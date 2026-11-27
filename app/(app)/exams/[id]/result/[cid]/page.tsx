import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { candidateSubjects, partSections, evaluatorGrades } from '@/lib/examSetup';
import { assertStudentAccess } from '@/lib/scope';
import { fmtDate, todayISO } from '@/lib/util';
import { PageHeader, Badge, Empty } from '@/components/ui';

/** One student's result in an exam (opened from the student profile › Exams). */
export default async function StudentExamResult({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const u = await requirePriv(['CD_EXAM_SETUP_PRV', 'CD_EXAM_CANDIDATE_PRV'], 'READ');
  const { id, cid } = await params;
  const [c] = await sql`
    select c.*, e.name exam_name, e.exam_date, e.exam_type_code, e.outcome_code, e.enterprise_id, e.promotion_date, y.name ay_name, a.assignment_number,
      (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = c.person_id order by effective_start_date desc limit 1) full_name,
      (select name from student_grade_f g where g.id = c.current_grade_id order by effective_start_date desc limit 1) grade_name,
      (select name from student_grade_f g where g.id = c.promoted_to_grade_id order by effective_start_date desc limit 1) promoted_to,
      (select name from grading_scale s where s.id = e.grading_scale_id) grading_name
    from exam_candidate c join exam e on e.id = c.exam_id join academic_year y on y.id = c.academic_year_id join assignment a on a.id = c.assignment_id
    where c.id = ${cid} and c.exam_id = ${id}`;
  if (!c || String(c.enterprise_id) !== String(u.enterpriseId)) notFound();
  // own class / branch only, unless the user examines this grade or sees all students
  const ev = await evaluatorGrades(u, id);
  if (!(ev === 'ALL' && can(u, 'CD_EXAM_SETUP_PRV')) && !(ev !== 'ALL' && ev.has(String(c.current_grade_id)))) {
    try { await assertStudentAccess(u, c.person_id, todayISO()); } catch { notFound(); }
  }
  const L = await lk();
  const subjects = await candidateSubjects(id, { id: c.id, current_grade_id: c.current_grade_id });
  const marks = new Map((await sql`select * from exam_mark where candidate_id = ${cid}`).map((m) => [String(m.exam_subject_id), m]));
  const units = new Map((await sql`select * from exam_unit_mark where candidate_id = ${cid}`).map((m) => [`${m.exam_subject_id}_${m.component_id}`, m]));
  const rates = new Map((await sql`select * from exam_section_rating where candidate_id = ${cid}`).map((m) => [`${m.exam_subject_id}_${m.component_id}_${m.section_id}`, m.rating]));
  const maxTotal = subjects.reduce((t, s) => t + Number(s.max_marks), 0);
  const published = c.published_flag === 'Y';
  const result = c.result_code === 'PASS' ? <Badge color="green">Pass</Badge> : c.result_code === 'FAIL' ? <Badge color="red">Failed</Badge> : <Badge color="amber">{L('EXAM_RESULT', c.result_code)}</Badge>;

  return (
    <div className="max-w-5xl">
      <PageHeader title={`${c.full_name} – ${c.exam_name}`}
        subtitle={<>Student No. <b>{c.assignment_number}</b> · {c.grade_name} · {L('EXAM_TYPE', c.exam_type_code)} · {c.ay_name} · {fmtDate(c.exam_date)}</>}
        actions={<><Link href={`/students/${c.person_id}?tab=exams`} className="btn">Back to student</Link><Link href={`/exams/${id}?tab=results`} className="btn">Whole exam</Link></>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        <div className="card"><div className="label">Total Marks</div><div className="text-2xl font-semibold">{maxTotal}</div></div>
        <div className="card"><div className="label">Obtained Marks</div><div className="text-2xl font-semibold">{c.total_marks ?? '—'}</div>{c.percentage !== null && <div className="text-xs text-slate-500">{c.percentage}%</div>}</div>
        <div className="card"><div className="label">Grade Rating</div><div className="text-2xl font-semibold">{c.grade_rating ?? '—'}</div>{c.grading_name && <div className="text-xs text-slate-500">{c.grading_name}</div>}</div>
        <div className="card"><div className="label">Result</div><div className="mt-1">{result}</div>{c.promoted_flag === 'Y' && <div className="mt-1"><Badge color="purple">Promoted{c.promoted_to ? ` to ${c.promoted_to}` : ''}</Badge></div>}</div>
        <div className="card"><div className="label">Published</div><div className="mt-1">{published ? <Badge color="green">Published</Badge> : <Badge color="gray">Not yet</Badge>}</div></div>
      </div>
      {!published && <div className="card mb-4 border-amber-300 bg-amber-50 text-sm">These results are not published yet – they may still change.</div>}

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Subject</th><th>Evaluation</th><th>Total Marks</th><th>Pass Mark</th><th>Obtained</th><th>Grade</th><th>Result</th></tr></thead>
          <tbody>{await Promise.all(subjects.map(async (s) => {
            const m = marks.get(String(s.id));
            const absent = m?.absent_flag === 'Y';
            const secs = await partSections(s.parts);
            const detail = s.parts.map((p) => {
              const l = secs.get(p.id) ?? [];
              const um = units.get(`${s.id}_${p.id}`);
              const inner = l.length
                ? l.map((x) => { const v = rates.get(`${s.id}_${p.id}_${x.id}`); const lab = x.values.find((o) => v !== null && v !== undefined && Math.abs(o.value - Number(v)) < 0.001)?.label;
                    return `${x.name}: ${v === null || v === undefined ? '—' : lab && lab !== String(Number(v)) ? `${lab} (${Number(v)})` : Number(v)}`; }).join(' · ')
                : 'direct marks';
              return <div key={p.id}>{s.combined_flag === 'Y' && <b>{p.name} {um?.marks != null ? `${Number(um.marks)}/${p.max}` : ''}: </b>}{inner}</div>;
            });
            return (
              <tr key={s.id}>
                <td className="font-medium">{s.subject_name}{s.optional_flag === 'Y' && <span className="ml-1 text-xs font-normal text-purple-700">optional (chosen)</span>}{s.combined_flag === 'Y' && <div className="text-xs text-slate-500">{s.parts.map((p) => p.name).join(' + ')}</div>}</td>
                <td className="text-xs text-slate-600">{detail}</td>
                <td>{Number(s.max_marks)}</td><td>{Number(s.pass_marks)}</td>
                <td className="font-semibold">{absent ? 'AB' : m?.marks ?? '—'}</td>
                <td>{m?.grade_rating ? <Badge color={m.pass_flag === 'N' ? 'red' : 'blue'}>{m.grade_rating}</Badge> : '—'}</td>
                <td>{absent ? <Badge color="red">Absent</Badge> : m?.pass_flag === 'Y' ? <Badge color="green">Pass</Badge> : m?.pass_flag === 'N' ? <Badge color="red">Failed</Badge> : <span className="text-xs text-slate-500">not entered</span>}</td>
              </tr>);
          }))}</tbody>
          <tfoot><tr className="font-semibold"><td colSpan={2}>Total</td><td>{maxTotal}</td><td /><td>{c.total_marks ?? '—'}</td><td>{c.grade_rating ?? '—'}</td><td>{result}</td></tr></tfoot>
        </table>
        {!subjects.length && <Empty>No subjects for this grade.</Empty>}
      </div>
      {c.outcome_code === 'PROMOTE' && c.promotion_date && <p className="muted mt-2">Students who pass are promoted from {fmtDate(c.promotion_date)}.</p>}
    </div>
  );
}
