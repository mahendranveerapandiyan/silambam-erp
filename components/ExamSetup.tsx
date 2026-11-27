import Link from 'next/link';
import type { SessionUser } from '@/lib/auth';
import type { Row } from '@/lib/db';
import { examOptions } from '@/lib/examOptions';
import { EXAM_STOPS } from '@/lib/examSetup';
import { inchargeClasses, isExamAdmin } from '@/lib/examAccess';
import { MirrorInput } from './client';
import { Field, Select, Back } from './ui';
import { saveExamDetails } from '@/app/(app)/exams/setupActions';

/** The train-stop bar of the exam setup. */
export function Stepper({ examId, step, reached }: { examId: string | null; step: number; reached: number }) {
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-1 text-sm" aria-label="Exam setup steps">
      {EXAM_STOPS.map((label, i) => {
        const n = i + 1;
        const done = n <= reached && n !== step;
        const open = examId !== null && n <= reached + 1;
        const inner = (
          <span className={`flex items-center gap-2 rounded-full border px-3 py-1 ${n === step ? 'border-sky-600 bg-sky-600 text-white' : done ? 'border-green-600 bg-green-50 text-green-800' : 'border-slate-300 bg-white text-slate-500'}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${n === step ? 'bg-white text-sky-700' : done ? 'bg-green-600 text-white' : 'bg-slate-200'}`}>{done ? '✓' : n}</span>
            {label}
          </span>
        );
        return (
          <li key={n} className="flex items-center gap-1" aria-current={n === step ? 'step' : undefined}>
            {open && n !== step ? <Link href={`/exams/${examId}/setup?step=${n}`}>{inner}</Link> : inner}
            {n < EXAM_STOPS.length && <span className="h-px w-3 bg-slate-300" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Stop 1 form – shared by /exams/new and the setup page. */
export async function DetailsForm({ u, exam, defaultAy, asOf, readOnly }: { u: SessionUser; exam?: Row; defaultAy?: string; asOf: string; readOnly: boolean }) {
  const o = await examOptions(u.enterpriseId, asOf);
  const e = exam ?? {};
  const ay = e.academic_year_id ?? defaultAy ?? o.years[0]?.value;
  // class assessments: incharges pick one of their classes and cannot create grade exams
  const own = !isExamAdmin(u) || e.exam_scope === 'CLASS';
  const mineCls = own && !isExamAdmin(u) ? await inchargeClasses(u, e.exam_date ?? asOf) : [];
  const types = own ? o.types.filter((t) => t.value !== 'GRADE_EXAM') : o.types;
  const className = e.class_id ? o.classes.find((c) => c.value === String(e.class_id))?.label : null;
  return (
    <form action={saveExamDetails.bind(null, exam ? String(exam.id) : null)} className="card">
      <Back to={exam ? `/exams/${exam.id}/setup?step=1` : '/exams/new'} />
      <fieldset disabled={readOnly} className="contents">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Exam Name *"><input name="name" defaultValue={e.name} required className="input" placeholder={own ? "e.g. Kids Batch Weekly Assessment" : "e.g. Level 2 Grade Exam – Dec 2026"} /></Field>
          <Field label="Exam Code" help="Same as the exam name – filled automatically"><MirrorInput source="name" initial={e.code ?? e.name ?? ''} label="Exam Code" /></Field>
          <Field label="Exam Type *" help={own ? 'Class assessments cannot be grade exams' : undefined}><Select name="exam_type_code" options={types} value={e.exam_type_code ?? (own ? 'ASSESSMENT' : 'GRADE_EXAM')} empty={false} /></Field>
          {own && (isExamAdmin(u)
            ? <Field label="Class"><input value={className ?? ''} readOnly className="input bg-slate-50" aria-label="Class" /></Field>
            : <Field label="Class *" help="One of the classes you are incharge of"><Select name="class_id" options={mineCls.map((c) => ({ value: c.id, label: c.name }))} value={e.class_id ? String(e.class_id) : mineCls.length === 1 ? mineCls[0].id : ''} required /></Field>)}
          <Field label="Academic Year *"><Select name="academic_year_id" options={o.years} value={ay} required /></Field>
          <Field label="Exam Date *"><input type="date" name="exam_date" defaultValue={e.exam_date} required className="input" /></Field>
          {exam && exam.status_code !== 'DRAFT' && <Field label="Status"><Select name="status_code" options={o.statuses.filter((s) => s.value !== 'DRAFT')} value={e.status_code} empty={false} /></Field>}
          <Field label="Description" className="sm:col-span-2 lg:col-span-3"><textarea name="description" defaultValue={e.description ?? ''} rows={2} className="input" /></Field>
        </div>
        <p className="muted mt-2">{own ? 'A class assessment covers the students of one class and records their results only – no grade changes.' : 'Grade Exams allow one per student per academic year. The exam type also sets the default outcome (stop 7).'}</p>
      </fieldset>
      {!readOnly && <Buttons first={!exam} />}
    </form>
  );
}

export function Buttons({ first, last, saveOnly }: { first?: boolean; last?: boolean; saveOnly?: boolean }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {!first && <button className="btn" name="_stay" value="1">Save</button>}
      {!saveOnly && <button className="btn btn-primary" name="_next" value="1">{last ? 'Save & Finish Setup' : first ? 'Create & Next ›' : 'Save & Next ›'}</button>}
    </div>
  );
}

