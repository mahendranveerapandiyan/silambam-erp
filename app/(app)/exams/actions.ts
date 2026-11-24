'use server';
import { sql } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { act, backOf, formObj, addDays, todayISO } from '@/lib/util';
import { eligibleStudents, examFeeFor } from '@/lib/exams';
import { examSubjects, templateSections, partMark, subjectScore, recomputeCandidate, evaluatorGrades } from '@/lib/examSetup';
import { addDemand, cancelDemandIfUnpaid } from '@/lib/fees';
import { dtChange } from '@/lib/dt';
import { actionByType } from '@/lib/people';
import { assertStudentAccess } from '@/lib/scope';

const num = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));

async function loadExam(id: string, enterpriseId: string) {
  const [e] = await sql`select * from exam where id = ${id} and enterprise_id = ${enterpriseId}`;
  if (!e) throw new Error('Exam not found');
  return e;
}

/** Incharges select eligible students; an exam fee line is created per candidate. */
export async function assignCandidates(examId: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_CANDIDATE_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const exam = await loadExam(examId, u.enterpriseId);
    if (['PUBLISHED', 'CANCELLED'].includes(exam.status_code)) throw new Error('Exam is closed');
    if (exam.status_code === 'DRAFT') throw new Error(`${exam.name} is still a draft – finish its setup first`);
    const ids = new Set(fd.getAll('person').map(String));
    const override = formObj(fd).override === 'Y' && can(u, 'CD_EXAM_SETUP_PRV', 'WRITE');
    if (!ids.size) throw new Error('Select at least one student');
    const pool = (await eligibleStudents(u, exam)).filter((s) => ids.has(String(s.person_id)));
    const blocked = pool.filter((s) => !s.eligible && !(override && !s.checks.find((c) => c.label === 'One grade exam / year' && !c.ok)));
    if (blocked.length) throw new Error(`Not eligible: ${blocked.map((b) => `${b.full_name} (${b.checks.filter((c) => !c.ok).map((c) => c.label).join(', ')})`).join('; ')}`);
    let fees = 0;
    await sql.begin(async (tx) => {
      for (const s of pool) {
        if (s.assigned) continue;
        const [c] = await tx`insert into exam_candidate (exam_id, person_id, assignment_id, academic_year_id, exam_type_code, current_grade_id, assigned_by)
          values (${examId}, ${s.person_id}, ${s.assignment_id}, ${exam.academic_year_id}, ${exam.exam_type_code}, ${s.student_grade_id}, ${u.username}) returning id`;
        const amount = await examFeeFor(exam, s.student_grade_id);
        if (amount && amount > 0) {
          const due = addDays(exam.exam_date, -7) < todayISO() ? todayISO() : addDays(exam.exam_date, -7);
          const did = await addDemand(tx, {
            enterpriseId: u.enterpriseId, personId: s.person_id, feeType: exam.exam_type_code, description: `${exam.name} – exam fee`, amount, dueDate: due,
            by: u.username, sourceType: 'EXAM', sourceId: examId, ayId: exam.academic_year_id, buId: s.business_unit_id, assignmentId: s.assignment_id,
          });
          await tx`update exam_candidate set fee_demand_id = ${did} where id = ${c.id}`;
          fees++;
        }
      }
    });
    return { msg: `${pool.length} student(s) have been assigned. ${fees} exam fee line(s) have been added to fee pages.` };
  });
}

export async function removeCandidate(examId: string, candidateId: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_CANDIDATE_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const [c] = await sql`select * from exam_candidate where id = ${candidateId} and exam_id = ${examId}`;
    if (!c) throw new Error('Candidate not found');
    await assertStudentAccess(u, c.person_id, todayISO());
    if (c.result_code !== 'PENDING') throw new Error('Results already entered; cannot remove');
    await sql.begin(async (tx) => {
      if (!(await cancelDemandIfUnpaid(tx, c.fee_demand_id))) throw new Error('Exam fee already paid – cancel the receipt first or keep the candidate');
      await tx`delete from exam_candidate where id = ${candidateId}`;
    });
    return { msg: 'The candidate has been removed and the unpaid exam fee cancelled.' };
  });
}

