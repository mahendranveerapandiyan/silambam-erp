import 'server-only';
import { sql, type Tx, type Row } from './db';
import type { SessionUser } from './auth';
import { managerOf } from './people';
import { todayISO } from './util';
import { HANDLERS } from './approvalHandlers';

/*
 * Approval engine.
 *  A rule (Configuration › Approval Rules) has ordered steps; each step names
 *  its approvers – a user, a user group, holders of an area of responsibility,
 *  the requester's manager N levels up, or a role – and for groups / AORs /
 *  roles whether ANY one approval is enough or ALL must approve.
 *  A request walks the steps in order. A step without anyone to approve is
 *  skipped (and recorded). When the last step is done the process handler
 *  completes the transaction (e.g. admits the student) in the same database
 *  transaction, so a failure leaves the request pending with the error shown.
 */

export type ProcessCode = 'STUDENT_ADMISSION' | 'STAFF_HIRE' | 'FEE_EXCEPTION';

/** Processes that always need approval (a default Administrator step is used when no rule is active). */
const ALWAYS: ProcessCode[] = ['STUDENT_ADMISSION', 'FEE_EXCEPTION'];

export async function activeRule(tx: Tx, enterpriseId: string, process: string) {
  const [rule] = await tx`select * from approval_rule where enterprise_id = ${enterpriseId} and process_code = ${process} and active_flag = 'Y'`;
  if (!rule) return null;
  const steps = await tx`select * from approval_rule_step where rule_id = ${rule.id} order by step_no`;
  return { rule, steps };
}

/** Does this process need approval right now (an active rule with steps, or always)? */
export async function needsApproval(enterpriseId: string, process: ProcessCode) {
  if (ALWAYS.includes(process)) return true;
  const r = await activeRule(sql, enterpriseId, process);
  return !!r && r.steps.length > 0;
}

const history = (tx: Tx, requestId: string, action: string, by: string | null, comments: string | null = null) =>
  tx`insert into approval_history (request_id, action, by_user, comments) values (${requestId}, ${action}, ${by}, ${comments})`;

/** Human label of a step, e.g. "Role: Administrator (any one)". */
export async function stepLabel(tx: Tx, step: Row) {
  const mode = step.approval_mode === 'ALL' ? ' (all must approve)' : ' (any one)';
  switch (step.approver_type) {
    case 'USER': { const [x] = await tx`select display_name, username from user_account where id = ${step.approver_ref}`; return `User: ${x?.display_name ?? step.approver_ref}`; }
    case 'USER_GROUP': { const [x] = await tx`select name from user_group where id = ${step.approver_ref}`; return `User group: ${x?.name ?? step.approver_ref}${mode}`; }
    case 'AOR': { const [x] = await tx`select meaning from lookup_value where lookup_type in ('STAFF_AOR', 'STUDENT_AOR') and lookup_code = ${step.approver_ref} limit 1`; return `Area of responsibility: ${x?.meaning ?? step.approver_ref}${mode}`; }
    case 'MANAGER': return Number(step.approver_ref) === 1 ? "Requester's manager" : `Requester's manager – level ${step.approver_ref}`;
    case 'ROLE': { const [x] = await tx`select name from app_role where code = ${step.approver_ref}`; return `Role: ${x?.name ?? step.approver_ref}${mode}`; }
    default: return step.approver_type;
  }
}

