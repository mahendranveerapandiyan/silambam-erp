import 'server-only';
import { sql, type Row } from './db';
import { can, type SessionUser } from './auth';

/** The 7 stops of the exam setup. */
export const EXAM_STOPS = ['Exam Details', 'Grade Eligibility', 'Student Eligibility', 'Subjects', 'Evaluation Template', 'Targeted Outcome', 'Examiners'] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Grades that may sit the exam, with the grade passed students move to. */
export async function examGrades(examId: string, asOf: string) {
  return sql`
    select eg.grade_id, eg.target_grade_id, g.name, g.sequence_no, g.next_grade_id,
      (select name from student_grade_f t where t.id = coalesce(eg.target_grade_id, g.next_grade_id) order by (${asOf}::date between t.effective_start_date and t.effective_end_date) desc, t.effective_start_date desc limit 1) target_name
    from exam_grade eg
    join lateral (select * from student_grade_f x where x.id = eg.grade_id order by (${asOf}::date between x.effective_start_date and x.effective_end_date) desc, x.effective_start_date desc limit 1) g on true
    where eg.exam_id = ${examId}
    order by g.sequence_no nulls last, g.name`;
}

export type Part = { id: string; subjectId: string; name: string; weight: number; max: number; pass: number };
export type ExamSubject = Row & { parts: Part[]; subject_name: string };

/** Subjects of an exam (optionally for one grade; subjects without a grade apply to all grades), with their parts. */
export async function examSubjects(examId: string, gradeId?: string | null): Promise<ExamSubject[]> {
  const subjName = (col: string) => sql`(select name from subject_f s where s.id = ${sql.unsafe(col)} order by effective_start_date desc limit 1)`;
  const rows = await sql`select es.*, ${subjName('es.subject_id')} subject_name from exam_subject es
    where es.exam_id = ${examId} ${gradeId ? sql`and (es.grade_id = ${gradeId} or es.grade_id is null)` : sql``} order by es.grade_id nulls first, es.display_seq, es.id`;
  const comps = rows.length ? await sql`select c.*, ${subjName('c.subject_id')} subject_name from exam_subject_component c where c.exam_subject_id in ${sql(rows.map((r) => r.id))} order by c.display_seq, c.id` : [];
  return rows.map((r) => ({
    ...r,
    subject_name: r.subject_name as string,
    parts: r.combined_flag === 'Y'
      ? comps.filter((c) => String(c.exam_subject_id) === String(r.id)).map((c) => ({ id: String(c.id), subjectId: String(c.subject_id), name: c.subject_name, weight: Number(c.weight), max: Number(c.max_marks), pass: Number(c.pass_marks) }))
      : [{ id: '0', subjectId: String(r.subject_id), name: r.subject_name as string, weight: 100, max: Number(r.max_marks), pass: Number(r.pass_marks) }],
  })) as ExamSubject[];
}

export type Section = { id: string; subject_id: string; name: string; weight_pct: number; min_rating: number; max_rating: number; input_type: 'RATING' | 'MARK' };

/** An evaluation template's sections, by subject. */
export async function templateSections(templateId: string | null | undefined) {
  const m = new Map<string, Section[]>();
  if (!templateId) return m;
  for (const s of await sql`select * from evaluation_section where template_id = ${templateId} order by display_seq, id`) {
    const k = String(s.subject_id);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push({ id: String(s.id), subject_id: k, name: s.name, weight_pct: Number(s.weight_pct), min_rating: Number(s.min_rating), max_rating: Number(s.max_rating), input_type: s.input_type === 'MARK' ? 'MARK' : 'RATING' });
  }
  return m;
}

/** Subjects whose section weights do not add up to 100 %. */
export function badWeights(sections: Map<string, Section[]>) {
  return [...sections.entries()].filter(([, l]) => Math.abs(l.reduce((t, s) => t + s.weight_pct, 0) - 100) > 0.001).map(([k]) => k);
}

/** A part's mark: from the section ratings (template) or the mark entered directly. */
export function partMark(part: Part, sections: Section[] | undefined, ratings: Map<string, number | null>, unit: number | null) {
  if (!sections?.length) return unit;
  let sum = 0;
  for (const s of sections) {
    const r = ratings.get(s.id);
    if (r === null || r === undefined) return null;
    sum += (s.weight_pct * r) / s.max_rating;
  }
  return r2((part.max * sum) / 100);
}

/** Subject mark from its part marks; pass needs every part ≥ its pass mark and the subject ≥ its pass mark. */
export function subjectScore(es: ExamSubject, partMarks: (number | null)[]) {
  if (partMarks.some((m) => m === null)) return { marks: null as number | null, pass: false };
  const ms = partMarks as number[];
  let marks: number;
  if (es.combined_flag !== 'Y') marks = ms[0];
  else if (es.weight_type === 'MARK') marks = es.parts.reduce((t, p, i) => t + (ms[i] / p.max) * p.weight, 0);
  else marks = (es.parts.reduce((t, p, i) => t + (ms[i] / p.max) * p.weight, 0) / 100) * Number(es.max_marks);
  marks = r2(marks);
  const pass = es.parts.every((p, i) => ms[i] >= p.pass) && marks >= Number(es.pass_marks);
  return { marks, pass };
}

