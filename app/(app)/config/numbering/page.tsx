import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { EditableForm, EditScope } from '@/components/EditMode';
import { sql } from '@/lib/db';
import { getAsOf } from '@/lib/asof';
import { lk, lookupOptions } from '@/lib/lookups';
import { formatNumber } from '@/lib/numbering';
import { PageHeader, Flash, Field, Select, type SP } from '@/components/ui';
import { saveNumberRule } from '../actions';

export default async function Numbering({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_NUMBERING_PRV');
  const write = can(u, 'CD_NUMBERING_PRV', 'WRITE');
  const asOf = await getAsOf();
  const rules = await sql`select r.*, (select max(last_value) from number_sequence s where s.rule_id = r.id) last_used from number_rule r where enterprise_id = ${u.enterpriseId} order by id`;
  const [methods, scopes, yn, L] = [await lookupOptions('NUMBER_METHOD', asOf), await lookupOptions('NUMBER_SCOPE', asOf), await lookupOptions('YES_NO', asOf), await lk()];
  return (
    <div className="max-w-6xl">
      <PageHeader title="Number Generation" subtitle="How person, student, staff and receipt numbers are generated. Automatic numbers can run at Enterprise, Legal Employer or Business Unit level, with prefix, suffix, year and yearly reset." />
      <Flash sp={await searchParams} />
      <div className="space-y-4">
        {rules.map((r) => (
          <EditableForm key={r.id} action={saveNumberRule.bind(null, r.id)} canEdit={write}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="h2 mb-0">{L('NUMBER_OBJECT', r.object_code)}</h2>
              <div className="text-sm">Example: <code className="rounded bg-black/5 px-2 py-0.5 font-semibold">{r.method_code === 'MANUAL' ? 'entered by user' : formatNumber(r, Number(r.last_used ?? r.start_number - 1) + 1, r.scope_code === 'BU' ? 'BR1' : 'LE1', asOf.slice(0, 4))}</code></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Method"><Select name="method_code" options={methods} value={r.method_code} empty={false} /></Field>
              <Field label="Generated at Level"><Select name="scope_code" options={scopes} value={r.scope_code} empty={false} /></Field>
              <Field label="Prefix"><input name="prefix" defaultValue={r.prefix ?? ''} className="input" /></Field>
              <Field label="Suffix"><input name="suffix" defaultValue={r.suffix ?? ''} className="input" /></Field>
              <Field label="Separator"><input name="separator" defaultValue={r.separator} maxLength={3} className="input" /></Field>
              <Field label="Digits (padding)"><input name="padding" type="number" min={1} max={12} defaultValue={r.padding} className="input" /></Field>
              <Field label="Start Number"><input name="start_number" type="number" min={0} defaultValue={r.start_number} className="input" /></Field>
              <Field label="Include LE/BU Code"><Select name="include_scope_code_flag" options={yn} value={r.include_scope_code_flag} empty={false} /></Field>
              <Field label="Include Year"><Select name="include_year_flag" options={yn} value={r.include_year_flag} empty={false} /></Field>
              <Field label="Reset Every Year"><Select name="reset_yearly_flag" options={yn} value={r.reset_yearly_flag} empty={false} /></Field>
              <div className="muted flex items-end">Last used: {r.last_used ?? '—'}</div>
            </div>
          </EditableForm>
        ))}
      </div>
    </div>
  );
}
