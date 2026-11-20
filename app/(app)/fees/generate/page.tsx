import { requireUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { lookupOptions } from '@/lib/lookups';
import { academicYearOn } from '@/lib/people';
import { PageHeader, Flash, Field, Select, Back, type SP } from '@/components/ui';
import { generateFees } from '../actions';

export default async function Generate({ searchParams }: { searchParams: SP }) {
  const u = await requireUser('ACCOUNTANT');
  const asOf = await getAsOf();
  const years = await sql`select * from academic_year where enterprise_id = ${u.enterpriseId} order by start_date desc`;
  const cur = await academicYearOn(u.enterpriseId, asOf);
  const [bus, feeTypes] = [await refOptions('business-units', u.enterpriseId, asOf), await lookupOptions('FEE_TYPE', asOf)];
  return (
    <div className="max-w-3xl">
      <PageHeader title="Generate Fees" subtitle="Creates installments for every active student from the fee structures, using each student's own fee frequency. Safe to run again – existing installments are never duplicated; new admissions are picked up." />
      <Flash sp={await searchParams} />
      <form action={generateFees} className="card space-y-3">
        <Back to="/fees/generate" />
        <Field label="Academic Year *"><Select name="academic_year_id" options={years.map((y) => ({ value: String(y.id), label: y.name }))} value={cur?.id} required /></Field>
        <Field label="Branch"><Select name="business_unit_id" options={bus} empty="All branches" /></Field>
        <div>
          <span className="label">Fee types (none ticked = all)</span>
          <div className="grid gap-1 sm:grid-cols-3">
            {feeTypes.filter((f) => !['GRADE_EXAM', 'ASSESSMENT', 'TERM_EXAM', 'EVENT', 'INVENTORY'].includes(f.value)).map((f) => (
              <label key={f.value} className="flex items-center gap-2 text-sm"><input type="checkbox" name="fee_types" value={f.value} /> {f.label}</label>
            ))}
          </div>
        </div>
        <button className="btn btn-primary">Generate</button>
        <p className="muted">Exam, event and equipment fees are added automatically when students are assigned to exams/events or buy items.</p>
      </form>
    </div>
  );
}
