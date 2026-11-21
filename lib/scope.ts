import 'server-only';
import { sql, type Row } from './db';
import { can, type SessionUser } from './auth';

/**
 * Data security for student data.
 * Users with CD_ALL_STUDENTS_DATA_PRV see every student; others see only students whose
 * assignment (as of the date) is in a class/section they are in charge of.
 */
export function seesAllStudents(u: SessionUser) {
  return can(u, 'CD_ALL_STUDENTS_DATA_PRV');
}

/** SQL fragment restricting an assignment_f alias to the user's classes. */
export function studentScopeSql(u: SessionUser, asOf: string, alias = 'af') {
  if (seesAllStudents(u)) return sql``;
  if (!u.personId) return sql`and false`;
  return sql`and exists (
    select 1 from class_incharge ci
    where ci.person_id = ${u.personId}
      and ${asOf}::date between ci.start_date and ci.end_date
      and ci.class_id = ${sql(alias + '.class_id')}
      and (ci.section_id is null or ci.section_id = ${sql(alias + '.section_id')}))`;
}

/** Class/section pairs the user may manage on a date: [{class_id, section_id|null, label}] */
export async function myClasses(u: SessionUser, asOf: string): Promise<Row[]> {
  const sectionLabel = sql`
    select s.id section_id, sf.class_id, bf.name || ' › ' || cf.name || ' › ' || sf.name as label, bf.id business_unit_id
    from section s
    join section_f sf on sf.id = s.id and ${asOf}::date between sf.effective_start_date and sf.effective_end_date
    join class_f cf on cf.id = sf.class_id and ${asOf}::date between cf.effective_start_date and cf.effective_end_date
    join business_unit_f bf on bf.id = cf.business_unit_id and ${asOf}::date between bf.effective_start_date and bf.effective_end_date
    where s.enterprise_id = ${u.enterpriseId} and sf.active_flag = 'Y'`;
  if (seesAllStudents(u)) return sql`${sectionLabel} order by label`;
  if (!u.personId) return [];
  return sql`${sectionLabel} and exists (
      select 1 from class_incharge ci where ci.person_id = ${u.personId}
        and ${asOf}::date between ci.start_date and ci.end_date
        and ci.class_id = sf.class_id and (ci.section_id is null or ci.section_id = s.id))
    order by label`;
}

/** Throws unless the user may act on this student on the date. */
export async function assertStudentAccess(u: SessionUser, personId: string, asOf: string) {
  if (seesAllStudents(u)) return;
  const [r] = await sql`
    select 1 from assignment a
    join assignment_f af on af.id = a.id and ${asOf}::date between af.effective_start_date and af.effective_end_date
    where a.person_id = ${personId} and a.assignment_type = 'STUDENT' ${studentScopeSql(u, asOf)}`;
  if (!r) throw new Error('You do not have access to this student (not in your class on this date).');
}

/**
 * Class/section options with the periods they are valid for (section × class ×
 * branch versions, and for incharges their incharge period), labelled with the
 * names in force during each period. Used by date-aware forms.
 */
export async function myClassesDated(u: SessionUser): Promise<{ value: string; label: string; start: string; end: string }[]> {
  const rows = await sql`
    select sf.id section_id, sf.class_id,
      greatest(sf.effective_start_date, cf.effective_start_date, bf.effective_start_date ${seesAllStudents(u) ? sql`` : sql`, ci.start_date`}) s,
      least(sf.effective_end_date, cf.effective_end_date, bf.effective_end_date ${seesAllStudents(u) ? sql`` : sql`, ci.end_date`}) e,
      bf.name || ' › ' || cf.name || ' › ' || sf.name label
    from section s
    join section_f sf on sf.id = s.id and sf.active_flag = 'Y'
    join class_f cf on cf.id = sf.class_id and daterange(cf.effective_start_date, cf.effective_end_date, '[]') && daterange(sf.effective_start_date, sf.effective_end_date, '[]')
    join business_unit_f bf on bf.id = cf.business_unit_id and daterange(bf.effective_start_date, bf.effective_end_date, '[]') && daterange(cf.effective_start_date, cf.effective_end_date, '[]')
    ${seesAllStudents(u) ? sql`` : sql`join class_incharge ci on ci.person_id = ${u.personId ?? '0'} and ci.class_id = sf.class_id and (ci.section_id is null or ci.section_id = s.id)`}
    where s.enterprise_id = ${u.enterpriseId}`;
  return rows
    .filter((r) => r.s <= r.e)
    .map((r) => ({ value: `${r.class_id}:${r.section_id}`, label: r.label, start: r.s, end: r.e }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Class ids and "class:section" keys the user is incharge of (null = all). */
export async function allowedClassKeys(u: SessionUser): Promise<Set<string> | null> {
  if (seesAllStudents(u)) return null;
  const rows = await sql`select class_id, section_id from class_incharge where person_id = ${u.personId ?? '0'}`;
  const keys = new Set<string>();
  for (const r of rows) { keys.add(String(r.class_id)); keys.add(r.section_id ? `${r.class_id}:${r.section_id}` : `${r.class_id}:*`); }
  return keys;
}