/** Active user ids who approve a step of a request (never the requester). */
async function resolveApprovers(tx: Tx, req: Row, step: Row): Promise<string[]> {
  const E = req.enterprise_id;
  const today = todayISO();
  let ids: string[] = [];
  switch (step.approver_type) {
    case 'USER':
      ids = (await tx`select id from user_account where id = ${step.approver_ref} and active_flag = 'Y'`).map((r) => String(r.id));
      break;
    case 'USER_GROUP':
      ids = (await tx`select m.user_id id from user_group_member m join user_group g on g.id = m.group_id and g.active_flag = 'Y'
        join user_account ua on ua.id = m.user_id and ua.active_flag = 'Y' where m.group_id = ${step.approver_ref}`).map((r) => String(r.id));
      break;
    case 'ROLE':
      ids = (await tx`select ua.id from user_account ua join user_role ur on ur.user_id = ua.id
        where ua.enterprise_id = ${E} and ua.active_flag = 'Y' and ur.role_code = ${step.approver_ref}`).map((r) => String(r.id));
      break;
    case 'AOR':
      ids = (await tx`select distinct ua.id from area_of_responsibility r join user_account ua on ua.person_id = r.person_id and ua.active_flag = 'Y'
        where r.enterprise_id = ${E} and r.aor_type_code = ${step.approver_ref} and ${today}::date between r.start_date and r.end_date`).map((r) => String(r.id));
      break;
    case 'MANAGER': {
      const [requester] = await tx`select person_id from user_account where id = ${req.requested_by_user_id}`;
      let person: string | null = requester?.person_id ? String(requester.person_id) : null;
      for (let level = 1; person && level <= Number(step.approver_ref || 1); level++) {
        const m = await managerOf(person, today);
        person = m ? String(m.person_id) : null;
      }
      if (person) ids = (await tx`select id from user_account where person_id = ${person} and active_flag = 'Y'`).map((r) => String(r.id));
      break;
    }
  }
  return [...new Set(ids)].filter((id) => id !== String(req.requested_by_user_id ?? ''));
}

/** Moves a request to its next step (skipping steps without approvers) or completes it. */
async function advance(tx: Tx, req: Row, actor: string) {
  const plan = req.rule_id
    ? await tx`select * from approval_rule_step where rule_id = ${req.rule_id} order by step_no`
    : [{ step_no: 1, approver_type: 'ROLE', approver_ref: 'ADMIN', approval_mode: 'ANY' }]; // default for processes that always need approval
  for (const step of plan.filter((p) => p.step_no > (req.current_step ?? 0))) {
    const label = await stepLabel(tx, step);
    const approvers = await resolveApprovers(tx, req, step);
    await tx`update approval_request set current_step = ${step.step_no} where id = ${req.id}`;
    req.current_step = step.step_no;
    if (!approvers.length) {
      await tx`insert into approval_task (request_id, step_no, step_label, approver_user_id, approval_mode, status_code, acted_by, acted_at, comments)
        values (${req.id}, ${step.step_no}, ${label}, null, ${step.approval_mode}, 'SKIPPED', 'SYSTEM', now(), 'No approver found for this step')`;
      await history(tx, req.id, `Step ${step.step_no} skipped – no approver found (${label})`, 'SYSTEM');
      continue;
    }
    for (const a of approvers)
      await tx`insert into approval_task (request_id, step_no, step_label, approver_user_id, approval_mode) values (${req.id}, ${step.step_no}, ${label}, ${a}, ${step.approval_mode})`;
    return 'PENDING' as const;
  }
  await complete(tx, req, actor);
  return 'APPROVED' as const;
}

/** Final approval: the process handler completes the transaction. */
async function complete(tx: Tx, req: Row, actor: string, note = 'Approved – transaction completed') {
  const h = HANDLERS[req.process_code as ProcessCode];
  const r = h ? await h.onApprove(tx, req, actor) : {};
  await tx`update approval_task set status_code = 'NOT_REQUIRED', acted_at = now() where request_id = ${req.id} and status_code = 'PENDING'`;
  await tx`update approval_request set status_code = 'APPROVED', completed_at = now(), result_ref = ${r.resultRef ?? null}, result_message = ${r.message ?? null} where id = ${req.id}`;
  await history(tx, req.id, note, actor, r.message ?? null);
}

/**
 * Submit a request. Returns null when the process needs no approval (no active
 * rule) – the caller then does the transaction directly.
 */
export async function submitRequest(tx: Tx, u: SessionUser, p: { process: ProcessCode; title: string; summary?: string | null; refTable?: string | null; refId?: string | null; payload?: unknown }) {
  const r = await activeRule(tx, u.enterpriseId, p.process);
  const hasSteps = !!r && r.steps.length > 0;
  if (!hasSteps && !ALWAYS.includes(p.process)) return null;
  const [req] = await tx`insert into approval_request ${tx({
    enterprise_id: u.enterpriseId, process_code: p.process, title: p.title, summary: p.summary ?? null, ref_table: p.refTable ?? null, ref_id: p.refId ?? null,
    payload: (p.payload ?? null) as any, rule_id: hasSteps ? r!.rule.id : null, requested_by_user_id: u.id, requested_by: u.username, current_step: 0,
  })} returning *`;
  await history(tx, req.id, 'Submitted', u.username);
  const status = await advance(tx, req, u.username);
  return { id: String(req.id), status };
}

