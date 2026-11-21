import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { lk, lookupOptions } from '@/lib/lookups';
import { money } from '@/lib/util';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP, s } from '@/components/ui';
import { saveItem } from './actions';

export default async function Inventory({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_INVENTORY_ITEM_PRV');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const L = await lk();
  const bus = await refOptions('business-units', u.enterpriseId, asOf);
  const items = await sql`select i.*, coalesce((select json_object_agg(business_unit_id, q) from (select business_unit_id, sum(quantity) q from stock_txn t where t.item_id = i.id group by 1) x), '{}') stock
    from item i where enterprise_id = ${u.enterpriseId} order by category_code, name, size_label`;
  const editing = items.find((i) => String(i.id) === s(sp.edit));
  const canEdit = can(u, 'CD_INVENTORY_ITEM_PRV', 'WRITE');
  const [cats, uoms] = [await lookupOptions('ITEM_CATEGORY', asOf), await lookupOptions('UOM', asOf)];
  return (
    <div className="max-w-7xl">
      <PageHeader title="Items & Stock" subtitle="Stock on hand per branch. Rows in red are at or below the reorder level." />
      <Flash sp={sp} />
      <div className="card mb-4 overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Code</th><th>Item</th><th>Category</th><th>Size</th><th className="text-right">Price</th>{bus.map((b) => <th key={b.value} className="text-right">{b.label}</th>)}<th className="text-right">Total</th><th></th></tr></thead>
          <tbody>{items.map((i) => {
            const total = Object.values(i.stock as Record<string, number>).reduce((a, b) => a + Number(b), 0);
            return (
              <tr key={i.id} className={i.active_flag === 'N' ? 'opacity-50' : ''}>
                <td className="font-mono text-xs">{i.code}</td><td>{i.name}</td><td>{L('ITEM_CATEGORY', i.category_code)}</td><td>{i.size_label}</td><td className="text-right">{money(i.unit_price)}</td>
                {bus.map((b) => { const q = Number(i.stock[b.value] ?? 0); return <td key={b.value} className={`text-right ${q <= Number(i.reorder_level) ? 'font-bold text-red-700' : ''}`}>{q}</td>; })}
                <td className="text-right font-semibold">{total}</td>
                <td>{canEdit && <a href={`?edit=${i.id}#item`} className="btn btn-sm">Edit</a>}</td>
              </tr>);
          })}</tbody>
        </table>
        {!items.length && <Empty />}
      </div>
      {canEdit && (
        <form id="item" action={saveItem.bind(null, editing?.id ?? null)} className="card">
          <Back to="/inventory" />
          <h2 className="h2">{editing ? `Edit ${editing.code}` : 'New Item'}</h2>
          <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <Field label="Code *"><input name="code" defaultValue={editing?.code} className="input uppercase" required /></Field>
            <Field label="Name *" className="sm:col-span-2"><input name="name" defaultValue={editing?.name} className="input" required /></Field>
            <Field label="Category *"><Select name="category_code" options={cats} value={editing?.category_code} required /></Field>
            <Field label="Size / Variant"><input name="size_label" defaultValue={editing?.size_label ?? ''} className="input" /></Field>
            <Field label="UOM"><Select name="uom_code" options={uoms} value={editing?.uom_code ?? 'EA'} empty={false} /></Field>
            <Field label="Sale Price"><input name="unit_price" type="number" step="0.01" defaultValue={editing?.unit_price ?? ''} className="input" /></Field>
            <Field label="Reorder Level"><input name="reorder_level" type="number" defaultValue={editing?.reorder_level ?? 5} className="input" /></Field>
            <Field label="Active"><select name="active_flag" defaultValue={editing?.active_flag ?? 'Y'} className="input"><option value="Y">Yes</option><option value="N">No</option></select></Field>
          </div>
          <div className="mt-3 flex gap-2"><button className="btn btn-primary">{editing ? 'Save' : 'Create'}</button>{editing && <a className="btn" href="/inventory">Cancel</a>}</div>
          {!editing && <p className="muted mt-2"><Badge>Tip</Badge> Opening stock: create the item, then add a Stock Receipt per branch.</p>}
        </form>
      )}
    </div>
  );
}
