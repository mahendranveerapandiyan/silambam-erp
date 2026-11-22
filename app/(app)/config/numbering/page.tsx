import { requirePriv, can } from '@/lib/auth';
import { EditableForm } from '@/components/EditMode';
import { sql, type Row } from '@/lib/db';
import { getAsOf } from '@/lib/asof';
import { lk, lookupOptions } from '@/lib/lookups';
import { formatNumber } from '@/lib/numbering';
import { PageHeader, Flash, Field, Select, Back, type SP } from '@/components/ui';
import { saveNumberRule, setNextNumber } from '../actions';

export default async function Numbering({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_NUMBERING_PRV');
  const write = can(u, 'CD_NUMBERING_PRV', 'WRITE');
  const asOf = await getAsOf();
  const year = asOf.slice(0, 4);
  const rules = await sql`select * from number_rule where enterprise_id = ${u.enterpriseId} order by id`;
  const seqs = await sql`select s.* from number_sequence s join number_rule r on r.id = s.rule_id where r.enterprise_id = ${u.enterpriseId}`;
  const bus = await sql`select b.id, b.code, (select name from business_unit_f f where f.id = b.id order by effective_start_date desc limit 1) name from business_unit b where enterprise_id = ${u.enterpriseId} order by b.code`;
  const les = await sql`select b.id, b.code, (select name from legal_employer_f f where f.id = b.id order by effective_start_date desc limit 1) name from legal_employer b where enterprise_id = ${u.enterpriseId} order by b.code`;
  const [methods, scopes, yn, L] = [await lookupOptions('NUMBER_METHOD', asOf), await lookupOptions('NUMBER_SCOPE', asOf), await lookupOptions('YES_NO', asOf), await lk()];

  /** Counters for a rule: one per Enterprise / LE / BU, per year when it resets yearly. */
  const counters = (r: Row) => {
    const targets = r.scope_code === 'BU' ? bus.map((b) => ({ id: String(b.id), code: b.code, name: b.name }))
      : r.scope_code === 'LE' ? les.map((l) => ({ id: String(l.id), code: l.code, name: l.name }))
      : [{ id: '0', code: null as string | null, name: 'Whole enterprise' }];
    const out: { id: string; code: string | null; name: string; period: string; last: number | null; next: number }[] = [];
    for (const t of targets) {
      const mine = seqs.filter((s) => String(s.rule_id) === String(r.id) && String(s.scope_id) === t.id);
      const periods = r.reset_yearly_flag === 'Y' ? [...new Set([...mine.map((s) => s.period as string), year])].sort() : ['ALL'];
      for (const p of periods) {
        const s = mine.find((x) => x.period === p);
        out.push({ ...t, period: p, last: s ? Number(s.last_value) : null, next: s ? Number(s.last_value) + 1 : Number(r.start_number) });
      }
    }
    return out;
  };

  return (
    <div className="max-w-6xl">
      <PageHeader title="Number Generation" subtitle="How person, student, staff and receipt numbers are generated: automatic or manual, at Enterprise, Legal Employer or Business Unit level, with prefix, suffix, year and yearly reset." />
      <Flash sp={await searchParams} />
      <div className="space-y-6">
        {rules.map((r) => {
          const cs = counters(r);
          const y = (p: string) => (p === 'ALL' ? year : p);
          return (
            <div key={r.id} className="space-y-3">
              <EditableForm action={saveNumberRule.bind(null, r.id)} canEdit={write}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="h2 mb-0">{L('NUMBER_OBJECT', r.object_code)}</h2>
                  <div className="text-sm">Next: <code className="rounded bg-sky-50 px-2 py-0.5 font-semibold text-sky-800">{r.method_code === 'MANUAL' ? 'typed by the user' : formatNumber(r, cs[0]?.next ?? r.start_number, cs[0]?.code ?? null, y(cs[0]?.period ?? 'ALL'))}</code></div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <Field label="Method"><Select name="method_code" options={methods} value={r.method_code} empty={false} /></Field>
                  <Field label="Generated at Level"><Select name="scope_code" options={scopes} value={r.scope_code} empty={false} /></Field>
                  <Field label="Prefix"><input name="prefix" defaultValue={r.prefix ?? ''} className="input" /></Field>
                  <Field label="Suffix"><input name="suffix" defaultValue={r.suffix ?? ''} className="input" /></Field>
                  <Field label="Separator"><input name="separator" defaultValue={r.separator} maxLength={3} className="input" /></Field>
                  <Field label="Digits (padding)"><input name="padding" type="number" min={1} max={12} defaultValue={r.padding} className="input" /></Field>
                  <Field label="Start Number" help="First number of a new counter"><input name="start_number" type="number" min={0} defaultValue={r.start_number} className="input" /></Field>
                  <Field label="Include LE/BU Code" help="Required for LE / BU level"><Select name="include_scope_code_flag" options={yn} value={r.include_scope_code_flag} empty={false} /></Field>
                  <Field label="Include Year"><Select name="include_year_flag" options={yn} value={r.include_year_flag} empty={false} /></Field>
                  <Field label="Reset Every Year" help="Needs Include Year"><Select name="reset_yearly_flag" options={yn} value={r.reset_yearly_flag} empty={false} /></Field>
                </div>
              </EditableForm>
              {r.method_code === 'AUTO' && (
                <div className="card">
                  <h3 className="mb-2 text-sm font-semibold">Counters</h3>
                  <table className="tbl">
                    <thead><tr><th>{r.scope_code === 'BU' ? 'Business Unit' : r.scope_code === 'LE' ? 'Legal Employer' : 'Level'}</th>{r.reset_yearly_flag === 'Y' && <th>Year</th>}<th>Last Issued</th><th>Next Number</th>{write && <th>Set Next Number</th>}</tr></thead>
                    <tbody>{cs.map((c) => (
                      <tr key={`${c.id}|${c.period}`}>
                        <td>{c.name}{c.code && <span className="text-xs text-slate-400"> ({c.code})</span>}</td>
                        {r.reset_yearly_flag === 'Y' && <td>{c.period}</td>}
                        <td className="font-mono text-xs">{c.last ? formatNumber(r, c.last, c.code, y(c.period)) : '—'}</td>
                        <td className="font-mono text-xs font-semibold">{formatNumber(r, c.next, c.code, y(c.period))}</td>
                        {write && (
                          <td>
                            <form action={setNextNumber.bind(null, r.id, c.id, c.period)} className="flex gap-1">
                              <Back to="/config/numbering" />
                              <input name="next_number" type="number" min={1} defaultValue={c.next} className="input w-24" />
                              <button className="btn btn-sm">Set</button>
                            </form>
                          </td>
                        )}
                      </tr>
                    ))}</tbody>
                  </table>
                  <p className="muted mt-2">Numbers already used are skipped automatically. Deleting the newest record gives its number back.</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
