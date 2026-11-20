import 'server-only';
import type { Tx, Row } from './db';

export type NumberCtx = { leId?: string | null; buId?: string | null; date: string };

export function formatNumber(rule: Row, n: number | string, scopeCode: string | null, year: string) {
  const parts = [
    rule.prefix,
    rule.include_scope_code_flag === 'Y' && rule.scope_code !== 'ENTERPRISE' ? scopeCode : null,
    rule.include_year_flag === 'Y' ? year : null,
    String(n).padStart(Number(rule.padding) || 1, '0'),
    rule.suffix,
  ].filter((p) => p !== null && p !== undefined && p !== '');
  return parts.join(rule.separator ?? '');
}

export async function getRule(tx: Tx, enterpriseId: string, objectCode: string) {
  const [rule] = await tx`select * from number_rule where enterprise_id = ${enterpriseId} and object_code = ${objectCode} and active_flag = 'Y'`;
  return rule as Row | undefined;
}

/** True when users must type the number themselves. */
export async function isManual(tx: Tx, enterpriseId: string, objectCode: string) {
  const r = await getRule(tx, enterpriseId, objectCode);
  return !r || r.method_code === 'MANUAL';
}

/**
 * Generates the next number for an object (PERSON, STUDENT, STAFF, RECEIPT)
 * honouring the configured level (Enterprise / LE / BU), prefix, suffix,
 * year and yearly reset. Returns null when the rule is MANUAL.
 */
export async function nextNumber(tx: Tx, enterpriseId: string, objectCode: string, ctx: NumberCtx): Promise<string | null> {
  const rule = await getRule(tx, enterpriseId, objectCode);
  if (!rule || rule.method_code === 'MANUAL') return null;
  let scopeId = '0';
  let scopeCode: string | null = null;
  if (rule.scope_code === 'LE' || rule.scope_code === 'BU') {
    let leId = ctx.leId;
    if (rule.scope_code === 'LE' && !leId && ctx.buId) {
      const [b] = await tx`select legal_employer_id from business_unit_f where id = ${ctx.buId} and ${ctx.date}::date between effective_start_date and effective_end_date`;
      leId = b?.legal_employer_id;
    }
    scopeId = (rule.scope_code === 'LE' ? leId : ctx.buId) ?? '';
    if (!scopeId) throw new Error(`Numbering for ${objectCode} is set at ${rule.scope_code} level, but no ${rule.scope_code} was given.`);
    const [s] = await tx`select code from ${tx(rule.scope_code === 'LE' ? 'legal_employer' : 'business_unit')} where id = ${scopeId}`;
    scopeCode = s?.code ?? null;
  }
  const year = ctx.date.slice(0, 4);
  const period = rule.reset_yearly_flag === 'Y' ? year : 'ALL';
  const [seq] = await tx`
    insert into number_sequence (rule_id, scope_id, period, last_value) values (${rule.id}, ${scopeId}, ${period}, ${rule.start_number})
    on conflict (rule_id, scope_id, period) do update set last_value = number_sequence.last_value + 1
    returning last_value`;
  return formatNumber(rule, seq.last_value, scopeCode, year);
}