async function lockRequest(tx: Tx, requestId: string, enterpriseId: string) {
  const [req] = await tx`select * from approval_request where id = ${requestId} and enterprise_id = ${enterpriseId} for update`;
  if (!req) throw new Error('Request not found');
  if (req.status_code !== 'PENDING') throw new Error(`This request is already ${String(req.status_code).toLowerCase()}.`);
  return req;
}

/** Is the step of this task finished (ANY: one approval; ALL: nobody pending)? */
async function stepDone(tx: Tx, requestId: string, stepNo: number) {
  const rows = await tx`select approval_mode, status_code from approval_task where request_id = ${requestId} and step_no = ${stepNo}`;
  const pending = rows.filter((r) => r.status_code === 'PENDING').length;
  const approved = rows.filter((r) => r.status_code === 'APPROVED').length;
  const mode = rows[0]?.approval_mode ?? 'ANY';
  return mode === 'ALL' ? pending === 0 : approved > 0 || pending === 0;
}

/** An approver acts on their task. */
export async function decideTask(u: SessionUser, taskId: string, decision: 'APPROVE' | 'REJECT', comments: string | null) {
  return sql.begin(async (tx) => {
    const [t] = await tx`select * from approval_task where id = ${taskId}`;
    if (!t) throw new Error('Task not found');
    const req = await lockRequest(tx, t.request_id, u.enterpriseId);
    if (t.status_code !== 'PENDING') throw new Error('This task is no longer pending.');
    if (String(t.approver_user_id) !== String(u.id)) throw new Error('This task is assigned to someone else.');
    if (decision === 'REJECT') {
      await tx`update approval_task set status_code = 'REJECTED', acted_by = ${u.username}, acted_at = now(), comments = ${comments} where id = ${taskId}`;
      return rejectRequest(tx, req, u.username, comments);
    }
    await tx`update approval_task set status_code = 'APPROVED', acted_by = ${u.username}, acted_at = now(), comments = ${comments} where id = ${taskId}`;
    await history(tx, req.id, `Approved (step ${t.step_no})`, u.username, comments);
    if (t.approval_mode !== 'ALL') await tx`update approval_task set status_code = 'NOT_REQUIRED', acted_at = now() where request_id = ${req.id} and step_no = ${t.step_no} and status_code = 'PENDING'`;
    if (!(await stepDone(tx, req.id, t.step_no))) return 'PENDING';
    return advance(tx, req, u.username);
  });
}

async function rejectRequest(tx: Tx, req: Row, actor: string, comments: string | null) {
  await tx`update approval_task set status_code = 'NOT_REQUIRED', acted_at = now() where request_id = ${req.id} and status_code = 'PENDING'`;
  await tx`update approval_request set status_code = 'REJECTED', completed_at = now() where id = ${req.id}`;
  await HANDLERS[req.process_code as ProcessCode]?.onReject?.(tx, req, actor);
  await history(tx, req.id, 'Rejected', actor, comments);
  return 'REJECTED' as const;
}

// ----------------------------------------------------------- console actions

/** Approve the whole request now – the transaction is completed. */
export async function forceApprove(u: SessionUser, requestId: string, comments: string | null) {
  return sql.begin(async (tx) => {
    const req = await lockRequest(tx, requestId, u.enterpriseId);
    await complete(tx, req, u.username, `Approved from the Transaction Console${comments ? '' : ''}`);
    if (comments) await history(tx, req.id, 'Comment', u.username, comments);
    return 'APPROVED';
  });
}

export async function forceReject(u: SessionUser, requestId: string, comments: string | null) {
  return sql.begin(async (tx) => rejectRequest(tx, await lockRequest(tx, requestId, u.enterpriseId), u.username, comments));
}

