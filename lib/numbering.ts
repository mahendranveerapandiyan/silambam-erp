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

const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regular expression matching numbers of this rule for one Enterprise / LE / BU.
 * The year is matched literally when numbering restarts every year; otherwise
 * any year is accepted (the count continues across years). The last group is
 * always the running number.
 */
function numberPattern(rule: Row, scopeCode: string | null, year: string | null) {
  const parts: string[] = [];
  if (rule.prefix) parts.push(esc(rule.prefix));
  if (rule.include_scope_code_flag === 'Y' && rule.scope_code !== 'ENTERPRISE' && scopeCode) parts.push(esc(scopeCode));
  if (rule.include_year_flag === 'Y') parts.push(year ? esc(year) : '(\\d{4})');
  parts.push('(\\d+)');
  if (rule.suffix) parts.push(esc(rule.suffix));
  return `^${parts.join(esc(rule.separator ?? ''))}$`;
}

/** The column holding the numbers of an object. */
function numberSource(tx: Tx, enterpriseId: string, objectCode: string) {
  return objectCode === 'PERSON' ? tx`select person_number n from person where enterprise_id = ${enterpriseId}`
    : objectCode === 'RECEIPT' ? tx`select receipt_number n from fee_payment where enterprise_id = ${enterpriseId}`
    : tx`select assignment_number n from assignment where enterprise_id = ${enterpriseId} and assignment_type = ${objectCode}`;
}

/**
 * Highest running number in use, per period ('ALL', or the year when the rule
 * restarts every year), for one Enterprise / LE / BU.
 */
async function highestInUse(tx: Tx, enterpriseId: string, objectCode: string, rule: Row, scopeCode: string | null) {
  const yearly = rule.reset_yearly_flag === 'Y' && rule.include_year_flag === 'Y';
  const re = numberPattern(rule, scopeCode, null);
  const rows = await tx`select m[1] g1, max(m[array_length(m, 1)]::numeric) hi
    from (select regexp_match(n, ${re}) m from (${numberSource(tx, enterpriseId, objectCode)}) src) x
    where m is not null group by ${yearly ? tx`m[1]` : tx`1`}`;
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = yearly ? String(r.g1) : 'ALL';
    out[k] = Math.max(out[k] ?? 0, Number(r.hi));
  }
  return out;
}

/**
 * Generates the next number for an object (PERSON, STUDENT, STAFF, RECEIPT):
 * the highest number in use for that Enterprise / LE / BU (and year, when it
 * restarts yearly) plus one, but never below the Start Number / the minimum set
 * with "Set Next Number". Deleting the newest record therefore gives its number
 * back, while deleting an older one leaves a gap. Returns null when MANUAL.
 */
export async function nextNumber(tx: Tx, enterpriseId: string, objectCode: string, ctx: NumberCtx): Promise<string | null> {
  const rule = await getRule(tx, enterpriseId, objectCode);
  if (!rule || rule.method_code === 'MANUAL') return null;
  const { scopeId, scopeCode, year, period } = await resolveScope(tx, rule, objectCode, ctx);
  // lock this counter so two people saved at the same moment get different numbers
  const [seq] = await tx`
    insert into number_sequence (rule_id, scope_id, period, last_value) values (${rule.id}, ${scopeId}, ${period}, 0)
    on conflict (rule_id, scope_id, period) do update set last_value = number_sequence.last_value
    returning last_value, next_min`;
  const used = (await highestInUse(tx, enterpriseId, objectCode, rule, scopeCode))[period] ?? 0;
  let n = Math.max(used + 1, Number(seq.next_min ?? rule.start_number), 1);
  for (let guard = 0; guard < 10000; guard++, n++) {
    const num = formatNumber(rule, n, scopeCode, year);
    if (await numberInUse(tx, enterpriseId, objectCode, num)) continue;
    await tx`update number_sequence set last_value = ${n} where rule_id = ${rule.id} and scope_id = ${scopeId} and period = ${period}`;
    return num;
  }
  throw new Error(`Could not find a free ${objectCode.toLowerCase()} number – check Configuration › Number Generation.`);
}

/** Is this number already held by a record? */
export async function numberInUse(tx: Tx, enterpriseId: string, objectCode: string, num: string) {
  const r =
    objectCode === 'PERSON' ? await tx`select 1 from person where enterprise_id = ${enterpriseId} and upper(person_number) = upper(${num})`
    : objectCode === 'RECEIPT' ? await tx`select 1 from fee_payment where enterprise_id = ${enterpriseId} and upper(receipt_number) = upper(${num})`
    : await tx`select 1 from assignment where enterprise_id = ${enterpriseId} and assignment_type = ${objectCode} and upper(assignment_number) = upper(${num})`;
  return r.length > 0;
}

export type CounterState = { scopeId: string; scopeCode: string | null; name: string; period: string; highest: number | null; min: number | null; next: number };

