import { requirePriv, can } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { lookupOptions } from '@/lib/lookups';
import { academicYearOn } from '@/lib/people';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP, s as one } from '@/components/ui';
import { MultiPick } from '@/components/MultiPick';
import { AutoSubmit, CheckAll } from '@/components/client';
import { fmtDate, money } from '@/lib/util';
import { ConfirmButton } from '@/components/client';
import { generateFees, rollbackInstallments } from '../actions';

export default async function Generate({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_FEE_GENERATE_PRV');
  const sp = await searchParams;
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
      <Flash sp={sp} />
      <form action={generateFees} className="card space-y-4">
        <Back to="/fees/generate" />
        <div className="grid-form">
          <Field label="Academic Year *"><Select name="academic_year_id" options={years.map((y) => ({ value: String(y.id), label: y.name }))} value={cur?.id} required /></Field>
          <Field label="Business Unit"><Select name="business_unit_id" options={bus} empty="All business units" /></Field>
          <Field label="Branch"><Select name="branch_id" options={branches} empty="All branches" /></Field>
          <Field label="Class"><Select name="class_id" options={classes} empty="All classes" /></Field>
          <Field label="Section"><Select name="section_id" options={sections} empty="All sections" /></Field>
        </div>
        <Field label="Students (optional – tick one or more)"><MultiPick name="student_numbers" options={students} emptyText="None ticked – all students in the levels above" /></Field>
        <p className="muted">Choose only the narrowest level – a section fills in its class, branch and business unit. Ticked students must also be in the chosen level. Students are taken by where they are placed today (within the academic year).</p>
        <div className="grid-form">
          <Field label="Fee Type" help="Values from the Fee Type lookup. Generate uses the fee structures of that type.">
            <Select name="fee_types" options={feeTypes} empty="All fee types" />
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
      <Installments />
    </div>
  );

  /** Roll back chosen installments of one student. */
  async function Installments() {
    const ayId = one(sp.rb_ay) ?? String(cur?.id ?? years[0]?.id ?? '');
    const stuNo = one(sp.rb_student);
    const [st] = stuNo ? await sql`select person_id, assignment_number from assignment where enterprise_id = ${E} and assignment_type = 'STUDENT' and upper(assignment_number) = upper(${stuNo})` : [];
    const lines = st ? await sql`select d.*, coalesce(v.paid_amount, 0) paid_amount,
        exists (select 1 from fee_allocation fa where fa.demand_id = d.id) paid, exists (select 1 from fee_exemption fe where fe.demand_id = d.id) excepted
      from fee_demand d left join fee_demand_v v on v.id = d.id
      where d.person_id = ${st.person_id} and d.academic_year_id = ${ayId} and d.source_type = 'STRUCTURE' order by d.fee_type_code, d.period_start nulls first, d.id` : [];
    const free = lines.filter((l) => !l.paid && !l.excepted);
    return (
      <div className="card mt-4 space-y-3" id="installments">
        <h2 className="h2 mb-0">Roll Back Chosen Installments of a Student</h2>
        <form className="grid items-end gap-2 sm:grid-cols-[1fr_2fr_auto]" action="/fees/generate#installments">
          <Field label="Academic Year"><Select name="rb_ay" options={years.map((y) => ({ value: String(y.id), label: y.name }))} value={ayId} empty={false} /></Field>
          <Field label="Student"><Select name="rb_student" options={students} value={st?.assignment_number ?? null} empty="— Choose a student —" /></Field>
          <AutoSubmit />
          <noscript><button className="btn">Show</button></noscript>
        </form>
        {!st ? <p className="muted">Choose a student to see the installments generated for them from the fee structures.</p>
          : !lines.length ? <Empty>No generated installments for {st.assignment_number} in this academic year.</Empty> : (
          <form action={rollbackInstallments.bind(null, String(st.person_id))}>
            <Back to={`/fees/generate?rb_ay=${ayId}&rb_student=${encodeURIComponent(st.assignment_number)}#installments`} />
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th className="w-8"><CheckAll name="demand_ids" /></th><th>Fee</th><th>Period</th><th>Due</th><th className="text-right">Amount</th><th className="text-right">Paid</th><th>Status</th></tr></thead>
                <tbody>{lines.map((l) => {
                  const locked = l.paid || l.excepted;
                  return (
                    <tr key={l.id} className={locked ? 'opacity-60' : ''}>
                      <td><input type="checkbox" name="demand_ids" value={l.id} disabled={locked} aria-label={`${l.description} ${l.period_label ?? ''}`} /></td>
                      <td>{l.description}</td><td>{l.period_label}</td><td className="whitespace-nowrap">{fmtDate(l.due_date)}</td>
                      <td className="text-right">{money(l.amount)}</td><td className="text-right">{Number(l.paid_amount) ? money(l.paid_amount) : ''}</td>
                      <td>{l.paid ? <Badge color="amber">Receipt recorded</Badge> : l.excepted ? <Badge color="purple">Fee exception</Badge> : l.cancelled_flag === 'Y' ? <Badge>Cancelled</Badge> : <Badge color="green">Can roll back</Badge>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            {write && free.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <ConfirmButton className="btn btn-danger" message={`Roll back the ticked installments of ${st.assignment_number}? They can be generated again later.`}>Roll Back Ticked</ConfirmButton>
                <span className="muted">{free.length} of {lines.length} can be rolled back. Lines with a receipt or fee exception are locked – delete those on the student&apos;s fee page first.</span>
              </div>
            )}
          </form>
        )}
      </div>
    );
  }
}
