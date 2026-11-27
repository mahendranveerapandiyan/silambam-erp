import 'server-only';
import { sql, type Row } from './db';
import { can, type SessionUser } from './auth';

/** Classes the user is incharge of on a date (for class assessments). */
export async function inchargeClasses(u: SessionUser, date: string) {
  if (!u.personId) return [] as { id: string; name: string }[];
  return (await sql`
    select distinct ci.class_id id,
      (select cf.name from class_f cf where cf.id = ci.class_id order by (${date}::date between cf.effective_start_date and cf.effective_end_date) desc, cf.effective_start_date desc limit 1) name
    from class_incharge ci where ci.person_id = ${u.personId} and ${date}::date between ci.start_date and ci.end_date
    order by name`).map((r) => ({ id: String(r.id), name: r.name as string }));
}

/** May this user create class assessments at all? */
export const canClassAssess = (u: SessionUser) => can(u, 'CD_CLASS_ASSESSMENT_PRV', 'WRITE');
/** Exam administrators (any exam). */
export const isExamAdmin = (u: SessionUser) => can(u, 'CD_EXAM_SETUP_PRV', 'WRITE');

/**
 * May the user set up, publish, roll back and delete this exam? Exam administrators:
 * any exam. Class incharges with "class assessments": their own class's assessments.
 */
export async function canManageExam(u: SessionUser, exam: Row) {
  if (isExamAdmin(u)) return true;
  if (exam.exam_scope !== 'CLASS' || !canClassAssess(u) || !exam.class_id) return false;
  return (await inchargeClasses(u, exam.exam_date)).some((c) => c.id === String(exam.class_id));
}

export async function assertManageExam(u: SessionUser, exam: Row) {
  if (!(await canManageExam(u, exam)))
    throw new Error(exam.exam_scope === 'CLASS' ? 'Only the incharge of this class (or an exam administrator) can change this assessment.' : 'Only exam administrators can change this exam.');
}
