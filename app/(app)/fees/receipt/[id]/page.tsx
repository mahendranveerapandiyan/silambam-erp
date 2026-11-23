import { notFound } from 'next/navigation';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { assertStudentAccess } from '@/lib/scope';
import { enterpriseInfo } from '@/lib/theme';
import { fmtDate, money, todayISO } from '@/lib/util';
import { PrintButton } from '@/components/client';

export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePriv(['CD_FEE_COLLECT_PRV', 'CD_FEE_SUMMARY_PRV'], 'READ');
  const { id } = await params;
  const [p] = await sql`select fp.*, a.assignment_number, (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = fp.person_id order by effective_start_date desc limit 1) full_name,
    (select name from business_unit_f b where b.id = fp.business_unit_id order by effective_start_date desc limit 1) bu_name
    from fee_payment fp join assignment a on a.person_id = fp.person_id and a.assignment_type = 'STUDENT' where fp.id = ${id}`;
  if (!p) notFound();
  await assertStudentAccess(u, p.person_id, todayISO()).catch(() => notFound());
  const lines = await sql`select fa.amount, d.description, d.period_label from fee_allocation fa join fee_demand d on d.id = fa.demand_id where fa.payment_id = ${id} order by d.due_date`;
  const [ent, L] = [await enterpriseInfo(u.enterpriseId), await lk()];
  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-3 flex justify-end no-print"><PrintButton /></div>
      <div className="card">
        <div className="mb-3 border-b pb-3 text-center">
          {ent?.logo_url && <img src={ent.logo_url} alt="" className="mx-auto mb-1 h-12" />}
          <div className="text-lg font-bold">{ent?.name}</div><div className="text-sm">{p.bu_name}</div>
          <div className="mt-2 text-base font-semibold uppercase tracking-wider">Fee Receipt {p.status_code === 'CANCELLED' && <span className="text-red-600">(Cancelled)</span>}</div>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-1 text-sm">
          <div>Receipt No: <b>{p.receipt_number}</b></div><div className="text-right">Date: <b>{fmtDate(p.payment_date)}</b></div>
          <div>Student: <b>{p.full_name}</b></div><div className="text-right">{p.assignment_number}</div>
        </div>
        <table className="tbl"><thead><tr><th>Particulars</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={i}><td>{l.description} {l.period_label}</td><td className="text-right">{money(l.amount)}</td></tr>)}</tbody>
          <tfoot><tr className="font-bold"><td>Total</td><td className="text-right">{money(p.amount)}</td></tr></tfoot></table>
        <div className="mt-3 text-sm">Mode: {L('PAYMENT_MODE', p.payment_mode_code)}{p.reference && ` · Ref ${p.reference}`}</div>
        <div className="mt-8 flex justify-between text-xs text-gray-500"><span>Collected by {p.collected_by}</span><span>Authorised signatory</span></div>
      </div>
    </div>
  );
}
