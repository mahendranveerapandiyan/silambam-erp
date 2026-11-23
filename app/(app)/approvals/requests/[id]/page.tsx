import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requirePriv, can } from '@/lib/auth';
import { sql, type Row } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { fmtDate, fmtDateTime, money } from '@/lib/util';
import { HANDLERS, type HirePayload } from '@/lib/approvalHandlers';
import { PageHeader, Flash, Field, Select, Back, Badge, type SP } from '@/components/ui';
import { ConfirmButton } from '@/components/client';
import { REQ_COLOR } from '@/components/ApprovalList';
import { decide, withdrawMine, consoleAction } from '../../actions';

const TASK_COLOR: Record<string, string> = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', SKIPPED: 'gray', NOT_REQUIRED: 'gray', REASSIGNED: 'blue', WITHDRAWN: 'gray' };

/** The submitted transaction in readable form. */
async function describe(req: Row, L: (t: string, c: string) => string): Promise<[string, string][]> {
  if (req.process_code === 'STUDENT_ADMISSION' || req.process_code === 'STAFF_HIRE') {
    const o = (req.payload as HirePayload)?.o ?? {};
    const nm = async (table: string, id: string | null | undefined) => (id ? (await sql`select name from ${sql(table + '_f')} where id = ${id} order by effective_start_date desc limit 1`)[0]?.name ?? id : null);
    const rows: [string, string | null | undefined][] = [
      ['Name', [o.first_name, o.middle_name, o.last_name].filter(Boolean).join(' ') || (o.existing_person_number ? `Existing person ${o.existing_person_number}` : null)],
      [req.process_code === 'STAFF_HIRE' ? 'Hire date' : 'Admission date', o.hire_date ? fmtDate(o.hire_date) : null],
      ['Date of birth', o.date_of_birth ? fmtDate(o.date_of_birth) : null],
      ['Gender', o.gender_code ? L('GENDER', o.gender_code) : null],
      ['Business unit', await nm('business_unit', o.business_unit_id)],
      ['Branch', await nm('branch', o.branch_id)],
      ['Class › Section', o.class_id ? `${await nm('class', o.class_id)} › ${await nm('section', o.section_id)}` : null],
      ['Department', await nm('department', o.department_id)], ['Job', await nm('job', o.job_id)], ['Position', await nm('position', o.position_id)],
      ['Fee', o.fee_frequency_code ? `${L('FEE_FREQUENCY', o.fee_frequency_code)}${o.fee_amount ? ` · ${money(Number(o.fee_amount))} per installment` : ' · from Fee Structures'}` : null],
      ['Mobile', o.phone], ['Email', o.email],
      ['Identification', o.id1_type ? `${L('IDENTIFICATION_TYPE', o.id1_type)} ${o.id1_number ?? ''}` : null],
      ['Father', o.father_name ? `${o.father_name}${o.father_phone ? ` · ${o.father_phone}` : ''}` : null],
      ['Mother', o.mother_name ? `${o.mother_name}${o.mother_phone ? ` · ${o.mother_phone}` : ''}` : null],
      ['Guardian', o.guardian_name ? `${o.guardian_name}${o.guardian_phone ? ` · ${o.guardian_phone}` : ''}` : null],
      ['Parent login', o.parent_username], ['Staff login', o.login_password ? 'Yes (user name from User Name Rules)' : null],
      ['Photo', (req.payload as HirePayload)?.photo ? 'Attached' : null],
    ];
    return rows.filter((r): r is [string, string] => !!r[1]);
  }
  if (req.process_code === 'FEE_EXCEPTION') {
    const [e] = await sql`select e.*, d.description, d.period_label, d.amount line_amount, d.balance_amount from fee_exemption e join fee_demand_v d on d.id = e.demand_id where e.id = ${req.ref_id}`;
    if (!e) return [['Fee exception', 'The fee line no longer exists']];
    return [['Fee', `${e.description}${e.period_label ? ` ${e.period_label}` : ''}`], ['Line amount', money(e.line_amount)], ['Open balance', money(e.balance_amount)],
      ['Exception', money(e.amount)], ['Reason', L('EXEMPTION_REASON', e.reason_code)], ...(e.remarks ? [['Remarks', e.remarks] as [string, string]] : []),
      ['Exception status', L('APPROVAL_STATUS', e.status_code)]];
  }
  return [];
}

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requirePriv('CD_MY_APPROVALS_PRV');
  const { id } = await params;
  const [req] = await sql`select r.*, (select display_name from user_account x where x.id = r.requested_by_user_id) requester_name from approval_request r where r.id = ${id} and r.enterprise_id = ${u.enterpriseId}`;
  if (!req) notFound();
  const tasks = await sql`select t.*, ua.display_name, ua.username from approval_task t left join user_account ua on ua.id = t.approver_user_id where t.request_id = ${id} order by t.step_no, t.id`;
  const isConsole = can(u, 'CD_TRANSACTION_CONSOLE_PRV');
  const consoleWrite = can(u, 'CD_TRANSACTION_CONSOLE_PRV', 'WRITE');
  const mine = String(req.requested_by_user_id) === String(u.id);
  const myTask = tasks.find((t) => String(t.approver_user_id) === String(u.id) && t.status_code === 'PENDING');
  if (!mine && !isConsole && !tasks.some((t) => String(t.approver_user_id) === String(u.id))) redirect('/forbidden');
  const L = await lk();
  const details = await describe(req, L);
  const hist = await sql`select * from approval_history where request_id = ${id} order by at, id`;
  const link = HANDLERS[req.process_code]?.link?.(req) ?? null;
  const pending = req.status_code === 'PENDING';
  const back = `/approvals/requests/${id}`;
  const steps = [...new Set(tasks.map((t) => t.step_no))];
  const pendingTasks = tasks.filter((t) => t.status_code === 'PENDING');
  const users = consoleWrite && pending ? (await sql`select id, display_name, username from user_account where enterprise_id = ${u.enterpriseId} and active_flag = 'Y' order by display_name`)
    .map((x) => ({ value: String(x.id), label: x.display_name, code: x.username })) : [];
  return (
    <div className="max-w-6xl">
      <PageHeader title={`#${req.id} ${req.title}`}
        subtitle={<>{L('APPROVAL_PROCESS', req.process_code)} · requested by {req.requester_name ?? req.requested_by} on {fmtDateTime(req.created_at)} · <Badge color={REQ_COLOR[req.status_code]}>{L('APPROVAL_STATUS', req.status_code)}</Badge></>}
        actions={<>{link && <Link href={link} className="btn btn-primary">Open {req.process_code === 'FEE_EXCEPTION' ? 'fee page' : 'record'}</Link>}
          <Link href={isConsole ? '/approvals/console' : mine ? '/approvals/requests' : '/approvals'} className="btn">Back</Link></>} />
      <Flash sp={await searchParams} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="card">
            <h2 className="h2">Request</h2>
            {req.summary && <p className="mb-3 text-sm text-slate-600">{req.summary}</p>}
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {details.map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd className="text-sm">{v}</dd></div>)}
            </dl>
            {req.result_message && <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{req.result_message}</p>}
          </div>
          <div className="card overflow-x-auto">
            <h2 className="h2">Approvers</h2>
            <table className="tbl">
              <thead><tr><th>Step</th><th>Approver</th><th>Status</th><th>Acted</th><th>Comments</th></tr></thead>
              <tbody>{steps.flatMap((s) => tasks.filter((t) => t.step_no === s).map((t, i) => (
                <tr key={t.id}>
                  <td className="text-sm">{i === 0 && <><b>{s}</b> <span className="text-slate-500">{t.step_label}</span></>}</td>
                  <td>{t.display_name ?? <span className="text-slate-400">—</span>}</td>
                  <td><Badge color={TASK_COLOR[t.status_code]}>{L('APPROVAL_STATUS', t.status_code)}</Badge></td>
                  <td className="whitespace-nowrap text-xs">{t.acted_at ? `${t.acted_by ?? ''} · ${fmtDateTime(t.acted_at)}` : ''}</td>
                  <td className="text-sm">{t.comments}</td>
                </tr>
              )))}</tbody>
            </table>
          </div>
          <div className="card">
            <h2 className="h2">History</h2>
            <ol className="space-y-1 text-sm">{hist.map((h) => (
              <li key={h.id}><span className="text-xs text-slate-500">{fmtDateTime(h.at)}</span> · <b>{h.action}</b>{h.by_user && <> by {h.by_user}</>}{h.comments && <span className="text-slate-600"> – {h.comments}</span>}</li>
            ))}</ol>
          </div>
        </div>

        <div className="space-y-4">
          {pending && myTask && (
            <form action={decide.bind(null, String(myTask.id), 'APPROVE')} className="card space-y-2">
              <Back to={back} />
              <h2 className="h2">Your Decision</h2>
              <Field label="Comments"><textarea name="comments" rows={2} className="input" /></Field>
              <div className="flex gap-2"><button className="btn btn-primary">Approve</button>
                <button className="btn btn-danger" formAction={decide.bind(null, String(myTask.id), 'REJECT')} data-confirm="Reject this request? It will be closed.">Reject</button></div>
            </form>
          )}
          {pending && mine && !consoleWrite && (
            <form action={withdrawMine.bind(null, id)} className="card space-y-2">
              <Back to={back} />
              <h2 className="h2">Withdraw</h2>
              <p className="muted">Cancels the request; nothing is saved.</p>
              <Field label="Comments"><input name="comments" className="input" /></Field>
              <ConfirmButton className="btn btn-danger" message="Withdraw this request? The transaction is cancelled.">Withdraw</ConfirmButton>
            </form>
          )}
          {pending && consoleWrite && (
            <div className="card space-y-4">
              <h2 className="h2 mb-0">Transaction Console</h2>
              <form action={consoleAction.bind(null, id)} className="space-y-2">
                <Back to={back} />
                <Field label="Comments"><input name="comments" className="input" /></Field>
                <div className="flex flex-wrap gap-2">
                  <ConfirmButton className="btn btn-primary" name="op" value="APPROVE" message="Approve this request now? Remaining approvers are not asked and the transaction is completed.">Approve Now</ConfirmButton>
                  <ConfirmButton className="btn" name="op" value="REJECT" message="Reject this request?">Reject</ConfirmButton>
                  <ConfirmButton className="btn btn-danger" name="op" value="WITHDRAW" message="Withdraw this request? The transaction is cancelled.">Withdraw</ConfirmButton>
                </div>
              </form>
              {pendingTasks.length > 0 && (
                <form action={consoleAction.bind(null, id)} className="space-y-2 border-t border-black/10 pt-3">
                  <Back to={back} />
                  <h3 className="text-sm font-semibold">Reassign or skip an approver</h3>
                  <Field label="Pending approver"><Select name="task_id" options={pendingTasks.map((t) => ({ value: String(t.id), label: `Step ${t.step_no}: ${t.display_name}`, code: t.username }))} required /></Field>
                  <Field label="Reassign to" help="Only for Reassign"><Select name="to_user_id" options={users} empty="— Choose user —" /></Field>
                  <Field label="Comments"><input name="comments" className="input" /></Field>
                  <div className="flex gap-2">
                    <button className="btn" name="op" value="REASSIGN">Reassign</button>
                    <ConfirmButton className="btn" name="op" value="SKIP" message="Skip this approver? If nobody else in the step is still to decide, the request moves to the next step.">Skip</ConfirmButton>
                  </div>
                </form>
              )}
            </div>
          )}
          {!pending && <div className="card text-sm text-slate-600">This request is {L('APPROVAL_STATUS', req.status_code).toLowerCase()}{req.completed_at ? ` (${fmtDateTime(req.completed_at)})` : ''}.</div>}
        </div>
      </div>
    </div>
  );
}
