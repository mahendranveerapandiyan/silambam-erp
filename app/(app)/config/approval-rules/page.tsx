import Link from 'next/link';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { lk, lookupOptions } from '@/lib/lookups';
import { getAsOf } from '@/lib/asof';
import { stepLabel } from '@/lib/approvals';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP } from '@/components/ui';
import { saveRule } from '../../approvals/actions';

export default async function ApprovalRules({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_APPROVAL_RULE_PRV');
  const write = can(u, 'CD_APPROVAL_RULE_PRV', 'WRITE');
  const L = await lk();
  const processes = await lookupOptions('APPROVAL_PROCESS', await getAsOf());
  const rules = await sql`select r.*, (select count(*) from approval_request q where q.rule_id = r.id and q.status_code = 'PENDING')::int pending from approval_rule r
    where r.enterprise_id = ${u.enterpriseId} order by r.process_code, r.active_flag desc, r.name`;
  const steps = await sql`select s.* from approval_rule_step s join approval_rule r on r.id = s.rule_id where r.enterprise_id = ${u.enterpriseId} order by s.rule_id, s.step_no`;
  const labels: Record<string, string[]> = {};
  for (const s of steps) (labels[s.rule_id] ??= []).push(`${s.step_no}. ${await stepLabel(sql, s)}`);
  return (
    <div className="max-w-6xl">
      <PageHeader title="Approval Rules" subtitle="Who approves each process. A rule has ordered steps; each step's approvers are a user, a user group, holders of an area of responsibility, the requester's manager (by level) or a role. One active rule per process." />
      <Flash sp={await searchParams} />
      <div className="card mb-4 overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Process</th><th>Rule</th><th>Steps (in order)</th><th>Active</th><th>Pending</th><th></th></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.id}>
              <td>{L('APPROVAL_PROCESS', r.process_code)}</td><td>{r.name}{r.description && <div className="text-xs text-slate-500">{r.description}</div>}</td>
              <td className="text-sm">{(labels[r.id] ?? []).map((x) => <div key={x}>{x}</div>)}{!labels[r.id] && <span className="text-amber-700">No steps yet</span>}</td>
              <td>{r.active_flag === 'Y' ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>}</td><td>{r.pending}</td>
              <td><Link className="btn btn-sm" href={`/config/approval-rules/${r.id}`}>Open</Link></td>
            </tr>
          ))}</tbody>
        </table>
        {!rules.length && <Empty>No approval rules yet.</Empty>}
        <p className="muted mt-3">Student Admission (Admission Form) and Fee Exception always need approval – without an active rule an Administrator approves. Staff Hire needs approval only while it has an active rule.</p>
      </div>
      {write && (
        <form action={saveRule.bind(null, null)} className="card grid items-end gap-3 sm:grid-cols-4">
          <Back to="/config/approval-rules" />
          <h2 className="h2 sm:col-span-4">New Approval Rule</h2>
          <Field label="Process *"><Select name="process_code" options={processes} required /></Field>
          <Field label="Rule Name *"><input name="name" required className="input" /></Field>
          <Field label="Active"><select name="active_flag" defaultValue="N" className="input"><option value="Y">Yes</option><option value="N">No – add steps first</option></select></Field>
          <button className="btn btn-primary">Create</button>
        </form>
      )}
    </div>
  );
}