/**
 * Marks of one subject for the candidates of one grade: section ratings (evaluation
 * template) or marks per part; the subject mark, pass and the candidate's result follow.
 */
export async function saveSubjectMarks(examId: string, esId: string, gradeId: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_CANDIDATE_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const exam = await loadExam(examId, u.enterpriseId);
    const admin = can(u, 'CD_EXAM_SETUP_PRV', 'WRITE');
    if (exam.status_code === 'DRAFT') throw new Error('Finish the exam setup first');
    if (exam.status_code === 'CANCELLED') throw new Error('The exam is cancelled');
    if (exam.status_code === 'PUBLISHED' && !admin) throw new Error('Results are published; only users who can set up exams can change marks');
    const grades = await evaluatorGrades(u, examId);
    if (grades !== 'ALL' && !grades.has(gradeId)) throw new Error('You are not an examiner for this grade');
    const [es] = (await examSubjects(examId, gradeId)).filter((x) => String(x.id) === esId);
    if (!es) throw new Error('Subject not found for this grade');
    const sections = await templateSections(exam.evaluation_template_id);
    const examiner = admin || (await sql`select 1 from exam_examiner where exam_id = ${examId} and grade_id = ${gradeId} and person_id = ${u.personId ?? 0}`).length > 0;
    const o = formObj(fd);
    const cands = await sql`select * from exam_candidate where exam_id = ${examId} and current_grade_id = ${gradeId}`;
    const rng = (v: string | null | undefined, lo: number, hi: number, what: string) => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      if (Number.isNaN(n) || n < lo || n > hi) throw new Error(`${what} must be between ${lo} and ${hi}`);
      return n;
    };
    let n = 0;
    await sql.begin(async (tx) => {
      for (const c of cands) {
        if (!(`seen_${c.id}` in o)) continue;
        if (!examiner) { try { await assertStudentAccess(u, c.person_id, todayISO()); } catch { continue; } }
        const absent = o[`ab_${c.id}`] === 'Y';
        const partMarks: (number | null)[] = [];
        for (const p of es.parts) {
          const secs = sections.get(p.subjectId);
          if (secs?.length) {
            const ratings = new Map<string, number | null>();
            for (const sec of secs) {
              const r = absent ? null : rng(o[`r_${c.id}_${p.id}_${sec.id}`], sec.min_rating, sec.max_rating, `${p.name} – ${sec.name} rating`);
              ratings.set(sec.id, r);
              await tx`insert into exam_section_rating (candidate_id, exam_subject_id, component_id, section_id, rating, entered_by) values (${c.id}, ${esId}, ${p.id}, ${sec.id}, ${r}, ${u.username})
                on conflict (candidate_id, exam_subject_id, component_id, section_id) do update set rating = excluded.rating, entered_by = excluded.entered_by, entered_at = now()`;
            }
            partMarks.push(partMark(p, secs, ratings, null));
          } else {
            const m = absent ? null : rng(o[`u_${c.id}_${p.id}`], 0, p.max, `${p.name} marks`);
            partMarks.push(m);
          }
          await tx`insert into exam_unit_mark (candidate_id, exam_subject_id, component_id, marks, absent_flag, entered_by)
            values (${c.id}, ${esId}, ${p.id}, ${partMarks[partMarks.length - 1]}, ${absent ? 'Y' : 'N'}, ${u.username})
            on conflict (candidate_id, exam_subject_id, component_id) do update set marks = excluded.marks, absent_flag = excluded.absent_flag, entered_by = excluded.entered_by, entered_at = now()`;
        }
        const sc = absent ? { marks: null, pass: false } : subjectScore(es, partMarks);
        await tx`insert into exam_mark (candidate_id, exam_subject_id, marks, absent_flag, pass_flag, entered_by)
          values (${c.id}, ${esId}, ${sc.marks}, ${absent ? 'Y' : 'N'}, ${sc.marks === null ? null : sc.pass ? 'Y' : 'N'}, ${u.username})
          on conflict (candidate_id, exam_subject_id) do update set marks = excluded.marks, absent_flag = excluded.absent_flag, pass_flag = excluded.pass_flag, entered_by = excluded.entered_by, entered_at = now()`;
        await recomputeCandidate(tx as unknown as typeof sql, exam, c.id);
        n++;
      }
    });
    return { msg: `${es.subject_name} marks have been saved for ${n} student(s).` };
  });
}

