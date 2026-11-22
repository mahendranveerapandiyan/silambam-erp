import { requirePriv, can } from '@/lib/auth';
import { EditableForm } from '@/components/EditMode';
import { sql } from '@/lib/db';
import { getAsOf } from '@/lib/asof';
import { lk, lookupOptions } from '@/lib/lookups';
import { formatNumber, counterStates } from '@/lib/numbering';
import { PageHeader, Flash, Field, Select, Back, type SP } from '@/components/ui';
import { saveNumberRule, setNextNumber } from '../actions';

export default async function Numbering({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_NUMBERING_PRV');
  const write = can(u, 'CD_NUMBERING_PRV', 'WRITE');
  const asOf = await getAsOf();
  const year = asOf.slice(0, 4);
  const rules = await sql`select * from number_rule where enterprise_id = ${u.enterpriseId} order by id`;
  const [methods, scopes, yn, L] = [await lookupOptions('NUMBER_METHOD', asOf), await lookupOptions('NUMBER_SCOPE', asOf), await lookupOptions('YES_NO', asOf), await lk()];

  const allCounters = await Promise.all(rules.map((r) => counterStates(sql, u.enterpriseId, r, year)));

  return (
    <div className="max-w-6xl">
      <PageHeader title="Number Generation" subtitle="How person, student, staff and receipt numbers are generated: automatic or manual, at Enterprise, Legal Employer or Business Unit level, with prefix, suffix, year and yearly reset." />
      <Flash sp={await searchParams} />
      <div className="space-y-6">
        {rules.map((r, i) => {
          const cs = allCounters[i];
          const y = (p: string) => (p === 'ALL' ? year : p);
          return (
            <div key={r.id} className="space-y-3">
              <EditableForm action={saveNumberRule.bind(null, r.id)} canEdit={write}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="h2 mb-0">{L('NUMBER_OBJECT', r.object_code)}</h2>
                  <div className="text-sm">Next: <code className="rounded bg-sky-50 px-2 py-0.5 font-semibold text-sky-800">{r.method_code === 'MANUAL' ? 'typed by the user' : formatNumber(r, cs[0]?.next ?? r.start_number, cs[0]?.scopeCode ?? null, y(cs[0]?.period ?? 'ALL'))}</code></div>
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
                    <thead><tr><th>{r.scope_code === 'BU' ? 'Business Unit' : r.scope_code === 'LE' ? 'Legal Employer' : 'Level'}</th>{r.reset_yearly_flag === 'Y' && <th>Year</th>}<th>Highest in Use</th><th>Next Number</th>{write && <th>Continue From</th>}</tr></thead>
                    <tbody>{cs.map((c) => (
                      <tr key={`${c.scopeId}|${c.period}`}>
                        <td>{c.name}{c.scopeCode && <span className="text-xs text-slate-400"> ({c.scopeCode})</span>}</td>
                        {r.reset_yearly_flag === 'Y' && <td>{c.period}</td>}
                        <td className="font-mono text-xs">{c.highest ? formatNumber(r, c.highest, c.scopeCode, y(c.period)) : '—'}</td>
                        <td className="font-mono text-xs font-semibold">{formatNumber(r, c.next, c.scopeCode, y(c.period))}</td>
                        {write && (
                          <td>
                            <form action={setNextNumber.bind(null, r.id, c.scopeId, c.period)} className="flex gap-1">
                              <Back to="/config/numbering" />
                              <input name="next_number" type="number" min={1} defaultValue={c.min ?? r.start_number} className="input w-24" />
                              <button className="btn btn-sm">Set</button>
                            </form>
                          </td>
                        )}
                      </tr>
                    ))}</tbody>
                  </table>
                  <p className="muted mt-2">The next number is the highest number in use + 1 (never below “Continue From”). Deleting the newest record gives its number back; deleting an older one leaves a gap. Changing the prefix, level or year format starts the new format from its Start Number.</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
