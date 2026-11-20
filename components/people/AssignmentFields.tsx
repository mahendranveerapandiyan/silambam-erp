import type { SessionUser } from '@/lib/auth';
import type { Row } from '@/lib/db';
import { assignmentFormOptions, type PersonKind } from '@/lib/people';
import { Field, Select } from '../ui';

/** Student or staff assignment attributes. `a` holds current values. */
export async function AssignmentFields({ u, kind, asOf, a = {}, showStatus = false }: { u: SessionUser; kind: PersonKind; asOf: string; a?: Row; showStatus?: boolean }) {
  const o: any = await assignmentFormOptions(u, kind, asOf);
  const status = showStatus && (
    <Field label="Status Override" help="Empty = status defined on the action"><Select name="assignment_status_id" options={o.statuses} value={null} empty="— From action —" /></Field>
  );
  if (kind === 'STUDENT') {
    const cs = a.class_id ? `${a.class_id}:${a.section_id ?? ''}` : '';
    return (
      <>
        <Field label="Branch › Class › Section *" className="sm:col-span-2"><Select name="class_section" options={o.classSections} value={cs} required /></Field>
        <Field label="Academic Year"><Select name="academic_year_id" options={o.years} value={a.academic_year_id} empty="— Year of effective date —" /></Field>
        <Field label="Grade / Level"><Select name="student_grade_id" options={o.grades} value={a.student_grade_id} /></Field>
        <Field label="Fee Frequency"><Select name="fee_frequency_code" options={o.frequencies} value={a.fee_frequency_code ?? 'MONTHLY'} empty={false} /></Field>
        <Field label="House"><Select name="house_id" options={o.houses} value={a.house_id} /></Field>
        <Field label="Club"><Select name="club_id" options={o.clubs} value={a.club_id} /></Field>
        <Field label="Community"><Select name="community_id" options={o.communities} value={a.community_id} /></Field>
        <Field label="Person Type"><Select name="person_type_id" options={o.personTypes} value={a.person_type_id} /></Field>
        {status}
      </>
    );
  }
  return (
    <>
      <Field label="Business Unit *"><Select name="business_unit_id" options={o.bus} value={a.business_unit_id} required /></Field>
      <Field label="Location"><Select name="location_id" options={o.locations} value={a.location_id} /></Field>
      <Field label="Department"><Select name="department_id" options={o.departments} value={a.department_id} /></Field>
      <Field label="Job"><Select name="job_id" options={o.jobs} value={a.job_id} /></Field>
      <Field label="Position"><Select name="position_id" options={o.positions} value={a.position_id} /></Field>
      <Field label="Grade"><Select name="staff_grade_id" options={o.staffGrades} value={a.staff_grade_id} /></Field>
      <Field label="Employment Type"><Select name="employment_type_code" options={o.employmentTypes} value={a.employment_type_code} /></Field>
      <Field label="Employment Category"><Select name="employment_category_code" options={o.employmentCategories} value={a.employment_category_code} /></Field>
      <Field label="Payroll Status"><Select name="payroll_status_code" options={o.payrollStatuses} value={a.payroll_status_code} /></Field>
      <Field label="Person Type"><Select name="person_type_id" options={o.personTypes} value={a.person_type_id} /></Field>
      {status}
    </>
  );
}
