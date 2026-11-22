import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { lk, lookupOptions } from '@/lib/lookups';
import { fmtDate, money, todayISO } from '@/lib/util';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP, s } from '@/components/ui';
import { AutoSubmit, ConfirmButton } from '@/components/client';
import { saveTxn } from './actions';

export default async function Finance({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_FINANCE_TXN_PRV');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const month = s(sp.month) ?? todayISO().slice(0, 7);
  const bu = s(sp.bu);
  const L = await lk();
  const [bus, inc, exp, modes] = [await refOptions('business-units', u.enterpriseId, asOf), await lookupOptions('INCOME_CATEGORY', asOf), await lookupOptions('EXPENSE_CATEGORY', asOf), await lookupOptions('PAYMENT_MODE', asOf)];
  const rows = await sql`select t.*, (select name from business_unit_f b where b.id = t.business_unit_id order by effective_start_date desc limit 1) bu_name
    from finance_txn t where enterprise_id = ${u.enterpriseId} and to_char(txn_date, 'YYYY-MM') = ${month} ${bu ? sql`and business_unit_id = ${bu}` : sql``} order by txn_date desc, id desc`;
  const [fees] = await sql`select coalesce(sum(amount),0) a from fee_payment where enterprise_id = ${u.enterpriseId} and status_code = 'ACTIVE' and to_char(payment_date, 'YYYY-MM') = ${month} ${bu ? sql`and business_unit_id = ${bu}` : sql``}`;
  const income = rows.filter((r) => r.txn_kind === 'INCOME').reduce((a, r) => a + Number(r.amount), 0) + Number(fees.a);
  const expense = rows.filter((r) => r.txn_kind === 'EXPENSE').reduce((a, r) => a + Number(r.amount), 0);
  return (
    <div className="max-w-6xl">
      <PageHeader title="Income & Expenses" subtitle="Fee collections are included automatically. Record other income and all expenses here." />
      <Flash sp={sp} />
      <form className="card mb-4 flex flex-wrap gap-2"><input type="month" name="month" defaultValue={month} className="input w-44" /><Select name="bu" options={bus} value={bu} empty="All business units" className="input max-w-xs" /><AutoSubmit /></form>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="card"><div className="text-xs font-semibold uppercase text-gray-500">Fee Collections</div><div className="text-xl font-bold">{money(fees.a)}</div></div>
        <div className="card"><div className="text-xs font-semibold uppercase text-gray-500">Total Income</div><div className="text-xl font-bold text-green-700">{money(income)}</div></div>
        <div className="card"><div className="text-xs font-semibold uppercase text-gray-500">Expenses</div><div className="text-xl font-bold text-red-700">{money(expense)}</div></div>
        <div className="card"><div className="text-xs font-semibold uppercase text-gray-500">Net</div><div className={`text-xl font-bold ${income - expense < 0 ? 'text-red-700' : ''}`}>{money(income - expense)}</div></div>
      </div>
      <form action={saveTxn} className="card mb-4 grid items-end gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Back to={`/finance?month=${month}`} />
        <Field label="Category *" className="sm:col-span-2">
          <select name="category" className="input" required defaultValue="">
            <option value="" disabled>Choose…</option>
            <optgroup label="Expense">{exp.map((x) => <option key={x.value} value={`EXPENSE:${x.value}`} data-code={x.value}>{x.label}</option>)}</optgroup>
            <optgroup label="Income">{inc.map((x) => <option key={x.value} value={`INCOME:${x.value}`} data-code={x.value}>{x.label}</option>)}</optgroup>
          </select>
        </Field>
        <Field label="Date"><input type="date" name="txn_date" defaultValue={todayISO()} className="input" /></Field>
        <Field label="Amount *"><input name="amount" type="number" step="0.01" min="0.01" className="input" required /></Field>
        <Field label="Business Unit"><Select name="business_unit_id" options={bus} empty="Head office" /></Field>
        <Field label="Mode"><Select name="payment_mode_code" options={modes} value="CASH" empty={false} /></Field>
        <Field label="Description"><input name="description" className="input" /></Field>
        <button className="btn btn-primary">Add</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="tbl"><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Business Unit</th><th>Description</th><th className="text-right">Amount</th><th>By</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{fmtDate(r.txn_date)}</td><td><Badge color={r.txn_kind === 'INCOME' ? 'green' : 'red'}>{r.txn_kind === 'INCOME' ? 'Income' : 'Expense'}</Badge></td>
              <td>{L(r.txn_kind === 'INCOME' ? 'INCOME_CATEGORY' : 'EXPENSE_CATEGORY', r.category_code)}</td><td>{r.bu_name ?? 'Head office'}</td><td>{r.description}</td>
              <td className="text-right">{money(r.amount)}</td><td className="text-xs">{r.created_by}</td>
              <td><form action={saveTxn}><Back to={`/finance?month=${month}`} /><input type="hidden" name="_delete" value={r.id} /><ConfirmButton className="btn btn-sm" message="Delete this entry?">✕</ConfirmButton></form></td></tr>))}</tbody></table>
        {!rows.length && <Empty />}
      </div>
    </div>
  );
}
