import 'server-only';
import { sql, type Row } from './db';
import { ageOn } from './util';

export const FLOW_KINDS: [string, string, string][] = [
  ['INDIVIDUAL', 'Individual Based', 'Each participant is evaluated on a template (sections and criteria). The highest mark wins.'],
  ['FIGHT', 'Fight Based (knockout)', 'Two participants per bout. Regular rounds are added up; tied bouts get extra rounds, then a final round or a toss. The loser is eliminated.'],
  ['INDIVIDUAL_FIGHT', 'Individual and Fight Based', 'Individual evaluation first (no winner announced). The individual marks are carried into each fight bout as the Individual Mark.'],
];
export const flowKindLabel = (k: string) => FLOW_KINDS.find((x) => x[0] === k)?.[1] ?? k;
export const hasIndividual = (k: string) => k === 'INDIVIDUAL' || k === 'INDIVIDUAL_FIGHT';
export const hasFight = (k: string) => k === 'FIGHT' || k === 'INDIVIDUAL_FIGHT';

/* ---------------- competition categories ---------------- */

/** Student fields a category rule can test. kind: number = compared as numbers; code = lookup / reference compared as codes or ids. */
export const CATEGORY_FIELDS: { code: string; label: string; kind: 'number' | 'code'; lookup?: string; ref?: string }[] = [
  { code: 'AGE', label: 'Age (years, on the tournament date)', kind: 'number' },
  { code: 'GENDER', label: 'Gender', kind: 'code', lookup: 'GENDER' },
  { code: 'WEIGHT', label: 'Weight (kg)', kind: 'number' },
  { code: 'HEIGHT', label: 'Height (cm)', kind: 'number' },
  { code: 'COMPETITION_CATEGORY', label: 'Competition Category (Open / School)', kind: 'code', lookup: 'COMPETITION_CATEGORY' },
  { code: 'GRADE', label: 'Grade / Level', kind: 'code', ref: 'student-grades' },
  { code: 'CLASS', label: 'Class', kind: 'code', ref: 'classes' },
  { code: 'BRANCH', label: 'Branch', kind: 'code', ref: 'branches' },
  { code: 'BUSINESS_UNIT', label: 'Business Unit', kind: 'code', ref: 'business-units' },
  { code: 'HOUSE', label: 'House', kind: 'code', ref: 'houses' },
  { code: 'CLUB', label: 'Club', kind: 'code', ref: 'clubs' },
  { code: 'BLOOD_GROUP', label: 'Blood Group', kind: 'code', lookup: 'BLOOD_GROUP' },
  { code: 'STATE', label: 'State', kind: 'code', lookup: 'STATE' },
];
export const OPERATORS: [string, string][] = [['EQ', '= is'], ['NE', '≠ is not'], ['LT', '< below'], ['LE', '<= up to'], ['GT', '> above'], ['GE', '>= at least'], ['BETWEEN', 'between (both included)'], ['IN', 'is one of']];
/** Words used when a rule is read out, e.g. "Age >= 7", "Age between 7 and 10". */
const OP_TEXT: Record<string, string> = { EQ: 'is', NE: 'is not', LT: '<', LE: '<=', GT: '>', GE: '>=', BETWEEN: 'between', IN: 'is one of' };
/** "Age between 7 and 10", "Gender is Female" – nameOf turns codes into names. */
export function ruleText(r: Rule, nameOf: (field: string, v: string) => string = (_f, v) => v) {
  const label = CATEGORY_FIELDS.find((f) => f.code === r.field_code)?.label.replace(/ \(.*/, '') ?? r.field_code;
  const vals = r.value.split(',').map((v) => nameOf(r.field_code, v.trim()));
  return r.operator === 'BETWEEN' ? `${label} between ${vals[0]} and ${vals[1]}` : `${label} ${OP_TEXT[r.operator] ?? r.operator} ${vals.join(', ')}`;
}

export type Facts = Record<string, string | number | null>;

/** The facts category rules test, for students on a date. */
export async function studentFacts(enterpriseId: string, date: string, personIds?: string[]) {
  const rows = await sql`
    select a.person_id, a.id assignment_id, a.assignment_number, p.date_of_birth, pf.gender_code, pf.weight_kg, pf.height_cm, pf.blood_group_code, pf.state_code,
      af.competition_category_code, af.student_grade_id, af.class_id, af.section_id, af.branch_id, af.business_unit_id, af.house_id, af.club_id,
      trim(concat_ws(' ', pf.first_name, pf.last_name)) full_name
    from assignment a
    join assignment_f af on af.id = a.id and ${date}::date between af.effective_start_date and af.effective_end_date
    join assignment_status_f st on st.id = af.assignment_status_id and ${date}::date between st.effective_start_date and st.effective_end_date
    join person p on p.id = a.person_id
    left join lateral (select * from person_f x where x.id = a.person_id order by (${date}::date between x.effective_start_date and x.effective_end_date) desc, x.effective_start_date desc limit 1) pf on true
    where a.enterprise_id = ${enterpriseId} and a.assignment_type = 'STUDENT' and st.system_status_code = 'ACTIVE'
      ${personIds ? sql`and a.person_id in ${sql(personIds.length ? personIds : ['0'])}` : sql``}`;
  return rows.map((r) => ({
    row: r,
    facts: {
      AGE: r.date_of_birth ? ageOn(r.date_of_birth, date) : null, GENDER: r.gender_code, WEIGHT: r.weight_kg === null ? null : Number(r.weight_kg),
      HEIGHT: r.height_cm === null ? null : Number(r.height_cm), COMPETITION_CATEGORY: r.competition_category_code, GRADE: r.student_grade_id && String(r.student_grade_id),
      CLASS: r.class_id && String(r.class_id), BRANCH: r.branch_id && String(r.branch_id), BUSINESS_UNIT: r.business_unit_id && String(r.business_unit_id),
      HOUSE: r.house_id && String(r.house_id), CLUB: r.club_id && String(r.club_id), BLOOD_GROUP: r.blood_group_code, STATE: r.state_code,
    } as Facts,
  }));
}

export type Rule = { field_code: string; operator: string; value: string };

/** Null when the student matches the rule, else why not. */
export function ruleFails(rule: Rule, facts: Facts, describe: (r: Rule) => string, nameOf?: (field: string, v: string) => string): string | null {
  const f = CATEGORY_FIELDS.find((x) => x.code === rule.field_code);
  const v = facts[rule.field_code];
  if (v === null || v === undefined || v === '') return `${f?.label.replace(/ \(.*/, '') ?? rule.field_code} not recorded`;
  const vals = rule.value.split(',').map((x) => x.trim()).filter(Boolean);
  let ok: boolean;
  if (f?.kind === 'number') {
    const a = Number(v), b = Number(rule.value);
    ok = rule.operator === 'EQ' ? a === b : rule.operator === 'NE' ? a !== b : rule.operator === 'LT' ? a < b : rule.operator === 'LE' ? a <= b
      : rule.operator === 'GT' ? a > b : rule.operator === 'GE' ? a >= b : rule.operator === 'IN' ? vals.map(Number).includes(a)
      : rule.operator === 'BETWEEN' ? a >= Number(vals[0]) && a <= Number(vals[1]) : false;
  } else {
    ok = rule.operator === 'NE' ? !vals.includes(String(v)) : vals.includes(String(v));
  }
  return ok ? null : `${describe(rule)} (is ${nameOf ? nameOf(rule.field_code, String(v)) : v})`;
}

/** The rules of a category. */
export async function categoryRules(categoryId: string | null | undefined): Promise<Rule[]> {
  if (!categoryId) return [];
  return (await sql`select field_code, operator, value from competition_category_rule where category_id = ${categoryId} order by id`) as unknown as Rule[];
}

/* ---------------- knockout fixtures ---------------- */

/**
 * The entrant who gets the bye in a round with an odd number of entrants: in turn the last
 * entrant, then the first, then the middle one – skipping anyone who already had a bye.
 */
export function proposeBye<T extends { id: string }>(entrants: T[], byesSoFar: number, hadBye: Set<string>) {
  if (entrants.length % 2 === 0) return null;
  const n = entrants.length;
  const order = [n - 1, 0, Math.floor((n - 1) / 2)];
  const start = byesSoFar % 3;
  for (let k = 0; k < 3; k++) { const e = entrants[order[(start + k) % 3]]; if (!hadBye.has(e.id)) return e.id; }
  return entrants.find((e) => !hadBye.has(e.id))?.id ?? entrants[order[start]].id;
}

/** Pairs a round in list order (neighbours fight); the bye entrant keeps their place and goes straight through. */
export function pairRound<T extends { id: string }>(entrants: T[], byeId: string | null) {
  const bouts: { red: T; blue: T | null }[] = [];
  let pending: { red: T; blue: T | null } | null = null;
  for (const e of entrants) {
    if (e.id === byeId) { bouts.push({ red: e, blue: null }); continue; }
    if (!pending) { pending = { red: e, blue: null }; bouts.push(pending); } else { pending.blue = e; pending = null; }
  }
  return bouts;
}

export const STAGES: Record<string, string> = { ROUND: 'Round', SEMI_FINAL: 'Semi Final', THIRD_PLACE: 'Third Place', FINAL: 'Final' };

/** Bout totals: points of all rounds, less the negative marks, plus the individual mark (combined flow). */
export function boutTotals(rounds: Row[], _unused: number, redIndividual = 0, blueIndividual = 0) {
  let red = redIndividual, blue = blueIndividual;
  for (const r of rounds) {
    red += Number(r.red_points ?? 0) - Number(r.red_fouls ?? 0);
    blue += Number(r.blue_points ?? 0) - Number(r.blue_fouls ?? 0);
  }
  return { red: Math.round(red * 100) / 100, blue: Math.round(blue * 100) / 100 };
}

/* ---------------- bout state ---------------- */

export type FlowRules = { regular_rounds: number; extra_rounds: number; allow_final_round: string; allow_toss: string; foul_points: number };

/**
 * Where a bout stands: rounds to show, running totals and the winner when decided.
 * Regular rounds are added up; when tied, the extra rounds are played (all rounds count);
 * still tied: one final round (if allowed), then a toss (if allowed) or the referee decides.
 */
export function boutState(rounds: Row[], flow: FlowRules, redIndividual = 0, blueIndividual = 0) {
  const R = Number(flow.regular_rounds), X = Number(flow.extra_rounds);
  const done = (n: number) => rounds.filter((r) => Number(r.round_no) <= n && r.red_points !== null && r.blue_points !== null).length === n;
  const totalsUpTo = (n: number) => boutTotals(rounds.filter((r) => Number(r.round_no) <= n), Number(flow.foul_points), redIndividual, blueIndividual);
  let shown = R;
  const res = (winner: 'RED' | 'BLUE' | null, tie = false, extra: Partial<{ tossOpen: boolean; refereeOpen: boolean }> = {}, upto = shown) => {
    const t = totalsUpTo(upto);
    return { shown, totals: t, winner, tie, tossOpen: false, refereeOpen: false, ...extra };
  };
  if (!done(R)) return res(null);
  let t = totalsUpTo(R);
  if (t.red !== t.blue) return res(t.red > t.blue ? 'RED' : 'BLUE', false, {}, R);
  if (X > 0) {
    shown = R + X;
    if (!done(R + X)) return res(null, true);
    t = totalsUpTo(R + X);
    if (t.red !== t.blue) return res(t.red > t.blue ? 'RED' : 'BLUE', false, {}, R + X);
  }
  if (flow.allow_final_round === 'Y') {
    shown = R + X + 1;
    if (!done(R + X + 1)) return res(null, true, { tossOpen: flow.allow_toss === 'Y' });
    t = totalsUpTo(R + X + 1);
    if (t.red !== t.blue) return res(t.red > t.blue ? 'RED' : 'BLUE', false, {}, R + X + 1);
  }
  return res(null, true, { tossOpen: flow.allow_toss === 'Y', refereeOpen: flow.allow_toss !== 'Y' });
}

/** "Gender is Female", "Grade is one of Level 1, Level 2" – rule text with names instead of codes. */
export async function ruleDescriber(enterpriseId: string, asOf: string) {
  const { lookupOptions } = await import('./lookups');
  const { refOptions } = await import('./dt');
  const names: Record<string, Map<string, string>> = {};
  for (const f of CATEGORY_FIELDS) {
    const opts = f.lookup ? await lookupOptions(f.lookup, asOf) : f.ref ? await refOptions(f.ref, enterpriseId, asOf) : [];
    names[f.code] = new Map(opts.map((o) => [String(o.value), o.label]));
  }
  const nameOf = (field: string, v: string) => names[field]?.get(v) ?? v;
  const describe = (r: Rule) => ruleText(r, nameOf);
  return { describe, nameOf };
}

/* ---------------- performance time ---------------- */

/** "1:45" → 105 seconds; "105" → 105; empty → null. */
export function parseSeconds(v: string | null | undefined) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const t = String(v).trim();
  const m = t.match(/^(\d+):([0-5]?\d)$/);
  const s = m ? Number(m[1]) * 60 + Number(m[2]) : /^\d+(\.\d+)?$/.test(t) ? Math.round(Number(t)) : NaN;
  if (Number.isNaN(s)) throw new Error(`"${t}" is not a time – use minutes:seconds, e.g. 1:45`);
  return s;
}
/** 105 → "1:45". */
export const fmtSeconds = (s: number | null | undefined) => (s === null || s === undefined ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
/** Null when the time is within the window (or no window is set), else why not. */
export function timeOutside(s: number | null, min: number | null, max: number | null) {
  if (s === null) return null;
  if (min !== null && s < min) return `under time (${fmtSeconds(s)} < ${fmtSeconds(min)})`;
  if (max !== null && s > max) return `over time (${fmtSeconds(s)} > ${fmtSeconds(max)})`;
  return null;
}
