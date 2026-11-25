'use server';
import { sql, type Row } from '@/lib/db';
import { requirePriv, type SessionUser } from '@/lib/auth';
import { act, backOf, formObj } from '@/lib/util';
import { cancelDemandIfUnpaid } from '@/lib/fees';
import { marksEntered, templateSections, badWeights, examGrades, examSubjects } from '@/lib/examSetup';

const num = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));
const stepUrl = (id: string, step: number, extra = '') => `/exams/${id}/setup?step=${step}${extra}`;

async function editable(u: SessionUser, id: string) {
  const [e] = await sql`select * from exam where id = ${id} and enterprise_id = ${u.enterpriseId}`;
  if (!e) throw new Error('Exam not found');
  if (['PUBLISHED', 'CANCELLED'].includes(e.status_code)) throw new Error(`${e.name} is ${e.status_code === 'PUBLISHED' ? 'published' : 'cancelled'} – its setup can no longer be changed.`);
  return e;
}
const reached = (id: string, step: number, by: string) => sql`update exam set setup_step = greatest(setup_step, ${step}), last_updated_by = ${by}, last_update_date = now() where id = ${id}`;
/** After a stop is saved: on to the next stop (or stay, when "Save" rather than "Save & Next" was pressed). */
const after = (fd: FormData, id: string, step: number, msg: string) => ({ to: fd.get('_next') ? stepUrl(id, step + 1) : stepUrl(id, step), msg });

async function noMarks(e: Row, what: string) {
  if (await marksEntered(String(e.id))) throw new Error(`Marks have already been entered for ${e.name} – ${what} can no longer be changed.`);
}

/** Stop 1 – Exam Details (a new exam starts as a Draft). */
export async function saveExamDetails(id: string | null, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd, '/exams/new'), async () => {
    const o = formObj(fd);
    if (!o.name || !o.exam_type_code || !o.academic_year_id || !o.exam_date) throw new Error('Exam name, type, academic year and date are required');
    const [ay] = await sql`select * from academic_year where id = ${o.academic_year_id} and enterprise_id = ${u.enterpriseId}`;
    if (!ay) throw new Error('Academic year not found');
    if (o.exam_date < ay.start_date || o.exam_date > ay.end_date) throw new Error(`The exam date must fall within ${ay.name}`);
    // the exam code is the exam name, unique within the academic year
    const v = { name: o.name, code: o.name, exam_type_code: o.exam_type_code, academic_year_id: o.academic_year_id, exam_date: o.exam_date, description: o.description };
    const [dup] = await sql`select 1 from exam where enterprise_id = ${u.enterpriseId} and academic_year_id = ${o.academic_year_id} and lower(code) = lower(${o.name}) and id <> ${id ?? 0}`;
    if (dup) throw new Error(`An exam named ${o.name} already exists in ${ay.name} – the exam name is also its code, so choose a different name.`);
    if (id) {
      const e = await editable(u, id);
      const status = o.status_code && e.status_code !== 'DRAFT' ? o.status_code : e.status_code;
      if (String(e.academic_year_id) !== String(o.academic_year_id)) {
        const [c] = await sql`select count(*)::int n from exam_candidate where exam_id = ${id}`;
        if (c.n) throw new Error(`${c.n} student(s) are already assigned – the academic year can no longer be changed.`);
      }
      await sql`update exam set ${sql({ ...v, status_code: status, last_updated_by: u.username, last_update_date: new Date() })} where id = ${id}`;
      await reached(id, 1, u.username);
      return after(fd, id, 1, `${o.name} exam has been updated.`);
    }
    const newId = await sql.begin(async (tx) => {
      const [r] = await tx`insert into exam ${sql({
        ...v, enterprise_id: u.enterpriseId, status_code: 'DRAFT', setup_step: 1, fees_cleared_flag: 'N',
        outcome_code: o.exam_type_code === 'GRADE_EXAM' ? 'PROMOTE' : 'RECORD', created_by: u.username,
      })} returning id`;
      return String(r.id);
    });
    return { to: stepUrl(newId, 2), msg: `${o.name} exam has been created as a draft. Next: choose the grades that may sit it.` };
  });
}

