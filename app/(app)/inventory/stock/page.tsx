import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { lk, lookupOptions } from '@/lib/lookups';
import { fmtDate, money, todayISO } from '@/lib/util';
import { PageHeader, Flash, Field, Select, Back, Empty, type SP } from '@/components/ui';
import { stockEntry } from '../actions';

export default async function Stock({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_STOCK_ENTRY_PRV');
  const asOf = await getAsOf();
  const L = await lk();
  const items = (await sql`select id, code, name, size_label from item where enterprise_id = ${u.enterpriseId} and active_flag = 'Y' order by name, size_label`).map((i) => ({ value: String(i.id), label: `${i.name}${i.size_label ? ' – ' + i.size_label : ''} (${i.code})` }));
  const [bus, types] = [await refOptions('business-units', u.enterpriseId, asOf), (await lookupOptions('STOCK_TXN_TYPE', asOf)).filter((t) => t.value !== 'SALE')];
  const txns = await sql`select t.*, i.name, i.size_label, (select name from business_unit_f b where b.id = t.business_unit_id order by effective_start_date desc limit 1) bu_name,
      (select a.assignment_number from assignment a where a.person_id = t.person_id and a.assignment_type = 'STUDENT') student
    from stock_txn t join item i on i.id = t.item_id where i.enterprise_id = ${u.enterpriseId} order by t.txn_date desc, t.id desc limit 200`;
  return (
    <div className="max-w-6xl">
      <PageHeader title="Stock Entry" subtitle="Record receipts from suppliers, returns and adjustments (negative quantity to reduce)." />
      <Flash sp={await searchParams} />
      <form action={stockEntry} className="card mb-4 grid items-end gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Back to="/inventory/stock" />
        <Field label="Item *" className="sm:col-span-2"><Select name="item_id" options={items} required /></Field>
        <Field label="Branch *"><Select name="business_unit_id" options={bus} required /></Field>
        <Field label="Type *"><Select name="txn_type_code" options={types} value="RECEIPT" empty={false} /></Field>
        <Field label="Quantity *"><input name="quantity" type="number" step="1" className="input" required /></Field>
        <Field label="Unit Cost"><input name="unit_price" type="number" step="0.01" className="input" /></Field>
        <Field label="Date"><input name="txn_date" type="date" defaultValue={todayISO()} className="input" /></Field>
        <button className="btn btn-primary">Save</button>
        <Field label="Reference" className="sm:col-span-2"><input name="reference" className="input" /></Field>
        <Field label="Remarks" className="sm:col-span-2"><input name="remarks" className="input" /></Field>
      </form>
      <div className="card overflow-x-auto">
        <h2 className="h2">Stock Ledger (latest 200)</h2>
        <table className="tbl"><thead><tr><th>Date</th><th>Item</th><th>Branch</th><th>Type</th><th className="text-right">Qty</th><th className="text-right">Price</th><th>Student</th><th>Reference</th><th>By</th></tr></thead>
          <tbody>{txns.map((t) => (
            <tr key={t.id}><td>{fmtDate(t.txn_date)}</td><td>{t.name} {t.size_label}</td><td>{t.bu_name}</td><td>{L('STOCK_TXN_TYPE', t.txn_type_code)}</td>
              <td className={`text-right ${Number(t.quantity) < 0 ? 'text-red-700' : 'text-green-700'}`}>{Number(t.quantity)}</td><td className="text-right">{t.unit_price && money(t.unit_price)}</td>
              <td>{t.student}</td><td>{t.reference}</td><td className="text-xs">{t.created_by}</td></tr>))}</tbody></table>
        {!txns.length && <Empty />}
      </div>
    </div>
  );
}
