import 'server-only';
import { sql, type Tx } from './db';

export const normId = (n: string) => n.replace(/[\s-]/g, '').toUpperCase();

export type IdInput = { type: string; number: string; country?: string | null; issue?: string | null; expiry?: string | null };

/** Validates type, format (lookup tag = regular expression) and dates. */
export async function validateIdentifier(tx: Tx, x: IdInput) {
  const [t] = await tx`select meaning, tag from lookup_value where lookup_type = 'IDENTIFICATION_TYPE' and lookup_code = ${x.type} and enabled_flag = 'Y'`;
  if (!t) throw new Error('Choose a valid identification type');
  const n = normId(x.number);
  if (n.length < 3) throw new Error(`${t.meaning}: enter the document number`);
  if (t.tag) {
    let ok = true;
    try { ok = new RegExp(t.tag).test(n); } catch { ok = true; }
    if (!ok) throw new Error(`${t.meaning} number "${x.number}" is not in the expected format (${t.meaning === 'Aadhaar' ? '12 digits' : 'see Configuration › Lookups › Identification Type'}).`);
  }
  if (x.issue && x.expiry && x.expiry < x.issue) throw new Error(`${t.meaning}: expiry date cannot be before the issue date`);
  return t.meaning as string;
}

/** No two people may share the same document (type + number). */
export async function assertIdUnique(tx: Tx, enterpriseId: string, x: IdInput, exceptPersonId?: string | null, exceptRowId?: string | null) {
  const [dup] = await tx`
    select pi.person_id, (select string_agg(a.assignment_type || ' ' || a.assignment_number, ', ') from assignment a where a.person_id = pi.person_id) who
    from person_identifier pi
    where pi.enterprise_id = ${enterpriseId} and pi.id_type_code = ${x.type} and pi.id_number_norm = ${normId(x.number)}
      ${exceptRowId ? tx`and pi.id <> ${exceptRowId}` : tx``}
      ${exceptPersonId ? tx`and pi.person_id <> ${exceptPersonId}` : tx``}
    limit 1`;
  if (dup) throw new Error(`This identification number is already recorded for ${dup.who ? dup.who.replace(/STUDENT /g, 'student ').replace(/STAFF /g, 'staff ') : 'another person'}. Two people cannot share the same document.`);
}

/** Read identification rows "<prefix>_type", "<prefix>_number" ... from a form. */
export function readIdForm(o: Record<string, string | null>, prefix: string): IdInput | null {
  const type = o[`${prefix}_type`], number = o[`${prefix}_number`];
  if (!type && !number) return null;
  if (!type || !number) throw new Error('Enter both the identification type and number');
  return { type, number: number.trim(), country: o[`${prefix}_country`], issue: o[`${prefix}_issue`], expiry: o[`${prefix}_expiry`] };
}

export async function insertIdentifier(tx: Tx, enterpriseId: string, personId: string, x: IdInput, primary: boolean, by: string) {
  await tx`insert into person_identifier ${tx({
    enterprise_id: enterpriseId, person_id: personId, id_type_code: x.type, id_number: x.number.toUpperCase(), issuing_country_code: x.country ?? null,
    issue_date: x.issue ?? null, expiry_date: x.expiry ?? null, primary_flag: primary ? 'Y' : 'N', created_by: by, last_updated_by: by,
  })}`;
}

export async function identifiersOf(personId: string) {
  return sql`select * from person_identifier where person_id = ${personId} order by primary_flag desc, id`;
}