/** Stop 2 – Grade Eligibility. */
export async function saveExamGrades(id: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const e = await editable(u, id);
    const ids = [...new Set(fd.getAll('grades').map(String).filter(Boolean))];
    if (!ids.length) throw new Error('Choose at least one grade');
    const old = (await sql`select grade_id from exam_grade where exam_id = ${id}`).map((g) => String(g.grade_id));
    const removed = old.filter((g) => !ids.includes(g));
    if (removed.length) {
      const [c] = await sql`select count(*)::int n, string_agg(distinct (select name from student_grade_f g where g.id = c.current_grade_id order by effective_start_date desc limit 1), ', ') names
        from exam_candidate c where c.exam_id = ${id} and c.current_grade_id in ${sql(removed)}`;
      if (c.n) throw new Error(`${c.n} assigned student(s) are in ${c.names} – remove them from the exam before removing the grade.`);
    }
    await sql.begin(async (tx) => {
      if (removed.length) {
        await tx`delete from exam_subject where exam_id = ${id} and grade_id in ${tx(removed)}`;
        await tx`delete from exam_examiner where exam_id = ${id} and grade_id in ${tx(removed)}`;
        await tx`delete from exam_grade where exam_id = ${id} and grade_id in ${tx(removed)}`;
      }
      for (const g of ids) await tx`insert into exam_grade (exam_id, grade_id) values (${id}, ${g}) on conflict do nothing`;
    });
    await reached(id, 2, u.username);
    return after(fd, id, 2, `${ids.length} grade(s) can sit ${e.name}.`);
  });
}

/** Stop 3 – Student Eligibility. */
export async function saveExamEligibility(id: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const e = await editable(u, id);
    const o = formObj(fd);
    const v = {
      min_attendance_pct: num(o.min_attendance_pct), min_months_in_grade: num(o.min_months_in_grade), min_age: num(o.min_age),
      fees_cleared_flag: o.fees_cleared_flag === 'Y' ? 'Y' : 'N', business_unit_id: o.business_unit_id, class_id: o.class_id,
    };
    if (v.min_attendance_pct !== null && (v.min_attendance_pct < 0 || v.min_attendance_pct > 100)) throw new Error('Minimum attendance must be between 0 and 100 %');
    if ((v.min_months_in_grade ?? 0) < 0 || (v.min_age ?? 0) < 0) throw new Error('Months and age cannot be negative');
    await sql`update exam set ${sql(v)} where id = ${id}`;
    await reached(id, 3, u.username);
    return after(fd, id, 3, `Student eligibility for ${e.name} has been updated.`);
  });
}

/** Stop 4 – add or change one subject of a grade (a single subject, or a combination of subjects with weights). */
export async function saveExamSubject(id: string, esId: string | null, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const e = await editable(u, id);
    await noMarks(e, 'its subjects');
    const o = formObj(fd);
    if (!o.grade_id || !o.subject_id || !o.subject_type_code) throw new Error('Grade, subject and subject type are required');
    const combined = o.combined_flag === 'Y';
    const weightType = o.weight_type === 'MARK' ? 'MARK' : 'PERCENT';
    const parts: { subject_id: string; weight: number; max_marks: number; pass_marks: number }[] = [];
    if (combined) {
      for (const i of [1, 2, 3]) {
        if (!o[`c${i}_subject_id`]) continue;
        const p = { subject_id: o[`c${i}_subject_id`]!, weight: Number(o[`c${i}_weight`]), max_marks: Number(o[`c${i}_max`]), pass_marks: Number(o[`c${i}_pass`]) };
        if (!(p.weight > 0) || !(p.max_marks > 0) || Number.isNaN(p.pass_marks) || p.pass_marks < 0) throw new Error(`Part ${i}: weight and maximum marks must be above 0, and the pass mark 0 or more`);
        if (p.pass_marks > p.max_marks) throw new Error(`Part ${i}: the pass mark cannot exceed the maximum`);
        parts.push(p);
      }
      if (parts.length < 2) throw new Error('A combined subject needs at least two subjects');
      if (new Set(parts.map((p) => p.subject_id)).size !== parts.length) throw new Error('Choose different subjects for each part');
      const tw = parts.reduce((t, p) => t + p.weight, 0);
      if (weightType === 'PERCENT' && Math.abs(tw - 100) > 0.001) throw new Error(`The weights of the parts must add up to 100 % (now ${tw} %)`);
    }
    let max = Number(o.max_marks), pass = Number(o.pass_marks);
    if (combined && weightType === 'MARK') max = parts.reduce((t, p) => t + p.weight, 0);
    if (!(max > 0) || Number.isNaN(pass) || pass < 0) throw new Error('Maximum marks must be above 0 and the pass mark 0 or more');
    if (pass > max) throw new Error(`The pass mark (${pass}) cannot exceed the maximum (${max})`);
    const v = { grade_id: o.grade_id, subject_id: o.subject_id, subject_type_code: o.subject_type_code, max_marks: max, pass_marks: pass,
      combined_flag: combined ? 'Y' : 'N', weight_type: weightType, display_seq: Number(o.display_seq ?? 0) };
    const [dup] = await sql`select 1 from exam_subject where exam_id = ${id} and grade_id = ${o.grade_id} and subject_id = ${o.subject_id} and subject_type_code = ${o.subject_type_code} and id <> ${esId ?? 0}`;
    if (dup) throw new Error('This subject is already in the exam for this grade');
    await sql.begin(async (tx) => {
      let sid = esId;
      if (esId) await tx`update exam_subject set ${tx(v)} where id = ${esId} and exam_id = ${id}`;
      else sid = String((await tx`insert into exam_subject ${tx({ ...v, exam_id: id })} returning id`)[0].id);
      await tx`delete from exam_subject_component where exam_subject_id = ${sid}`;
      for (const [i, p] of parts.entries()) await tx`insert into exam_subject_component ${tx({ ...p, exam_subject_id: sid, display_seq: i })}`;
    });
    const [s] = await sql`select name from subject_f where id = ${o.subject_id} order by effective_start_date desc limit 1`;
    return { to: stepUrl(id, 4, `&grade=${o.grade_id}`), msg: `${s?.name ?? 'The subject'} has been ${esId ? 'updated' : 'added'}${combined ? ` as a combination of ${parts.length} subjects` : ''}.` };
  });
}

