import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getAsOf } from '@/lib/asof';
import { fieldContexts } from '@/lib/fields';
import { lookupOptions, lk } from '@/lib/lookups';
import { PageHeader, Flash, Field, Back, Badge, Select, Empty, type SP, s } from '@/components/ui';
import { AutoSubmit, ShowFor } from '@/components/client';
import { saveField } from '../actions';

export default async function FieldsPage({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_ADDITIONAL_FIELD_PRV');
  const sp = await searchParams;
  const contexts = fieldContexts();
  const context = s(sp.context) ?? contexts[0].value;
  const asOf = await getAsOf();
  const L = await lk();
  const fields = await sql`select * from additional_field where enterprise_id = ${u.enterpriseId} and context_code = ${context} order by display_seq, label`;
  const counts = Object.fromEntries((await sql`select context_code, count(*)::int n from additional_field where enterprise_id = ${u.enterpriseId} group by 1`).map((r) => [r.context_code, r.n]));
  const types = await lookupOptions('ADDITIONAL_FIELD_TYPE', asOf);
  const lookups = (await sql`select lookup_type, meaning from lookup_type order by meaning`).map((r) => ({ value: r.lookup_type, label: `${r.meaning} (${r.lookup_type})` }));
  const back = `/config/fields?context=${encodeURIComponent(context)}`;
  const write = can(u, 'CD_ADDITIONAL_FIELD_PRV', 'WRITE');
  const cols = 'grid grid-cols-[9rem_1fr_7rem_10rem_6rem_6rem_5rem_1fr_auto] gap-2 items-center';
  return (
    <div className="max-w-7xl">
      <PageHeader title="Additional Fields" subtitle="Add your own fields to pages. Values are saved with the record's date-effective history. Create a lookup first (Configuration › Lookups) to offer a list of values." />
      <Flash sp={sp} />
      <form className="card mb-4 flex flex-wrap items-center gap-2">
        <span className="label mb-0">Page</span>
        <select name="context" defaultValue={context} className="input max-w-md">
          {contexts.map((c) => <option key={c.value} value={c.value}>{c.label}{counts[c.value] ? ` (${counts[c.value]})` : ''}</option>)}
        </select>
        <AutoSubmit />
      </form>
      <div className="card overflow-x-auto">
        <div className="min-w-[1100px]">
          <div className={`${cols} border-b pb-1 text-xs font-semibold uppercase text-gray-600`}><div>Field Code</div><div>Label</div><div>Type</div><div>Lookup</div><div>Mandatory</div><div>Active</div><div>Order</div><div>Help text</div><div /></div>
          {fields.map((f) => (
            <form key={f.id} action={saveField.bind(null, f.id)} className={`${cols} border-b border-black/5 py-1.5`}>
              <Back to={back} />
              <div className="font-mono text-xs">{f.field_code}</div>
              <input name="label" defaultValue={f.label} className="input" required disabled={!write} />
              <div><Badge color="blue">{L('ADDITIONAL_FIELD_TYPE', f.data_type)}</Badge></div>
              <div className="text-xs">{f.lookup_type ?? '—'}</div>
              <select name="required_flag" defaultValue={f.required_flag} className="input" disabled={!write}><option value="N">No</option><option value="Y">Yes</option></select>
              <select name="active_flag" defaultValue={f.active_flag} className="input" disabled={!write}><option value="Y">Yes</option><option value="N">No</option></select>
              <input name="display_seq" type="number" defaultValue={f.display_seq} className="input" disabled={!write} />
              <input name="help_text" defaultValue={f.help_text ?? ''} className="input" disabled={!write} />
              {write ? <button className="btn btn-sm">Save</button> : <span />}
            </form>
          ))}
          {!fields.length && <Empty>No additional fields on this page yet.</Empty>}
          {write && (
            <form action={saveField.bind(null, null)} className={`${cols} mt-2 rounded bg-green-50 py-2`}>
              <Back to={back} /><input type="hidden" name="context_code" value={context} />
              <input name="field_code" placeholder="CODE" className="input uppercase" required />
              <input name="label" placeholder="Label shown on the page" className="input" required />
              <Select name="data_type" options={types} value="TEXT" empty={false} />
              <div><ShowFor select="data_type" /><div data-show-for-data_type="LOOKUP"><Select name="lookup_type" options={lookups} empty="Choose lookup" /></div></div>
              <select name="required_flag" className="input"><option value="N">No</option><option value="Y">Yes</option></select>
              <select name="active_flag" className="input"><option value="Y">Yes</option><option value="N">No</option></select>
              <input name="display_seq" type="number" defaultValue={(fields.at(-1)?.display_seq ?? 0) + 10} className="input" />
              <input name="help_text" placeholder="Optional hint" className="input" />
              <button className="btn btn-primary btn-sm">Add</button>
            </form>
          )}
        </div>
        <p className="muted mt-3">The field code and type are fixed once created. Make a field inactive to hide it; existing values are kept.</p>
      </div>
    </div>
  );
}