/** Recompute a candidate's total, % and result from the subject marks of their grade. */
export async function recomputeCandidate(tx: typeof sql, exam: Row, candidateId: string) {
  const [c] = await tx`select * from exam_candidate where id = ${candidateId}`;
  const subjects = await tx`select * from exam_subject where exam_id = ${exam.id} and (grade_id = ${c.current_grade_id} or grade_id is null)`;
  const marks = new Map((await tx`select * from exam_mark where candidate_id = ${candidateId}`).map((m) => [String(m.exam_subject_id), m]));
  let total = 0, max = 0, allPass = true, anyMark = false, allAbsent = subjects.length > 0, pending = false;
  for (const s of subjects) {
    const m = marks.get(String(s.id));
    max += Number(s.max_marks);
    const absent = m?.absent_flag === 'Y';
    if (!absent) allAbsent = false;
    if (m && !absent && m.marks !== null) { anyMark = true; total += Number(m.marks); if (m.pass_flag === 'N' || (m.pass_flag == null && Number(m.marks) < Number(s.pass_marks))) allPass = false; }
    else if (absent) allPass = false;
    else pending = true;
  }
  const pct = max ? r2((total / max) * 100) : 0;
  const result = allAbsent ? 'ABSENT' : !anyMark || pending ? (anyMark && !allPass ? 'FAIL' : 'PENDING')
    : allPass && (exam.pass_percentage === null || pct >= Number(exam.pass_percentage)) ? 'PASS' : 'FAIL';
  await tx`update exam_candidate set total_marks = ${anyMark ? r2(total) : null}, percentage = ${anyMark ? pct : null}, result_code = ${result} where id = ${candidateId}`;
}

/** Grades the user evaluates in this exam (examiner), or 'ALL' for exam administrators / when no examiners are set for a grade. */
export async function evaluatorGrades(u: SessionUser, examId: string): Promise<'ALL' | Set<string>> {
  if (can(u, 'CD_EXAM_SETUP_PRV', 'WRITE')) return 'ALL';
  const rows = await sql`select grade_id, person_id from exam_examiner where exam_id = ${examId}`;
  const all = await sql`select grade_id from exam_grade where exam_id = ${examId}`;
  const withExaminers = new Set(rows.map((r) => String(r.grade_id)));
  const mine = new Set(rows.filter((r) => u.personId && String(r.person_id) === String(u.personId)).map((r) => String(r.grade_id)));
  if (!all.length && !rows.length) return can(u, 'CD_EXAM_CANDIDATE_PRV', 'WRITE') ? 'ALL' : new Set();
  // grades with no examiners stay open to anyone who may enter marks
  if (can(u, 'CD_EXAM_CANDIDATE_PRV', 'WRITE')) for (const g of all) if (!withExaminers.has(String(g.grade_id))) mine.add(String(g.grade_id));
  return mine;
}

/** True once any mark or rating has been entered for the exam. */
export async function marksEntered(examId: string) {
  const [r] = await sql`select exists (select 1 from exam_mark m join exam_candidate c on c.id = m.candidate_id where c.exam_id = ${examId} and (m.marks is not null or m.absent_flag = 'Y'))
    or exists (select 1 from exam_unit_mark m join exam_candidate c on c.id = m.candidate_id where c.exam_id = ${examId})
    or exists (select 1 from exam_section_rating m join exam_candidate c on c.id = m.candidate_id where c.exam_id = ${examId}) x`;
  return Boolean(r.x);
}

/** Next exam code for an academic year: EX-<year code>-001, 002, … */
export async function nextExamCode(tx: typeof sql, enterpriseId: string, ayId: string) {
  const [y] = await tx`select code from academic_year where id = ${ayId}`;
  const prefix = `EX-${y?.code ?? 'AY'}-`;
  const from = prefix.length + 1;
  const [m] = await tx`select max(substring(code from ${from}::int)::int) n from exam where enterprise_id = ${enterpriseId} and code like ${prefix + '%'} and substring(code from ${from}::int) ~ '^[0-9]+$'`;
  return prefix + String((m?.n ?? 0) + 1).padStart(3, '0');
}

/** Section value inputs: a rating drop-down for small whole-number scales, else a number box. */
export function ratingChoices(s: Section) {
  if (s.input_type !== 'RATING' || !Number.isInteger(s.min_rating) || !Number.isInteger(s.max_rating) || s.max_rating - s.min_rating > 20) return null;
  return Array.from({ length: s.max_rating - s.min_rating + 1 }, (_, i) => s.min_rating + i);
}