/** Publish results; when the exam promotes, passed students move to their grade's target grade. */
export async function publishResults(examId: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const exam = await loadExam(examId, u.enterpriseId);
    if (exam.status_code === 'DRAFT') throw new Error('Finish the exam setup first');
    const o = formObj(fd);
    const date = o.promotion_date ?? todayISO();
    let promoted = 0;
    await sql.begin(async (tx) => {
      if (exam.outcome_code === 'PROMOTE' && o.promote === 'Y') {
        const action = await actionByType(u.enterpriseId, 'STUDENT', 'PROMOTION', date);
        if (!action) throw new Error('No Promotion action is configured for students');
        const passed = await tx`select c.*, coalesce(eg.target_grade_id, (select next_grade_id from student_grade_f g where g.id = c.current_grade_id order by effective_start_date desc limit 1)) target
          from exam_candidate c left join exam_grade eg on eg.exam_id = c.exam_id and eg.grade_id = c.current_grade_id
          where c.exam_id = ${examId} and c.result_code = 'PASS' and c.promoted_flag = 'N'`;
        const none = passed.filter((c) => !c.target);
        if (none.length) throw new Error(`${none.length} passed student(s) have no grade to be promoted to – set it in stop 6 of the exam setup.`);
        for (const c of passed) {
          await dtChange(tx, 'assignment', c.assignment_id, date, 'UPDATE', {
            student_grade_id: c.target, action_id: action.id, action_reason_code: 'GRADE_EXAM_PASSED', comments: `Passed ${exam.name}`,
            ...(action.assignment_status_id ? { assignment_status_id: action.assignment_status_id } : {}),
          }, u.username);
          await tx`update exam_candidate set promoted_flag = 'Y' where id = ${c.id}`;
          promoted++;
        }
      }
      await tx`update exam set status_code = 'PUBLISHED', last_updated_by = ${u.username}, last_update_date = now() where id = ${examId}`;
    });
    return { msg: `${exam.name} results have been published${promoted ? ` · ${promoted} student(s) promoted effective ${date}` : ' and recorded on the student profiles'}.` };
  });
}

export async function saveExamFees(fd: FormData) {
  const u = await requirePriv('CD_EXAM_FEE_PRV', 'WRITE');
  await act(backOf(fd, '/exams/fees'), async () => {
    const o = formObj(fd);
    if (!o.academic_year_id) throw new Error('Academic year is required');
    let n = 0;
    await sql.begin(async (tx) => {
      for (const [k, v] of Object.entries(o)) {
        const m = k.match(/^f_([A-Z_]+)_(\d+)$/);
        if (!m) continue;
        if (v === null) {
          await tx`delete from exam_fee where academic_year_id = ${o.academic_year_id} and exam_type_code = ${m[1]} and student_grade_id = ${m[2]}`;
          continue;
        }
        if (Number.isNaN(Number(v)) || Number(v) < 0) throw new Error('Invalid amount');
        await tx`insert into exam_fee (academic_year_id, exam_type_code, student_grade_id, amount) values (${o.academic_year_id}, ${m[1]}, ${m[2]}, ${Number(v)})
          on conflict (academic_year_id, exam_type_code, student_grade_id) do update set amount = excluded.amount`;
        n++;
      }
    });
    return { msg: `${n} exam fee(s) have been updated.` };
  });
}
