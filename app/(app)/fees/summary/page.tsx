import Link from 'next/link';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { lk } from '@/lib/lookups';
import { academicYearOn } from '@/lib/people';
import { studentScopeSql } from '@/lib/scope';
import { money, todayISO } from '@/lib/util';
import { PageHeader, Select, Badge, Empty, STATUS_COLOR, type SP, s } from '@/components/ui';
import { AutoSubmit, PrintButton } from '@/components/client';

export default async function FeeSummary({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_FEE_SUMMARY_PRV');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const today = todayISO();
  const years = await sql`select * from academic_year where enterprise_id = ${u.enterpriseId} order by start_date desc`;
  const ay = s(sp.ay) ?? String((await academicYearOn(u.enterpriseId, asOf))?.id ?? years[0]?.id ?? '');
  const bu = s(sp.bu), ft = s(sp.ft);
  const L = await lk();
  const bus = await refOptions('business-units', u.enterpriseId, asOf);
  const [year] = years.filter((y) => String(y.id) === ay);
  if (!year) return <div className="max-w-3xl"><PageHeader title="Fee Summary" /><div className="card"><Empty>No academic year is defined yet. Create one under <b>Academic Structure › Academic Years</b>, then set up fee structures.</Empty></div></div>;
  // demands of the year (+ manual/sale lines dated within it) restricted to the user's students
  const base = sql`
    from fee_demand_v d
    join assignment a on a.person_id = d.person_id and a.assignment_type = 'STUDENT'
    left join assignment_f af on af.id = a.id and ${asOf}::date between af.effective_start_date and af.effective_end_date
    where d.enterprise_id = ${u.enterpriseId} and d.cancelled_flag = 'N'
      and (d.academic_year_id = ${ay} or (d.academic_year_id is null and d.due_date between ${year?.start_date ?? '1900-01-01'} and ${year?.end_date ?? '1900-01-01'}))
      ${bu ? sql`and d.business_unit_id = ${bu}` : sql``} ${ft ? sql`and d.fee_type_code = ${ft}` : sql``}
      ${u.roles.includes('ADMIN') || u.roles.includes('ACCOUNTANT') ? sql`` : studentScopeSql(u, asOf)}`;
  const agg = sql`coalesce(sum(d.amount),0) due, coalesce(sum(d.paid_amount),0) paid, coalesce(sum(d.exempted_amount),0) exempted, coalesce(sum(d.balance_amount),0) balance,
    coalesce(sum(d.balance_amount) filter (where d.due_date < ${today}),0) overdue`;
  const [tot] = await sql`select ${agg}, count(distinct d.person_id)::int students ${base}`;
  const byBu = await sql`select (select name from business_unit_f b where b.id = d.business_unit_id order by effective_start_date desc limit 1) name, ${agg} ${base} group by d.business_unit_id order by 1`;
  const byType = await sql`select d.fee_type_code, ${agg} ${base} group by d.fee_type_code order by 1`;
  const byStatus = await sql`select d.payment_status, count(*)::int n, coalesce(sum(d.amount),0) amt ${base} group by 1 order by 1`;
  const students = await sql`select d.person_id, a.assignment_number,
      (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = d.person_id order by effective_start_date desc limit 1) full_name,
      (select name from class_f c where c.id = af.class_id order by effective_start_date desc limit 1) class_name, ${agg}
    ${base} group by d.person_id, a.assignment_number, af.class_id order by balance desc, full_name`;
  const [prev] = year ? await sql`select coalesce(sum(balance_amount),0) b from fee_demand_v d where d.enterprise_id = ${u.enterpriseId} and d.cancelled_flag = 'N' and d.due_date < ${year.start_date} ${bu ? sql`and d.business_unit_id = ${bu}` : sql``}` : [{ b: 0 }];
  const T = ({ r }: { r: any }) => <><td className="text-right">{money(r.due)}</td><td className="text-right text-green-700">{money(r.paid)}</td><td className="text-right text-purple-700">{money(r.exempted)}</td><td className="text-right font-semibold">{money(r.balance)}</td><td className="text-right text-red-700">{money(r.overdue)}</td></>;
  const H = () => <><th className="text-right">Total Due</th><th className="text-right">Paid</th><th className="text-right">Exception</th><th className="text-right">Pending</th><th className="text-right">Overdue</th></>;
  return (
    <div className="max-w-7xl">
      <PageHeader title="Fee Summary" subtitle={`${year?.name ?? ''} · ${tot.students} student(s)`} actions={<PrintButton />} />
      <form className="card mb-4 flex flex-wrap gap-2 no-print">
        <Select name="ay" options={years.map((y) => ({ value: String(y.id), label: y.name }))} value={ay} empty={false} className="input max-w-xs" />
        <Select name="bu" options={bus} value={bu} empty="All business units" className="input max-w-xs" />
        <select name="ft" defaultValue={ft ?? ''} className="input max-w-xs"><option value="">All fee types</option>{byType.map((t) => <option key={t.fee_type_code} value={t.fee_type_code} data-code={t.fee_type_code}>{L('FEE_TYPE', t.fee_type_code)}</option>)}</select>
        <AutoSubmit />
      </form>
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[['Total Due', tot.due], ['Collected', tot.paid], ['Exception Given', tot.exempted], ['Pending', tot.balance], ['Overdue', tot.overdue], ['Pending from earlier years', prev.b]].map(([l, v]) => (
          <div key={l as string} className="card"><div className="text-xs font-semibold uppercase text-gray-500">{l}</div><div className="text-xl font-bold">{money(v as number)}</div></div>
        ))}
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <div className="card overflow-x-auto lg:col-span-2"><h2 className="h2">By Business Unit</h2>
          <table className="tbl"><thead><tr><th>Business Unit</th><H /></tr></thead><tbody>{byBu.map((r) => <tr key={r.name}><td>{r.name ?? '—'}</td><T r={r} /></tr>)}</tbody></table></div>
        <div className="card"><h2 className="h2">By Status</h2>
          <table className="tbl"><thead><tr><th>Status</th><th>Lines</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{byStatus.map((r) => <tr key={r.payment_status}><td><Badge color={STATUS_COLOR[r.payment_status]}>{L('FEE_PAYMENT_STATUS', r.payment_status)}</Badge></td><td>{r.n}</td><td className="text-right">{money(r.amt)}</td></tr>)}</tbody></table></div>
        <div className="card overflow-x-auto lg:col-span-3"><h2 className="h2">By Fee Type</h2>
          <table className="tbl"><thead><tr><th>Fee Type</th><H /></tr></thead><tbody>{byType.map((r) => <tr key={r.fee_type_code}><td>{L('FEE_TYPE', r.fee_type_code)}</td><T r={r} /></tr>)}</tbody></table></div>
      </div>
      <div className="card overflow-x-auto">
        <h2 className="h2">Student-wise</h2>
        <table className="tbl"><thead><tr><th>Student</th><th>Class</th><H /></tr></thead>
          <tbody>{students.map((r) => <tr key={r.person_id}><td><Link className="link" href={`/fees/students/${r.person_id}`}>{r.full_name}</Link> <span className="text-xs text-gray-500">{r.assignment_number}</span></td><td>{r.class_name}</td><T r={r} /></tr>)}</tbody>
          <tfoot><tr className="font-bold"><td colSpan={2}>Total</td><T r={tot} /></tr></tfoot></table>
        {!students.length && <Empty />}
      </div>
    </div>
  );
}
