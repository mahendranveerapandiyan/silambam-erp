import 'server-only';
import { cache } from 'react';
import { sql } from './db';

export type Opt = { value: string; label: string; parent?: string | null; inactive?: boolean };

/** Enabled lookup values valid on the given date, in display order. */
export async function lookupOptions(type: string, asOf: string): Promise<Opt[]> {
  const rows = await sql`
    select lookup_code, meaning, parent_code from lookup_value
    where lookup_type = ${type} and enabled_flag = 'Y' and ${asOf}::date between start_date and end_date
    order by display_seq, meaning`;
  return rows.map((r) => ({ value: r.lookup_code, label: r.meaning, parent: r.parent_code }));
}

/** All meanings for all lookups (cached per request) - used to render codes. */
export const allMeanings = cache(async () => {
  const rows = await sql`select lookup_type, lookup_code, meaning, tag from lookup_value`;
  const m: Record<string, Record<string, string>> = {};
  const tags: Record<string, Record<string, string | null>> = {};
  for (const r of rows) {
    (m[r.lookup_type] ??= {})[r.lookup_code] = r.meaning;
    (tags[r.lookup_type] ??= {})[r.lookup_code] = r.tag;
  }
  return { m, tags };
});

export async function meaning(type: string, code: string | null | undefined) {
  if (!code) return '';
  const { m } = await allMeanings();
  return m[type]?.[code] ?? code;
}

/** Synchronous helper once the map is loaded: `const L = await lk(); L('GENDER', 'M')`. */
export async function lk() {
  const { m, tags } = await allMeanings();
  const fn = (type: string, code: string | null | undefined) => (code ? m[type]?.[code] ?? code : '');
  fn.tag = (type: string, code: string | null | undefined) => (code ? tags[type]?.[code] ?? null : null);
  return fn;
}
