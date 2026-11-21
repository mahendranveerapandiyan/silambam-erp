import Link from 'next/link';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PageHeader, Flash, Field, Badge, Back, type SP, s } from '@/components/ui';
import { AutoSubmit } from '@/components/client';
import { createLookupType } from '../actions';

const ACCESS_COLOR: Record<string, string> = { SYSTEM: 'red', EXTENSIBLE: 'amber', USER: 'green' };

export default async function Lookups({ searchParams }: { searchParams: SP }) {
  await requirePriv('CD_LOOKUP_PRV');
  const sp = await searchParams;
  const q = s(sp.q), mod = s(sp.module);
  const modules = await sql`select distinct module_code from lookup_type order by 1`;
  const rows = await sql`
    select t.*, (select count(*) from lookup_value v where v.lookup_type = t.lookup_type)::int n
    from lookup_type t
    where (${q}::text is null or t.lookup_type ilike ${'%' + (q ?? '') + '%'} or t.meaning ilike ${'%' + (q ?? '') + '%'})
      and (${mod}::text is null or t.module_code = ${mod})
    order by t.module_code, t.meaning`;
  return (
    <div>
      <PageHeader title="Lookups" subtitle="Every list of values in the application (including Yes/No) is a lookup. SYSTEM: values fixed · EXTENSIBLE: you can add values · USER: fully editable." />
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <form className="mb-3 flex flex-wrap gap-2">
            <input name="q" defaultValue={q ?? ''} placeholder="Search" className="input max-w-xs" />
            <select name="module" defaultValue={mod ?? ''} className="input max-w-[12rem]">
              <option value="">All modules</option>
              {modules.map((m) => <option key={m.module_code}>{m.module_code}</option>)}
            </select>
            <AutoSubmit /><button className="btn">Filter</button>
          </form>
          <table className="tbl">
            <thead><tr><th>Lookup Type</th><th>Meaning</th><th>Module</th><th>Access</th><th>Values</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.lookup_type}>
                <td><Link className="link font-mono text-xs" href={`/config/lookups/${r.lookup_type}`}>{r.lookup_type}</Link></td>
                <td>{r.meaning}{r.parent_lookup_type && <span className="muted"> (depends on {r.parent_lookup_type})</span>}</td>
                <td>{r.module_code}</td>
                <td><Badge color={ACCESS_COLOR[r.access_level]}>{r.access_level}</Badge></td>
                <td>{r.n}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
        <form action={createLookupType} className="card h-fit space-y-3">
          <Back to="/config/lookups" />
          <h2 className="h2">New Lookup Type</h2>
          <Field label="Lookup Type Code *"><input name="lookup_type" className="input uppercase" required placeholder="e.g. TSHIRT_SIZE" /></Field>
          <Field label="Meaning *"><input name="meaning" className="input" required /></Field>
          <Field label="Module"><select name="module_code" className="input">{['COMMON', 'GEOGRAPHY', 'ACADEMIC', 'WORKFORCE', 'ATTENDANCE', 'FEES', 'EXAMS', 'EVENTS', 'INVENTORY', 'FINANCE'].map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Parent Lookup (for dependent lists)">
            <select name="parent_lookup_type" className="input"><option value="">None</option>{rows.map((r) => <option key={r.lookup_type} value={r.lookup_type}>{r.meaning}</option>)}</select>
          </Field>
          <Field label="Description"><textarea name="description" className="input" rows={2} /></Field>
          <button className="btn btn-primary">Create</button>
        </form>
      </div>
    </div>
  );
}
