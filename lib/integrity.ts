import 'server-only';
import { sql, type Tx } from './db';
import { ENTITIES } from './entities';
import { addDays } from './util';

/** Friendly names for tables that can reference a record. */
const TABLE_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.values(ENTITIES).map((e) => [`${e.table}_f`, e.plural])),
  assignment_f: 'Student / staff assignments',
  class_incharge: 'Class incharge assignments',
  fee_structure: 'Fee structures',
  fee_demand: 'Fee lines',
  fee_payment: 'Fee payments',
  student_attendance: 'Student attendance',
  staff_attendance: 'Staff attendance',
  exam: 'Exams',
  exam_fee: 'Exam fees',
  exam_subject: 'Exam subjects',
  exam_candidate: 'Exam candidates',
  event: 'Events',
  stock_txn: 'Stock transactions',
  finance_txn: 'Income / expense entries',
  payment_qr: 'Payment QR codes',
};
const label = (t: string) => TABLE_LABEL[t] ?? t.replace(/_f$/, '').replace(/_/g, ' ');

type Fk = { tbl: string; col: string };

/** Single-column foreign keys pointing at a table. */
async function referencing(tx: Tx, table: string): Promise<Fk[]> {
  const rows = await tx`
    select c.conrelid::regclass::text tbl, a.attname col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = ${table}::regclass and array_length(c.conkey, 1) = 1`;
  return rows.filter((r) => r.tbl !== `${table}_f`) as unknown as Fk[];
}

/** Where a record is used: [{label, count}] (empty = safe to delete). */
export async function usages(tx: Tx, table: string, id: string) {
  const out: { label: string; count: number }[] = [];
  for (const fk of await referencing(tx, table)) {
    const [r] = await tx`select count(*)::int n from ${tx(fk.tbl)} where ${tx(fk.col)} = ${id}`;
    if (r.n > 0) out.push({ label: label(fk.tbl), count: r.n });
  }
  return out;
}

/**
 * Date-tracked children (and incharge assignments) that refer to this record
 * outside [start, end] - they would point at a record that does not exist then.
 */
export async function assertDependentsWithin(tx: Tx, table: string, id: string, start: string | null, end: string | null, what: string) {
  const bad: string[] = [];
  for (const fk of await referencing(tx, table)) {
    let s: string | null = null, e: string | null = null;
    if (fk.tbl.endsWith('_f')) [s, e] = ['effective_start_date', 'effective_end_date'];
    else if (fk.tbl === 'class_incharge') [s, e] = ['start_date', 'end_date'];
    if (!s || !e) continue;
    const [r] = await tx`
      select count(*)::int n, min(${tx(s)}) first_start, max(${tx(e)}) last_end from ${tx(fk.tbl)}
      where ${tx(fk.col)} = ${id}
        and (${start}::date is not null and ${tx(s)} < ${start}::date or ${end}::date is not null and ${tx(e)} > ${end}::date)`;
    if (r.n > 0) bad.push(`${label(fk.tbl)} (${r.n})`);
  }
  if (bad.length) throw new Error(`Cannot ${what}: still referenced by ${bad.join(', ')} outside the new dates. Change or end-date those first.`);
}

/** The referenced record must exist (and be active) on the date. */
export async function assertEffective(tx: Tx, table: string, id: string | null | undefined, date: string, what: string) {
  if (!id) return;
  const [r] = await tx`select name, ${tx(table + '_f')}.* from ${tx(table + '_f')} where id = ${id} and ${date}::date between effective_start_date and effective_end_date`;
  if (!r) {
    const [any] = await tx`select name, min(effective_start_date) over () s from ${tx(table + '_f')} where id = ${id} order by effective_start_date limit 1`;
    throw new Error(`${what}${any ? ` "${any.name}"` : ''} is not effective on ${date}${any ? ` (starts ${any.s})` : ''}. Choose a date on or after it starts, or another ${what.toLowerCase()}.`);
  }
  if (r.active_flag === 'N') throw new Error(`${what} "${r.name}" is inactive on ${date}.`);
}

/** Check every ref field of an entity record against its effective start date. */
export async function assertRefsEffective(tx: Tx, entityKey: string, values: Record<string, any>, date: string) {
  const e = ENTITIES[entityKey];
  for (const f of e.fields) if (f.type === 'ref' && values[f.name]) await assertEffective(tx, ENTITIES[f.ref!].table, values[f.name], date, f.label);
}

export { addDays };
