import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { examGrades, examSubjects, templateSections, evaluatorGrades, ratingChoices } from '@/lib/examSetup';
import { studentScopeSql } from '@/lib/scope';
import { fmtDate, todayISO } from '@/lib/util';
import { PageHeader, Flash, Back, Badge, Empty, STATUS_COLOR, type SP, s as one, here } from '@/components/ui';
import { saveSubjectMarks } from '../../actions';

/** Marks entry: one grade and one subject at a time; examiners see only their grades. */
export default async function ExamMarks({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requirePriv(['CD_EXAM_SETUP_PRV', 'CD_EXAM_CANDIDATE_PRV'], 'READ');
  const { id } = await params;
  const sp = await searchParams;
  const [exam] = await sql`select e.*, y.name ay_name from exam e join academic_year y on y.id = e.academic_year_id where e.id = ${id} and e.enterprise_id = ${u.enterpriseId}`;
  if (!exam) notFound();
  const L = await lk();
  const admin = can(u, 'CD_EXAM_SETUP_PRV', 'WRITE');
  const mine = await evaluatorGrades(u, id);
  // grades of the exam (older exams: the grades of their candidates)
  let grades: { grade_id: string; name: string }[] = (await examGrades(id, exam.exam_date)).map((g) => ({ grade_id: String(g.grade_id), name: g.name }));
  if (!grades.length)
    grades = (await sql`select distinct c.current_grade_id grade_id, (select name from student_grade_f g where g.id = c.current_grade_id order by effective_start_date desc limit 1) name
      from exam_candidate c where c.exam_id = ${id} and c.current_grade_id is not null`).map((g) => ({ grade_id: String(g.grade_id), name: g.name }));
  const visible = grades.filter((g) => mine === 'ALL' || mine.has(g.grade_id));
  const header = (
    <PageHeader title={`Marks – ${exam.name}`}
      subtitle={<><span className="font-mono">{exam.code}</span> · {exam.ay_name} · {fmtDate(exam.exam_date)} · <Badge color={exam.status_code === 'PUBLISHED' ? 'green' : 'blue'}>{L('EXAM_STATUS', exam.status_code)}</Badge></>}
      actions={<Link href={`/exams/${id}?tab=results`} className="btn">Back to exam</Link>} />
  );
  if (exam.status_code === 'DRAFT') return <div className="max-w-6xl">{header}<div className="card muted">The exam is still being set up.</div></div>;
  if (!visible.length) return <div className="max-w-6xl">{header}<div className="card muted">You are not an examiner for any grade of this exam.</div></div>;
  const grade = visible.find((g) => g.grade_id === one(sp.grade)) ?? visible[0];
  const subjects = await examSubjects(id, grade.grade_id);
  const es = subjects.find((s) => String(s.id) === one(sp.subject)) ?? subjects[0];
  const sections = await templateSections(es?.evaluation_template_id);
  const examiner = admin || (await sql`select 1 from exam_examiner where exam_id = ${id} and grade_id = ${grade.grade_id} and person_id = ${u.personId ?? 0}`).length > 0;
  const today = todayISO();
  const cands = await sql`
    select c.*, a.assignment_number, (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = c.person_id order by effective_start_date desc limit 1) full_name
    from exam_candidate c join assignment a on a.id = c.assignment_id
    left join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    where c.exam_id = ${id} and c.current_grade_id = ${grade.grade_id} ${examiner ? sql`` : studentScopeSql(u, today)}
    order by full_name`;
  const locked = exam.status_code === 'CANCELLED' || !(admin || can(u, 'CD_EXAM_CANDIDATE_PRV', 'WRITE'));
  const open = cands.filter((c) => c.published_flag !== 'Y');
  const ids = cands.map((c) => c.id);
  const units = es && ids.length ? await sql`select * from exam_unit_mark where exam_subject_id = ${es.id} and candidate_id in ${sql(ids)}` : [];
  const rates = es && ids.length ? await sql`select * from exam_section_rating where exam_subject_id = ${es.id} and candidate_id in ${sql(ids)}` : [];
  const subj = es && ids.length ? await sql`select * from exam_mark where exam_subject_id = ${es.id} and candidate_id in ${sql(ids)}` : [];
  const U = new Map(units.map((r) => [`${r.candidate_id}_${r.component_id}`, r]));
  const R = new Map(rates.map((r) => [`${r.candidate_id}_${r.component_id}_${r.section_id}`, r.rating]));
  const M = new Map(subj.map((r) => [String(r.candidate_id), r]));
  // legacy marks (entered before parts existed) show in the single part
  const legacy = (cid: string) => M.get(String(cid))?.marks ?? '';
  const pageUrl = (g: string, s?: string) => `/exams/${id}/marks?grade=${g}${s ? `&subject=${s}` : ''}`;

  return (
    <div className="max-w-7xl">
      {header}
      <Flash sp={sp} />
      <div className="mb-2 flex flex-wrap items-center gap-2"><span className="label mb-0">Grade</span>
        {visible.map((g) => <Link key={g.grade_id} href={pageUrl(g.grade_id)} className={`rounded-full border px-3 py-1 text-sm ${g.grade_id === grade.grade_id ? 'border-sky-600 bg-sky-50 font-semibold text-sky-800' : 'border-slate-300'}`}>{g.name}</Link>)}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2"><span className="label mb-0">Subject</span>
        {subjects.map((s) => <Link key={s.id} href={pageUrl(grade.grade_id, String(s.id))} className={`rounded-full border px-3 py-1 text-sm ${es && s.id === es.id ? 'border-sky-600 bg-sky-50 font-semibold text-sky-800' : 'border-slate-300'}`}>{s.subject_name}</Link>)}
        {!subjects.length && <span className="muted">No subjects for this grade – add them in stop 4 of the exam setup.</span>}
      </div>
      {es && (
        <form action={saveSubjectMarks.bind(null, id, String(es.id), grade.grade_id)} className="card overflow-x-auto">
          <Back to={here(`/exams/${id}/marks`, { ...sp, grade: grade.grade_id, subject: String(es.id) })} />
          <p className="muted mb-2">
            <b>{es.subject_name}</b> · out of {Number(es.max_marks)}, pass {Number(es.pass_marks)}
            {es.combined_flag === 'Y' && <> · combines {es.parts.map((p) => `${p.name} (${es.weight_type === 'MARK' ? `${p.weight} marks` : `${p.weight} %`}, pass ${p.pass}/${p.max})`).join(' + ')}</>}
            {es.parts.some((p) => sections.get(p.subjectId)?.length) && <> · evaluated by sections – the mark is worked out from the weights</>}
          </p>
          {cands.length > 0 && open.length < cands.length && (
            <div className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
              {open.length ? `${cands.length - open.length} student(s) have published results – their marks are locked.` : 'The results are published – marks are locked.'} To change them, roll the results back first (exam › Marks & Results, or the student profile › Exams).
            </div>)}
          <table className="tbl">
            <thead>
              <tr><th rowSpan={2}>Student</th>
                {es.parts.map((p) => { const secs = sections.get(p.subjectId) ?? []; return <th key={p.id} colSpan={Math.max(secs.length, 1)} className="text-center">{p.name}<div className="font-normal normal-case">{secs.length ? `rate → mark out of ${p.max}` : `mark out of ${p.max}`} · pass {p.pass}</div></th>; })}
                <th rowSpan={2}>Absent</th><th rowSpan={2}>{es.subject_name} mark</th><th rowSpan={2}>Subject</th><th rowSpan={2}>Exam result</th></tr>
              <tr>{es.parts.flatMap((p) => { const secs = sections.get(p.subjectId) ?? []; return secs.length ? secs.map((s) => <th key={`${p.id}_${s.id}`} className="font-normal normal-case">{s.name}<div className="text-[10px]">{s.weight_pct}% · {s.input_type === 'MARK' ? 'marks' : 'rating'} {s.min_rating}–{s.max_rating}</div></th>) : [<th key={p.id} className="font-normal normal-case">Marks</th>]; })}</tr>
            </thead>
            <tbody>{cands.map((c) => {
              const m = M.get(String(c.id));
              const absent = m?.absent_flag === 'Y';
              const pub = c.published_flag === 'Y';
              const off = locked || pub;
              return (
                <tr key={c.id} className={pub ? 'bg-slate-100 text-slate-500' : ''}>
                  <td>{!pub && <input type="hidden" name={`seen_${c.id}`} value="1" />}{c.full_name}<div className="text-xs text-gray-500">{c.assignment_number}{pub && <> · <Badge color="green">Published</Badge></>}</div></td>
                  {es.parts.flatMap((p) => {
                    const secs = sections.get(p.subjectId) ?? [];
                    if (secs.length) return secs.map((s) => {
                      const ch = ratingChoices(s);
                      const nm = `r_${c.id}_${p.id}_${s.id}`;
                      const v = R.get(`${c.id}_${p.id}_${s.id}`);
                      const lbl = `${c.full_name} ${p.name} ${s.name}`;
                      return <td key={`${p.id}_${s.id}`}>{ch
                        ? <select name={nm} defaultValue={v === null || v === undefined ? '' : String(Number(v))} disabled={off} className="input w-20" aria-label={lbl}><option value="">–</option>{ch.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                        : <input name={nm} type="number" step="0.5" min={s.min_rating} max={s.max_rating} defaultValue={v ?? ''} disabled={off} className="input w-20" aria-label={lbl} />}</td>;
                    });
                    const um = U.get(`${c.id}_${p.id}`);
                    return [<td key={p.id}><input name={`u_${c.id}_${p.id}`} type="number" step="0.5" min="0" max={p.max} defaultValue={um ? um.marks ?? '' : es.combined_flag === 'Y' ? '' : legacy(c.id)} disabled={off} className="input w-20" aria-label={`${c.full_name} ${p.name} marks`} /></td>];
                  })}
                  <td><input type="checkbox" name={`ab_${c.id}`} value="Y" defaultChecked={absent} disabled={off} aria-label={`${c.full_name} absent`} /></td>
                  <td className="font-semibold">{m?.marks ?? (absent ? 'AB' : '—')}</td>
                  <td>{m?.pass_flag === 'Y' ? <Badge color="green">Pass</Badge> : m?.pass_flag === 'N' || absent ? <Badge color="red">{absent ? 'Absent' : 'Fail'}</Badge> : ''}</td>
                  <td><Badge color={STATUS_COLOR[c.result_code]}>{L('EXAM_RESULT', c.result_code)}</Badge> {c.percentage !== null && <span className="text-xs">{c.percentage}%</span>}</td>
                </tr>);
            })}</tbody>
          </table>
          {!cands.length && <Empty>No students of {grade.name} are assigned{examiner ? '' : ' in your classes'}.</Empty>}
          {cands.length > 0 && <button className="btn btn-primary mt-3" disabled={locked || !open.length} title={!open.length ? 'Results are published – roll back to change marks' : undefined}>Save {es.subject_name} Marks</button>}
        </form>
      )}
    </div>
  );
}
