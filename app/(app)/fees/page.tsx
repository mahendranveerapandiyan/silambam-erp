import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { fullName, personAsOf, nm } from '@/lib/people';
import { myClasses, studentScopeSql } from '@/lib/scope';
import { lk } from '@/lib/lookups';
import { money, todayISO } from '@/lib/util';
import { PageHeader, Flash, Select, Empty, type SP, s } from '@/components/ui';
import { AutoSubmit } from '@/components/client';

export default async function CollectFees({ searchParams }: { searchParams: SP }) {
  const u = await requireUser('INCHARGE', 'ACCOUNTANT');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const today = todayISO();
  const cls = s(sp.cls), q = s(sp.q), show = s(sp.show) ?? 'pending';
  const classes = await myClasses(u, asOf);
  const L = await lk();
  const like = q ? `%${q}%` : null;
  const rows = await sql`
    select a.person_id, a.assignment_number, ${fullName()} full_name, pf.phone, af.fee_frequency_code,
      ${nm('class', 'af.class_id', asOf)} class_name, ${nm('business_unit', 'af.business_unit_id', asOf)} bu_name,
      coalesce(t.due, 0) due, coalesce(t.paid, 0) paid, coalesce(t.exempted, 0) exempted, coalesce(t.balance, 0) balance, coalesce(t.overdue, 0) overdue
    from assignment a
    join assignment_f af on af.id = a.id and ${asOf}::date between af.effective_start_date and af.effective_end_date
    join person p on p.id = a.person_id ${personAsOf(asOf)}
    left join lateral (select sum(amount) due, sum(paid_amount) paid, sum(exempted_amount) exempted, sum(balance_amount) balance,
        sum(balance_amount) filter (where due_date < ${today}) overdue
      from fee_demand_v d where d.person_id = a.person_id and d.cancelled_flag = 'N') t on true
    where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STUDENT' ${studentScopeSql(u, asOf)}
      ${cls ? sql`and af.class_id = ${cls.split(':')[0]} and af.section_id = ${cls.split(':')[1]}` : sql``}
      ${like ? sql`and (a.assignment_number ilike ${like} or ${fullName()} ilike ${like} or pf.phone ilike ${like})` : sql``}
      ${show === 'pending' ? sql`and coalesce(t.balance, 0) > 0` : show === 'overdue' ? sql`and coalesce(t.overdue, 0) > 0` : sql``}
    order by overdue desc, full_name limit 1000`;
  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k]), 0);
  return (
    <div>
      <PageHeader title="Collect Fees" subtitle={`${rows.length} student(s) · pending ${money(sum('balance'))} · overdue ${money(sum('overdue'))}`} />
      <Flash sp={sp} />
      <div className="card">
        <form className="mb-3 grid gap-2 sm:grid-cols-4">
          <input name="q" defaultValue={q ?? ''} placeholder="Name, number or phone" className="input" />
          <Select name="cls" options={classes.map((c) => ({ value: `${c.class_id}:${c.section_id}`, label: c.label }))} value={cls} empty="All my classes" />
          <select name="show" defaultValue={show} className="input"><option value="pending">With pending dues</option><option value="overdue">With overdue dues</option><option value="all">All students</option></select>
          <AutoSubmit />
        </form>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Student</th><th>Class</th><th>Frequency</th><th className="text-right">Total Due</th><th className="text-right">Paid</th><th className="text-right">Exception</th><th className="text-right">Pending</th><th className="text-right">Overdue</th><th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.person_id}>
                <td><div className="font-medium">{r.full_name}</div><div className="text-xs text-gray-500">{r.assignment_number} · {r.phone}</div></td>
                <td>{r.bu_name} › {r.class_name}</td><td>{L('FEE_FREQUENCY', r.fee_frequency_code)}</td>
                <td className="text-right">{money(r.due)}</td><td className="text-right text-green-700">{money(r.paid)}</td><td className="text-right">{money(r.exempted)}</td>
                <td className="text-right font-semibold">{money(r.balance)}</td><td className={`text-right ${Number(r.overdue) > 0 ? 'font-bold text-red-700' : ''}`}>{money(r.overdue)}</td>
                <td><Link className="btn btn-sm btn-primary" href={`/fees/students/${r.person_id}`}>Collect</Link></td>
              </tr>))}</tbody>
          </table>
          {!rows.length && <Empty />}
        </div>
      </div>
    </div>
  );
}
