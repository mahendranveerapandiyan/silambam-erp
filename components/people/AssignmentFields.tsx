import type { SessionUser } from '@/lib/auth';
import type { Row } from '@/lib/db';
import type { PersonKind } from '@/lib/people';
import { datedLookupOptions, datedRefOptions } from '@/lib/dt';
import { allowedClassKeys } from '@/lib/scope';
import { sql } from '@/lib/db';
import { activeStaffPeriods } from '@/lib/people';
import { Field } from '../ui';
import { DatedSelect } from '../DatedSelect';
import { PositionAutofill } from '../PositionAutofill';

/**
 * Student or staff assignment attributes. Every drop-down follows the date
 * input named `dateField` (admission/hire date or action effective date).
 */
/** `part`: 'main' = everything except the fee fields, 'fees' = only the fee fields (students), 'all' = both. */
export async function AssignmentFields({ u, kind, a = {}, showStatus = false, dateField, part = 'all' }: { u: SessionUser; kind: PersonKind; asOf?: string; a?: Row; showStatus?: boolean; dateField: string; part?: 'all' | 'main' | 'fees' }) {
  const E = u.enterpriseId;
  const D = (name: string, options: any[], value: any, extra: { required?: boolean; empty?: string | false; parentField?: string } = {}) => (
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
    // Business Unit → Branch → Class → Section, limited to the user's own classes when they are an incharge
    const allowed = await allowedClassKeys(u);
    // an incharge only gets the classes / sections they look after on the chosen date
    const periods = allowed ? await sql`select class_id, section_id, start_date, end_date from class_incharge where person_id = ${u.personId ?? '0'}` : [];
    const clip = (o: { start: string; end: string }, p: { start_date: string; end_date: string }) => {
      const start = o.start > p.start_date ? o.start : p.start_date;
      const end = o.end < p.end_date ? o.end : p.end_date;
      return start <= end ? { start, end } : null;
    };
    const within = <T extends { start: string; end: string }>(opts: T[], match: (o: T, p: Row) => boolean): T[] =>
      !allowed ? opts : opts.flatMap((o) => periods.filter((p) => match(o, p)).map((p) => clip(o, p as any)).filter((x) => !!x).map((x) => ({ ...o, ...x! })));
    const classes = within(await datedRefOptions('classes', E, { plain: true }), (c, p) => String(p.class_id) === c.value);
    const sections = within(await datedRefOptions('sections', E, { plain: true }),
      (s, p) => String(p.class_id) === String(s.parent) && (!p.section_id || String(p.section_id) === s.value));
    const branches = (await datedRefOptions('branches', E)).filter((b) => !allowed || classes.some((c) => c.parent === b.value));
    const bus = (await datedRefOptions('business-units', E)).filter((b) => !allowed || branches.some((x) => x.parent === b.value));
    const feeFields = (
      <>
        <Field label="Fee Frequency *">{D('fee_frequency_code', (await datedLookupOptions('FEE_FREQUENCY')).filter((o) => o.value !== 'ONE_TIME'), a.fee_frequency_code ?? 'MONTHLY', { empty: false, required: true })}</Field>
        <Field label="Fee Type">{D('fee_type_code', (await datedLookupOptions('FEE_TYPE')).filter((o) => o.value === 'TUITION'), a.fee_type_code ?? 'TUITION', { empty: false })}</Field>
        <Field label="Fee Amount" help="Per installment of the Fee Frequency – first preference. Empty = amount from Fee Structures.">
          <input name="fee_amount" type="number" min="0" step="0.01" defaultValue={a.fee_amount ?? ''} className="input" placeholder="From Fee Structures" />
        </Field>
      </>
    );
    if (part === 'fees') return feeFields;
    return (
      <>
        <Field label="Business Unit *">{D('business_unit_id', bus, a.business_unit_id, { required: true })}</Field>
        <Field label="Branch *">{D('branch_id', branches, a.branch_id, { required: true, parentField: 'business_unit_id' })}</Field>
        <Field label="Class *">{D('class_id', classes, a.class_id, { required: true, parentField: 'branch_id' })}</Field>
        <Field label="Section *">{D('section_id', sections, a.section_id, { required: true, parentField: 'class_id' })}</Field>
        <Field label="Academic Year" help="Empty = the year containing the date">{D('academic_year_id', years, a.academic_year_id, { empty: '— Year of effective date —' })}</Field>
        <Field label="Grade / Level">{D('student_grade_id', await datedRefOptions('student-grades', E), a.student_grade_id)}</Field>
        <Field label="House">{D('house_id', await datedRefOptions('houses', E), a.house_id)}</Field>
        <Field label="Club">{D('club_id', await datedRefOptions('clubs', E), a.club_id)}</Field>
        <Field label="Community">{D('community_id', await datedRefOptions('communities', E), a.community_id)}</Field>
        <Field label="Person Type">{D('person_type_id', personTypes, a.person_type_id)}</Field>
        {status}
        {part === 'all' && feeFields}
      </>
    );
  }
  return (
    <>
      <Field label="Legal Employer">{D('legal_employer_id', await datedRefOptions('legal-employers', E), a.legal_employer_id)}</Field>
      <Field label="Business Unit *">{D('business_unit_id', await datedRefOptions('business-units', E, { parentField: 'legal_employer_id' }), a.business_unit_id, { required: true, parentField: 'legal_employer_id' })}</Field>
      <Field label="Branch" help="Empty for staff not tied to one branch">{D('branch_id', await datedRefOptions('branches', E), a.branch_id, { parentField: 'business_unit_id' })}</Field>
      <Field label="Location">{D('location_id', await datedRefOptions('locations', E), a.location_id)}</Field>
      <Field label="Department">{D('department_id', await datedRefOptions('departments', E), a.department_id)}</Field>
      <Field label="Job">{D('job_id', await datedRefOptions('jobs', E), a.job_id)}</Field>
      <Field label="Position" help="Choosing a position fills business unit, department, job, grade and type">{D('position_id', await datedRefOptions('positions', E), a.position_id)}</Field>
      <PositionAutofill dateField={dateField} positions={(await sql`select f.id, f.effective_start_date, f.effective_end_date, f.business_unit_id, f.department_id, f.job_id, f.staff_grade_id, f.full_time_flag
        from position b join position_f f on f.id = b.id where b.enterprise_id = ${E}`).map((r) => ({ id: String(r.id), start: r.effective_start_date, end: r.effective_end_date,
          business_unit_id: r.business_unit_id && String(r.business_unit_id), department_id: r.department_id && String(r.department_id), job_id: r.job_id && String(r.job_id),
          staff_grade_id: r.staff_grade_id && String(r.staff_grade_id), full_time_flag: r.full_time_flag }))} />
      <Field label="Manager" help="Empty = the holder of the position's parent position (Reports To)">{D('manager_person_id', (await activeStaffPeriods(E))
        .filter((m) => String(m.person_id) !== String(a.person_id ?? ''))
        .map((m) => ({ value: String(m.person_id), label: m.full_name || m.assignment_number, code: m.assignment_number, start: m.start_date, end: m.end_date })), a.manager_person_id, { empty: '— From position hierarchy —' })}</Field>
      <Field label="Grade">{D('staff_grade_id', await datedRefOptions('staff-grades', E), a.staff_grade_id)}</Field>
      <Field label="Employment Type">{D('employment_type_code', await datedLookupOptions('EMPLOYMENT_TYPE'), a.employment_type_code)}</Field>
      <Field label="Employment Category">{D('employment_category_code', await datedLookupOptions('EMPLOYMENT_CATEGORY'), a.employment_category_code)}</Field>
      <Field label="Payroll Status">{D('payroll_status_code', await datedLookupOptions('PAYROLL_STATUS'), a.payroll_status_code)}</Field>
      <Field label="Person Type">{D('person_type_id', personTypes, a.person_type_id)}</Field>
      {status}
    </>
  );
}
