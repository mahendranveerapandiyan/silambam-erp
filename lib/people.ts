import 'server-only';
import { sql, type Row } from './db';
import type { SessionUser } from './auth';
import { studentScopeSql, myClasses } from './scope';
import { refOptions } from './dt';
import { lookupOptions } from './lookups';

export type PersonKind = 'STUDENT' | 'STAFF';

export const fullName = (alias = 'pf') =>
  sql`trim(concat_ws(' ', ${sql(alias + '.first_name')}, ${sql(alias + '.middle_name')}, ${sql(alias + '.last_name')}))`;

/** Name of a date-tracked record as of a date. */
export const nm = (table: string, col: string, asOf: string) =>
  sql`(select n.name from ${sql(table + '_f')} n where n.id = ${sql(col)} and ${asOf}::date between n.effective_start_date and n.effective_end_date)`;

/** Person version effective on asOf, falling back to the closest one. */
export const personAsOf = (asOf: string, pAlias = 'p') =>
  sql`left join lateral (select * from person_f x where x.id = ${sql(pAlias + '.id')}
        order by (${asOf}::date between x.effective_start_date and x.effective_end_date) desc, x.effective_start_date desc limit 1) pf on true`;

export async function peopleList(
  u: SessionUser,
  kind: PersonKind,
  asOf: string,
  f: { q?: string | null; bu?: string | null; cls?: string | null; grade?: string | null; status?: string | null },
  page = 1,
  pageSize = 100,
) {
  const like = f.q ? `%${f.q}%` : null;
  const status = f.status || 'ACTIVE';
  return sql`
    select a.id assignment_id, a.assignment_number, a.original_start_date, p.id person_id, p.person_number, p.date_of_birth,
      ${fullName()} as full_name, pf.phone, pf.gender_code, af.*,
      st.system_status_code, st.name status_name,
      ${nm('business_unit', 'af.business_unit_id', asOf)} bu_name,
      ${nm('class', 'af.class_id', asOf)} class_name,
      ${nm('section', 'af.section_id', asOf)} section_name,
      ${nm('student_grade', 'af.student_grade_id', asOf)} grade_name,
      ${nm('house', 'af.house_id', asOf)} house_name,
      ${nm('job', 'af.job_id', asOf)} job_name,
      ${nm('department', 'af.department_id', asOf)} department_name,
      ${nm('staff_grade', 'af.staff_grade_id', asOf)} staff_grade_name,
      exists (select 1 from person_photo ph where ph.person_id = p.id) has_photo,
      count(*) over () as total_count
    from assignment a
    join assignment_f af on af.id = a.id and ${asOf}::date between af.effective_start_date and af.effective_end_date
    join person p on p.id = a.person_id
    ${personAsOf(asOf)}
    left join assignment_status_f st on st.id = af.assignment_status_id and ${asOf}::date between st.effective_start_date and st.effective_end_date
    where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = ${kind}
      ${kind === 'STUDENT' ? studentScopeSql(u, asOf) : sql``}
      ${status !== 'ALL' ? sql`and st.system_status_code = ${status}` : sql``}
      ${f.bu ? sql`and af.business_unit_id = ${f.bu}` : sql``}
      ${f.cls ? sql`and af.class_id = ${f.cls}` : sql``}
      ${f.grade ? sql`and af.student_grade_id = ${f.grade}` : sql``}
      ${like ? sql`and (a.assignment_number ilike ${like} or p.person_number ilike ${like} or ${fullName()} ilike ${like} or pf.phone ilike ${like})` : sql``}
    order by full_name
    limit ${pageSize} offset ${(Math.max(1, page) - 1) * pageSize}`;
}

export async function personDetail(personId: string, asOf: string) {
  const [p] = await sql`
    select p.*, pf.*, p.id as id, ${fullName()} as full_name,
      exists (select 1 from person_photo ph where ph.person_id = p.id) has_photo
    from person p ${personAsOf(asOf)} where p.id = ${personId}`;
  return p;
}

export async function assignmentFor(personId: string, kind: PersonKind, asOf: string) {
  const [a] = await sql`
    select a.id assignment_id, a.assignment_number, a.original_start_date, a.person_id, af.*,
      st.system_status_code, st.name status_name,
      ${nm('action', 'af.action_id', asOf)} action_name,
      ${nm('legal_employer', 'af.legal_employer_id', asOf)} le_name,
      ${nm('business_unit', 'af.business_unit_id', asOf)} bu_name,
      ${nm('location', 'af.location_id', asOf)} location_name,
      ${nm('class', 'af.class_id', asOf)} class_name,
      ${nm('section', 'af.section_id', asOf)} section_name,
      ${nm('student_grade', 'af.student_grade_id', asOf)} grade_name,
      ${nm('house', 'af.house_id', asOf)} house_name,
      ${nm('club', 'af.club_id', asOf)} club_name,
      ${nm('community', 'af.community_id', asOf)} community_name,
      ${nm('person_type', 'af.person_type_id', asOf)} person_type_name,
      ${nm('job', 'af.job_id', asOf)} job_name,
      ${nm('staff_grade', 'af.staff_grade_id', asOf)} staff_grade_name,
      ${nm('department', 'af.department_id', asOf)} department_name,
      ${nm('position', 'af.position_id', asOf)} position_name,
      (select name from academic_year y where y.id = af.academic_year_id) academic_year_name
    from assignment a
    join assignment_f af on af.id = a.id and ${asOf}::date between af.effective_start_date and af.effective_end_date
    left join assignment_status_f st on st.id = af.assignment_status_id and ${asOf}::date between st.effective_start_date and st.effective_end_date
    where a.person_id = ${personId} and a.assignment_type = ${kind}`;
  return a as Row | undefined;
}

