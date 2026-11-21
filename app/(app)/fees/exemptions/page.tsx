import Link from 'next/link';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { fmtDateTime, money } from '@/lib/util';
import { PageHeader, Flash, Back, Badge, Empty, STATUS_COLOR, type SP, s } from '@/components/ui';
import { decideExemption } from '../actions';

export default async function Exemptions({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_FEE_EXCEPTION_APPROVAL_PRV');
  const sp = await searchParams;
  const st = s(sp.status) ?? 'PENDING';
  const L = await lk();
  const rows = await sql`
    select e.*, d.description, d.period_label, d.amount demand_amount, d.balance_amount, d.person_id, a.assignment_number,
      (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = d.person_id order by effective_start_date desc limit 1) full_name
    from fee_exemption e join fee_demand_v d on d.id = e.demand_id join assignment a on a.person_id = d.person_id and a.assignment_type = 'STUDENT'
    where d.enterprise_id = ${u.enterpriseId} and (${st} = 'ALL' or e.status_code = ${st}) order by e.requested_at desc limit 500`;
  return (
    <div className="max-w-7xl">
      <PageHeader title="Fee Exception Approvals" subtitle="Exceptions requested by class incharges wait here for approval." />
      <Flash sp={sp} />
      <div className="mb-3 flex gap-2">{['PENDING', 'APPROVED', 'REJECTED', 'ALL'].map((x) => <Link key={x} href={`?status=${x}`} className={`btn btn-sm ${x === st ? 'btn-primary' : ''}`}>{x === 'ALL' ? 'All' : L('APPROVAL_STATUS', x)}</Link>)}</div>
      <div className="card overflow-x-auto">
        <table className="tbl"><thead><tr><th>Student</th><th>Fee</th><th className="text-right">Line Amount</th><th className="text-right">Open Balance</th><th className="text-right">Exception</th><th>Reason</th><th>Requested</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><Link className="link" href={`/fees/students/${r.person_id}`}>{r.full_name}</Link><div className="text-xs text-gray-500">{r.assignment_number}</div></td>
              <td>{r.description} {r.period_label}</td><td className="text-right">{money(r.demand_amount)}</td><td className="text-right">{money(r.balance_amount)}</td>
              <td className="text-right font-semibold">{money(r.amount)}</td><td>{L('EXEMPTION_REASON', r.reason_code)}{r.remarks && <div className="text-xs">{r.remarks}</div>}</td>
              <td className="text-xs">{r.requested_by}<br />{fmtDateTime(r.requested_at)}</td>
              <td><Badge color={STATUS_COLOR[r.status_code]}>{L('APPROVAL_STATUS', r.status_code)}</Badge>{r.decided_by && <div className="text-xs">{r.decided_by}</div>}</td>
              <td>{r.status_code === 'PENDING' && <div className="flex gap-1">
                <form action={decideExemption.bind(null, r.id, 'APPROVED')}><Back to={`/fees/exemptions?status=${st}`} /><button className="btn btn-sm btn-primary">Approve</button></form>
                <form action={decideExemption.bind(null, r.id, 'REJECTED')}><Back to={`/fees/exemptions?status=${st}`} /><button className="btn btn-sm">Reject</button></form></div>}</td>
            </tr>))}</tbody></table>
        {!rows.length && <Empty />}
      </div>
    </div>
  );
}
