import Link from 'next/link';
import type { SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isManual } from '@/lib/numbering';
import type { PersonKind } from '@/lib/people';
import { lookupOptions } from '@/lib/lookups';
import { PageHeader, Flash, Field, Back } from '../ui';
import { PersonFields } from './PersonFields';
import { PhotoInput } from '../PhotoInput';
import { AssignmentFields } from './AssignmentFields';
import { hirePerson } from '@/app/(app)/people/actions';

export async function HireForm({ u, kind, asOf, sp }: { u: SessionUser; kind: PersonKind; asOf: string; sp: Record<string, any> }) {
  const stu = kind === 'STUDENT';
  const [manualPerson, manualAsg] = [await isManual(sql, u.enterpriseId, 'PERSON'), await isManual(sql, u.enterpriseId, kind)];
  const reasons = await lookupOptions('ACTION_REASON', asOf);
  return (
    <div className="max-w-6xl">
      <PageHeader title={stu ? 'New Student Admission' : 'Hire Staff'} actions={<Link href={stu ? '/students' : '/staff'} className="btn">Back</Link>} />
      <Flash sp={sp} />
      <form action={hirePerson.bind(null, kind)} className="space-y-4">
        <Back to={stu ? '/students/new' : '/staff/new'} />
        <div className="card">
          <h2 className="h2">{stu ? 'Admission' : 'Hire'} Details</h2>
          <div className="grid-form">
            <Field label={`${stu ? 'Admission' : 'Hire'} Date *`}><input type="date" name="hire_date" defaultValue={asOf} required className="input" /></Field>
            {manualAsg && <Field label={`${stu ? 'Student' : 'Staff'} Number *`}><input name="assignment_number" required className="input" /></Field>}
            {manualPerson && <Field label="Person Number *"><input name="person_number" className="input" /></Field>}
            <Field label="Action Reason"><select name="action_reason_code" defaultValue="NEW_JOINER" className="input">{reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></Field>
            <Field label="Existing Person No. (optional)" help={stu ? 'If this person is already in the system (e.g. a staff member\'s record)' : 'e.g. a senior student joining as staff – reuses their personal record'}>
              <input name="existing_person_number" className="input" placeholder="Leave empty for a new person" />
            </Field>
          </div>
        </div>
        <div className="card">
          <h2 className="h2">Assignment</h2>
          <div className="grid-form"><AssignmentFields u={u} kind={kind} asOf={asOf} /></div>
        </div>
        <div className="card">
          <h2 className="h2">Personal Details</h2>
          <p className="muted mb-3">Ignored when an existing person number is given.</p>
          <div className="grid-form">
            <PersonFields asOf={asOf} />
            <Field label="Photo"><PhotoInput /></Field>
          </div>
        </div>
        {stu ? (
          <>
            <div className="card">
              <h2 className="h2">Parents / Guardian</h2>
              <div className="grid gap-3 md:grid-cols-3">
                {['Father', 'Mother', 'Guardian'].map((r) => (
                  <div key={r} className="space-y-2 rounded-md bg-black/[0.03] p-3">
                    <div className="text-sm font-semibold">{r}</div>
                    <input name={`${r.toLowerCase()}_name`} placeholder="Name" className="input" />
                    <input name={`${r.toLowerCase()}_phone`} placeholder="Phone" type="tel" className="input" />
                    <input name={`${r.toLowerCase()}_email`} placeholder="Email" type="email" className="input" />
                    <input name={`${r.toLowerCase()}_occupation`} placeholder="Occupation" className="input" />
                    <label className="flex items-center gap-1 text-xs"><input type="radio" name="primary_contact" value={r.toUpperCase()} defaultChecked={r === 'Father'} /> Primary contact</label>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h2 className="h2">Portal Login & Fees</h2>
              <div className="grid-form">
                <Field label="Parent Login Username" help="e.g. parent mobile number. Existing username = add this child to that parent."><input name="parent_username" className="input" autoComplete="off" /></Field>
                <Field label="Temporary Password"><input name="parent_password" type="password" className="input" autoComplete="new-password" /></Field>
                <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" name="student_login" value="Y" /> Also create a student login (username = student number)</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="generate_fees" value="Y" defaultChecked /> Generate this academic year&apos;s fees (admission + tuition)</label>
              </div>
            </div>
          </>
        ) : (
          <div className="card">
            <h2 className="h2">Application Login</h2>
            <div className="grid-form">
              <Field label="Username"><input name="login_username" className="input" autoComplete="off" /></Field>
              <Field label="Temporary Password"><input name="login_password" type="password" className="input" autoComplete="new-password" /></Field>
              <div className="space-y-1 pt-5 text-sm">
                {[['INCHARGE', 'Class Incharge'], ['STAFF', 'Staff'], ['ACCOUNTANT', 'Accountant']].map(([v, l]) => (
                  <label key={v} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" name="login_roles" value={v} defaultChecked={v === 'STAFF'} /> {l}</label>
                ))}
              </div>
            </div>
          </div>
        )}
        <button className="btn btn-primary">{stu ? 'Admit Student' : 'Hire'}</button>
      </form>
    </div>
  );
}
