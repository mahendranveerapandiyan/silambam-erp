import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { lookupOptions } from '@/lib/lookups';
import { academicYearOn } from '@/lib/people';
import { PageHeader, Flash, Select, Back, type SP, s } from '@/components/ui';
import { AutoSubmit } from '@/components/client';
import { saveExamFees } from '../actions';

export default async function ExamFees({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_EXAM_FEE_PRV');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const years = (await sql`select id, name from academic_year where enterprise_id = ${u.enterpriseId} order by start_date desc`).map((y) => ({ value: String(y.id), label: y.name }));
  const ay = s(sp.ay) ?? String((await academicYearOn(u.enterpriseId, asOf))?.id ?? years[0]?.value ?? '');
  const [grades, types] = [await refOptions('student-grades', u.enterpriseId, asOf), await lookupOptions('EXAM_TYPE', asOf)];
  const fees = await sql`select * from exam_fee where academic_year_id = ${ay || null}`;
  const val = (t: string, g: string) => fees.find((f) => f.exam_type_code === t && String(f.student_grade_id) === g)?.amount ?? '';
  return (
    <div className="max-w-5xl">
      <PageHeader title="Exam Fees" subtitle="Exam fee per grade and exam type for the academic year. For grade exams the fee of the target grade applies; for other exams the student's current grade. Assigning a student to an exam adds this fee to their fee page." />
      <Flash sp={sp} />
      <form className="card mb-4"><Select name="ay" options={years} value={ay} empty={false} className="input max-w-xs" /><AutoSubmit /></form>
      <form action={saveExamFees} className="card overflow-x-auto">
        <Back to={`/exams/fees?ay=${ay}`} /><input type="hidden" name="academic_year_id" value={ay} />
        <table className="tbl"><thead><tr><th>Grade</th>{types.map((t) => <th key={t.value}>{t.label}</th>)}</tr></thead>
          <tbody>{grades.map((g) => (
            <tr key={g.value}><td>{g.label}</td>{types.map((t) => <td key={t.value}><input name={`f_${t.value}_${g.value}`} type="number" step="0.01" min="0" defaultValue={val(t.value, g.value)} className="input w-32" /></td>)}</tr>))}</tbody></table>
        <button className="btn btn-primary mt-4">Save Exam Fees</button>
      </form>
    </div>
  );
}
