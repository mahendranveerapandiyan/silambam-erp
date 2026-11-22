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
/** Which counter (Enterprise / LE / BU) a number belongs to, and the code shown in it. */
async function resolveScope(tx: Tx, rule: Row, objectCode: string, ctx: NumberCtx) {
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
  return { scopeId: String(scopeId), scopeCode, year, period: rule.reset_yearly_flag === 'Y' ? year : 'ALL' };
}

export async function nextNumber(tx: Tx, enterpriseId: string, objectCode: string, ctx: NumberCtx): Promise<string | null> {
  const rule = await getRule(tx, enterpriseId, objectCode);
  if (!rule || rule.method_code === 'MANUAL') return null;
  const { scopeId, scopeCode, year, period } = await resolveScope(tx, rule, objectCode, ctx);
  const [seq] = await tx`
    insert into number_sequence (rule_id, scope_id, period, last_value) values (${rule.id}, ${scopeId}, ${period}, ${rule.start_number})
    on conflict (rule_id, scope_id, period) do update set last_value = number_sequence.last_value + 1
    returning last_value`;
  return formatNumber(rule, seq.last_value, scopeCode, year);
}

/**
 * Called after a record holding an auto-generated number is deleted. If it
 * held the newest number of its counter, the counter steps back so that number
 * is issued again – and keeps stepping back over any other unused numbers at
 * the top. Numbers in the middle (with newer ones still in use) are not reused.
 * `inUse(n)` tells whether a number is still held by another record.
 */
export async function releaseNumber(tx: Tx, enterpriseId: string, objectCode: string, ctx: NumberCtx, deleted: string, inUse: (n: string) => Promise<boolean>) {
  const rule = await getRule(tx, enterpriseId, objectCode);
  if (!rule || rule.method_code === 'MANUAL') return;
  const { scopeId, scopeCode, year, period } = await resolveScope(tx, rule, objectCode, ctx);
  const [seq] = await tx`select last_value from number_sequence where rule_id = ${rule.id} and scope_id = ${scopeId} and period = ${period} for update`;
  if (!seq) return;
  let last = Number(seq.last_value);
  if (formatNumber(rule, last, scopeCode, year) !== deleted) return; // not the newest number: leave the gap
  const floor = Number(rule.start_number) - 1;
  last--;
  while (last > floor && !(await inUse(formatNumber(rule, last, scopeCode, year)))) last--;
  await tx`update number_sequence set last_value = ${last} where rule_id = ${rule.id} and scope_id = ${scopeId} and period = ${period}`;
}

export type NumberPreviews = { single: string | null; byScope: Record<string, string>; classToScope: Record<string, string>; buToScope: Record<string, string> } | null;

/**
 * The number the next student / staff member would get, without using it up.
 * For branch- or LE-level rules it is worked out per branch / LE; the form
 * picks the right one from the selected branch or class.
 */
export async function numberPreviews(enterpriseId: string, kind: 'STUDENT' | 'STAFF', date: string): Promise<NumberPreviews> {
  const { sql } = await import('./db');
  const rule = await getRule(sql, enterpriseId, kind);
  if (!rule || rule.method_code === 'MANUAL') return null;
  const year = date.slice(0, 4);
  const period = rule.reset_yearly_flag === 'Y' ? year : 'ALL';
  const next = async (scopeId: string, scopeCode: string | null) => {
    const [s] = await sql`select last_value from number_sequence where rule_id = ${rule.id} and scope_id = ${scopeId} and period = ${period}`;
    return formatNumber(rule, s ? Number(s.last_value) + 1 : Number(rule.start_number), scopeCode, year);
  };
  const out = { single: null as string | null, byScope: {} as Record<string, string>, classToScope: {} as Record<string, string>, buToScope: {} as Record<string, string> };
  if (rule.scope_code === 'ENTERPRISE') {
    out.single = await next('0', null);
    return out;
  }
  const bus = await sql`select b.id, b.code, f.legal_employer_id from business_unit b
    join lateral (select * from business_unit_f x where x.id = b.id order by (${date}::date between x.effective_start_date and x.effective_end_date) desc, x.effective_start_date desc limit 1) f on true
    where b.enterprise_id = ${enterpriseId}`;
  if (rule.scope_code === 'BU') {
    for (const b of bus) { out.byScope[String(b.id)] = await next(String(b.id), b.code); out.buToScope[String(b.id)] = String(b.id); }
  } else {
    const les = await sql`select id, code from legal_employer where enterprise_id = ${enterpriseId}`;
    for (const l of les) out.byScope[String(l.id)] = await next(String(l.id), l.code);
    for (const b of bus) out.buToScope[String(b.id)] = String(b.legal_employer_id);
  }
  const classes = await sql`select c.id, f.business_unit_id from class c
    join lateral (select * from class_f x where x.id = c.id order by (${date}::date between x.effective_start_date and x.effective_end_date) desc, x.effective_start_date desc limit 1) f on true
    where c.enterprise_id = ${enterpriseId}`;
  for (const c of classes) out.classToScope[String(c.id)] = out.buToScope[String(c.business_unit_id)];
  return out;
}