/**
 * One row per counter of a rule (Enterprise, or each LE / BU; per year when it
 * restarts yearly): highest number in use, the minimum set by the user and the
 * next number that will be issued. `year` is the year shown when no year has
 * numbers yet.
 */
export async function counterStates(tx: Tx, enterpriseId: string, rule: Row, year: string): Promise<CounterState[]> {
  const targets = rule.scope_code === 'ENTERPRISE'
    ? [{ id: '0', code: null as string | null, name: 'Whole enterprise' }]
    : (await tx`select b.id, b.code, (select name from ${tx(rule.scope_code === 'LE' ? 'legal_employer_f' : 'business_unit_f')} f where f.id = b.id order by effective_start_date desc limit 1) name
        from ${tx(rule.scope_code === 'LE' ? 'legal_employer' : 'business_unit')} b where b.enterprise_id = ${enterpriseId} order by b.code`)
      .map((b) => ({ id: String(b.id), code: b.code as string, name: b.name as string }));
  const seqs = await tx`select scope_id, period, next_min from number_sequence where rule_id = ${rule.id}`;
  const yearly = rule.reset_yearly_flag === 'Y' && rule.include_year_flag === 'Y';
  const out: CounterState[] = [];
  for (const t of targets) {
    const hi = await highestInUse(tx, enterpriseId, rule.object_code, rule, t.code);
    const mins = Object.fromEntries(seqs.filter((s) => String(s.scope_id) === t.id && s.next_min !== null).map((s) => [s.period, Number(s.next_min)]));
    const periods = yearly ? [...new Set([...Object.keys(hi), ...Object.keys(mins).filter((p) => p !== 'ALL'), year])].sort() : ['ALL'];
    for (const p of periods) {
      const highest = hi[p] ?? null;
      const min = mins[p] ?? null;
      out.push({ scopeId: t.id, scopeCode: t.code, name: t.name, period: p, highest, min, next: Math.max((highest ?? 0) + 1, min ?? Number(rule.start_number), 1) });
    }
  }
  return out;
}

export type NumberPreviews = {
  rule: { prefix: string | null; suffix: string | null; separator: string; padding: number; include_scope_code_flag: string; include_year_flag: string;
    reset_yearly_flag: string; scope_code: string; start_number: number };
  counters: Record<string, number>; // "<scopeId>|<period>" -> next number - 1
  scopeCodes: Record<string, string>; // scopeId -> code shown in the number
  buToScope: Record<string, string>; classToScope: Record<string, string>;
} | null;

/**
 * Everything the hire / admission page needs to show the number the new person
 * will get (formatted in the browser for the chosen branch and hire date).
 */
export async function numberPreviews(enterpriseId: string, kind: 'STUDENT' | 'STAFF', date: string): Promise<NumberPreviews> {
  const { sql } = await import('./db');
  const rule = await getRule(sql, enterpriseId, kind);
  if (!rule || rule.method_code === 'MANUAL') return null;
  // "<scopeId>|<period>" -> next number - 1 (the browser adds one)
  const counters = Object.fromEntries((await counterStates(sql, enterpriseId, rule, date.slice(0, 4))).map((c) => [`${c.scopeId}|${c.period}`, c.next - 1]));
  const bus = await sql`select b.id, b.code, f.legal_employer_id from business_unit b
    join lateral (select * from business_unit_f x where x.id = b.id order by (${date}::date between x.effective_start_date and x.effective_end_date) desc, x.effective_start_date desc limit 1) f on true
    where b.enterprise_id = ${enterpriseId}`;
  const les = await sql`select id, code from legal_employer where enterprise_id = ${enterpriseId}`;
  const scopeCodes: Record<string, string> = {};
  const buToScope: Record<string, string> = {};
  if (rule.scope_code === 'BU') for (const b of bus) { scopeCodes[String(b.id)] = b.code; buToScope[String(b.id)] = String(b.id); }
  else if (rule.scope_code === 'LE') { for (const l of les) scopeCodes[String(l.id)] = l.code; for (const b of bus) buToScope[String(b.id)] = String(b.legal_employer_id); }
  else for (const b of bus) buToScope[String(b.id)] = '0';
  const classes = await sql`select c.id, f.business_unit_id from class c
    join lateral (select * from class_f x where x.id = c.id order by (${date}::date between x.effective_start_date and x.effective_end_date) desc, x.effective_start_date desc limit 1) f on true
    where c.enterprise_id = ${enterpriseId}`;
  const classToScope = Object.fromEntries(classes.map((c) => [String(c.id), buToScope[String(c.business_unit_id)]]));
  return {
    rule: { prefix: rule.prefix, suffix: rule.suffix, separator: rule.separator ?? '', padding: Number(rule.padding), include_scope_code_flag: rule.include_scope_code_flag,
      include_year_flag: rule.include_year_flag, reset_yearly_flag: rule.reset_yearly_flag, scope_code: rule.scope_code, start_number: Number(rule.start_number) },
    counters, scopeCodes, buToScope, classToScope,
  };
}
