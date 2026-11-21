'use server';
import { sql } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { act, backOf, formObj, addDays, todayISO } from '@/lib/util';
import { eligibleStudents, examFeeFor } from '@/lib/exams';
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

export async function saveExam(id: string | null, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd, '/exams'), async () => {
    const o = formObj(fd);
    if (!o.academic_year_id || !o.exam_type_code || !o.name || !o.exam_date) throw new Error('Academic year, type, name and date are required');
    const [ay] = await sql`select * from academic_year where id = ${o.academic_year_id}`;
    if (o.exam_date < ay.start_date || o.exam_date > ay.end_date) throw new Error(`Exam date must fall within ${ay.name}`);
    const v = {
      academic_year_id: o.academic_year_id, exam_type_code: o.exam_type_code, name: o.name, description: o.description, exam_date: o.exam_date,
      business_unit_id: o.business_unit_id, class_id: o.class_id, from_grade_id: o.from_grade_id, target_grade_id: o.exam_type_code === 'GRADE_EXAM' ? o.target_grade_id : null,
      min_attendance_pct: num(o.min_attendance_pct), fees_cleared_flag: o.fees_cleared_flag === 'Y' ? 'Y' : 'N', min_months_in_grade: num(o.min_months_in_grade),
      min_age: num(o.min_age), pass_percentage: num(o.pass_percentage), status_code: o.status_code ?? 'SCHEDULED',
    };
    if (v.exam_type_code === 'GRADE_EXAM' && !v.target_grade_id) {
      if (v.from_grade_id) {
        const [g] = await sql`select next_grade_id from student_grade_f where id = ${v.from_grade_id} order by effective_start_date desc limit 1`;
        v.target_grade_id = g?.next_grade_id ?? null;
      }
      if (!v.target_grade_id) throw new Error('Grade exams need a target grade (or an eligible grade that has a next grade)');
    }
    let eid = id;
    if (id) await sql`update exam set ${sql({ ...v, last_updated_by: u.username, last_update_date: new Date() })} where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    else {
      eid = (await sql`insert into exam ${sql({ ...v, enterprise_id: u.enterpriseId, created_by: u.username })} returning id`)[0].id;
      // pre-load subjects mapped by default marks
      const subs = fd.getAll('subjects').map(String);
      for (const [i, s] of subs.entries()) {
        const [sf] = await sql`select * from subject_f where id = ${s} order by effective_start_date desc limit 1`;
        if (sf) await sql`insert into exam_subject (exam_id, subject_id, subject_type_code, max_marks, pass_marks, display_seq) values (${eid}, ${s}, ${sf.subject_type_code}, ${sf.default_max_marks ?? 100}, ${sf.default_pass_marks ?? 35}, ${i})`;
      }
    }
    return { to: `/exams/${eid}`, msg: id ? 'Exam saved' : 'Exam created' };
  });
}

export async function saveSubject(examId: string, rowId: string | null, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    await loadExam(examId, u.enterpriseId);
    const o = formObj(fd);
    if (o._delete && rowId) {
      await sql`delete from exam_subject where id = ${rowId} and exam_id = ${examId}`;
      return { msg: 'Subject removed' };
    }
    if (!o.subject_id || !o.subject_type_code || !o.max_marks || !o.pass_marks) throw new Error('Subject, type, max and pass marks are required');
    if (Number(o.pass_marks) > Number(o.max_marks)) throw new Error('Pass marks cannot exceed max marks');
    const v = { subject_id: o.subject_id, subject_type_code: o.subject_type_code, max_marks: Number(o.max_marks), pass_marks: Number(o.pass_marks), display_seq: Number(o.display_seq ?? 0) };
    if (rowId) await sql`update exam_subject set ${sql(v)} where id = ${rowId} and exam_id = ${examId}`;
    else await sql`insert into exam_subject ${sql({ ...v, exam_id: examId })}`;
    return { msg: 'Subject saved' };
  });
}

/** Incharges select eligible students; an exam fee line is created per candidate. */
export async function assignCandidates(examId: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_CANDIDATE_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const exam = await loadExam(examId, u.enterpriseId);
    if (['PUBLISHED', 'CANCELLED'].includes(exam.status_code)) throw new Error('Exam is closed');
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
    return { msg: `${pool.length} student(s) assigned · ${fees} exam fee line(s) added to fee pages` };
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
    return { msg: 'Candidate removed and unpaid exam fee cancelled' };
  });
}

export async function saveMarks(examId: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_CANDIDATE_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const exam = await loadExam(examId, u.enterpriseId);
    if (exam.status_code === 'PUBLISHED' && !can(u, 'CD_EXAM_SETUP_PRV', 'WRITE')) throw new Error('Results are published; only users who can set up exams can change marks');
    const o = formObj(fd);
    const subjects = await sql`select * from exam_subject where exam_id = ${examId}`;
    if (!subjects.length) throw new Error('Add subjects before entering marks');
    const cands = await sql`select * from exam_candidate where exam_id = ${examId}`;
    let n = 0;
    await sql.begin(async (tx) => {
      for (const c of cands) {
        if (!(`m_${c.id}_${subjects[0].id}` in o)) continue;
        try { await assertStudentAccess(u, c.person_id, todayISO()); } catch { continue; }
        let total = 0, max = 0, allPass = true, anyMark = false, allAbsent = true;
        for (const s of subjects) {
          const absent = o[`a_${c.id}_${s.id}`] === 'Y';
          const raw = o[`m_${c.id}_${s.id}`];
          const marks = raw === null || raw === undefined ? null : Number(raw);
          if (marks !== null && (Number.isNaN(marks) || marks < 0 || marks > Number(s.max_marks))) throw new Error(`Marks must be between 0 and ${s.max_marks}`);
          await tx`insert into exam_mark (candidate_id, exam_subject_id, marks, absent_flag, entered_by) values (${c.id}, ${s.id}, ${absent ? null : marks}, ${absent ? 'Y' : 'N'}, ${u.username})
            on conflict (candidate_id, exam_subject_id) do update set marks = excluded.marks, absent_flag = excluded.absent_flag, entered_by = excluded.entered_by, entered_at = now()`;
          max += Number(s.max_marks);
          if (!absent) allAbsent = false;
          if (marks !== null && !absent) { anyMark = true; total += marks; }
          if (absent || marks === null || marks < Number(s.pass_marks)) allPass = false;
        }
        const pct = max ? Math.round((total / max) * 10000) / 100 : 0;
        const result = allAbsent ? 'ABSENT' : !anyMark ? 'PENDING' : allPass && (exam.pass_percentage === null || pct >= Number(exam.pass_percentage)) ? 'PASS' : 'FAIL';
        await tx`update exam_candidate set total_marks = ${anyMark ? total : null}, percentage = ${anyMark ? pct : null}, result_code = ${result} where id = ${c.id}`;
        n++;
      }
    });
    return { msg: `Marks saved for ${n} candidate(s)` };
  });
}

/** Publish results; for grade exams, promote passed students to the target grade. */
export async function publishResults(examId: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const exam = await loadExam(examId, u.enterpriseId);
    const o = formObj(fd);
    const date = o.promotion_date ?? todayISO();
    let promoted = 0;
    await sql.begin(async (tx) => {
      if (exam.exam_type_code === 'GRADE_EXAM' && o.promote === 'Y') {
        const action = await actionByType(u.enterpriseId, 'STUDENT', 'PROMOTION', date);
        if (!action) throw new Error('No Promotion action is configured for students');
        const passed = await tx`select * from exam_candidate where exam_id = ${examId} and result_code = 'PASS' and promoted_flag = 'N'`;
        for (const c of passed) {
          await dtChange(tx, 'assignment', c.assignment_id, date, 'UPDATE', {
            student_grade_id: exam.target_grade_id, action_id: action.id, action_reason_code: 'GRADE_EXAM_PASSED', comments: `Passed ${exam.name}`,
            ...(action.assignment_status_id ? { assignment_status_id: action.assignment_status_id } : {}),
          }, u.username);
          await tx`update exam_candidate set promoted_flag = 'Y' where id = ${c.id}`;
          promoted++;
        }
      }
      await tx`update exam set status_code = 'PUBLISHED', last_updated_by = ${u.username}, last_update_date = now() where id = ${examId}`;
    });
    return { msg: `Results published${promoted ? ` · ${promoted} student(s) promoted effective ${date}` : ''}` };
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
    return { msg: `${n} exam fee(s) saved` };
  });
}
