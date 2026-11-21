import Link from 'next/link';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { fullName, personAsOf, nm } from '@/lib/people';
import { myClasses, studentScopeSql } from '@/lib/scope';
import { lk } from '@/lib/lookups';
import { money, todayISO } from '@/lib/util';
import { PageHeader, Flash, Select, Empty, type SP, s } from '@/components/ui';
import { AutoSubmit } from '@/components/client';

export default async function CollectFees({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_FEE_COLLECT_PRV');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const today = todayISO();
  const cls = s(sp.cls), q = s(sp.q), show = s(sp.show) ?? 'pending';
  const page = Math.max(1, Number(s(sp.page)) || 1);
  const classes = await myClasses(u, asOf);
  const L = await lk();
  const like = q ? `%${q}%` : null;
  const rows = await sql`
    select a.person_id, a.assignment_number, ${fullName()} full_name, pf.phone, af.fee_frequency_code,
      ${nm('class', 'af.class_id', asOf)} class_name, ${nm('business_unit', 'af.business_unit_id', asOf)} bu_name,
      coalesce(t.due, 0) due, coalesce(t.paid, 0) paid, coalesce(t.exempted, 0) exempted, coalesce(t.balance, 0) balance, coalesce(t.overdue, 0) overdue,
      count(*) over () total_count, sum(coalesce(t.balance, 0)) over () total_balance, sum(coalesce(t.overdue, 0)) over () total_overdue
    from assignment a
    join assignment_f af on af.id = a.id and ${asOf}::date between af.effective_start_date and af.effective_end_date
    join person p on p.id = a.person_id ${personAsOf(asOf)}
    left join (select person_id, sum(amount) due, sum(paid_amount) paid, sum(exempted_amount) exempted, sum(balance_amount) balance,
        sum(balance_amount) filter (where due_date < ${today}) overdue
      from fee_demand_v d where d.enterprise_id = ${u.enterpriseId} and d.cancelled_flag = 'N' group by person_id) t on t.person_id = a.person_id
    where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STUDENT' ${studentScopeSql(u, asOf)}
      ${cls ? sql`and af.class_id = ${cls.split(':')[0]} and af.section_id = ${cls.split(':')[1]}` : sql``}
      ${like ? sql`and (a.assignment_number ilike ${like} or ${fullName()} ilike ${like} or pf.phone ilike ${like})` : sql``}
      ${show === 'pending' ? sql`and coalesce(t.balance, 0) > 0` : show === 'overdue' ? sql`and coalesce(t.overdue, 0) > 0` : sql``}
    order by overdue desc, full_name limit 100 offset ${(page - 1) * 100}`;
  const total = Number(rows[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / 100));
  const pageHref = (n: number) => '?' + new URLSearchParams({ ...(q ? { q } : {}), ...(cls ? { cls } : {}), show, page: String(n) }).toString();
  return (
    <div>
      <PageHeader title="Collect Fees" subtitle={`${total} student(s) · pending ${money(rows[0]?.total_balance ?? 0)} · overdue ${money(rows[0]?.total_overdue ?? 0)}`} />
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
        {pages > 1 && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="muted">Page {page} of {pages}</span>
            {page > 1 && <Link className="btn btn-sm" href={pageHref(page - 1)}>‹ Previous</Link>}
            {page < pages && <Link className="btn btn-sm" href={pageHref(page + 1)}>Next ›</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