export async function assignmentBase(personId: string, kind: PersonKind) {
  const [a] = await sql`select * from assignment where person_id = ${personId} and assignment_type = ${kind}`;
  return a as Row | undefined;
}

export async function academicYears(enterpriseId: string) {
  return sql`select * from academic_year where enterprise_id = ${enterpriseId} order by start_date desc`;
}

export async function academicYearOn(enterpriseId: string, date: string) {
  const [y] = await sql`select * from academic_year where enterprise_id = ${enterpriseId} and ${date}::date between start_date and end_date`;
  return y as Row | undefined;
}

/** Everything a student/staff assignment form needs. */
export async function assignmentFormOptions(u: SessionUser, kind: PersonKind, asOf: string) {
  const E = u.enterpriseId;
  const common = {
    reasons: await lookupOptions('ACTION_REASON', asOf),
    actions: (await refOptions(kind === 'STUDENT' ? 'student-actions' : 'staff-actions', E, asOf)).filter((o) => !o.inactive),
    statuses: await refOptions(kind === 'STUDENT' ? 'student-statuses' : 'staff-statuses', E, asOf),
    personTypes: await refOptions(kind === 'STUDENT' ? 'student-person-types' : 'staff-person-types', E, asOf),
  };
  if (kind === 'STUDENT') {
    const cls = await myClasses(u, asOf);
    return {
      ...common,
      classSections: cls.map((c) => ({ value: `${c.class_id}:${c.section_id}`, label: c.label })),
      grades: await refOptions('student-grades', E, asOf),
      houses: await refOptions('houses', E, asOf),
      clubs: await refOptions('clubs', E, asOf),
      communities: await refOptions('communities', E, asOf),
      years: (await academicYears(E)).map((y) => ({ value: String(y.id), label: y.name })),
      frequencies: (await lookupOptions('FEE_FREQUENCY', asOf)).filter((o) => o.value !== 'ONE_TIME'),
    };
  }
  return {
    ...common,
    bus: await refOptions('business-units', E, asOf),
    locations: await refOptions('locations', E, asOf),
    jobs: await refOptions('jobs', E, asOf),
    staffGrades: await refOptions('staff-grades', E, asOf),
    departments: await refOptions('departments', E, asOf),
    positions: await refOptions('positions', E, asOf),
    employmentTypes: await lookupOptions('EMPLOYMENT_TYPE', asOf),
    employmentCategories: await lookupOptions('EMPLOYMENT_CATEGORY', asOf),
    payrollStatuses: await lookupOptions('PAYROLL_STATUS', asOf),
  };
}

/** Resolve class -> BU -> LE on a date. */
export async function classHierarchy(classId: string, asOf: string) {
  const [r] = await sql`
    select cf.business_unit_id, bf.legal_employer_id from class_f cf
    join business_unit_f bf on bf.id = cf.business_unit_id and ${asOf}::date between bf.effective_start_date and bf.effective_end_date
    where cf.id = ${classId} and ${asOf}::date between cf.effective_start_date and cf.effective_end_date`;
  if (!r) throw new Error('Class is not effective on this date.');
  return r as { business_unit_id: string; legal_employer_id: string };
}

export async function buLegalEmployer(buId: string, asOf: string) {
  const [r] = await sql`select legal_employer_id from business_unit_f where id = ${buId} and ${asOf}::date between effective_start_date and effective_end_date`;
  if (!r) throw new Error('Business unit is not effective on this date.');
  return r.legal_employer_id as string;
}

export async function actionInfo(actionId: string, asOf: string) {
  const [r] = await sql`select f.*, a.code from action a join action_f f on f.id = a.id and ${asOf}::date between f.effective_start_date and f.effective_end_date where a.id = ${actionId}`;
  if (!r) throw new Error('Action is not valid on this date.');
  return r;
}

export async function actionByType(enterpriseId: string, category: PersonKind, type: string, asOf: string) {
  const [r] = await sql`select a.id, f.assignment_status_id from action a join action_f f on f.id = a.id and ${asOf}::date between f.effective_start_date and f.effective_end_date
    where a.enterprise_id = ${enterpriseId} and f.person_category = ${category} and f.action_type_code = ${type} and f.active_flag = 'Y' order by a.id limit 1`;
  return r;
}
