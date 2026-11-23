'use server';
import { sql } from '@/lib/db';
import { requirePriv, can } from '@/lib/auth';
import { act, backOf, formObj } from '@/lib/util';
import { decideTask, forceApprove, forceReject, withdrawRequest, reassignTask, skipTask } from '@/lib/approvals';

const outcome: Record<string, string> = {
  APPROVED: 'Approved – the transaction has been completed.',
  PENDING: 'Recorded – the request moves on to the next approver.',
  REJECTED: 'Rejected – the request has been closed.',
  WITHDRAWN: 'Withdrawn – the transaction has been cancelled.',
};

// ---------------------------------------------------------- approver
export async function decide(taskId: string, decision: 'APPROVE' | 'REJECT', fd: FormData) {
  const u = await requirePriv('CD_MY_APPROVALS_PRV', 'WRITE');
  await act(backOf(fd, '/approvals'), async () => {
    const st = await decideTask(u, taskId, decision, formObj(fd).comments);
    return { msg: outcome[st] ?? st };
  });
}

export async function withdrawMine(requestId: string, fd: FormData) {
  const u = await requirePriv('CD_MY_APPROVALS_PRV', 'WRITE');
  await act(backOf(fd, '/approvals/requests'), async () => ({ msg: outcome[await withdrawRequest(u, requestId, formObj(fd).comments, false)] }));
}

// ---------------------------------------------------------- transaction console
export async function consoleAction(requestId: string, fd: FormData) {
  const u = await requirePriv('CD_TRANSACTION_CONSOLE_PRV', 'WRITE');
  await act(backOf(fd, `/approvals/requests/${requestId}`), async () => {
    const o = formObj(fd);
    let st: string;
    switch (o.op) {
      case 'APPROVE': st = await forceApprove(u, requestId, o.comments); break;
      case 'REJECT': st = await forceReject(u, requestId, o.comments); break;
      case 'WITHDRAW': st = await withdrawRequest(u, requestId, o.comments, true); break;
      case 'REASSIGN':
        if (!o.task_id || !o.to_user_id) throw new Error('Choose the approver and who to reassign to.');
        st = await reassignTask(u, o.task_id, o.to_user_id, o.comments);
        return { msg: 'The approver has been reassigned.' };
      case 'SKIP':
        if (!o.task_id) throw new Error('Choose the approver to skip.');
        st = await skipTask(u, o.task_id, o.comments);
        return { msg: st === 'PENDING' ? 'The approver has been skipped.' : `The approver has been skipped. ${outcome[st] ?? ''}` };
      default: throw new Error('Unknown action');
    }
    return { msg: outcome[st] ?? st };
  });
}

// ---------------------------------------------------------- approval rules
export async function saveRule(id: string | null, fd: FormData) {
  const u = await requirePriv('CD_APPROVAL_RULE_PRV', 'WRITE');
  await act(backOf(fd, '/config/approval-rules'), async () => {
    const o = formObj(fd);
    if (!o.process_code || !o.name) throw new Error('Process and rule name are required');
    const active = o.active_flag === 'N' ? 'N' : 'Y';
    let rid = id;
    await sql.begin(async (tx) => {
      if (active === 'Y') {
        const [other] = await tx`select name from approval_rule where enterprise_id = ${u.enterpriseId} and process_code = ${o.process_code} and active_flag = 'Y' ${rid ? tx`and id <> ${rid}` : tx``}`;
        if (other) throw new Error(`"${other.name}" is already the active rule for this process. Deactivate it first – one active rule per process.`);
      }
      const v = { process_code: o.process_code, name: o.name, description: o.description, active_flag: active, last_updated_by: u.username, last_update_date: new Date() };
      if (rid) await tx`update approval_rule set ${tx(v)} where id = ${rid} and enterprise_id = ${u.enterpriseId}`;
      else rid = String((await tx`insert into approval_rule ${tx({ ...v, enterprise_id: u.enterpriseId, created_by: u.username })} returning id`)[0].id);
    });
    return { to: `/config/approval-rules/${rid}`, msg: `${o.name} approval rule has been ${id ? 'updated' : 'created'}.` };
  });
}

