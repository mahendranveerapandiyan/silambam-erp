import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePriv, can, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql, type Row } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { refOptions } from '@/lib/dt';
import { examOptions } from '@/lib/examOptions';
import { activeStaffPeriods } from '@/lib/people';
import { EXAM_STOPS, examGrades, examSubjects, templateSections, marksEntered } from '@/lib/examSetup';
import { Stepper, DetailsForm, Buttons } from '@/components/ExamSetup';
import { fmtDate } from '@/lib/util';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP, s as one, here } from '@/components/ui';
import { ConfirmButton, ShowFor } from '@/components/client';
import { MultiPick } from '@/components/MultiPick';
import {
  saveExamGrades, saveExamEligibility, saveExamSubject, deleteExamSubject, fillExamSubjects, finishExamSubjects,
  saveExamTemplate, saveExamOutcome, saveExamExaminers, deleteDraftExam,
} from '../../setupActions';

export default async function ExamSetup({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requirePriv('CD_EXAM_SETUP_PRV', 'READ');
  const { id } = await params;
  const sp = await searchParams;
  const [exam] = await sql`select e.*, y.name ay_name from exam e join academic_year y on y.id = e.academic_year_id where e.id = ${id} and e.enterprise_id = ${u.enterpriseId}`;
  if (!exam) notFound();
  const asOf = await getAsOf();
  const L = await lk();
  const reachedStep = Number(exam.setup_step ?? 7);
  const step = Math.min(Math.max(Number(one(sp.step) ?? 1) || 1, 1), Math.min(7, reachedStep + 1));
  const closed = ['PUBLISHED', 'CANCELLED'].includes(exam.status_code);
  const readOnly = closed || !can(u, 'CD_EXAM_SETUP_PRV', 'WRITE');
  const back = here(`/exams/${id}/setup`, { ...sp, step: String(step) });
  const grades = await examGrades(id, exam.exam_date);
  const locked = await marksEntered(id);

  return (
    <div className="max-w-6xl">
      <PageHeader title={`${exam.name}`}
        subtitle={<><span className="font-mono">{exam.code}</span> · {L('EXAM_TYPE', exam.exam_type_code)} · {exam.ay_name} · {fmtDate(exam.exam_date)} · <Badge color={exam.status_code === 'DRAFT' ? 'amber' : exam.status_code === 'PUBLISHED' ? 'green' : 'blue'}>{L('EXAM_STATUS', exam.status_code)}</Badge></>}
        actions={<>{exam.status_code !== 'DRAFT' && <Link href={`/exams/${id}`} className="btn">Open exam</Link>}<Link href="/exams" className="btn">All exams</Link></>} />
      <Flash sp={sp} />
      <Stepper examId={id} step={step} reached={reachedStep} />
      {closed && <div className="card mb-3 border-amber-300 bg-amber-50 text-sm">This exam is {L('EXAM_STATUS', exam.status_code).toLowerCase()} – its setup is shown read-only.</div>}
      <h2 className="h2">Stop {step} of 7 · {EXAM_STOPS[step - 1]}</h2>
      {step === 1 && <DetailsForm u={u} exam={exam} asOf={asOf} readOnly={readOnly} />}
      {step === 2 && <GradeStop />}
      {step === 3 && <EligibilityStop />}
      {step === 4 && <SubjectStop />}
      {step === 5 && <TemplateStop />}
      {step === 6 && <OutcomeStop />}
      {step === 7 && <ExaminerStop />}
      {exam.status_code === 'DRAFT' && !readOnly && (
        <form action={deleteDraftExam.bind(null, id)} className="mt-6"><Back to={back} />
          <ConfirmButton className="btn btn-danger btn-sm" message={`Delete the draft exam ${exam.name}?`}>Delete draft</ConfirmButton></form>
      )}
    </div>
  );

  async function GradeStop() {
    const opts = await refOptions('student-grades', u.enterpriseId, exam.exam_date);
    return (
      <form action={saveExamGrades.bind(null, id)} className="card">
        <Back to={back} />
        <p className="muted mb-2">Students currently in any of these grades may sit the exam. Each grade gets its own subjects (stop 4) and examiners (stop 7).</p>
        {readOnly ? <div className="flex flex-wrap gap-2">{grades.map((g) => <Badge key={g.grade_id} color="blue">{g.name}</Badge>)}</div>
          : <Field label="Grades *"><MultiPick name="grades" options={opts} initial={grades.map((g) => String(g.grade_id))} emptyText="No grade chosen yet" /></Field>}
        {!readOnly && <Buttons />}
      </form>
    );
  }

  async function EligibilityStop() {
    const o = await examOptions(u.enterpriseId, exam.exam_date);
    return (
      <form action={saveExamEligibility.bind(null, id)} className="card">
        <Back to={back} />
        <fieldset disabled={readOnly} className="contents">
          <p className="muted mb-2">Leave a rule blank to skip it. Students who do not meet a rule are shown in red when students are assigned.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Minimum Attendance %" help="In the academic year, up to the exam date"><input name="min_attendance_pct" type="number" step="0.1" min="0" max="100" defaultValue={exam.min_attendance_pct ?? ''} className="input" /></Field>
            <Field label="Minimum Months in Grade"><input name="min_months_in_grade" type="number" min="0" defaultValue={exam.min_months_in_grade ?? ''} className="input" /></Field>
            <Field label="Minimum Age (years)" help="On the exam date"><input name="min_age" type="number" min="0" defaultValue={exam.min_age ?? ''} className="input" /></Field>
            <Field label="Fees Must Be Cleared"><select name="fees_cleared_flag" defaultValue={exam.fees_cleared_flag ?? 'N'} className="input"><option value="N">No</option><option value="Y">Yes</option></select></Field>
            <Field label="Only Business Unit (optional)"><Select name="business_unit_id" options={o.bus} value={exam.business_unit_id} empty="All business units" /></Field>
            <Field label="Only Class (optional)"><Select name="class_id" options={o.classes} value={exam.class_id} empty="All classes" /></Field>
          </div>
        </fieldset>
        {!readOnly && <Buttons />}
      </form>
    );
  }

  async function SubjectStop() {
    if (!grades.length) return <div className="card muted">Choose the grades first (stop 2).</div>;
    const grade = one(sp.grade) ?? String(grades[0].grade_id);
    const g = grades.find((x) => String(x.grade_id) === grade) ?? grades[0];
    const list = await examSubjects(id, String(g.grade_id));
    const counts = new Map((await sql`select grade_id, count(*)::int n from exam_subject where exam_id = ${id} group by grade_id`).map((r) => [String(r.grade_id), r.n]));
    const o = await examOptions(u.enterpriseId, exam.exam_date);
    const edit = list.find((s) => String(s.id) === one(sp.edit));
    const ro = readOnly || locked;
    const e = edit ?? ({} as Row);
    const part = (i: number) => edit?.combined_flag === 'Y' ? edit.parts[i - 1] : undefined;
    const subBack = `/exams/${id}/setup?step=4&grade=${g.grade_id}`;
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {grades.map((x) => (
            <Link key={x.grade_id} href={`/exams/${id}/setup?step=4&grade=${x.grade_id}`}
              className={`rounded-full border px-3 py-1 text-sm ${String(x.grade_id) === String(g.grade_id) ? 'border-sky-600 bg-sky-50 font-semibold text-sky-800' : 'border-slate-300'}`}>
              {x.name} <span className="text-xs text-slate-500">({(counts.get(String(x.grade_id)) ?? 0) + (counts.get('null') ?? 0)})</span>
            </Link>))}
        </div>
        {locked && !readOnly && <div className="card border-amber-300 bg-amber-50 text-sm">Marks have been entered – subjects can no longer be changed.</div>}
        <div className="card overflow-x-auto">
          <h3 className="mb-2 font-semibold">Subjects for {g.name}</h3>
          <table className="tbl">
            <thead><tr><th>Subject</th><th>Type</th><th>Max</th><th>Pass (min)</th><th>Made up of</th><th></th></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.id} className={edit && edit.id === s.id ? 'bg-sky-50' : ''}>
                <td>{s.subject_name}{s.grade_id === null && <div className="text-xs text-slate-500">all grades (older exam)</div>}</td>
                <td>{L('SUBJECT_TYPE', s.subject_type_code)}</td><td>{Number(s.max_marks)}</td><td>{Number(s.pass_marks)}</td>
                <td className="text-xs">{s.combined_flag === 'Y'
                  ? s.parts.map((p) => <div key={p.id}>{p.name}: {s.weight_type === 'MARK' ? `${p.weight} marks` : `${p.weight} %`} · out of {p.max}, pass {p.pass}</div>)
                  : '—'}</td>
                <td className="whitespace-nowrap">{!ro && <div className="flex gap-1">
                  <Link className="btn btn-sm" href={`${subBack}&edit=${s.id}`}>Edit</Link>
                  <form action={deleteExamSubject.bind(null, id, s.id)}><Back to={subBack} /><ConfirmButton className="btn btn-sm" message={`Remove ${s.subject_name} from ${g.name}?`}>✕</ConfirmButton></form>
                </div>}</td>
              </tr>))}</tbody>
          </table>
          {!list.length && <Empty>No subjects for {g.name} yet.</Empty>}
          {!ro && (
            <div className="mt-3 flex flex-wrap gap-2">
              <form action={fillExamSubjects.bind(null, id)}><Back to={subBack} /><input type="hidden" name="grade_id" value={g.grade_id} /><input type="hidden" name="mode" value="defaults" />
                <button className="btn btn-sm">+ Add all active subjects (default marks)</button></form>
              {grades.length > 1 && list.length > 0 && (
                <form action={fillExamSubjects.bind(null, id)}><Back to={subBack} /><input type="hidden" name="grade_id" value={g.grade_id} /><input type="hidden" name="mode" value="copy" />
                  <ConfirmButton className="btn btn-sm" message={`Copy the subjects of ${g.name} to every other grade of this exam? Their current subjects are replaced.`}>Copy to the other grades</ConfirmButton></form>)}
            </div>
          )}
        </div>
        {!ro && (
          <form key={edit?.id ?? `new-${g.grade_id}-${list.length}`} action={saveExamSubject.bind(null, id, edit ? String(edit.id) : null)} className={`card ${edit ? '' : 'bg-green-50/40'}`}>
            <Back to={subBack} />
            <input type="hidden" name="grade_id" value={g.grade_id} />
            <h3 className="mb-2 font-semibold">{edit ? `Edit ${edit.subject_name}` : `Add a subject to ${g.name}`}</h3>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Subject *" className="lg:col-span-2"><Select name="subject_id" options={o.subjects} value={e.subject_id} required /></Field>
              <Field label="Type *"><Select name="subject_type_code" options={o.subjectTypes} value={e.subject_type_code ?? o.subjectTypes[0]?.value} required /></Field>
              <Field label="Maximum Marks *" help="For weights in marks: the total of the weights"><input name="max_marks" type="number" step="0.5" min="0.5" defaultValue={e.max_marks ? Number(e.max_marks) : 100} required className="input" /></Field>
              <Field label="Minimum (Pass) Marks *"><input name="pass_marks" type="number" step="0.5" min="0" defaultValue={e.pass_marks ? Number(e.pass_marks) : 35} required className="input" /></Field>
              <Field label="Order"><input name="display_seq" type="number" defaultValue={e.display_seq ?? list.length + 1} className="input" /></Field>
              <Field label="Combination of subjects?" className="lg:col-span-2">
                <select name="combined_flag" defaultValue={e.combined_flag ?? 'N'} className="input"><option value="N">No – a single subject</option><option value="Y">Yes – combines two or more subjects</option></select>
                <ShowFor select="combined_flag" />
              </Field>
              <div data-show-for-combined_flag="Y" className="lg:col-span-2">
                <Field label="Weight given as"><select name="weight_type" defaultValue={e.weight_type ?? 'PERCENT'} className="input"><option value="PERCENT">% of the subject (total 100 %)</option><option value="MARK">Marks (max = total of the weights)</option></select></Field>
              </div>
            </div>
            <div data-show-for-combined_flag="Y" className="mt-3 rounded border border-slate-200 p-3">
              <p className="muted mb-2">Each part is marked on its own scale, then weighted into this subject. A student passes only when every part reaches its minimum <b>and</b> the combined mark reaches the subject&apos;s minimum.</p>
              <div className="grid gap-2 text-xs font-semibold uppercase text-gray-600 sm:grid-cols-[2fr_1fr_1fr_1fr]"><div>Part subject</div><div>Weight</div><div>Max marks</div><div>Min (pass) marks</div></div>
              {[1, 2, 3].map((i) => (
                <div key={i} className="mt-1 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
                  <Select name={`c${i}_subject_id`} options={o.subjects} value={part(i)?.subjectId} empty={i === 3 ? '— (optional third part) —' : '— Select —'} />
                  <input name={`c${i}_weight`} type="number" step="0.01" min="0" defaultValue={part(i)?.weight ?? (i < 3 ? 50 : '')} className="input" aria-label={`Part ${i} weight`} />
                  <input name={`c${i}_max`} type="number" step="0.5" min="0" defaultValue={part(i)?.max ?? (i < 3 ? 100 : '')} className="input" aria-label={`Part ${i} max`} />
                  <input name={`c${i}_pass`} type="number" step="0.5" min="0" defaultValue={part(i)?.pass ?? (i < 3 ? 35 : '')} className="input" aria-label={`Part ${i} pass`} />
                </div>))}
            </div>
            <div className="mt-3 flex gap-2"><button className="btn btn-primary">{edit ? 'Save Subject' : 'Add Subject'}</button>{edit && <Link className="btn" href={subBack}>Cancel</Link>}</div>
          </form>
        )}
        {!readOnly && (
          <form action={finishExamSubjects.bind(null, id)}><Back to={back} /><button className="btn btn-primary">Subjects are complete – Next ›</button></form>
        )}
      </div>
    );
  }

  async function TemplateStop() {
    const temps = await sql`select * from evaluation_template where enterprise_id = ${u.enterpriseId} and (active_flag = 'Y' or id = ${exam.evaluation_template_id ?? 0}) order by name`;
    const examSubjectIds = new Set((await examSubjects(id)).flatMap((s) => s.parts.map((p) => p.subjectId)));
    const names = Object.fromEntries((await refOptions('subjects', u.enterpriseId, exam.exam_date)).map((o) => [o.value, o.label]));
    const sections = new Map<string, Awaited<ReturnType<typeof templateSections>>>();
    for (const t of temps) sections.set(String(t.id), await templateSections(String(t.id)));
    const cur = String(exam.evaluation_template_id ?? '');
    return (
      <form action={saveExamTemplate.bind(null, id)} className="card space-y-3">
        <Back to={back} />
        <p className="muted">With a template, examiners rate each section and the subject mark is worked out from the weights. Subjects the template does not cover are marked directly. {can(u, 'CD_EVALUATION_TEMPLATE_PRV') && <Link className="link" href="/exams/templates">Manage templates</Link>}</p>
        {locked && <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">Marks have been entered – the template can no longer be changed.</div>}
        <fieldset disabled={readOnly || locked} className="space-y-2">
          <label className="flex items-start gap-2 rounded border p-3"><input type="radio" name="evaluation_template_id" value="" defaultChecked={!cur} /> <span><b>No template</b><div className="text-sm text-slate-500">Examiners enter the marks of each subject directly.</div></span></label>
          {temps.map((t) => {
            const secs = sections.get(String(t.id))!;
            const covered = [...secs.keys()].filter((k) => examSubjectIds.has(k));
            return (
              <label key={t.id} className={`flex items-start gap-2 rounded border p-3 ${String(t.id) === cur ? 'border-sky-500 bg-sky-50' : ''}`}>
                <input type="radio" name="evaluation_template_id" value={t.id} defaultChecked={String(t.id) === cur} />
                <span className="flex-1"><b>{t.name}</b> <span className="font-mono text-xs text-slate-500">{t.code}</span>
                  <div className="text-xs text-slate-500">Covers {covered.length} of this exam&apos;s {examSubjectIds.size} subject(s)</div>
                  <div className="mt-1 grid gap-1 text-xs sm:grid-cols-2">{[...secs.entries()].map(([sid, l]) => (
                    <div key={sid} className={examSubjectIds.has(sid) ? '' : 'opacity-50'}><b>{names[sid] ?? sid}</b>: {l.map((s) => `${s.name} ${s.weight_pct}% (${s.min_rating}–${s.max_rating})`).join(' · ')}</div>))}</div>
                </span>
              </label>);
          })}
        </fieldset>
        {!readOnly && !locked && <Buttons />}
        {!readOnly && locked && <Link className="btn btn-primary" href={`/exams/${id}/setup?step=6`}>Next ›</Link>}
      </form>
    );
  }

  async function OutcomeStop() {
    const opts = await refOptions('student-grades', u.enterpriseId, exam.exam_date);
    return (
      <form action={saveExamOutcome.bind(null, id)} className="card space-y-3">
        <Back to={back} />
        <fieldset disabled={readOnly} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="When a student passes *">
              <select name="outcome_code" defaultValue={exam.outcome_code ?? 'RECORD'} className="input">
                <option value="PROMOTE">Promote to the next grade (on publishing)</option><option value="RECORD">Only record the result on the student profile</option>
              </select>
              <ShowFor select="outcome_code" />
            </Field>
            <Field label="Overall Pass % (optional)" help="Besides passing every subject"><input name="pass_percentage" type="number" step="0.1" min="0" max="100" defaultValue={exam.pass_percentage ?? ''} className="input" /></Field>
          </div>
          <div data-show-for-outcome_code="PROMOTE" className="overflow-x-auto">
            <table className="tbl"><thead><tr><th>Grade</th><th>Promote to</th></tr></thead>
              <tbody>{grades.map((g) => (
                <tr key={g.grade_id}><td>{g.name}</td>
                  <td><Select name={`target_${g.grade_id}`} options={opts.filter((x) => x.value !== String(g.grade_id))} value={g.target_grade_id ? String(g.target_grade_id) : ''}
                    empty={g.next_grade_id ? `Next grade: ${opts.find((x) => x.value === String(g.next_grade_id))?.label ?? ''}` : '— Select (no next grade set) —'} /></td></tr>))}</tbody></table>
          </div>
        </fieldset>
        {!readOnly && <Buttons />}
      </form>
    );
  }

  async function ExaminerStop() {
    if (!grades.length) return <div className="card muted">Choose the grades first (stop 2).</div>;
    const d = exam.exam_date as string;
    const seen = new Set<string>();
    const staff = (await activeStaffPeriods(u.enterpriseId)).filter((s) => s.start_date <= d && s.end_date >= d && !seen.has(String(s.person_id)) && seen.add(String(s.person_id)))
      .map((s) => ({ value: String(s.person_id), label: s.full_name, code: s.assignment_number }));
    const ex = await sql`select x.*, (select trim(concat_ws(' ', first_name, last_name)) from person_f p where p.id = x.person_id order by effective_start_date desc limit 1) full_name
      from exam_examiner x where x.exam_id = ${id}`;
    return (
      <form action={saveExamExaminers.bind(null, id)} className="card space-y-3">
        <Back to={back} />
        <p className="muted">Examiners enter the marks of the students of their grade(s) – only staff active on {fmtDate(d)} are listed. A grade without examiners can be marked by anyone allowed to enter exam marks.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {grades.map((g) => {
            const mine = ex.filter((x) => String(x.grade_id) === String(g.grade_id));
            return (
              <Field key={g.grade_id} label={`${g.name} – examiners`}>
                {readOnly ? <div className="text-sm">{mine.map((m) => m.full_name).join(', ') || '—'}</div>
                  : <MultiPick name={`ex_${g.grade_id}`} options={staff} initial={mine.map((m) => String(m.person_id))} emptyText="No examiner – open to all markers" />}
              </Field>);
          })}
        </div>
        {!readOnly && <Buttons last />}
      </form>
    );
  }
}
