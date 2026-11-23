import { requirePriv, can } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { lookupOptions } from '@/lib/lookups';
import { academicYearOn } from '@/lib/people';
import { PageHeader, Flash, Field, Select, Back, type SP } from '@/components/ui';
import { ConfirmButton } from '@/components/client';
import { generateFees } from '../actions';

export default async function Generate({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_FEE_GENERATE_PRV');
  const write = can(u, 'CD_FEE_GENERATE_PRV', 'WRITE');
  const asOf = await getAsOf();
  const E = u.enterpriseId;
  const years = await sql`select * from academic_year where enterprise_id = ${E} order by start_date desc`;
  const cur = await academicYearOn(E, asOf);
  const [bus, branches, classes, sections, feeTypes] = [await refOptions('business-units', E, asOf), await refOptions('branches', E, asOf),
    await refOptions('classes', E, asOf), await refOptions('sections', E, asOf), await lookupOptions('FEE_TYPE', asOf)];
  const students = (await sql`select a.assignment_number,
      (select trim(concat_ws(' ', x.first_name, x.last_name)) from person_f x where x.id = a.person_id order by x.effective_start_date desc limit 1) full_name
    from assignment a where a.enterprise_id = ${E} and a.assignment_type = 'STUDENT'`)
    .map((x) => ({ value: x.assignment_number as string, label: (x.full_name || x.assignment_number) as string, code: x.assignment_number as string }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="max-w-4xl">
      <PageHeader title="Generate Fees" subtitle="Creates installments from the fee structures, using each student's own fee frequency – for all students, or one business unit, branch, class, section or student. Safe to run again: existing installments are never duplicated. Roll Back removes generated installments again as long as no payment is recorded." />
      <Flash sp={await searchParams} />
      <form action={generateFees} className="card space-y-4">
        <Back to="/fees/generate" />
        <div className="grid-form">
          <Field label="Academic Year *"><Select name="academic_year_id" options={years.map((y) => ({ value: String(y.id), label: y.name }))} value={cur?.id} required /></Field>
          <Field label="Business Unit"><Select name="business_unit_id" options={bus} empty="All business units" /></Field>
          <Field label="Branch"><Select name="branch_id" options={branches} empty="All branches" /></Field>
          <Field label="Class"><Select name="class_id" options={classes} empty="All classes" /></Field>
          <Field label="Section"><Select name="section_id" options={sections} empty="All sections" /></Field>
          <Field label="Student"><Select name="student_number" options={students} empty="All students" /></Field>
        </div>
        <p className="muted">Choose only the narrowest level – a section fills in its class, branch and business unit. Students are taken by where they are placed today (within the academic year).</p>
        <div className="grid-form">
          <Field label="Fee Type" help="Exam, event and equipment fees are added on their own pages">
            <Select name="fee_types" options={feeTypes.filter((f) => !['GRADE_EXAM', 'ASSESSMENT', 'TERM_EXAM', 'EVENT', 'INVENTORY'].includes(f.value))} empty="All fee types" />
          </Field>
        </div>
        {write && (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" name="_op" value="GENERATE">Generate</button>
            <ConfirmButton className="btn btn-danger" name="_op" value="ROLLBACK"
              message="Roll back the generated fee installments for the chosen academic year, level and fee type? Students with a payment or fee exception recorded are kept unchanged.">Roll Back</ConfirmButton>
          </div>
        )}
        <ul className="muted list-disc space-y-0.5 pl-5">
          <li><b>Roll Back</b> removes only installments created from fee structures (by Generate or on admission). Exam, event and equipment fees and manual charges are never touched.</li>
          <li>A student whose generated installments in the scope have any receipt (even a cancelled one) or fee exception is skipped entirely and listed in the message.</li>
        </ul>
      </form>
    </div>
  );
}
