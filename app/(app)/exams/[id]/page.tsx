import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { eligibleStudents, examFeeFor } from '@/lib/exams';
import { examOptions } from '@/lib/examOptions';
import { studentScopeSql, seesAllStudents } from '@/lib/scope';
import { fmtDate, money, todayISO } from '@/lib/util';
import { PageHeader, Flash, Back, Badge, Empty, Select, Tabs, STATUS_COLOR, type SP, here } from '@/components/ui';
import { CheckAll, ConfirmButton, ShowFor } from '@/components/client';
import { assignCandidates, removeCandidate, publishResults, rollbackResults } from '../actions';
import { deleteExam } from '../setupActions';
import { examGrades, examSubjects, evaluatorGrades } from '@/lib/examSetup';

export default async function ExamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requirePriv(['CD_EXAM_SETUP_PRV', 'CD_EXAM_CANDIDATE_PRV'], 'READ');
  const { id } = await params;
  const sp = await searchParams;
  const [exam] = await sql`select e.*, y.name ay_name
    from exam e join academic_year y on y.id = e.academic_year_id where e.id = ${id} and e.enterprise_id = ${u.enterpriseId}`;
  if (!exam) notFound();
  const asOf = await getAsOf();
  const L = await lk();
  const tab = typeof sp.tab === 'string' ? sp.tab : 'candidates';
  const back = here(`/exams/${id}`, sp);
  const admin = can(u, 'CD_EXAM_SETUP_PRV', 'WRITE');
  const canMarks = can(u, 'CD_EXAM_CANDIDATE_PRV', 'WRITE') || admin;
  if (exam.status_code === 'DRAFT') redirect(`/exams/${id}/setup?step=${Math.min(7, Number(exam.setup_step) + 1)}`);
  const grades = await examGrades(id, exam.exam_date);
  const subjects = await examSubjects(id);
  const mine = await evaluatorGrades(u, id);
  const closed = ['PUBLISHED', 'CANCELLED'].includes(exam.status_code);
  const today = todayISO();
  const cands = await sql`
    select c.*, a.assignment_number, (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = c.person_id order by effective_start_date desc limit 1) full_name,
      (select name from student_grade_f g where g.id = c.current_grade_id order by effective_start_date desc limit 1) grade_name,
      d.amount fee_amount, d.payment_status fee_status, ex.section_id,
      (select concat_ws(' › ', (select cf.name from class_f cf where cf.id = sf.class_id order by effective_start_date desc limit 1), sf.name) from section_f sf where sf.id = ex.section_id order by sf.effective_start_date desc limit 1) section_name
    from exam_candidate c join assignment a on a.id = c.assignment_id
    left join exam xe on xe.id = c.exam_id
    left join assignment_f ex on ex.id = a.id and xe.exam_date between ex.effective_start_date and ex.effective_end_date
    left join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    left join fee_demand_v d on d.id = c.fee_demand_id
    where c.exam_id = ${id} ${studentScopeSql(u, today)}
    order by full_name`;
  const rules = [
    grades.length ? `Grades: ${grades.map((g) => g.name).join(', ')}` : 'Any grade', exam.min_attendance_pct !== null && `Attendance ≥ ${exam.min_attendance_pct}%`,
    exam.fees_cleared_flag === 'Y' && 'Fees cleared', exam.min_months_in_grade !== null && `≥ ${exam.min_months_in_grade} months in grade`,
    exam.min_age !== null && `Age ≥ ${exam.min_age}`, exam.exam_type_code === 'GRADE_EXAM' && 'One grade exam per year',
    exam.outcome_code === 'PROMOTE' ? `Promotes: ${grades.map((g) => `${g.name} → ${g.target_name ?? '?'}`).join(', ') || 'to the next grade'}` : 'Result recorded on the profile only',
  ].filter(Boolean);
  const tabs: [string, string][] = [['candidates', `Candidates (${cands.length})`], ['eligible', 'Assign Students'], ['results', 'Marks & Results'], ['subjects', `Subjects (${subjects.length})`]];

  return (
    <div className="max-w-7xl">
      <PageHeader title={exam.name}
        subtitle={<>{L('EXAM_TYPE', exam.exam_type_code)} · {exam.ay_name} · {fmtDate(exam.exam_date)} · <Badge color={exam.status_code === 'PUBLISHED' ? 'green' : 'blue'}>{L('EXAM_STATUS', exam.status_code)}</Badge></>}
        actions={<>{can(u, 'CD_EXAM_SETUP_PRV') && <Link href={`/exams/${id}/setup?step=1`} className="btn">{admin && !closed ? '✎ Exam Setup' : 'Exam Setup'}</Link>}<Link href="/exams" className="btn">All exams</Link></>} />
      <Flash sp={sp} />
      {rules.length > 0 && <div className="mb-3 flex flex-wrap gap-2 text-xs">{rules.map((r) => <Badge key={r as string} color="gray">{r}</Badge>)}</div>}
      <Tabs tabs={tabs} active={tab} base={`/exams/${id}`} />
      {tab === 'candidates' && <Candidates />}
      {tab === 'eligible' && <Eligible />}
      {tab === 'results' && <Results />}
      {tab === 'subjects' && <Subjects />}
      {admin && exam.status_code !== 'PUBLISHED' && !cands.some((c) => c.published_flag === 'Y') && (
        <form action={deleteExam.bind(null, id)} className="mt-6"><Back to={back} />
          <ConfirmButton className="btn btn-danger btn-sm" message={`Delete the exam ${exam.name}${cands.length ? ` with its ${cands.length} assigned student(s) and their marks? Unpaid exam fees are cancelled` : ''}? This cannot be undone.`}>Delete exam</ConfirmButton>
          <span className="muted ml-2">Possible until results are published.</span></form>)}
    </div>
  );

  function Candidates() {
    return (
      <div className="card overflow-x-auto">
        <table className="tbl"><thead><tr><th>Student</th><th>Grade at assignment</th><th>Exam Fee</th><th>Marks</th><th>%</th><th>Result</th><th>Assigned by</th><th></th></tr></thead>
          <tbody>{cands.map((c) => (
            <tr key={c.id}>
              <td><Link className="link" href={`/students/${c.person_id}`}>{c.full_name}</Link><div className="text-xs text-gray-500">{c.assignment_number}</div></td>
              <td>{c.grade_name}</td>
              <td>{c.fee_amount ? <>{money(c.fee_amount)} <Badge color={STATUS_COLOR[c.fee_status]}>{L('FEE_PAYMENT_STATUS', c.fee_status)}</Badge></> : '—'}</td>
              <td>{c.total_marks}</td><td>{c.percentage}</td>
              <td><Badge color={STATUS_COLOR[c.result_code]}>{L('EXAM_RESULT', c.result_code)}</Badge>{c.promoted_flag === 'Y' && <Badge color="purple">Promoted</Badge>}</td>
              <td className="text-xs">{c.assigned_by}</td>
              <td>{!closed && c.result_code === 'PENDING' && <form action={removeCandidate.bind(null, id, c.id)}><Back to={back} /><ConfirmButton className="btn btn-sm" message="Remove this candidate? The unpaid exam fee is cancelled.">Remove</ConfirmButton></form>}</td>
            </tr>))}</tbody></table>
        {!cands.length && <Empty>No candidates yet. Use “Assign Students”.</Empty>}
      </div>
    );
  }

  async function Eligible() {
    if (closed) return <div className="card muted">This exam is closed.</div>;
    const list = await eligibleStudents(u, exam);
    const fees = new Map<string, number | null>();
    for (const s of list) { const k = String(s.student_grade_id); if (!fees.has(k)) fees.set(k, await examFeeFor(exam, s.student_grade_id)); }
    const open = list.filter((s) => !s.assigned);
    return (
      <form action={assignCandidates.bind(null, id)} className="card overflow-x-auto">
        <Back to={back} />
        <p className="muted mb-2">{open.filter((s) => s.eligible).length} eligible of {open.length} active students{seesAllStudents(u) ? '' : ' in your classes'}. Selected students are assigned and their exam fee is added to their fee page.</p>
        <table className="tbl"><thead><tr><th><CheckAll name="person" /></th><th>Student</th><th>Grade</th>{list[0]?.checks.map((c) => <th key={c.label}>{c.label}</th>)}<th>Exam Fee</th></tr></thead>
          <tbody>{open.map((s) => (
            <tr key={s.person_id} className={s.eligible ? '' : 'bg-red-50/50'}>
              <td><input type="checkbox" name="person" value={s.person_id} disabled={!s.eligible && !admin} /></td>
              <td>{s.full_name}<div className="text-xs text-gray-500">{s.assignment_number}</div></td><td>{s.grade_name}</td>
              {s.checks.map((c) => <td key={c.label} className={c.ok ? 'text-green-700' : 'font-semibold text-red-700'}>{c.ok ? '✓' : '✕'} <span className="text-xs">{c.detail}</span></td>)}
              <td>{fees.get(String(s.student_grade_id)) != null ? money(fees.get(String(s.student_grade_id))) : <span className="text-xs text-amber-700">not set</span>}</td>
            </tr>))}</tbody></table>
        {!open.length && <Empty>Everyone is already assigned or no active students match.</Empty>}
        {open.length > 0 && <div className="mt-3 flex items-center gap-3">
          <button className="btn btn-primary">Assign Selected</button>
          {admin && <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="override" value="Y" /> Administrator override (ignore rules except one-grade-exam-per-year)</label>}
        </div>}
      </form>
    );
  }

  async function Results() {
    const marks = await sql`select m.* from exam_mark m join exam_candidate c on c.id = m.candidate_id where c.exam_id = ${id}`;
    const mk = new Map(marks.map((m) => [`${m.candidate_id}_${m.exam_subject_id}`, m]));
    const unpublished = cands.filter((c) => c.published_flag !== 'Y');
    const published = cands.filter((c) => c.published_flag === 'Y');
    const canEnter = (mine === 'ALL' || mine.size > 0) && exam.status_code !== 'CANCELLED';
    const byGrade = new Map<string, typeof cands>();
    for (const c of cands) { const k = String(c.current_grade_id ?? ''); if (!byGrade.has(k)) byGrade.set(k, [] as unknown as typeof cands); byGrade.get(k)!.push(c); }
    const sections = [...new Map(published.filter((c) => c.section_id).map((c) => [String(c.section_id), c.section_name as string])).entries()];
    const rollback = admin && published.length > 0;
    return (
      <div className="space-y-4">
        {canEnter && cands.length > 0 && (
          <div className="card flex flex-wrap items-center gap-3">
            <div className="flex-1"><b>Enter marks</b><div className="muted">{unpublished.length ? <>One grade and subject at a time{mine !== 'ALL' ? ' – the grades you examine' : ''}.{published.length > 0 && ` ${published.length} published result(s) are locked.`}</> : 'All results are published – marks are locked. Roll results back to change them.'}</div></div>
            {unpublished.length ? <Link href={`/exams/${id}/marks`} className="btn btn-primary">Enter Marks</Link>
              : <span className="btn cursor-not-allowed opacity-50" aria-disabled="true" title="Results are published – roll back to change marks">Enter Marks</span>}
          </div>)}
        <form action={rollbackResults.bind(null, id)} className="space-y-4">
          <Back to={back} />
          {[...byGrade.entries()].map(([g, list]) => {
            const subs = subjects.filter((s) => s.grade_id === null || String(s.grade_id) === g);
            return (
              <div key={g} className="card overflow-x-auto">
                <h3 className="mb-2 font-semibold">{list[0].grade_name ?? 'Grade not set'} <span className="text-sm font-normal text-slate-500">({list.length})</span></h3>
                <table className="tbl"><thead><tr>{rollback && <th><CheckAll name="cand" /></th>}<th>Student</th><th>Section</th>{subs.map((s) => <th key={s.id}>{s.subject_name}<div className="font-normal normal-case">max {Number(s.max_marks)} / pass {Number(s.pass_marks)}</div></th>)}<th>Total</th><th>%</th><th>Result</th><th>Published</th></tr></thead>
                  <tbody>{list.map((c) => (
                    <tr key={c.id}>
                      {rollback && <td><input type="checkbox" name="cand" value={c.id} disabled={c.published_flag !== 'Y'} aria-label={`Select ${c.full_name}`} /></td>}
                      <td>{c.full_name}<div className="text-xs text-gray-500">{c.assignment_number}</div></td><td className="text-xs">{c.section_name ?? '—'}</td>
                      {subs.map((s) => { const m = mk.get(`${c.id}_${s.id}`); return <td key={s.id} className={m?.pass_flag === 'N' ? 'font-semibold text-red-700' : ''}>{m?.absent_flag === 'Y' ? 'AB' : m?.marks ?? '—'}</td>; })}
                      <td>{c.total_marks ?? '—'}</td><td>{c.percentage ?? '—'}</td>
                      <td><Badge color={STATUS_COLOR[c.result_code]}>{L('EXAM_RESULT', c.result_code)}</Badge>{c.promoted_flag === 'Y' && <Badge color="purple">Promoted</Badge>}</td>
                      <td>{c.published_flag === 'Y' ? <Badge color="green">Published</Badge> : <Badge color="gray">Not yet</Badge>}</td></tr>))}</tbody></table>
              </div>);
          })}
          {rollback && (
            <div className="card flex flex-wrap items-end gap-3 border-amber-300">
              <div className="min-w-60 flex-1"><h2 className="h2 mb-1">Roll Back Results</h2><p className="muted">Hides the result again and unlocks the marks{exam.outcome_code === 'PROMOTE' ? '; promoted students go back to their earlier grade' : ''}. A single student can also be rolled back from their profile › Exams.</p></div>
              <label className="text-sm">Roll back for
                <select name="scope" defaultValue="SELECTED" className="input">
                  <option value="ALL">All {published.length} published student(s)</option>
                  <option value="SELECTED">The students ticked above</option>
                  {sections.length > 0 && <option value="SECTION">One section</option>}
                </select><ShowFor select="scope" /></label>
              {sections.length > 0 && <label data-show-for-scope="SECTION" className="text-sm">Section
                <select name="section_id" className="input">{sections.map(([sid, n]) => <option key={sid} value={sid}>{n}</option>)}</select></label>}
              <ConfirmButton className="btn btn-danger" message={`Roll back the chosen published results of ${exam.name}?${exam.outcome_code === 'PROMOTE' ? ' Promotions made by this exam are reversed.' : ''}`}>Roll Back</ConfirmButton>
            </div>)}
        </form>
        {!cands.length && <div className="card"><Empty>No candidates yet.</Empty></div>}
        {admin && unpublished.length > 0 && (
          <form action={publishResults.bind(null, id)} className="card flex flex-wrap items-end gap-3">
            <Back to={back} />
            <div><h2 className="h2 mb-1">Publish Results</h2><p className="muted">{unpublished.length} result(s) not yet published. They become visible on the student profile and the parent/student portal, and their marks are locked.</p></div>
            {exam.outcome_code === 'PROMOTE' ? <>
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="promote" value="Y" defaultChecked /> Promote passed students ({grades.map((g) => `${g.name} → ${g.target_name ?? '?'}`).join(', ') || 'to their next grade'})</label>
              <label className="text-sm">effective <input type="date" name="promotion_date" defaultValue={exam.exam_date > today ? exam.exam_date : today} className="input inline-block w-40" /></label>
            </> : <span className="text-sm">Outcome: results are recorded only – no promotion.</span>}
            <ConfirmButton className="btn btn-primary" message="Publish results?">Publish</ConfirmButton>
          </form>
        )}
      </div>
    );
  }

  function Subjects() {
    return (
      <div className="card overflow-x-auto">
        <table className="tbl"><thead><tr><th>Grade</th><th>Subject</th><th>Type</th><th>Max</th><th>Pass</th><th>Made up of</th></tr></thead>
          <tbody>{subjects.map((s) => (
            <tr key={s.id}><td>{s.grade_id === null ? 'All grades' : grades.find((g) => String(g.grade_id) === String(s.grade_id))?.name}</td><td>{s.subject_name}</td>
              <td>{L('SUBJECT_TYPE', s.subject_type_code)}</td><td>{Number(s.max_marks)}</td><td>{Number(s.pass_marks)}</td>
              <td className="text-xs">{s.combined_flag === 'Y' ? s.parts.map((p) => `${p.name} ${s.weight_type === 'MARK' ? `${p.weight} marks` : `${p.weight}%`} (pass ${p.pass}/${p.max})`).join(' + ') : '—'}</td></tr>))}</tbody></table>
        {!subjects.length && <Empty />}
        {admin && !closed && <Link className="btn btn-sm mt-2" href={`/exams/${id}/setup?step=4`}>Change subjects (stop 4)</Link>}
      </div>
    );
  }
}