export async function deleteExamSubject(id: string, esId: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const e = await editable(u, id);
    await noMarks(e, 'its subjects');
    const [s] = await sql`delete from exam_subject where id = ${esId} and exam_id = ${id} returning (select name from subject_f f where f.id = subject_id order by effective_start_date desc limit 1) name`;
    return { msg: `${s?.name ?? 'The subject'} has been removed from ${e.name}.` };
  });
}

/** Stop 4 – add every active subject (with its default marks) to a grade, or copy one grade's subjects to the others. */
export async function fillExamSubjects(id: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const e = await editable(u, id);
    await noMarks(e, 'its subjects');
    const o = formObj(fd);
    if (!o.grade_id) throw new Error('Choose a grade');
    const grades = (await sql`select grade_id from exam_grade where exam_id = ${id}`).map((g) => String(g.grade_id));
    let n = 0;
    await sql.begin(async (tx) => {
      if (o.mode === 'defaults') {
        const subs = await tx`select distinct on (s.id) s.id, s.subject_type_code, s.default_max_marks, s.default_pass_marks from subject_f s join subject x on x.id = s.id
          where x.enterprise_id = ${u.enterpriseId} and s.active_flag = 'Y' and ${e.exam_date}::date between s.effective_start_date and s.effective_end_date order by s.id`;
        for (const [i, s] of subs.entries()) {
          const r = await tx`insert into exam_subject (exam_id, grade_id, subject_id, subject_type_code, max_marks, pass_marks, display_seq)
            select ${id}, ${o.grade_id}, ${s.id}, ${s.subject_type_code}, ${s.default_max_marks ?? 100}, ${s.default_pass_marks ?? 35}, ${i}
            where not exists (select 1 from exam_subject y where y.exam_id = ${id} and y.grade_id = ${o.grade_id} and y.subject_id = ${s.id} and y.subject_type_code = ${s.subject_type_code})`;
          n += r.count;
        }
        return;
      }
      // copy this grade's subjects to every other grade (replacing theirs)
      const src = await tx`select * from exam_subject where exam_id = ${id} and grade_id = ${o.grade_id}`;
      if (!src.length) throw new Error('This grade has no subjects to copy');
      for (const g of grades.filter((x) => x !== o.grade_id)) {
        await tx`delete from exam_subject where exam_id = ${id} and grade_id = ${g}`;
        for (const s of src) {
          const [ns] = await tx`insert into exam_subject (exam_id, grade_id, subject_id, subject_type_code, max_marks, pass_marks, display_seq, combined_flag, weight_type, evaluation_template_id, evaluation_chosen_flag)
            values (${id}, ${g}, ${s.subject_id}, ${s.subject_type_code}, ${s.max_marks}, ${s.pass_marks}, ${s.display_seq}, ${s.combined_flag}, ${s.weight_type}, ${s.evaluation_template_id}, ${s.evaluation_chosen_flag}) returning id`;
          await tx`insert into exam_subject_component (exam_subject_id, subject_id, weight, max_marks, pass_marks, display_seq)
            select ${ns.id}, subject_id, weight, max_marks, pass_marks, display_seq from exam_subject_component where exam_subject_id = ${s.id}`;
          n++;
        }
      }
    });
    return { msg: o.mode === 'defaults' ? `${n} subject(s) have been added with their default marks.` : `${n} subject line(s) have been copied to the other grades.` };
  });
}

