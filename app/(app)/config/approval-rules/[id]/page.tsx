import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { lk, lookupOptions } from '@/lib/lookups';
import { getAsOf } from '@/lib/asof';
import { stepLabel } from '@/lib/approvals';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP, s as one } from '@/components/ui';
import { ConfirmButton, ShowFor } from '@/components/client';
import { EditableForm } from '@/components/EditMode';
import { saveRule, deleteRule, saveStep } from '../../../approvals/actions';

export default async function ApprovalRule({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requirePriv('CD_APPROVAL_RULE_PRV');
  const write = can(u, 'CD_APPROVAL_RULE_PRV', 'WRITE');
  const { id } = await params;
  const sp = await searchParams;
  const asOf = await getAsOf();
  const [rule] = await sql`select * from approval_rule where id = ${id} and enterprise_id = ${u.enterpriseId}`;
  if (!rule) notFound();
  const L = await lk();
  const steps = await sql`select * from approval_rule_step where rule_id = ${id} order by step_no`;
  const labelled: any[] = await Promise.all(steps.map(async (s) => ({ ...(s as Record<string, any>), label: await stepLabel(sql, s) })));
  const editing = steps.find((s) => String(s.id) === one(sp.step));
  const [processes, types, modes] = [await lookupOptions('APPROVAL_PROCESS', asOf), await lookupOptions('APPROVER_TYPE', asOf), await lookupOptions('APPROVAL_MODE', asOf)];
  const users = (await sql`select id, display_name, username from user_account where enterprise_id = ${u.enterpriseId} and active_flag = 'Y' order by display_name`)
    .map((x) => ({ value: String(x.id), label: x.display_name, code: x.username }));
  const groups = (await sql`select id, code, name from user_group where enterprise_id = ${u.enterpriseId} and active_flag = 'Y' order by name`).map((x) => ({ value: String(x.id), label: x.name, code: x.code }));
  const aors = [...(await lookupOptions('STAFF_AOR', asOf)).map((x) => ({ ...x, label: `${x.label} (staff)` })), ...(await lookupOptions('STUDENT_AOR', asOf)).map((x) => ({ ...x, label: `${x.label} (student)` }))];
  const roles = (await sql`select code, name from app_role where active_flag = 'Y' order by name`).map((x) => ({ value: x.code, label: x.name, code: x.code }));
  const back = `/config/approval-rules/${id}`;
  const e = editing ?? null;
  const ref = (t: string) => (e && e.approver_type === t ? e.approver_ref : null);
  return (
    <div className="max-w-5xl">
      <PageHeader title={`Approval Rule: ${rule.name}`} subtitle={<>{L('APPROVAL_PROCESS', rule.process_code)} · {rule.active_flag === 'Y' ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>}</>}
        actions={<Link href="/config/approval-rules" className="btn">Back</Link>} />
      <Flash sp={sp} />
      <div className="space-y-4">
        <EditableForm action={saveRule.bind(null, id)} canEdit={write}>
          <Back to={back} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Process *"><Select name="process_code" options={processes} value={rule.process_code} required /></Field>
            <Field label="Rule Name *"><input name="name" defaultValue={rule.name} required className="input" /></Field>
            <Field label="Active"><select name="active_flag" defaultValue={rule.active_flag} className="input"><option value="Y">Yes</option><option value="N">No</option></select></Field>
            <Field label="Description" className="sm:col-span-3"><input name="description" defaultValue={rule.description ?? ''} className="input" /></Field>
          </div>
        </EditableForm>

        <div className="card overflow-x-auto">
          <h2 className="h2">Steps</h2>
          <p className="muted mb-2">Steps run in order. A step is done when one approver approves (Any) or every approver approves (All); a step without anyone to approve is skipped. The requester never approves their own request.</p>
          <table className="tbl">
            <thead><tr><th>Step</th><th>Approvers</th>{write && <th></th>}</tr></thead>
            <tbody>{labelled.map((s) => (
              <tr key={s.id} className={e && String(e.id) === String(s.id) ? 'bg-sky-50' : ''}>
                <td className="w-16 font-semibold">{s.step_no}</td><td>{s.label}</td>
                {write && <td className="whitespace-nowrap"><div className="flex gap-1">
                  <Link className="btn btn-sm" href={`${back}?step=${s.id}#step`}>Edit</Link>
                  <form action={saveStep.bind(null, id, String(s.id))}><Back to={back} /><ConfirmButton className="btn btn-sm btn-danger" name="_delete" value="1" message={`Remove step ${s.step_no} (${s.label})?`}>Delete</ConfirmButton></form>
                </div></td>}
              </tr>
            ))}</tbody>
          </table>
          {!steps.length && <Empty>No steps yet – add the first approver below.</Empty>}
        </div>

        {write && (
          <form id="step" action={saveStep.bind(null, id, e ? String(e.id) : null)} className="card">
            <Back to={back} />
            <h2 className="h2">{e ? `Edit Step ${e.step_no}` : 'Add Step'}</h2>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Step No. *"><input name="step_no" type="number" min={1} defaultValue={e?.step_no ?? steps.length + 1} required className="input" /></Field>
              <Field label="Approver Type *"><Select name="approver_type" options={types} value={e?.approver_type ?? 'ROLE'} empty={false} /></Field>
              <div data-show-for-approver_type="USER"><Field label="User *"><Select name="ref_user" options={users} value={ref('USER')} required /></Field></div>
              <div data-show-for-approver_type="USER_GROUP"><Field label="User Group *" help="Configuration › User Groups"><Select name="ref_group" options={groups} value={ref('USER_GROUP')} required /></Field></div>
              <div data-show-for-approver_type="AOR"><Field label="Area of Responsibility *" help="People holding it on the day"><Select name="ref_aor" options={aors} value={ref('AOR')} required /></Field></div>
              <div data-show-for-approver_type="MANAGER"><Field label="Manager Level *" help="1 = requester's manager, 2 = their manager …"><input name="ref_level" type="number" min={1} max={10} defaultValue={ref('MANAGER') ?? 1} required className="input" /></Field></div>
              <div data-show-for-approver_type="ROLE"><Field label="Role *"><Select name="ref_role" options={roles} value={ref('ROLE') ?? 'ADMIN'} required /></Field></div>
              <div data-show-for-approver_type="USER_GROUP,AOR,ROLE"><Field label="Approval *" help="When the group / AOR / role has several people"><Select name="approval_mode" options={modes} value={e?.approval_mode ?? 'ANY'} empty={false} /></Field></div>
            </div>
            <ShowFor select="approver_type" />
            <div className="mt-3 flex gap-2"><button className="btn btn-primary">{e ? 'Save Step' : 'Add Step'}</button>{e && <Link href={back} className="btn">Cancel</Link>}</div>
          </form>
        )}

        {write && (
          <form action={deleteRule.bind(null, id)} className="card">
            <Back to={back} />
            <h2 className="h2">Delete Rule</h2>
            <p className="muted mb-2">Not possible while requests under this rule are pending – deactivate it instead.</p>
            <ConfirmButton className="btn btn-danger" message={`Delete the approval rule ${rule.name} and its steps?`}>Delete</ConfirmButton>
          </form>
        )}
      </div>
    </div>
  );
}
