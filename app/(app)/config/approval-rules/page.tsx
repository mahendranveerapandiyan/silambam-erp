import Link from 'next/link';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { lk, lookupOptions } from '@/lib/lookups';
import { getAsOf } from '@/lib/asof';
import { stepLabel, describeCondition } from '@/lib/approvals';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP } from '@/components/ui';
import { saveRule } from '../../approvals/actions';

const NO_MATCH: Record<string, string> = {
  STUDENT_ADMISSION: 'an Administrator approves',
  FEE_EXCEPTION: 'an Administrator approves',
  STAFF_HIRE: 'no approval is needed',
};

export default async function ApprovalRules({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_APPROVAL_RULE_PRV');
  const write = can(u, 'CD_APPROVAL_RULE_PRV', 'WRITE');
  const L = await lk();
  const asOf = await getAsOf();
  const processes = await lookupOptions('APPROVAL_PROCESS', asOf);
  const outcomes = await lookupOptions('APPROVAL_OUTCOME', asOf);
  const rules = await sql`select r.*, (select count(*) from approval_request q where q.rule_id = r.id and q.status_code = 'PENDING')::int pending from approval_rule r
    where r.enterprise_id = ${u.enterpriseId} order by r.process_code, r.active_flag desc, r.priority, r.id`;
  const steps = await sql`select s.* from approval_rule_step s join approval_rule r on r.id = s.rule_id where r.enterprise_id = ${u.enterpriseId} order by s.rule_id, s.step_no`;
  const conds = await sql`select c.* from approval_rule_condition c join approval_rule r on r.id = c.rule_id where r.enterprise_id = ${u.enterpriseId} order by c.rule_id, c.id`;
  const stepText: Record<string, string[]> = {};
  for (const s of steps) (stepText[s.rule_id] ??= []).push(`${s.step_no}. ${await stepLabel(sql, s)}`);
  const condText: Record<string, string[]> = {};
  for (const c of conds) (condText[c.rule_id] ??= []).push(await describeCondition(sql, c));
  return (
    <div className="max-w-6xl">
      <PageHeader title="Approval Rules" subtitle="A process can have several rules. They are checked in priority order (lower first); the first rule whose conditions all match decides – its approval steps, or no approval at all. A rule without conditions matches everything, so put it last as the catch-all." />
      <Flash sp={await searchParams} />
      <div className="space-y-4">
        {processes.map((p) => {
          const list = rules.filter((r) => r.process_code === p.value);
          return (
            <div key={p.value} className="card overflow-x-auto">
              <h2 className="h2">{p.label}</h2>
              {list.length ? (
                <table className="tbl">
                  <thead><tr><th>Priority</th><th>Rule</th><th>When</th><th>Then</th><th>Active</th><th>Pending</th><th></th></tr></thead>
                  <tbody>{list.map((r) => (
                    <tr key={r.id} className={r.active_flag === 'Y' ? '' : 'opacity-60'}>
                      <td className="font-semibold">{r.priority}</td>
                      <td>{r.name}{r.description && <div className="text-xs text-slate-500">{r.description}</div>}</td>
                      <td className="text-sm">{(condText[r.id] ?? []).map((x) => <div key={x}>{x}</div>)}{!condText[r.id] && <span className="text-slate-500">Always (no conditions)</span>}</td>
                      <td className="text-sm">{r.outcome_code === 'AUTO'
                        ? <Badge color="green">No approval required</Badge>
                        : <>{(stepText[r.id] ?? []).map((x) => <div key={x}>{x}</div>)}{!stepText[r.id] && <span className="text-amber-700">No steps yet</span>}</>}</td>
                      <td>{r.active_flag === 'Y' ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>}</td><td>{r.pending}</td>
                      <td><Link className="btn btn-sm" href={`/config/approval-rules/${r.id}`}>Open</Link></td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <Empty>No rules for this process.</Empty>}
              <p className="muted mt-2">When no active rule matches: {NO_MATCH[p.value] ?? 'no approval is needed'}.</p>
            </div>
          );
        })}
      </div>
      {write && (
        <form action={saveRule.bind(null, null)} className="card mt-4 grid items-end gap-3 sm:grid-cols-5">
          <Back to="/config/approval-rules" />
          <h2 className="h2 sm:col-span-5">New Approval Rule</h2>
          <Field label="Process *"><Select name="process_code" options={processes} required /></Field>
          <Field label="Rule Name *"><input name="name" required className="input" /></Field>
          <Field label="Priority *" help="Lower is checked first"><input name="priority" type="number" min={0} defaultValue={10} required className="input" /></Field>
          <Field label="Outcome *"><Select name="outcome_code" options={outcomes} value="APPROVAL" empty={false} /></Field>
          <Field label="Active"><select name="active_flag" defaultValue="N" className="input"><option value="Y">Yes</option><option value="N">No – add conditions / steps first</option></select></Field>
          <button className="btn btn-primary sm:col-span-5 sm:w-fit">Create</button>
        </form>
      )}
    </div>
  );
}