export async function deleteRule(id: string, fd: FormData) {
  const u = await requirePriv('CD_APPROVAL_RULE_PRV', 'WRITE');
  await act(backOf(fd, '/config/approval-rules'), async () => {
    const [r] = await sql`select name from approval_rule where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    if (!r) throw new Error('Rule not found');
    const [p] = await sql`select count(*)::int n from approval_request where rule_id = ${id} and status_code = 'PENDING'`;
    if (p.n) throw new Error(`${r.name} has ${p.n} pending request(s). Deactivate it instead, or finish those requests first.`);
    await sql`delete from approval_rule where id = ${id}`;
    return { to: '/config/approval-rules', msg: `${r.name} approval rule has been deleted.` };
  });
}

export async function saveStep(ruleId: string, stepId: string | null, fd: FormData) {
  const u = await requirePriv('CD_APPROVAL_RULE_PRV', 'WRITE');
  await act(backOf(fd, `/config/approval-rules/${ruleId}`), async () => {
    const o = formObj(fd);
    const [r] = await sql`select id from approval_rule where id = ${ruleId} and enterprise_id = ${u.enterpriseId}`;
    if (!r) throw new Error('Rule not found');
    if (o._delete) {
      await sql`delete from approval_rule_step where id = ${stepId} and rule_id = ${ruleId}`;
      // keep the steps numbered 1, 2, 3 …
      const left = await sql`select id from approval_rule_step where rule_id = ${ruleId} order by step_no`;
      await sql.begin(async (tx) => {
        for (const [i, s] of left.entries()) await tx`update approval_rule_step set step_no = ${-(i + 1)} where id = ${s.id}`;
        await tx`update approval_rule_step set step_no = -step_no where rule_id = ${ruleId}`;
      });
      return { msg: 'The step has been removed.' };
    }
    const type = o.approver_type;
    const ref = type === 'USER' ? o.ref_user : type === 'USER_GROUP' ? o.ref_group : type === 'AOR' ? o.ref_aor : type === 'MANAGER' ? o.ref_level : type === 'ROLE' ? o.ref_role : null;
    if (!type || !ref) throw new Error('Choose the approver type and who approves');
    if (type === 'MANAGER' && !(Number(ref) >= 1 && Number(ref) <= 10)) throw new Error('Manager level must be between 1 and 10');
    const mode = ['USER_GROUP', 'AOR', 'ROLE'].includes(type) && o.approval_mode === 'ALL' ? 'ALL' : 'ANY';
    const stepNo = Number(o.step_no);
    if (!Number.isInteger(stepNo) || stepNo < 1) throw new Error('Step number must be 1 or more');
    const [clash] = await sql`select 1 from approval_rule_step where rule_id = ${ruleId} and step_no = ${stepNo} ${stepId ? sql`and id <> ${stepId}` : sql``}`;
    if (clash) throw new Error(`Step ${stepNo} already exists – use another number.`);
    const v = { step_no: stepNo, approver_type: type, approver_ref: String(ref), approval_mode: mode };
    if (stepId) await sql`update approval_rule_step set ${sql(v)} where id = ${stepId} and rule_id = ${ruleId}`;
    else await sql`insert into approval_rule_step ${sql({ ...v, rule_id: ruleId })}`;
    return { msg: `Step ${stepNo} has been ${stepId ? 'updated' : 'added'}.` };
  });
}

// ---------------------------------------------------------- user groups
export async function saveGroup(id: string | null, fd: FormData) {
  const u = await requirePriv('CD_USER_GROUP_PRV', 'WRITE');
  await act(backOf(fd, '/config/user-groups'), async () => {
    const o = formObj(fd);
    if (!o.name || (!id && !o.code)) throw new Error('Code and name are required');
    const members = fd.getAll('members').map(String).filter(Boolean);
    let gid = id;
    await sql.begin(async (tx) => {
      const v = { name: o.name, description: o.description, active_flag: o.active_flag === 'N' ? 'N' : 'Y', last_updated_by: u.username, last_update_date: new Date() };
      if (gid) await tx`update user_group set ${tx(v)} where id = ${gid} and enterprise_id = ${u.enterpriseId}`;
      else {
        const code = o.code!.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const [dup] = await tx`select 1 from user_group where enterprise_id = ${u.enterpriseId} and code = ${code}`;
        if (dup) throw new Error(`A user group with code ${code} already exists.`);
        gid = String((await tx`insert into user_group ${tx({ ...v, code, enterprise_id: u.enterpriseId, created_by: u.username })} returning id`)[0].id);
      }
      await tx`delete from user_group_member where group_id = ${gid}`;
      for (const m of members) await tx`insert into user_group_member values (${gid}, ${m}) on conflict do nothing`;
    });
    return { to: `/config/user-groups?edit=${gid}`, msg: `${o.name} user group has been ${id ? 'updated' : 'created'} with ${members.length} member(s).` };
  });
}

export async function deleteGroup(id: string, fd: FormData) {
  const u = await requirePriv('CD_USER_GROUP_PRV', 'WRITE');
  await act(backOf(fd, '/config/user-groups'), async () => {
    const [g] = await sql`select name from user_group where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    if (!g) throw new Error('User group not found');
    const [used] = await sql`select count(*)::int n from approval_rule_step where approver_type = 'USER_GROUP' and approver_ref = ${String(id)}`;
    if (used.n) throw new Error(`${g.name} is used in ${used.n} approval rule step(s). Change those steps first, or deactivate the group.`);
    await sql`delete from user_group where id = ${id}`;
    return { to: '/config/user-groups', msg: `${g.name} user group has been deleted.` };
  });
}

