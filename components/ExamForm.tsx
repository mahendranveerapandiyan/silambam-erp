import type { Row } from '@/lib/db';
import type { Opt } from '@/lib/lookups';
import { Field, Select, Back } from './ui';
import { ShowFor } from './client';
import { EditableForm } from './EditMode';

export function ExamForm({ action, exam, back, o, defaultAy }: { action: (fd: FormData) => Promise<void>; exam?: Row; back: string; o: Record<string, Opt[]>; defaultAy?: string }) {
  const e = exam ?? {};
  return (
    <EditableForm action={action} canEdit startEditing={!exam} saveLabel={exam ? 'Save' : 'Create Exam'}>
      <Back to={back} />
      <div className="grid-form">
        <Field label="Academic Year *"><Select name="academic_year_id" options={o.years} value={e.academic_year_id ?? defaultAy} required /></Field>
        <Field label="Exam Type *"><Select name="exam_type_code" options={o.types} value={e.exam_type_code ?? 'GRADE_EXAM'} empty={false} /><ShowFor select="exam_type_code" /></Field>
        <Field label="Name *"><input name="name" defaultValue={e.name} className="input" required /></Field>
        <Field label="Exam Date *"><input type="date" name="exam_date" defaultValue={e.exam_date} className="input" required /></Field>
        <Field label="Branch (optional)"><Select name="business_unit_id" options={o.bus} value={e.business_unit_id} empty="All branches" /></Field>
        <Field label="Class (optional)"><Select name="class_id" options={o.classes} value={e.class_id} empty="All classes" /></Field>
        <Field label="Eligible Current Grade"><Select name="from_grade_id" options={o.grades} value={e.from_grade_id} empty="Any grade" /></Field>
        <div data-show-for-exam_type_code="GRADE_EXAM"><Field label="Target Grade (promote to)" help="Empty = next grade of the eligible grade"><Select name="target_grade_id" options={o.grades} value={e.target_grade_id} /></Field></div>
        <Field label="Status"><Select name="status_code" options={o.statuses} value={e.status_code ?? 'SCHEDULED'} empty={false} /></Field>
      </div>
      <h3 className="mb-2 mt-4 text-sm font-semibold">Eligibility Criteria (leave blank to skip a rule)</h3>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="Min Attendance %"><input name="min_attendance_pct" type="number" step="0.1" min="0" max="100" defaultValue={e.min_attendance_pct ?? ''} className="input" /></Field>
        <Field label="Fees Must Be Cleared"><select name="fees_cleared_flag" defaultValue={e.fees_cleared_flag ?? 'N'} className="input"><option value="N">No</option><option value="Y">Yes</option></select></Field>
        <Field label="Min Months in Grade"><input name="min_months_in_grade" type="number" min="0" defaultValue={e.min_months_in_grade ?? ''} className="input" /></Field>
        <Field label="Min Age (years)"><input name="min_age" type="number" min="0" defaultValue={e.min_age ?? ''} className="input" /></Field>
        <Field label="Overall Pass %"><input name="pass_percentage" type="number" step="0.1" min="0" max="100" defaultValue={e.pass_percentage ?? ''} className="input" /></Field>
      </div>
      {!exam && o.subjects.length > 0 && (
        <div className="mt-4"><span className="label">Subjects (with default marks – editable later)</span>
          <div className="flex flex-wrap gap-3">{o.subjects.map((s) => <label key={s.value} className="flex items-center gap-1 text-sm"><input type="checkbox" name="subjects" value={s.value} defaultChecked /> {s.label}</label>)}</div></div>
      )}
      <Field label="Description" className="mt-3"><textarea name="description" defaultValue={e.description ?? ''} rows={2} className="input" /></Field>
    </EditableForm>
  );
}
