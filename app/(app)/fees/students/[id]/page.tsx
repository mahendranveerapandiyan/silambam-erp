import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { assignmentFor, personDetail } from '@/lib/people';
import { lk, lookupOptions } from '@/lib/lookups';
import { paymentQrsFor, totals } from '@/lib/fees';
import { fmtDate, money, todayISO } from '@/lib/util';
import { PageHeader, Flash, Back, Badge, Empty, Field, Select, STATUS_COLOR, type SP, here } from '@/components/ui';
import { ConfirmButton, CheckAll } from '@/components/client';
import { AccessGuard } from '@/components/people/AccessGuard';
import { demandAction, bulkPayment, addCharge, cancelPayment, deletePayment, deleteExemption, changeFrequency } from '../../actions';

export default async function StudentFees({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requirePriv('CD_FEE_COLLECT_PRV', 'READ');
  const { id } = await params;
  const sp = await searchParams;
  const asOf = await getAsOf();
  const p = await personDetail(id, asOf);
  if (!p) notFound();
  return (
    <AccessGuard u={u} kind="STUDENT" personId={id} asOf={asOf}>
      <Body />
    </AccessGuard>
  );

  async function Body() {
    const a = await assignmentFor(id, 'STUDENT', asOf);
    const today = todayISO();
    const back = here(`/fees/students/${id}`, sp);
    const [L, modes, reasons, feeTypes, freqs] = [await lk(), await lookupOptions('PAYMENT_MODE', asOf), await lookupOptions('EXEMPTION_REASON', asOf), await lookupOptions('FEE_TYPE', asOf), await lookupOptions('FEE_FREQUENCY', asOf)];
    const demands = await sql`select d.*, y.name ay_name, (select coalesce(sum(amount),0) from fee_exemption e where e.demand_id = d.id and e.status_code = 'PENDING') pending_exempt
      from fee_demand_v d left join academic_year y on y.id = d.academic_year_id where d.person_id = ${id} and d.cancelled_flag = 'N' order by d.due_date, d.id`;
    const payments = await sql`select fp.*, (select string_agg(fd.description || coalesce(' ' || fd.period_label, ''), ', ') from fee_allocation fa join fee_demand fd on fd.id = fa.demand_id where fa.payment_id = fp.id) applied_to
      from fee_payment fp where person_id = ${id} order by payment_date desc, id desc`;
    const exemptions = await sql`select e.*, d.description, d.period_label from fee_exemption e join fee_demand d on d.id = e.demand_id where d.person_id = ${id} order by e.requested_at desc`;
    const qrs = await paymentQrsFor(id, asOf);
    const t = totals(demands);
    // carry-forward: balances on lines whose period ended (or due date passed) before the current term
    const current = demands.find((d) => d.period_start && d.period_start <= today && (d.period_end ?? d.due_date) >= today && d.fee_type_code === 'TUITION');
    const cfCut = current?.period_start ?? today;
    const carried = demands.filter((d) => Number(d.balance_amount) > 0 && d.due_date < cfCut && d.id !== current?.id);
    const carriedAmt = carried.reduce((s, d) => s + Number(d.balance_amount), 0);
    const byYear = new Map<string, any[]>();
    for (const d of demands) byYear.set(d.ay_name ?? 'Other charges', [...(byYear.get(d.ay_name ?? 'Other charges') ?? []), d]);
    const isAcct = can(u, 'CD_FEE_EXCEPTION_APPROVAL_PRV', 'WRITE');
    const canCancel = can(u, 'CD_FEE_CANCEL_PRV', 'WRITE');
    const canPay = can(u, 'CD_FEE_COLLECT_PRV', 'WRITE');
    const canCharge = can(u, 'CD_FEE_CHARGE_PRV', 'WRITE');

    return (
      <div className="max-w-7xl">
        <PageHeader title={`Fees: ${p.full_name}`}
          subtitle={<>{a?.assignment_number} · {a?.bu_name} › {a?.class_name} · Grade {a?.grade_name ?? '—'} · Frequency <b>{L('FEE_FREQUENCY', a?.fee_frequency_code)}</b></>}
          actions={<><Link href={`/students/${id}`} className="btn">Student profile</Link><Link href="/fees" className="btn">Back</Link></>} />
        <Flash sp={sp} />

        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[['Total Due', t.due, ''], ['Paid', t.paid, 'text-green-700'], ['Exception', t.exempted, 'text-purple-700'], ['Pending', t.balance, t.balance > 0 ? 'text-red-700' : ''], ['Carried Forward', carriedAmt, carriedAmt > 0 ? 'text-red-700' : '']].map(([l, v, c]) => (
            <div key={l as string} className="card"><div className="text-xs font-semibold uppercase text-gray-500">{l}</div><div className={`text-xl font-bold ${c}`}>{money(v as number)}</div></div>
          ))}
          <div className="card text-sm">
            <div className="text-xs font-semibold uppercase text-gray-500">Current term</div>
            {current ? <><div className="font-semibold">{current.period_label}</div><Badge color={STATUS_COLOR[current.payment_status]}>{L('FEE_PAYMENT_STATUS', current.payment_status)}</Badge></> : <span className="muted">—</span>}
          </div>
        </div>

        {carriedAmt > 0 && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            <b>{money(carriedAmt)}</b> unpaid from previous term(s) is carried forward: {carried.map((d) => `${d.description}${d.period_label ? ' (' + d.period_label + ')' : ''}`).join(', ')}.
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            <form id="bulk" action={bulkPayment.bind(null, id)} className="card">
              <Back to={back} />
              <h2 className="h2">Record Payment</h2>
              <p className="muted mb-2">Tick lines below to pay specific items, or leave all unticked to pay the oldest dues first (carry-forward first).</p>
              <div className="grid items-end gap-2 sm:grid-cols-6">
                <Field label="Amount *"><input name="amount" type="number" step="0.01" min="0.01" defaultValue={t.balance || ''} className="input" required /></Field>
                <Field label="Date"><input name="payment_date" type="date" defaultValue={today} className="input" /></Field>
                <Field label="Mode"><Select name="payment_mode_code" options={modes} value="CASH" empty={false} /></Field>
                <Field label="Reference / UTR"><input name="reference" className="input" /></Field>
                <Field label="Remarks"><input name="remarks" className="input" /></Field>
                <button className="btn btn-primary">Record Payment</button>
              </div>
            </form>

            {[...byYear.entries()].map(([year, rows]) => (
              <div key={year} className="card overflow-x-auto">
                <h2 className="h2">{year}</h2>
                <table className="tbl">
                  <thead><tr><th><CheckAll name="demand" /></th><th>Due</th><th>Fee</th><th>Period</th><th className="text-right">Amount</th><th className="text-right">Paid</th><th className="text-right">Exception</th><th className="text-right">Balance</th><th>Status</th><th>Update</th></tr></thead>
                  <tbody>{rows.map((d) => {
                    const open = Number(d.balance_amount) > 0;
                    const overdue = open && d.due_date < today;
                    return (
                      <tr key={d.id} className={overdue ? 'bg-red-50/60' : ''}>
                        <td>{open && <input type="checkbox" name="demand" value={d.id} form="bulk" />}</td>
                        <td className="whitespace-nowrap">{fmtDate(d.due_date)}{overdue && <div className="text-[10px] font-semibold text-red-700">OVERDUE</div>}</td>
                        <td>{d.description}<div className="text-xs text-gray-500">{L('FEE_TYPE', d.fee_type_code)}</div></td>
                        <td>{d.period_label}</td>
                        <td className="text-right">{money(d.amount)}</td><td className="text-right">{money(d.paid_amount)}</td>
                        <td className="text-right">{money(d.exempted_amount)}{Number(d.pending_exempt) > 0 && <div className="text-[10px] text-amber-700">{money(d.pending_exempt)} pending</div>}</td>
                        <td className="text-right font-semibold">{money(d.balance_amount)}</td>
                        <td><Badge color={STATUS_COLOR[d.payment_status]}>{L('FEE_PAYMENT_STATUS', d.payment_status)}</Badge></td>
                        <td>{canPay && (open || canCancel) && (
                          <details className="relative">
                            <summary className="btn btn-sm cursor-pointer list-none">Update ▾</summary>
                            <form action={demandAction.bind(null, d.id)} className="absolute right-0 z-10 mt-1 w-72 space-y-2 rounded-md border bg-white p-3 shadow-lg">
                              <Back to={back} />
                              <select name="op" className="input" required defaultValue="">
                                <option value="" disabled>Choose…</option>
                                {open && <option value="PAY_FULL">Mark Paid ({money(d.balance_amount)})</option>}
                                {open && <option value="PAY_PARTIAL">Partially Paid</option>}
                                {open && <option value="EXEMPT_FULL">Exception – full balance</option>}
                                {open && <option value="EXEMPT_PARTIAL">Exception – partial</option>}
                                {canCancel && Number(d.paid_amount) === 0 && <option value="CANCEL">Cancel this line</option>}
                              </select>
                              <input name="amount" type="number" step="0.01" placeholder="Amount (partial)" className="input" />
                              <Select name="payment_mode_code" options={modes} value="CASH" empty={false} />
                              <input name="reference" placeholder="Reference / UTR" className="input" />
                              <Select name="reason_code" options={reasons} empty="Exception reason" />
                              <input name="remarks" placeholder="Remarks" className="input" />
                              <button className="btn btn-primary w-full">Apply</button>
                              {!isAcct && <p className="text-[11px] text-gray-500">Exceptions need administrator approval.</p>}
                            </form>
                          </details>
                        )}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            ))}
            {!demands.length && <div className="card"><Empty>No fees yet. Generate fees from Fees › Generate Fees, or add a charge.</Empty></div>}

            <div className="card overflow-x-auto">
              <h2 className="h2">Payments</h2>
              <table className="tbl"><thead><tr><th>Receipt</th><th>Date</th><th className="text-right">Amount</th><th>Mode</th><th>Reference</th><th>Applied To</th><th>By</th><th></th></tr></thead>
                <tbody>{payments.map((r) => (
                  <tr key={r.id} className={r.status_code === 'CANCELLED' ? 'line-through opacity-50' : ''}>
                    <td><Link className="link" href={`/fees/receipt/${r.id}`}>{r.receipt_number}</Link></td><td>{fmtDate(r.payment_date)}</td><td className="text-right">{money(r.amount)}</td>
                    <td>{L('PAYMENT_MODE', r.payment_mode_code)}</td><td>{r.reference}</td><td className="text-xs">{r.applied_to}</td><td className="text-xs">{r.collected_by}</td>
                    <td className="whitespace-nowrap">{canCancel && <div className="flex gap-1">
                      {r.status_code === 'ACTIVE' && <form action={cancelPayment.bind(null, r.id)}><Back to={back} /><ConfirmButton className="btn btn-sm" message={`Cancel receipt ${r.receipt_number}? It stays on record as cancelled and its amounts become outstanding again.`}>Cancel</ConfirmButton></form>}
                      <form action={deletePayment.bind(null, r.id)}><Back to={back} /><ConfirmButton className="btn btn-sm btn-danger" message={`Delete receipt ${r.receipt_number} (${money(r.amount)}) completely? Its amounts become outstanding again. This cannot be undone.`}>Delete</ConfirmButton></form>
                    </div>}</td>
                  </tr>))}</tbody></table>
              {!payments.length && <Empty>No payments yet.</Empty>}
            </div>

            {exemptions.length > 0 && (
              <div className="card overflow-x-auto">
                <h2 className="h2">Exceptions</h2>
                <table className="tbl"><thead><tr><th>Fee</th><th className="text-right">Amount</th><th>Reason</th><th>Status</th><th>Requested</th><th>Decided</th><th></th></tr></thead>
                  <tbody>{exemptions.map((e) => (
                    <tr key={e.id}><td>{e.description} {e.period_label}</td><td className="text-right">{money(e.amount)}</td><td>{L('EXEMPTION_REASON', e.reason_code)}{e.remarks && ` – ${e.remarks}`}</td>
                      <td><Badge color={STATUS_COLOR[e.status_code]}>{L('APPROVAL_STATUS', e.status_code)}</Badge></td><td className="text-xs">{e.requested_by}</td><td className="text-xs">{e.decided_by}</td>
                      <td>{canCancel && <form action={deleteExemption.bind(null, e.id)}><Back to={back} /><ConfirmButton className="btn btn-sm btn-danger" message={`Delete the fee exception of ${money(e.amount)} on ${e.description}? The line's balance returns.`}>Delete</ConfirmButton></form>}</td></tr>))}</tbody></table>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="card">
              <h2 className="h2">Pay by UPI QR</h2>
              {qrs.length ? qrs.map((q) => (
                <div key={q.id} className="mb-3 text-center"><img src={`/api/payment-qr/${q.id}`} alt={q.label} className="mx-auto max-h-56 rounded border" /><div className="mt-1 text-sm font-semibold">{q.label}</div>{q.upi_id && <div className="font-mono text-xs">{q.upi_id}</div>}</div>
              )) : <p className="muted">No payment QR uploaded for this class yet. <Link href="/fees/payment-qr" className="link">Upload one</Link>.</p>}
            </div>
            <form action={changeFrequency.bind(null, id)} className="card space-y-2">
              <Back to={back} />
              <h2 className="h2">Change Fee Frequency</h2>
              <Select name="fee_frequency_code" options={freqs.filter((f) => f.value !== 'ONE_TIME')} value={a?.fee_frequency_code} empty={false} />
              <Field label="Effective from"><input type="date" name="effective_date" defaultValue={today} className="input" /></Field>
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="regenerate" value="Y" defaultChecked /> Cancel future unpaid tuition lines and regenerate them at the new frequency</label>
              <button className="btn w-full">Change</button>
            </form>
            {canCharge && (
              <form action={addCharge.bind(null, id)} className="card space-y-2">
                <Back to={back} />
                <h2 className="h2">Add Charge</h2>
                <Select name="fee_type_code" options={feeTypes} required />
                <input name="description" placeholder="Description" className="input" required />
                <input name="amount" type="number" step="0.01" placeholder="Amount" className="input" required />
                <Field label="Due date"><input type="date" name="due_date" defaultValue={today} className="input" required /></Field>
                <button className="btn w-full">Add</button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }
}
