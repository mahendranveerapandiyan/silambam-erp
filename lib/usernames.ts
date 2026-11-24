import 'server-only';
import { sql, type Tx } from './db';

export type UserNameRule = { method_code: string; separator: string };
export const USER_CATEGORIES = ['STAFF', 'STUDENT', 'PARENT'] as const;
export type UserCategory = (typeof USER_CATEGORIES)[number];

const DEFAULTS: Record<UserCategory, UserNameRule> = {
  STAFF: { method_code: 'STAFF_NUMBER', separator: '.' },
  STUDENT: { method_code: 'STUDENT_NUMBER', separator: '.' },
  PARENT: { method_code: 'MANUAL', separator: '.' },
};

/** The rule in force for staff / students / parents (Configuration › User Name Rules). */
export async function userNameRule(enterpriseId: string, category: UserCategory, tx: Tx = sql): Promise<UserNameRule> {
  // students always use their student number and parents are always typed manually
  if (category !== 'STAFF') return DEFAULTS[category];
  const [r] = await tx`select method_code, separator from user_name_rule where enterprise_id = ${enterpriseId} and person_category = ${category}`;
  return (r as UserNameRule | undefined) ?? DEFAULTS.STAFF;
}

/** "Ravi Kumar" -> "ravi.kumar" (letters and digits only, lower case). */
export function nameUsername(first: string | null | undefined, last: string | null | undefined, separator: string) {
  const clean = (s: string | null | undefined) => (s ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return [clean(first), clean(last)].filter(Boolean).join(separator);
}

/**
 * Is the user name used? A login left behind by a deleted record (inactive and
 * linked to nobody) does not count: it is renamed out of the way (kept for history).
 */
const taken = async (tx: Tx, username: string) => {
  const [x] = await tx`select id, active_flag, person_id from user_account where lower(username) = lower(${username})`;
  if (!x) return false;
  if (x.active_flag === 'N' && x.person_id === null) {
    await tx`update user_account set username = ${`${username.toLowerCase()}~old-${x.id}`} where id = ${x.id}`;
    return false;
  }
  return true;
};

/**
 * The user name for a new login, following the rule:
 *   STAFF_NUMBER / STUDENT_NUMBER – the staff / student number (must be free)
 *   FIRST_LAST – first.last; a number is added if already used (ravi.kumar2)
 *   EMAIL – the person's email address (must be given and free)
 *   MANUAL – the typed user name
 */
export async function makeUsername(tx: Tx, enterpriseId: string, category: UserCategory,
  p: { number?: string | null; first?: string | null; last?: string | null; email?: string | null; typed?: string | null }) {
  const rule = await userNameRule(enterpriseId, category, tx);
  const fixed = async (name: string | null | undefined, what: string) => {
    const n = (name ?? '').trim().toLowerCase();
    if (!n) throw new Error(`The login user name is the ${what}, but no ${what} was given.`);
    if (await taken(tx, n)) throw new Error(`User name "${n}" (the ${what}) is already used by another login.`);
    return n;
  };
  switch (rule.method_code) {
    case 'STAFF_NUMBER': return fixed(p.number, 'staff number');
    case 'STUDENT_NUMBER': return fixed(p.number, 'student number');
    case 'EMAIL': return fixed(p.email, 'email id');
    case 'FIRST_LAST': {
      const base = nameUsername(p.first, p.last, rule.separator ?? '.');
      if (!base) throw new Error('The login user name is formed from the first and last name, but no name was given.');
      for (let i = 1; i < 1000; i++) {
        const n = i === 1 ? base : `${base}${i}`;
        if (!(await taken(tx, n))) return n;
      }
      throw new Error(`No free user name found for ${base}.`);
    }
    default: return fixed(p.typed, 'user name');
  }
}

/** Which rule applies to a person being given a login: their staff or student record (`prefer` decides when they have both). */
export async function personLoginInfo(tx: Tx, personId: string, asOf: string, prefer: 'STAFF' | 'STUDENT' = 'STAFF') {
  const rows = await tx`select a.assignment_type, a.assignment_number, pf.first_name, pf.last_name, pf.email
    from assignment a
    left join lateral (select * from person_f x where x.id = a.person_id order by (${asOf}::date between x.effective_start_date and x.effective_end_date) desc, x.effective_start_date desc limit 1) pf on true
    where a.person_id = ${personId} order by (a.assignment_type = ${prefer}) desc`;
  const r = rows[0];
  if (!r) return null;
  return { category: r.assignment_type as UserCategory, number: r.assignment_number as string, first: r.first_name as string | null, last: r.last_name as string | null, email: r.email as string | null };
}
