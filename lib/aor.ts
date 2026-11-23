import 'server-only';
import { sql, type Tx } from './db';
import type { PersonKind } from './people';

export const EOT = '4712-12-31';
export const aorLookup = (kind: PersonKind) => (kind === 'STUDENT' ? 'STUDENT_AOR' : 'STAFF_AOR');

export type AorInput = { type: string | null; academicYearId?: string | null; start?: string | null; end?: string | null; remarks?: string | null };

/**
 * Checks and completes an Area of Responsibility row.
 *  Students: an academic year is required; dates default to (and must stay inside) that year.
 *  Staff: date based; the start defaults to `defaultStart`, the end to open-ended.
 *  The same responsibility may not overlap itself for one person.
 */
export async function checkAor(tx: Tx, kind: PersonKind, personId: string | null, v: AorInput, defaultStart: string, excludeId: string | null = null) {
  if (!v.type) throw new Error('Choose the area of responsibility');
  const [lv] = await tx`select meaning from lookup_value where lookup_type = ${aorLookup(kind)} and lookup_code = ${v.type} and enabled_flag = 'Y'`;
  if (!lv) throw new Error(`Unknown ${kind === 'STUDENT' ? 'student' : 'staff'} area of responsibility ${v.type}`);
  let ay: { id: string; name: string; start_date: string; end_date: string } | null = null;
  let start = v.start || null;
  let end = v.end || null;
  if (kind === 'STUDENT') {
    if (!v.academicYearId) throw new Error(`Choose the academic year for "${lv.meaning}"`);
    [ay] = (await tx`select id, name, start_date, end_date from academic_year where id = ${v.academicYearId}`) as any;
    if (!ay) throw new Error('Academic year not found');
    start ??= defaultStart > ay.start_date && defaultStart <= ay.end_date ? defaultStart : ay.start_date;
    end ??= ay.end_date;
    if (start < ay.start_date || start > ay.end_date || end < ay.start_date || end > ay.end_date) throw new Error(`"${lv.meaning}" dates must be inside ${ay.name} (${ay.start_date} – ${ay.end_date}).`);
  } else {
    start ??= defaultStart;
    end ??= EOT;
  }
  if (end < start) throw new Error(`"${lv.meaning}": the end date cannot be before the start date.`);
  if (personId) {
    const [o] = await tx`select start_date, end_date from area_of_responsibility where person_id = ${personId} and aor_type_code = ${v.type}
      and person_category = ${kind} and daterange(start_date, end_date, '[]') && daterange(${start}::date, ${end}::date, '[]')
      ${excludeId ? tx`and id <> ${excludeId}` : tx``} limit 1`;
    if (o) throw new Error(`"${lv.meaning}" is already recorded for ${o.start_date} – ${o.end_date === EOT ? 'open' : o.end_date}. End it first or choose other dates.`);
  }
  return { aor_type_code: v.type, academic_year_id: kind === 'STUDENT' ? v.academicYearId : null, start_date: start, end_date: end, remarks: v.remarks || null, meaning: lv.meaning as string };
}

/** Reads the AOR rows of a hire / admission form (prefix aor1_, aor2_ …). */
export function aorRowsFromForm(o: Record<string, string | null>, max = 3): AorInput[] {
  const rows: AorInput[] = [];
  for (let i = 1; i <= max; i++) {
    const type = o[`aor${i}_type`];
    if (!type) continue;
    rows.push({ type, academicYearId: o[`aor${i}_ay`], start: o[`aor${i}_start`], end: o[`aor${i}_end`], remarks: o[`aor${i}_remarks`] });
  }
  return rows;
}

/** People (with their login user ids) holding a responsibility on a date. */
export async function aorHolders(enterpriseId: string, typeCode: string, onDate: string) {
  return sql`select distinct r.person_id, ua.id user_id from area_of_responsibility r
    left join user_account ua on ua.person_id = r.person_id and ua.active_flag = 'Y'
    where r.enterprise_id = ${enterpriseId} and r.aor_type_code = ${typeCode} and ${onDate}::date between r.start_date and r.end_date`;
}
