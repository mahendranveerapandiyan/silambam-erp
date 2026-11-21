import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { eligibleStudents, examFeeFor } from '@/lib/exams';
import { examOptions } from '@/lib/examOptions';
import { studentScopeSql, seesAllStudents } from '@/lib/scope';
import { fmtDate, money, todayISO } from '@/lib/util';
import { PageHeader, Flash, Back, Badge, Empty, Select, Tabs, STATUS_COLOR, type SP, here } from '@/components/ui';
import { CheckAll, ConfirmButton } from '@/components/client';
import { ExamForm } from '@/components/ExamForm';
import { saveExam, saveSubject, assignCandidates, removeCandidate, saveMarks, publishResults } from '../actions';

export default async function ExamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requirePriv(['CD_EXAM_SETUP_PRV', 'CD_EXAM_CANDIDATE_PRV'], 'READ');
  const { id } = await params;
  const sp = await searchParams;
  const [exam] = await sql`select e.*, y.name ay_name,
      (select name from student_grade_f g where g.id = e.from_grade_id order by effective_start_date desc limit 1) from_grade,
      (select name from student_grade_f g where g.id = e.target_grade_id order by effective_start_date desc limit 1) target_grade
    from exam e join academic_year y on y.id = e.academic_year_id where e.id = ${id} and e.enterprise_id = ${u.enterpriseId}`;
  if (!exam) notFound();
  const asOf = await getAsOf();
  const L = await lk();
  const tab = typeof sp.tab === 'string' ? sp.tab : 'candidates';
  const back = here(`/exams/${id}`, sp);
  const admin = can(u, 'CD_EXAM_SETUP_PRV', 'WRITE');
  const canMarks = can(u, 'CD_EXAM_CANDIDATE_PRV', 'WRITE') || admin;
  const subjects = await sql`select es.*, (select name from subject_f s where s.id = es.subject_id order by effective_start_date desc limit 1) subject_name from exam_subject es where exam_id = ${id} order by display_seq, id`;
  const closed = ['PUBLISHED', 'CANCELLED'].includes(exam.status_code);
  const today = todayISO();
  const cands = await sql`
    select c.*, a.assignment_number, (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = c.person_id order by effective_start_date desc limit 1) full_name,
      (select name from student_grade_f g where g.id = c.current_grade_id order by effective_start_date desc limit 1) grade_name,
      d.amount fee_amount, d.payment_status fee_status
    from exam_candidate c join assignment a on a.id = c.assignment_id
    left join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    left join fee_demand_v d on d.id = c.fee_demand_id
    where c.exam_id = ${id} ${studentScopeSql(u, today)}
    order by full_name`;
  const rules = [
    exam.from_grade && `Grade: ${exam.from_grade}`, exam.min_attendance_pct !== null && `Attendance ≥ ${exam.min_attendance_pct}%`,
    exam.fees_cleared_flag === 'Y' && 'Fees cleared', exam.min_months_in_grade !== null && `≥ ${exam.min_months_in_grade} months in grade`,
    exam.min_age !== null && `Age ≥ ${exam.min_age}`, exam.exam_type_code === 'GRADE_EXAM' && 'One grade exam per year',
  ].filter(Boolean);
  const tabs: [string, string][] = [['candidates', `Candidates (${cands.length})`], ['eligible', 'Assign Students'], ['marks', 'Marks & Results'], ['subjects', `Subjects (${subjects.length})`], ...(admin ? [['details', 'Exam Details'] as [string, string]] : [])];

  return (
    <div className="max-w-7xl">
      <PageHeader title={exam.name}
        subtitle={<>{L('EXAM_TYPE', exam.exam_type_code)} · {exam.ay_name} · {fmtDate(exam.exam_date)} {exam.target_grade && <>· promotes to <b>{exam.target_grade}</b></>} · <Badge color={exam.status_code === 'PUBLISHED' ? 'green' : 'blue'}>{L('EXAM_STATUS', exam.status_code)}</Badge></>}
        actions={<Link href="/exams" className="btn">All exams</Link>} />
      <Flash sp={sp} />
      {rules.length > 0 && <div className="mb-3 flex flex-wrap gap-2 text-xs">{rules.map((r) => <Badge key={r as string} color="gray">{r}</Badge>)}</div>}
      <Tabs tabs={tabs} active={tab} base={`/exams/${id}`} />
      {tab === 'candidates' && <Candidates />}
      {tab === 'eligible' && <Eligible />}
      {tab === 'marks' && <Marks />}
      {tab === 'subjects' && <Subjects />}
      {tab === 'details' && admin && <ExamForm action={saveExam.bind(null, id)} exam={exam} back={back} o={await examOptions(u.enterpriseId, asOf)} />}
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

  async function Marks() {
    if (!subjects.length) return <div className="card muted">Add subjects first.</div>;
    const marks = await sql`select m.* from exam_mark m join exam_candidate c on c.id = m.candidate_id where c.exam_id = ${id}`;
    const mk = new Map(marks.map((m) => [`${m.candidate_id}_${m.exam_subject_id}`, m]));
    const locked = (exam.status_code === 'PUBLISHED' && !admin) || !canMarks;
    return (
      <div className="space-y-4">
        <form action={saveMarks.bind(null, id)} className="card overflow-x-auto">
          <Back to={back} />
          <table className="tbl"><thead><tr><th>Student</th>{subjects.map((s) => <th key={s.id}>{s.subject_name}<div className="font-normal normal-case">{L('SUBJECT_TYPE', s.subject_type_code)} · max {Number(s.max_marks)} / pass {Number(s.pass_marks)}</div></th>)}<th>Total</th><th>Result</th></tr></thead>
            <tbody>{cands.map((c) => (
              <tr key={c.id}>
                <td>{c.full_name}</td>
                {subjects.map((s) => {
                  const m = mk.get(`${c.id}_${s.id}`);
                  return (
                    <td key={s.id}>
                      <div className="flex items-center gap-1">
                        <input name={`m_${c.id}_${s.id}`} type="number" step="0.5" min="0" max={Number(s.max_marks)} defaultValue={m?.marks ?? ''} disabled={locked} className="input w-20" />
                        <label className="text-[10px]"><input type="checkbox" name={`a_${c.id}_${s.id}`} value="Y" defaultChecked={m?.absent_flag === 'Y'} disabled={locked} /> AB</label>
                      </div>
                    </td>);
                })}
                <td>{c.total_marks} {c.percentage !== null && <span className="text-xs">({c.percentage}%)</span>}</td>
                <td><Badge color={STATUS_COLOR[c.result_code]}>{L('EXAM_RESULT', c.result_code)}</Badge></td>
              </tr>))}</tbody></table>
          {!cands.length && <Empty />}
          {!locked && cands.length > 0 && <button className="btn btn-primary mt-3">Save Marks</button>}
        </form>
        {admin && exam.status_code !== 'PUBLISHED' && cands.length > 0 && (
          <form action={publishResults.bind(null, id)} className="card flex flex-wrap items-end gap-3">
            <Back to={back} />
            <div><h2 className="h2 mb-1">Publish Results</h2><p className="muted">Results become visible on the parent/student portal.</p></div>
            {exam.exam_type_code === 'GRADE_EXAM' && <>
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="promote" value="Y" defaultChecked /> Promote passed students to <b>{exam.target_grade}</b></label>
              <label className="text-sm">effective <input type="date" name="promotion_date" defaultValue={exam.exam_date > today ? exam.exam_date : today} className="input inline-block w-40" /></label>
            </>}
            <ConfirmButton className="btn btn-primary" message="Publish results?">Publish</ConfirmButton>
          </form>
        )}
      </div>
    );
  }

  async function Subjects() {
    const o = await examOptions(u.enterpriseId, asOf);
    const row = (s?: any) => (
      <form key={s?.id ?? 'new'} action={saveSubject.bind(null, id, s?.id ?? null)} className={`grid items-end gap-2 sm:grid-cols-6 ${s ? '' : 'rounded bg-green-50 p-2'}`}>
        <Back to={back} />
        <Select name="subject_id" options={o.subjects} value={s?.subject_id} required disabled={!admin} />
        <Select name="subject_type_code" options={o.subjectTypes} value={s?.subject_type_code} required disabled={!admin} />
        <input name="max_marks" type="number" step="0.5" defaultValue={s?.max_marks ?? 100} placeholder="Max" className="input" disabled={!admin} />
        <input name="pass_marks" type="number" step="0.5" defaultValue={s?.pass_marks ?? 35} placeholder="Pass" className="input" disabled={!admin} />
        <input name="display_seq" type="number" defaultValue={s?.display_seq ?? subjects.length} className="input" disabled={!admin} />
        {admin && <div className="flex gap-1"><button className="btn btn-sm">{s ? 'Save' : 'Add'}</button>{s && <button name="_delete" value="1" className="btn btn-sm">✕</button>}</div>}
      </form>
    );
    return (
      <div className="card space-y-2">
        <div className="grid gap-2 text-xs font-semibold uppercase text-gray-600 sm:grid-cols-6"><div>Subject</div><div>Type</div><div>Max Marks</div><div>Pass Marks</div><div>Order</div></div>
        {subjects.map(row)}
        {admin && !closed && row()}
      </div>
    );
  }
}
