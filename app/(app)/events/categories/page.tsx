import Link from 'next/link';
import { requirePriv, can } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { lookupOptions } from '@/lib/lookups';
import { CATEGORY_FIELDS, OPERATORS, studentFacts, ruleFails, ruleText, type Rule } from '@/lib/tournament';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP, s as one, here } from '@/components/ui';
import { ConfirmButton, ShowFor } from '@/components/client';
import { MultiPick } from '@/components/MultiPick';
import { EditableForm } from '@/components/EditMode';
import { saveCategory, deleteCategory, saveRule } from './actions';

/** Events › Competition Categories: who may enter, by rules on age, gender, weight and other student fields. */
export default async function Categories({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_GAME_SETUP_PRV');
  const write = can(u, 'CD_GAME_SETUP_PRV', 'WRITE');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const back = here('/events/categories', sp);
  // value names for code fields
  const options: Record<string, { value: string; label: string; code?: string | null }[]> = {};
  for (const f of CATEGORY_FIELDS) {
    if (f.lookup) options[f.code] = await lookupOptions(f.lookup, asOf);
    if (f.ref) options[f.code] = await refOptions(f.ref, u.enterpriseId, asOf);
  }
  const describe = (r: Rule) => ruleText(r, (f, v) => options[f]?.find((o) => o.value === v)?.label ?? v);
  const cats = await sql`select c.* from competition_category c where c.enterprise_id = ${u.enterpriseId} order by c.active_flag desc, c.name`;
  const rules = await sql`select r.* from competition_category_rule r join competition_category c on c.id = r.category_id where c.enterprise_id = ${u.enterpriseId} order by r.id`;
  const rulesOf = (id: string) => rules.filter((r) => String(r.category_id) === String(id)) as unknown as (Rule & { id: string })[];
  const cat = cats.find((c) => String(c.id) === one(sp.edit));
  const facts = await studentFacts(u.enterpriseId, asOf);
  const matching = (id: string) => facts.filter((s) => rulesOf(id).every((r) => !ruleFails(r, s.facts, describe)));

  return (
    <div className="max-w-6xl">
      <PageHeader title="Competition Categories" subtitle="Who may enter a competition – e.g. 'Girls – Age below 7' = Gender is Female and Age below 7. A student must meet every rule of the category." />
      <Flash sp={sp} />
      <div className="card mb-4 overflow-x-auto">
        <table className="tbl"><thead><tr><th>Category</th><th>Rules</th><th>Students matching today</th><th>Active</th><th></th></tr></thead>
          <tbody>{cats.map((c) => (
            <tr key={c.id} className={cat && cat.id === c.id ? 'bg-sky-50' : ''}>
              <td className="font-medium">{c.name}<div className="font-mono text-xs text-slate-500">{c.code}</div></td>
              <td className="text-sm">{rulesOf(c.id).map((r) => describe(r)).join(' and ') || <span className="text-slate-400">no rules – everyone</span>}</td>
              <td>{matching(c.id).length}</td>
              <td><Badge color={c.active_flag === 'Y' ? 'green' : 'gray'}>{c.active_flag === 'Y' ? 'Active' : 'Inactive'}</Badge></td>
              <td><Link className="btn btn-sm" href={`/events/categories?edit=${c.id}`}>{write ? 'Open / Edit' : 'View'}</Link></td>
            </tr>))}</tbody></table>
        {!cats.length && <Empty>No categories yet.</Empty>}
      </div>

      {cat ? <Category /> : write && (
        <>
          <h2 className="h2">New Category</h2>
          <form action={saveCategory.bind(null, null)} className="card grid gap-3 sm:grid-cols-3">
            <Back to="/events/categories" />
            <Field label="Name *"><input name="name" required className="input" placeholder="e.g. Girls – Age below 7" /></Field>
            <Field label="Description"><input name="description" className="input" /></Field>
            <div className="flex items-end"><button className="btn btn-primary">Create Category</button></div>
          </form>
        </>
      )}
    </div>
  );

  function Category() {
    const list = rulesOf(cat!.id);
    const field = CATEGORY_FIELDS.find((f) => f.code === one(sp.field)) ?? null;
    const ops = field?.kind === 'code' ? OPERATORS.filter(([k]) => ['EQ', 'NE', 'IN'].includes(k)).map(([k, l]) => [k, l.replace(/^[=≠] /, '')]) : OPERATORS.filter(([k]) => k !== 'IN');
    const m = matching(cat!.id);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="h2 mb-0">{cat!.name}</h2><Link href="/events/categories" className="btn btn-sm">Close</Link></div>
        <EditableForm action={saveCategory.bind(null, cat!.id)} canEdit={write}>
          <Back to={back} />
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Name *"><input name="name" defaultValue={cat!.name} required className="input" /></Field>
            <Field label="Code"><input name="code" defaultValue={cat!.code} className="input" /></Field>
            <Field label="Active"><select name="active_flag" defaultValue={cat!.active_flag} className="input"><option value="Y">Yes</option><option value="N">No</option></select></Field>
            <Field label="Description"><input name="description" defaultValue={cat!.description ?? ''} className="input" /></Field>
          </div>
        </EditableForm>
        <div className="card space-y-2">
          <h3 className="font-semibold">Rules <span className="text-sm font-normal text-slate-500">– a student must meet all of them</span></h3>
          {list.map((r) => (
            <form key={r.id} action={saveRule.bind(null, cat!.id, r.id)} className="flex items-center justify-between rounded border px-3 py-2">
              <Back to={back} /><span>{describe(r)}</span>
              {write && <ConfirmButton className="btn btn-sm" name="_delete" value="1" message={`Remove the rule “${describe(r)}”?`}>✕</ConfirmButton>}
            </form>))}
          {!list.length && <p className="muted">No rules yet – every active student would qualify.</p>}
          {write && (
            <div className="rounded border border-green-200 bg-green-50/50 p-3">
              <form className="mb-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="edit" value={cat!.id} />
                <Field label="Add a rule on"><select name="field" defaultValue={field?.code ?? ''} className="input"><option value="">— Choose a field —</option>{CATEGORY_FIELDS.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}</select></Field>
                <button className="btn btn-sm">Choose</button>
              </form>
              {field && (
                <form action={saveRule.bind(null, cat!.id, null)} className="flex flex-wrap items-end gap-2">
                  <Back to={here('/events/categories', { edit: String(cat!.id) })} /><input type="hidden" name="field_code" value={field.code} />
                  <span className="pb-2 font-medium">{field.label}</span>
                  <Field label="Condition"><select name="operator" className="input">{ops.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{field.kind === 'number' && <ShowFor select="operator" />}</Field>
                  {field.kind === 'number'
                    ? <>
                      <div data-show-for-operator="EQ,NE,LT,LE,GT,GE"><Field label="Value"><input name="value" type="number" step="0.01" required className="input w-32" placeholder={field.code === 'AGE' ? 'e.g. 7' : ''} /></Field></div>
                      <div data-show-for-operator="BETWEEN" className="flex items-end gap-2">
                        <Field label="From"><input name="value_from" type="number" step="0.01" required className="input w-28" placeholder={field.code === 'AGE' ? 'e.g. 7' : ''} /></Field>
                        <span className="pb-2">and</span>
                        <Field label="To"><input name="value_to" type="number" step="0.01" required className="input w-28" placeholder={field.code === 'AGE' ? 'e.g. 10' : ''} /></Field>
                      </div>
                    </>
                    : <>
                      <Field label="Value (is / is not)"><Select name="value" options={options[field.code] ?? []} /></Field>
                      <Field label="…or several (is one of)"><MultiPick name="value_multi" options={options[field.code] ?? []} emptyText="None" /></Field>
                    </>}
                  <button className="btn btn-primary btn-sm">Add Rule</button>
                </form>)}
            </div>)}
        </div>
        <div className="card">
          <h3 className="mb-2 font-semibold">Students matching today ({m.length})</h3>
          <div className="flex flex-wrap gap-1 text-sm">{m.slice(0, 60).map((s) => <Badge key={s.row.person_id} color="gray">{s.row.full_name} <span className="text-xs text-slate-500">{s.row.assignment_number}</span></Badge>)}{m.length > 60 && <span className="muted">…and {m.length - 60} more</span>}</div>
          {!m.length && <p className="muted">No active student matches these rules.</p>}
        </div>
        {write && <form action={deleteCategory.bind(null, cat!.id)}><Back to={back} /><ConfirmButton className="btn btn-danger" message={`Delete the ${cat!.name} category?`}>Delete Category</ConfirmButton></form>}
      </div>
    );
  }
}
