import { requireUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { academicYearOn } from '@/lib/people';
import { money, todayISO } from '@/lib/util';
import { PageHeader, Select, type SP, s } from '@/components/ui';
import { AutoSubmit, PrintButton } from '@/components/client';

const INCOME = '#2a78d6'; // categorical slot 1
const EXPENSE = '#eb6834'; // categorical slot 2
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default async function Reports({ searchParams }: { searchParams: SP }) {
  const u = await requireUser('ACCOUNTANT');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const today = todayISO();
  const E = u.enterpriseId;
  const years = await sql`select * from academic_year where enterprise_id = ${E} order by start_date desc`;
  const ayId = s(sp.ay) ?? String((await academicYearOn(E, asOf))?.id ?? years[0]?.id ?? '');
  const ay = years.find((y) => String(y.id) === ayId);
  const L = await lk();
  if (!ay) return <div className="card">Define an academic year first.</div>;

  const months = await sql`
    with m as (select to_char(d, 'YYYY-MM') m from generate_series(${ay.start_date}::date, ${ay.end_date}::date, interval '1 month') d)
    select m.m,
      coalesce((select sum(amount) from fee_payment p where p.enterprise_id = ${E} and p.status_code = 'ACTIVE' and to_char(p.payment_date, 'YYYY-MM') = m.m), 0)::float fees,
      coalesce((select sum(amount) from finance_txn t where t.enterprise_id = ${E} and t.txn_kind = 'INCOME' and to_char(t.txn_date, 'YYYY-MM') = m.m), 0)::float other,
      coalesce((select sum(amount) from finance_txn t where t.enterprise_id = ${E} and t.txn_kind = 'EXPENSE' and to_char(t.txn_date, 'YYYY-MM') = m.m), 0)::float expense
    from m order by m.m`;
  const maxV = Math.max(1, ...months.map((m) => Math.max(m.fees + m.other, m.expense)));
  const tot = months.reduce((a, m) => ({ inc: a.inc + m.fees + m.other, exp: a.exp + m.expense }), { inc: 0, exp: 0 });

  const buNames = sql`(select name from business_unit_f b where b.id = x.business_unit_id order by effective_start_date desc limit 1)`;
  const collByBu = await sql`select ${buNames} bu, to_char(payment_date, 'YYYY-MM') m, sum(amount)::float a from fee_payment x
    where enterprise_id = ${E} and status_code = 'ACTIVE' and payment_date between ${ay.start_date} and ${ay.end_date} group by 1, 2`;
  const buList = [...new Set(collByBu.map((r) => r.bu ?? '—'))].sort();
  const byMode = await sql`select payment_mode_code, count(*)::int n, sum(amount)::float a from fee_payment where enterprise_id = ${E} and status_code = 'ACTIVE'
    and payment_date between ${ay.start_date} and ${ay.end_date} group by 1 order by 3 desc`;

  const month = today.slice(0, 7);
  const branches = await sql`
    select b.id, f.name,
      (select count(*) from assignment a join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
        join assignment_status_f st on st.id = af.assignment_status_id and ${today}::date between st.effective_start_date and st.effective_end_date
        where a.assignment_type = 'STUDENT' and af.business_unit_id = b.id and st.system_status_code = 'ACTIVE')::int students,
      (select count(*) from assignment a join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
        join assignment_status_f st on st.id = af.assignment_status_id and ${today}::date between st.effective_start_date and st.effective_end_date
        where a.assignment_type = 'STAFF' and af.business_unit_id = b.id and st.system_status_code = 'ACTIVE')::int staff,
      (select coalesce(sum(amount),0) from fee_payment p where p.business_unit_id = b.id and p.status_code = 'ACTIVE' and to_char(payment_date, 'YYYY-MM') = ${month})::float collected,
      (select coalesce(sum(balance_amount),0) from fee_demand_v d where d.business_unit_id = b.id and d.cancelled_flag = 'N' and d.due_date <= ${today})::float overdue,
      (select coalesce(sum(amount),0) from finance_txn t where t.business_unit_id = b.id and t.txn_kind = 'EXPENSE' and to_char(txn_date, 'YYYY-MM') = ${month})::float expense,
      (select count(*) filter (where status_code in ('P','L'))::float / nullif(count(*), 0) * 100 from student_attendance sa where sa.business_unit_id = b.id and sa.attendance_date = ${today}) att
    from business_unit b join business_unit_f f on f.id = b.id and ${today}::date between f.effective_start_date and f.effective_end_date
    where b.enterprise_id = ${E} order by f.name`;
  const ml = (m: string) => `${MON[+m.slice(5) - 1]} ${m.slice(2, 4)}`;

  return (
    <div className="max-w-7xl">
      <PageHeader title="Finance Reports" subtitle={ay.name} actions={<PrintButton />} />
      <form className="card mb-4 no-print"><Select name="ay" options={years.map((y) => ({ value: String(y.id), label: y.name }))} value={ayId} empty={false} className="input max-w-xs" /><AutoSubmit /></form>

      <div className="card mb-4">
        <h2 className="h2">Branch Dashboard – {MON[+month.slice(5) - 1]} {month.slice(0, 4)}</h2>
        <div className="overflow-x-auto">
          <table className="tbl"><thead><tr><th>Branch</th><th className="text-right">Active Students</th><th className="text-right">Staff</th><th className="text-right">Collected this month</th><th className="text-right">Overdue dues</th><th className="text-right">Expenses this month</th><th className="text-right">Attendance today</th></tr></thead>
            <tbody>{branches.map((b) => (
              <tr key={b.id}><td className="font-medium">{b.name}</td><td className="text-right">{b.students}</td><td className="text-right">{b.staff}</td><td className="text-right">{money(b.collected)}</td>
                <td className="text-right">{money(b.overdue)}</td><td className="text-right">{money(b.expense)}</td><td className="text-right">{b.att === null ? '—' : `${Math.round(b.att)}%`}</td></tr>))}</tbody></table>
        </div>
      </div>

      <div className="card mb-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="h2 mb-0">Income vs Expenses</h2>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: INCOME }} />Income (fees + other) · {money(tot.inc)}</span>
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: EXPENSE }} />Expenses · {money(tot.exp)}</span>
            <span>Net <b>{money(tot.inc - tot.exp)}</b></span>
          </div>
        </div>
        <div className="flex h-56 items-end gap-2 border-b border-black/20 px-1 pt-4">
          {months.map((m) => {
            const inc = m.fees + m.other;
            return (
              <div key={m.m} className="group relative flex h-full flex-1 flex-col justify-end">
                <div className="flex h-full items-end justify-center gap-[2px]">
                  <div className="w-1/3 max-w-5 rounded-t" style={{ height: `${(inc / maxV) * 100}%`, background: INCOME, minHeight: inc ? 2 : 0 }} />
                  <div className="w-1/3 max-w-5 rounded-t" style={{ height: `${(m.expense / maxV) * 100}%`, background: EXPENSE, minHeight: m.expense ? 2 : 0 }} />
                </div>
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded border bg-white px-2 py-1 text-xs shadow group-hover:block">
                  <b>{ml(m.m)}</b><br />Fees {money(m.fees)} · Other {money(m.other)}<br />Expenses {money(m.expense)}<br />Net {money(inc - m.expense)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 px-1 pt-1">{months.map((m) => <div key={m.m} className="flex-1 text-center text-[10px] text-gray-500">{ml(m.m)}</div>)}</div>
        <details className="mt-3"><summary className="cursor-pointer text-sm text-gray-600">Table view</summary>
          <table className="tbl mt-2"><thead><tr><th>Month</th><th className="text-right">Fee Collections</th><th className="text-right">Other Income</th><th className="text-right">Expenses</th><th className="text-right">Net</th></tr></thead>
            <tbody>{months.map((m) => <tr key={m.m}><td>{ml(m.m)}</td><td className="text-right">{money(m.fees)}</td><td className="text-right">{money(m.other)}</td><td className="text-right">{money(m.expense)}</td><td className="text-right font-semibold">{money(m.fees + m.other - m.expense)}</td></tr>)}</tbody></table>
        </details>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-x-auto lg:col-span-2">
          <h2 className="h2">Monthly Fee Collection by Branch</h2>
          <table className="tbl"><thead><tr><th>Month</th>{buList.map((b) => <th key={b} className="text-right">{b}</th>)}<th className="text-right">Total</th></tr></thead>
            <tbody>{months.map((m) => {
              const cells = buList.map((b) => collByBu.find((r) => (r.bu ?? '—') === b && r.m === m.m)?.a ?? 0);
              return <tr key={m.m}><td>{ml(m.m)}</td>{cells.map((c, i) => <td key={i} className="text-right">{c ? money(c) : ''}</td>)}<td className="text-right font-semibold">{money(cells.reduce((a, b) => a + b, 0))}</td></tr>;
            })}</tbody></table>
        </div>
        <div className="card">
          <h2 className="h2">Collections by Payment Mode</h2>
          <table className="tbl"><thead><tr><th>Mode</th><th className="text-right">Receipts</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{byMode.map((r) => <tr key={r.payment_mode_code}><td>{L('PAYMENT_MODE', r.payment_mode_code)}</td><td className="text-right">{r.n}</td><td className="text-right">{money(r.a)}</td></tr>)}</tbody></table>
        </div>
      </div>
    </div>
  );
}