/** Stop 4 – done: every grade needs at least one subject. */
export async function finishExamSubjects(id: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const e = await editable(u, id);
    const grades = await examGrades(id, e.exam_date);
    const have = new Set((await sql`select distinct coalesce(grade_id::text, 'ALL') g from exam_subject where exam_id = ${id}`).map((r) => r.g));
    const none = grades.filter((g) => !have.has('ALL') && !have.has(String(g.grade_id)));
    if (none.length) throw new Error(`Add subjects for ${none.map((g) => g.name).join(', ')} first.`);
    await reached(id, 4, u.username);
    return { to: stepUrl(id, 5), msg: `Subjects for ${e.name} are complete.` };
  });
}

/** Stop 5 – the evaluation template of each subject of each grade (or direct marks). */
export async function saveExamTemplates(id: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const e = await editable(u, id);
    const o = formObj(fd);
    const subs = await examSubjects(id);
    const gname = new Map((await examGrades(id, e.exam_date)).map((g) => [String(g.grade_id), g.name as string]));
    const label = (s: (typeof subs)[number]) => `${s.subject_name} (${s.grade_id === null ? 'all grades' : gname.get(String(s.grade_id)) ?? ''})`;
    const missing = subs.filter((s) => !o[`t_${s.id}`]);
    if (missing.length && fd.get('_next')) throw new Error(`Choose the evaluation template (or direct marks) for ${missing.map(label).join(', ')}.`);
    const checked = new Map<string, string[]>();
    let n = 0;
    await sql.begin(async (tx) => {
      for (const s of subs) {
        const v = o[`t_${s.id}`];
        if (!v) continue;
        const t = v === 'NONE' ? null : v;
        if (String(t ?? '') !== String(s.evaluation_template_id ?? '')) {
          const [m] = await tx`select 1 from exam_mark m join exam_candidate c on c.id = m.candidate_id where m.exam_subject_id = ${s.id} and (m.marks is not null or m.absent_flag = 'Y') limit 1`;
          if (m) throw new Error(`Marks have already been entered for ${label(s)} – its evaluation template can no longer be changed.`);
        }
        if (t) {
          if (!checked.has(t)) {
            const [tp] = await tx`select * from evaluation_template where id = ${t} and enterprise_id = ${u.enterpriseId}`;
            if (!tp) throw new Error('Template not found');
            const bad = badWeights(await templateSections(t));
            if (bad.length) {
              const names = await tx`select distinct on (id) name from subject_f where id in ${tx(bad)} order by id, effective_start_date desc`;
              throw new Error(`In ${tp.name} the section weights of ${names.map((x) => x.name).join(', ')} do not add up to 100 % – fix the template first.`);
            }
            checked.set(t, (await tx`select distinct subject_id from evaluation_section where template_id = ${t}`).map((r) => String(r.subject_id)));
          }
          if (!s.parts.some((p) => checked.get(t)!.includes(p.subjectId))) throw new Error(`The chosen template has no sections for ${label(s)}.`);
        }
        await tx`update exam_subject set evaluation_template_id = ${t}, evaluation_chosen_flag = 'Y' where id = ${s.id}`;
        n++;
      }
    });
    await reached(id, 5, u.username);
    return after(fd, id, 5, `The evaluation of ${n} subject(s) of ${e.name} has been saved.`);
  });
}

