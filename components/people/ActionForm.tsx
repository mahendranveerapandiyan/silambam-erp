import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { SessionUser } from '@/lib/auth';
import { assignmentBase, assignmentFor, assignmentFormOptions, personDetail, actionAndReasonOptions, type PersonKind } from '@/lib/people';
import { sql } from '@/lib/db';
import { fmtDate } from '@/lib/util';
import { PageHeader, Flash, Field, Back, Select, Badge, STATUS_COLOR } from '../ui';
import { AssignmentFields } from './AssignmentFields';
import { ActionPicker } from './ActionPicker';
import { assignmentAction } from '@/app/(app)/people/actions';

export async function ActionForm({ u, kind, personId, asOf, sp }: { u: SessionUser; kind: PersonKind; personId: string; asOf: string; sp: Record<string, any> }) {
  const [p, ab] = [await personDetail(personId, asOf), await assignmentBase(personId, kind)];
  if (!p || !ab) notFound();
  const a = (await assignmentFor(personId, kind, asOf)) ??
    (await sql`select af.* from assignment_f af where af.id = ${ab.id} order by effective_start_date desc limit 1`)[0];
  const { actions, reasons } = await actionAndReasonOptions(u.enterpriseId, kind, 'OTHER');
  const hire = await actionAndReasonOptions(u.enterpriseId, kind, 'HIRE');
  const versions = (await sql`select effective_start_date, effective_end_date, action_id, action_reason_code from assignment_f where id = ${ab.id} order by effective_start_date`)
    .map((r, i) => ({ start: r.effective_start_date as string, end: r.effective_end_date as string, action_id: r.action_id ? String(r.action_id) : null, action_reason_code: r.action_reason_code as string | null, first: i === 0 }));
  const base = kind === 'STUDENT' ? '/students' : '/staff';
  return (
    <div className="max-w-6xl">
      <PageHeader title={`Assignment Action: ${p.full_name}`}
        subtitle={<>{ab.assignment_number} · current status {a?.status_name ? <Badge color={STATUS_COLOR[a.system_status_code]}>{a.status_name}</Badge> : '—'} · current version from {fmtDate(a?.effective_start_date)}</>}
        actions={<Link href={`${base}/${personId}`} className="btn">Back</Link>} />
      <Flash sp={sp} />
      <form action={assignmentAction.bind(null, kind, personId)} className="space-y-4">
        <Back to={`${base}/${personId}/action`} />
        <div className="card">
          <div className="grid-form">
            <Field label="Change Mode"><select name="mode" className="input"><option value="UPDATE">Update – new version from effective date</option><option value="CORRECT">Correct – fix the version on the effective date</option></select></Field>
            <Field label="Effective Date *"><input type="date" name="effective_date" defaultValue={asOf} required className="input" /></Field>
            <ActionPicker other={actions} otherReasons={reasons} hire={hire.actions} hireReasons={hire.reasons} versions={versions} initialDate={asOf} />
            <Field label="Comments" className="sm:col-span-2"><input name="comments" className="input" /></Field>
          </div>
          <p className="muted mt-3">Termination / Withdrawal keeps the assignment values and only changes the status. Other actions save the values below as a new date-effective version.</p>
        </div>
        <div className="card">
          <h2 className="h2">Assignment values from the effective date</h2>
          <div className="grid-form"><AssignmentFields u={u} kind={kind} a={a} showStatus dateField="effective_date" /></div>
        </div>
        <button className="btn btn-primary">Submit Action</button>
      </form>
    </div>
  );
}
