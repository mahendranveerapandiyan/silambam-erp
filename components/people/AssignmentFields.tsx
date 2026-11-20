import type { SessionUser } from '@/lib/auth';
import type { Row } from '@/lib/db';
import type { PersonKind } from '@/lib/people';
import { datedLookupOptions, datedRefOptions } from '@/lib/dt';
import { myClassesDated } from '@/lib/scope';
import { sql } from '@/lib/db';
import { Field } from '../ui';
import { DatedSelect } from '../DatedSelect';

/**
 * Student or staff assignment attributes. Every drop-down follows the date
 * input named `dateField` (admission/hire date or action effective date).
 */
export async function AssignmentFields({ u, kind, a = {}, showStatus = false, dateField }: { u: SessionUser; kind: PersonKind; asOf?: string; a?: Row; showStatus?: boolean; dateField: string }) {
  const E = u.enterpriseId;
  const D = (name: string, options: any[], value: any, extra: { required?: boolean; empty?: string | false } = {}) => (
    <DatedSelect name={name} options={options} dateField={dateField} value={value == null ? '' : String(value)} {...extra} />
  );
  const statuses = await datedRefOptions(kind === 'STUDENT' ? 'student-statuses' : 'staff-statuses', E);
  const personTypes = await datedRefOptions(kind === 'STUDENT' ? 'student-person-types' : 'staff-person-types', E);
  const status = showStatus && (
    <Field label="Status Override" help="Empty = status defined on the action">{D('assignment_status_id', statuses, null, { empty: '— From action —' })}</Field>
  );
  if (kind === 'STUDENT') {
    const years = (await sql`select id, name, start_date, end_date from academic_year where enterprise_id = ${E} order by start_date desc`)
      .map((y) => ({ value: String(y.id), label: y.name, start: y.start_date, end: y.end_date }));
    const cs = a.class_id ? `${a.class_id}:${a.section_id ?? ''}` : '';
    return (
      <>
        <Field label="Branch › Class › Section *" className="sm:col-span-2">{D('class_section', await myClassesDated(u), cs, { required: true })}</Field>
        <Field label="Academic Year" help="Empty = the year containing the date">{D('academic_year_id', years, a.academic_year_id, { empty: '— Year of effective date —' })}</Field>
        <Field label="Grade / Level">{D('student_grade_id', await datedRefOptions('student-grades', E), a.student_grade_id)}</Field>
        <Field label="Fee Frequency">{D('fee_frequency_code', (await datedLookupOptions('FEE_FREQUENCY')).filter((o) => o.value !== 'ONE_TIME'), a.fee_frequency_code ?? 'MONTHLY', { empty: false })}</Field>
        <Field label="House">{D('house_id', await datedRefOptions('houses', E), a.house_id)}</Field>
        <Field label="Club">{D('club_id', await datedRefOptions('clubs', E), a.club_id)}</Field>
        <Field label="Community">{D('community_id', await datedRefOptions('communities', E), a.community_id)}</Field>
        <Field label="Person Type">{D('person_type_id', personTypes, a.person_type_id)}</Field>
        {status}
      </>
    );
  }
  return (
    <>
      <Field label="Business Unit *">{D('business_unit_id', await datedRefOptions('business-units', E), a.business_unit_id, { required: true })}</Field>
      <Field label="Location">{D('location_id', await datedRefOptions('locations', E), a.location_id)}</Field>
      <Field label="Department">{D('department_id', await datedRefOptions('departments', E), a.department_id)}</Field>
      <Field label="Job">{D('job_id', await datedRefOptions('jobs', E), a.job_id)}</Field>
      <Field label="Position">{D('position_id', await datedRefOptions('positions', E), a.position_id)}</Field>
      <Field label="Grade">{D('staff_grade_id', await datedRefOptions('staff-grades', E), a.staff_grade_id)}</Field>
      <Field label="Employment Type">{D('employment_type_code', await datedLookupOptions('EMPLOYMENT_TYPE'), a.employment_type_code)}</Field>
      <Field label="Employment Category">{D('employment_category_code', await datedLookupOptions('EMPLOYMENT_CATEGORY'), a.employment_category_code)}</Field>
      <Field label="Payroll Status">{D('payroll_status_code', await datedLookupOptions('PAYROLL_STATUS'), a.payroll_status_code)}</Field>
      <Field label="Person Type">{D('person_type_id', personTypes, a.person_type_id)}</Field>
      {status}
    </>
  );
}
