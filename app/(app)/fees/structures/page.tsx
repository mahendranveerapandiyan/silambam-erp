import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions, refNames } from '@/lib/dt';
import { lk, lookupOptions } from '@/lib/lookups';
import { academicYearOn } from '@/lib/people';
import { money } from '@/lib/util';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP, s } from '@/components/ui';
import { AutoSubmit, ConfirmButton } from '@/components/client';
import { saveStructure, copyStructures, deleteStructure } from '../actions';

const FREQS = ['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'ONE_TIME'];

export default async function Structures({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_FEE_STRUCTURE_PRV');
  const write = can(u, 'CD_FEE_STRUCTURE_PRV', 'WRITE');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const years = await sql`select * from academic_year where enterprise_id = ${u.enterpriseId} order by start_date desc`;
  const ay = s(sp.ay) ?? String((await academicYearOn(u.enterpriseId, asOf))?.id ?? years[0]?.id ?? '');
  const edit = s(sp.edit);
  const L = await lk();
  const E = u.enterpriseId;
  const [bus, classes, grades, feeTypes] = [await refOptions('business-units', E, asOf), await refOptions('classes', E, asOf), await refOptions('student-grades', E, asOf), await lookupOptions('FEE_TYPE', asOf)];
  const [buN, clN, grN] = [await refNames('business-units', E, asOf), await refNames('classes', E, asOf), await refNames('student-grades', E, asOf)];
  const [branches, sections, brN, seN] = [await refOptions('branches', E, asOf), await refOptions('sections', E, asOf), await refNames('branches', E, asOf), await refNames('sections', E, asOf)];
  const yr = years.find((y) => String(y.id) === ay);
  // students admitted during (or before and still on roll in) the selected academic year
  const students = yr ? (await sql`select distinct on (a.person_id) a.person_id, a.assignment_number,
      (select trim(concat_ws(' ', x.first_name, x.last_name)) from person_f x where x.id = a.person_id order by x.effective_start_date desc limit 1) full_name
    from assignment a join assignment_f af on af.id = a.id
    where a.enterprise_id = ${E} and a.assignment_type = 'STUDENT' and af.effective_start_date <= ${yr.end_date} and af.effective_end_date >= ${yr.start_date}
    order by a.person_id`).map((x) => ({ value: x.assignment_number as string, label: `${x.full_name || x.assignment_number}`, code: x.assignment_number as string }))
    .sort((a, b) => a.label.localeCompare(b.label)) : [];
  const stuByPerson: Record<string, { value: string; label: string }> = {};
  if (yr) for (const x of await sql`select person_id, assignment_number from assignment where enterprise_id = ${E} and assignment_type = 'STUDENT'`)
    stuByPerson[String(x.person_id)] = { value: x.assignment_number, label: students.find((st) => st.value === x.assignment_number)?.label ?? x.assignment_number };
  const rows = ay ? await sql`select fs.*, coalesce(json_object_agg(a.frequency_code, a.amount) filter (where a.frequency_code is not null), '{}') amounts,
      (select count(*) from fee_demand d where d.fee_structure_id = fs.id and d.cancelled_flag = 'N')::int used
    from fee_structure fs left join fee_structure_amount a on a.fee_structure_id = fs.id where fs.academic_year_id = ${ay} group by fs.id order by fs.fee_type_code, fs.name` : [];
  const editing = rows.find((r) => String(r.id) === edit);
  const yearOpts = years.map((y) => ({ value: String(y.id), label: y.name }));
  return (
    <div className="max-w-7xl">
      <PageHeader title="Fee Structures" subtitle="Fees are defined per academic year – for everyone, or a business unit, branch, class, section, grade or one student. For each fee type the most specific structure wins: student › section › grade › class › branch › business unit › all." />
      <Flash sp={sp} />
      <form className="card mb-4 flex gap-2"><Select name="ay" options={yearOpts} value={ay} empty={false} className="input max-w-xs" /><AutoSubmit /></form>
      <div className="card mb-4 overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Fee Type</th><th>Name</th><th>Applies To</th>{FREQS.map((f) => <th key={f} className="text-right">{L('FEE_FREQUENCY', f)}</th>)}<th>Active</th><th title="Fee lines generated from it">Used</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td>{L('FEE_TYPE', r.fee_type_code)}</td><td>{r.name}</td>
              <td className="text-xs">{r.person_id
                ? <Badge color="purple">Student: {stuByPerson[String(r.person_id)]?.label} ({stuByPerson[String(r.person_id)]?.value})</Badge>
                : [r.business_unit_id && buN[r.business_unit_id], r.branch_id && brN[r.branch_id], r.class_id && clN[r.class_id], r.section_id && seN[r.section_id], r.student_grade_id && grN[r.student_grade_id]].filter(Boolean).join(' · ') || 'All students'}</td>
              {FREQS.map((f) => <td key={f} className="text-right">{r.amounts[f] !== undefined ? money(r.amounts[f]) : ''}</td>)}
              <td>{r.active_flag === 'Y' ? <Badge color="green">Yes</Badge> : <Badge>No</Badge>}</td><td>{r.used}</td>
              <td className="whitespace-nowrap">
                <div className="flex gap-1">
                  <a className="btn btn-sm" href={`?ay=${ay}&edit=${r.id}#form`}>Edit</a>
                  {write && r.used === 0 && (
                    <form action={deleteStructure.bind(null, r.id)}><Back to={`/fees/structures?ay=${ay}`} />
                      <ConfirmButton className="btn btn-sm btn-danger" message={`Delete the ${r.name} fee structure? No fee lines have been generated from it.`}>Delete</ConfirmButton></form>
                  )}
                </div>
              </td>
            </tr>))}</tbody>
        </table>
        {!rows.length && <Empty>No fee structures for this year. Create one below or copy from a previous year.</Empty>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <form id="form" action={saveStructure.bind(null, editing?.id ?? null)} className="card lg:col-span-2">
          <Back to={`/fees/structures?ay=${ay}`} />
          <h2 className="h2">{editing ? `Edit: ${editing.name}` : 'New Fee Structure'}</h2>
          <div className="grid-form">
            <Field label="Academic Year *"><Select name="academic_year_id" options={yearOpts} value={editing?.academic_year_id ?? ay} required /></Field>
            <Field label="Fee Type *"><Select name="fee_type_code" options={feeTypes} value={editing?.fee_type_code} required /></Field>
            <Field label="Name *"><input name="name" defaultValue={editing?.name} className="input" required /></Field>
            <Field label="Business Unit (optional)"><Select name="business_unit_id" options={bus} value={editing?.business_unit_id} empty="All business units" /></Field>
            <Field label="Branch (optional)"><Select name="branch_id" options={branches} value={editing?.branch_id} empty="All branches" /></Field>
            <Field label="Class (optional)"><Select name="class_id" options={classes} value={editing?.class_id} empty="All classes" /></Field>
            <Field label="Section (optional)"><Select name="section_id" options={sections} value={editing?.section_id} empty="All sections" /></Field>
            <Field label="Grade (optional)"><Select name="student_grade_id" options={grades} value={editing?.student_grade_id} empty="All grades" /></Field>
            <Field label="Individual Student (optional)" help="A fee only for this student – it overrides every other structure of the same fee type for them">
              <Select name="student_number" options={students} value={editing?.person_id ? stuByPerson[String(editing.person_id)]?.value : null} empty="— Not student-specific —" />
            </Field>
          </div>
          <p className="muted mt-2">Choose only the narrowest level you need – a section fills in its class, branch and business unit automatically.</p>
          <p className="muted my-3">Amount <b>per installment</b> for each frequency the student may choose. For admission-type fees fill only <b>One Time</b>.</p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {FREQS.map((f) => <Field key={f} label={L('FEE_FREQUENCY', f)}><input name={`amt_${f}`} type="number" step="0.01" min="0" defaultValue={editing?.amounts[f] ?? ''} className="input" /></Field>)}
          </div>
          <div className="mt-3 grid-form">
            <Field label="Active"><select name="active_flag" defaultValue={editing?.active_flag ?? 'Y'} className="input"><option value="Y">Yes</option><option value="N">No</option></select></Field>
            <Field label="Description" className="sm:col-span-2"><input name="description" defaultValue={editing?.description ?? ''} className="input" /></Field>
          </div>
          <div className="mt-4 flex gap-2"><button className="btn btn-primary">{editing ? 'Save' : 'Create'}</button>{editing && <a href={`?ay=${ay}`} className="btn">Cancel</a>}</div>
        </form>
        <form action={copyStructures} className="card h-fit space-y-3">
          <Back to={`/fees/structures?ay=${ay}`} />
          <h2 className="h2">Copy to Next Academic Year</h2>
          <p className="muted">Re-use the same fees (0%) or apply a change. Exam fees are copied too.</p>
          <Field label="From"><Select name="from_ay" options={yearOpts} value={ay} empty={false} /></Field>
          <Field label="To"><Select name="to_ay" options={yearOpts} required /></Field>
          <Field label="Change %"><input name="increase_pct" type="number" step="0.1" defaultValue="0" className="input" /></Field>
          <Field label="Round to nearest"><select name="round_to" defaultValue="10" className="input"><option value="1">1</option><option value="10">10</option><option value="50">50</option><option value="100">100</option></select></Field>
          <button className="btn btn-primary w-full">Copy</button>
        </form>
      </div>
    </div>
  );
}