/** Withdraw: the transaction is cancelled (requester or console). */
export async function withdrawRequest(u: SessionUser, requestId: string, comments: string | null, asAdmin: boolean) {
  return sql.begin(async (tx) => {
    const req = await lockRequest(tx, requestId, u.enterpriseId);
    if (!asAdmin && String(req.requested_by_user_id) !== String(u.id)) throw new Error('Only the requester (or the Transaction Console) can withdraw this request.');
    await tx`update approval_task set status_code = 'WITHDRAWN', acted_at = now() where request_id = ${req.id} and status_code = 'PENDING'`;
    await tx`update approval_request set status_code = 'WITHDRAWN', completed_at = now() where id = ${req.id}`;
    await HANDLERS[req.process_code as ProcessCode]?.onWithdraw?.(tx, req, u.username);
    await history(tx, req.id, 'Withdrawn – transaction cancelled', u.username, comments);
    return 'WITHDRAWN';
  });
}

/** Give a pending approver's task to someone else. */
export async function reassignTask(u: SessionUser, taskId: string, toUserId: string, comments: string | null) {
  return sql.begin(async (tx) => {
    const [t] = await tx`select * from approval_task where id = ${taskId}`;
    if (!t) throw new Error('Task not found');
    const req = await lockRequest(tx, t.request_id, u.enterpriseId);
    if (t.status_code !== 'PENDING') throw new Error('Only a pending approver can be reassigned.');
    const [to] = await tx`select id, display_name from user_account where id = ${toUserId} and enterprise_id = ${u.enterpriseId} and active_flag = 'Y'`;
    if (!to) throw new Error('Choose an active user to reassign to.');
    const [dup] = await tx`select 1 from approval_task where request_id = ${req.id} and step_no = ${t.step_no} and approver_user_id = ${toUserId} and status_code = 'PENDING'`;
    if (dup) throw new Error(`${to.display_name} is already an approver of this step.`);
    const [from] = await tx`select display_name from user_account where id = ${t.approver_user_id}`;
    await tx`update approval_task set status_code = 'REASSIGNED', acted_by = ${u.username}, acted_at = now(), comments = ${'Reassigned to ' + to.display_name + (comments ? ` – ${comments}` : '')} where id = ${taskId}`;
    await tx`insert into approval_task (request_id, step_no, step_label, approver_user_id, approval_mode) values (${req.id}, ${t.step_no}, ${t.step_label}, ${toUserId}, ${t.approval_mode})`;
    await history(tx, req.id, `Reassigned (step ${t.step_no}) from ${from?.display_name ?? '?'} to ${to.display_name}`, u.username, comments);
    return 'PENDING';
  });
}

/** Skip a pending approver; when the step is then done the request moves on. */
export async function skipTask(u: SessionUser, taskId: string, comments: string | null) {
  return sql.begin(async (tx) => {
    const [t] = await tx`select * from approval_task where id = ${taskId}`;
    if (!t) throw new Error('Task not found');
    const req = await lockRequest(tx, t.request_id, u.enterpriseId);
    if (t.status_code !== 'PENDING') throw new Error('Only a pending approver can be skipped.');
    const [who] = await tx`select display_name from user_account where id = ${t.approver_user_id}`;
    await tx`update approval_task set status_code = 'SKIPPED', acted_by = ${u.username}, acted_at = now(), comments = ${comments} where id = ${taskId}`;
    await history(tx, req.id, `Skipped approver ${who?.display_name ?? ''} (step ${t.step_no})`, u.username, comments);
    // ANY: skipping counts only when nobody else is still pending; ALL: the rest still decide
    const rows = await tx`select status_code from approval_task where request_id = ${req.id} and step_no = ${t.step_no}`;
    const pending = rows.filter((r) => r.status_code === 'PENDING').length;
    const approved = rows.filter((r) => r.status_code === 'APPROVED').length;
    if (pending > 0 && !(t.approval_mode !== 'ALL' && approved > 0)) return 'PENDING';
    return advance(tx, req, u.username);
  });
}

/** Ids of requests the user may see as an approver. */
export const myTaskFilter = (userId: string) => sql`exists (select 1 from approval_task t where t.request_id = r.id and t.approver_user_id = ${userId})`;
