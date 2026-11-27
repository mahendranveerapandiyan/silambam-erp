import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { examGrades, examSubjects, evaluatorGrades } from '@/lib/examSetup';
import { studentScopeSql } from '@/lib/scope';
import { fmtDate, todayISO } from '@/lib/util';
import { PageHeader, Flash, Back, Badge, Empty, type SP, s as one, here } from '@/components/ui';
import { ConfirmButton } from '@/components/client';
import { saveSubjectChoices } from '../../actions';

/** Optional subjects each student chooses (decided during the exam days). */
export default async function SubjectChoices({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requirePriv(['CD_EXAM_SETUP_PRV', 'CD_EXAM_CANDIDATE_PRV'], 'READ');
  const { id } = await params;
  const sp = await searchParams;
  const [exam] = await sql`select e.*, y.name ay_name from exam e join academic_year y on y.id = e.academic_year_id where e.id = ${id} and e.enterprise_id = ${u.enterpriseId}`;
  if (!exam) notFound();
  const admin = can(u, 'CD_EXAM_SETUP_PRV', 'WRITE');
  const mine = await evaluatorGrades(u, id);
  const grades = (await examGrades(id, exam.exam_date)).filter((g) => Number(g.optional_count) > 0 && (mine === 'ALL' || mine.has(String(g.grade_id))));
  const header = (
    <PageHeader title={`Subject Choices – ${exam.name}`} subtitle={<>{exam.ay_name} · {fmtDate(exam.exam_date)} · each student chooses their optional subjects</>}
      actions={<Link href={`/exams/${id}?tab=results`} className="btn">Back to exam</Link>} />
  );
  if (!grades.length) return <div className="max-w-6xl">{header}<div className="card muted">No grade {mine === 'ALL' ? '' : 'you examine '}in this exam has optional subjects. Set them in Exam Setup › Subjects.</div></div>;
  const grade = grades.find((g) => String(g.grade_id) === one(sp.grade)) ?? grades[0];
  const need = Number(grade.optional_count);
  const opt = (await examSubjects(id, String(grade.grade_id))).filter((x) => x.optional_flag === 'Y');
  const comp = (await examSubjects(id, String(grade.grade_id))).filter((x) => x.optional_flag !== 'Y');
  const examiner = admin || (await sql`select 1 from exam_examiner where exam_id = ${id} and grade_id = ${grade.grade_id} and person_id = ${u.personId ?? 0}`).length > 0;
  const today = todayISO();
  const cands = await sql`
    select c.*, a.assignment_number, (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = c.person_id order by effective_start_date desc limit 1) full_name
    from exam_candidate c join assignment a on a.id = c.assignment_id
    left join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    where c.exam_id = ${id} and c.current_grade_id = ${grade.grade_id} ${examiner ? sql`` : studentScopeSql(u, today)}
    order by full_name`;
  const chosen = new Set((cands.length ? await sql`select candidate_id, exam_subject_id from exam_candidate_subject where candidate_id in ${sql(cands.map((c) => c.id))}` : [])
    .map((r) => `${r.candidate_id}_${r.exam_subject_id}`));
  const marked = new Set((cands.length ? await sql`select candidate_id, exam_subject_id from exam_mark where candidate_id in ${sql(cands.map((c) => c.id))} and (marks is not null or absent_flag = 'Y')` : [])
    .map((r) => `${r.candidate_id}_${r.exam_subject_id}`));
  const canEdit = (admin || can(u, 'CD_EXAM_CANDIDATE_PRV', 'WRITE')) && !['DRAFT', 'CANCELLED'].includes(exam.status_code);
  const done = cands.filter((c) => opt.filter((x) => chosen.has(`${c.id}_${x.id}`)).length === need).length;

  return (
    <div className="max-w-7xl">
      {header}
      <Flash sp={sp} />
      <div className="mb-3 flex flex-wrap items-center gap-2"><span className="label mb-0">Grade</span>
        {grades.map((g) => <Link key={g.grade_id} href={`/exams/${id}/choices?grade=${g.grade_id}`} className={`rounded-full border px-3 py-1 text-sm ${String(g.grade_id) === String(grade.grade_id) ? 'border-sky-600 bg-sky-50 font-semibold text-sky-800' : 'border-slate-300'}`}>{g.name} · choose {g.optional_count}</Link>)}
      </div>
      <form key={String(grade.grade_id)} action={saveSubjectChoices.bind(null, id, String(grade.grade_id))} className="card overflow-x-auto">
        <Back to={here(`/exams/${id}/choices`, { grade: String(grade.grade_id) })} />
        <p className="muted mb-2">Every {grade.name} student sits the compulsory subjects ({comp.map((x) => x.subject_name).join(', ') || 'none'}) and chooses <b>{need}</b> of the {opt.length} optional subjects below. {done} of {cands.length} student(s) have chosen.</p>
        <table className="tbl">
          <thead><tr><th>Student</th>{opt.map((x) => <th key={x.id} className="text-center">{x.subject_name}<div className="font-normal normal-case">max {Number(x.max_marks)}</div></th>)}<th>Chosen</th></tr></thead>
          <tbody>{cands.map((c) => {
            const pub = c.published_flag === 'Y';
            const n = opt.filter((x) => chosen.has(`${c.id}_${x.id}`)).length;
            return (
              <tr key={c.id} className={pub ? 'bg-slate-100 text-slate-500' : ''}>
                <td>{!pub && <input type="hidden" name={`seen_${c.id}`} value="1" />}{c.full_name}<div className="text-xs text-gray-500">{c.assignment_number}{pub && <> · <Badge color="green">Published</Badge></>}</div></td>
                {opt.map((x) => (
                  <td key={x.id} className="text-center">
                    <input type="checkbox" name={`opt_${c.id}`} value={x.id} defaultChecked={chosen.has(`${c.id}_${x.id}`)} disabled={!canEdit || pub} aria-label={`${c.full_name} ${x.subject_name}`} />
                    {marked.has(`${c.id}_${x.id}`) && <div className="text-[10px] text-amber-700">marks entered</div>}
                  </td>))}
                <td>{n === need ? <Badge color="green">{n} of {need} ✓</Badge> : n ? <Badge color="red">{n} of {need}</Badge> : <Badge color="amber">not chosen</Badge>}</td>
              </tr>);
          })}</tbody>
        </table>
        {!cands.length && <Empty>No {grade.name} students are assigned{examiner ? '' : ' in your classes'}.</Empty>}
        {canEdit && cands.length > 0 && (
          <ConfirmButton className="btn btn-primary mt-3" message={`Save the subject choices? Each student must have exactly ${need} optional subject(s) ticked (or none yet). Marks already entered for a subject a student drops are removed.`}>Save Choices</ConfirmButton>
        )}
      </form>
    </div>
  );
}