/** Stop 6 – Targeted Outcome. */
export async function saveExamOutcome(id: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const e = await editable(u, id);
    const o = formObj(fd);
    const outcome = o.outcome_code === 'PROMOTE' ? 'PROMOTE' : 'RECORD';
    const pp = num(o.pass_percentage);
    if (pp !== null && (pp < 0 || pp > 100)) throw new Error('The overall pass % must be between 0 and 100');
    const grades = await examGrades(id, e.exam_date);
    if (outcome === 'PROMOTE') {
      const none = grades.filter((g) => !o[`target_${g.grade_id}`] && !g.next_grade_id);
      if (none.length) throw new Error(`Choose the grade to promote to for ${none.map((g) => g.name).join(', ')} (it has no next grade).`);
      const same = grades.filter((g) => o[`target_${g.grade_id}`] && String(o[`target_${g.grade_id}`]) === String(g.grade_id));
      if (same.length) throw new Error(`${same.map((g) => g.name).join(', ')} cannot be promoted to the same grade.`);
    }
    await sql.begin(async (tx) => {
      await tx`update exam set outcome_code = ${outcome}, pass_percentage = ${pp} where id = ${id}`;
      for (const g of grades) await tx`update exam_grade set target_grade_id = ${outcome === 'PROMOTE' ? o[`target_${g.grade_id}`] : null} where exam_id = ${id} and grade_id = ${g.grade_id}`;
    });
    await reached(id, 6, u.username);
    return after(fd, id, 6, outcome === 'PROMOTE' ? `Students who pass ${e.name} will be promoted to the next grade.` : `${e.name} results will be recorded on the student profile only.`);
  });
}

/** Stop 7 – Examiners per grade; finishing the setup schedules a draft exam. */
export async function saveExamExaminers(id: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const e = await editable(u, id);
    const grades = await examGrades(id, e.exam_date);
    let n = 0;
    await sql.begin(async (tx) => {
      await tx`delete from exam_examiner where exam_id = ${id}`;
      for (const g of grades)
        for (const p of new Set(fd.getAll(`ex_${g.grade_id}`).map(String).filter(Boolean))) { await tx`insert into exam_examiner (exam_id, grade_id, person_id) values (${id}, ${g.grade_id}, ${p})`; n++; }
    });
    await reached(id, 7, u.username);
    if (!fd.get('_next')) return { to: stepUrl(id, 7), msg: `${n} examiner assignment(s) have been saved.` };
    // finish: check the stops that are required
    if (!grades.length) throw new Error('Choose the grades that may sit the exam (stop 2) first.');
    const have = new Set((await sql`select distinct coalesce(grade_id::text, 'ALL') g from exam_subject where exam_id = ${id}`).map((r) => r.g));
    const none = grades.filter((g) => !have.has('ALL') && !have.has(String(g.grade_id)));
    if (none.length) throw new Error(`Add subjects for ${none.map((g) => g.name).join(', ')} (stop 4) first.`);
    const [nc] = await sql`select count(*)::int n from exam_subject where exam_id = ${id} and evaluation_chosen_flag = 'N'`;
    if (nc.n) throw new Error(`Choose the evaluation template of ${nc.n} subject(s) (stop 5) first.`);
    if (e.status_code === 'DRAFT') await sql`update exam set status_code = 'SCHEDULED' where id = ${id}`;
    return { to: `/exams/${id}`, msg: e.status_code === 'DRAFT' ? `${e.name} has been set up and scheduled. You can now assign students.` : `${e.name} setup has been saved.` };
  });
}

/**
 * Delete an exam until its results are published: assigned students, their marks
 * and unpaid exam fees go with it. Refused once a result is published or an exam fee is paid.
 */
export async function deleteExam(id: string, fd: FormData) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'WRITE');
  await act(backOf(fd, '/exams'), async () => {
    const [e] = await sql`select * from exam where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    if (!e) throw new Error('Exam not found');
    const [p] = await sql`select count(*)::int n from exam_candidate where exam_id = ${id} and published_flag = 'Y'`;
    if (e.status_code === 'PUBLISHED' || p.n)
      throw new Error(`${e.name} has ${p.n || 'its'} published result(s) – roll the results back first (Marks & Results › Roll Back), then delete.`);
    let cancelled = 0, students = 0;
    await sql.begin(async (tx) => {
      const cands = await tx`select c.id, c.fee_demand_id, (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = c.person_id order by effective_start_date desc limit 1) full_name
        from exam_candidate c where c.exam_id = ${id}`;
      for (const c of cands) {
        if (c.fee_demand_id) {
          if (!(await cancelDemandIfUnpaid(tx, c.fee_demand_id))) throw new Error(`${c.full_name} has paid the ${e.name} exam fee – delete or refund that receipt first, or cancel the exam instead.`);
          cancelled++;
        }
      }
      students = cands.length;
      await tx`delete from exam where id = ${id}`;
    });
    return { to: '/exams', msg: `${e.name} exam has been deleted${students ? ` with ${students} assigned student(s) and their marks${cancelled ? `; ${cancelled} unpaid exam fee line(s) cancelled` : ''}` : ''}.` };
  });
}
