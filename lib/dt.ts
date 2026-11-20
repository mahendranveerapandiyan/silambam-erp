import 'server-only';
import { sql, EOT, type Tx, type Row } from './db';
import { ENTITIES, type Entity } from './entities';
import type { Opt } from './lookups';
import { addDays } from './util';

/**
 * Generic date-effective operations on any "<table>_f" table.
 *
 * UPDATE  - ends the version current on `effDate` the day before and inserts
 *           a new version from `effDate` (until the old version's end date,
 *           so future-dated changes are preserved).
 * CORRECT - overwrites the version current on `effDate` in place.
 */
export async function dtChange(
  tx: Tx,
  table: string,
  id: string,
  effDate: string,
  mode: 'UPDATE' | 'CORRECT',
  values: Row,
  by: string,
) {
  const ft = `${table}_f`;
  const [cur] = await tx`
    select * from ${tx(ft)} where id = ${id} and ${effDate}::date between effective_start_date and effective_end_date for update`;
  if (!cur) throw new Error(`No version of this record is effective on ${effDate}.`);
  if (mode === 'CORRECT' || cur.effective_start_date === effDate) {
    await tx`
      update ${tx(ft)} set ${tx({ ...values, last_updated_by: by, last_update_date: new Date() })},
        object_version_number = object_version_number + 1
      where id = ${id} and effective_start_date = ${cur.effective_start_date}`;
    return;
  }
  await tx`update ${tx(ft)} set effective_end_date = ${addDays(effDate, -1)}, last_updated_by = ${by}, last_update_date = now()
           where id = ${id} and effective_start_date = ${cur.effective_start_date}`;
  const { creation_date, last_update_date, object_version_number, ...rest } = cur;
  await tx`insert into ${tx(ft)} ${tx({
    ...rest,
    ...values,
    effective_start_date: effDate,
    effective_end_date: cur.effective_end_date,
    created_by: by,
    last_updated_by: by,
  })}`;
}

/** End-date a record: the version current on endDate ends that day, later versions are removed. */
export async function dtEndDate(tx: Tx, table: string, id: string, endDate: string) {
  const ft = `${table}_f`;
  const [cur] = await tx`select effective_start_date from ${tx(ft)} where id = ${id} and ${endDate}::date between effective_start_date and effective_end_date`;
  if (!cur) throw new Error(`No version is effective on ${endDate}.`);
  await tx`delete from ${tx(ft)} where id = ${id} and effective_start_date > ${endDate}`;
  await tx`update ${tx(ft)} set effective_end_date = ${endDate}, last_update_date = now() where id = ${id} and effective_start_date = ${cur.effective_start_date}`;
}

/** Remove the latest version and re-open the previous one (undo the last change). */
export async function dtDeleteLatest(tx: Tx, table: string, id: string) {
  const ft = `${table}_f`;
  const rows = await tx`select effective_start_date, effective_end_date from ${tx(ft)} where id = ${id} order by effective_start_date desc limit 2`;
  if (rows.length < 2) throw new Error('This is the only version; end-date the record instead.');
  await tx`delete from ${tx(ft)} where id = ${id} and effective_start_date = ${rows[0].effective_start_date}`;
  await tx`update ${tx(ft)} set effective_end_date = ${rows[0].effective_end_date} where id = ${id} and effective_start_date = ${rows[1].effective_start_date}`;
}

export async function dtHistory(table: string, id: string) {
  return sql`select * from ${sql(table + '_f')} where id = ${id} order by effective_start_date desc`;
}

// ------------------------------------------------------------------------
// Generic entity queries
// ------------------------------------------------------------------------
function fixedWhere(e: Entity, alias = 'f') {
  const conds = Object.entries(e.fixed ?? {}).map(([k, v]) => sql`and ${sql(alias + '.' + k)} = ${v}`);
  return conds.reduce((a, c) => sql`${a} ${c}`, sql``);
}

export async function entityList(e: Entity, enterpriseId: string, asOf: string, q?: string | null) {
  const like = q ? `%${q}%` : null;
  return sql`
    select b.id, b.code, f.*
    from ${sql(e.table)} b join ${sql(e.table + '_f')} f on f.id = b.id
      and ${asOf}::date between f.effective_start_date and f.effective_end_date
    where b.enterprise_id = ${enterpriseId} ${fixedWhere(e)}
      ${like ? sql`and (b.code ilike ${like} or f.name ilike ${like})` : sql``}
    order by ${e.fields.some((x) => x.name === 'sequence_no') ? sql`f.sequence_no,` : sql``} f.name`;
}

/** Records that exist but are not effective on asOf (future-dated or ended). */
export async function entityNotEffective(e: Entity, enterpriseId: string, asOf: string) {
  return sql`
    select b.id, b.code, max(f.name) as name, min(f.effective_start_date) as first_start, max(f.effective_end_date) as last_end
    from ${sql(e.table)} b join ${sql(e.table + '_f')} f on f.id = b.id
    where b.enterprise_id = ${enterpriseId} ${fixedWhere(e)}
      and not exists (select 1 from ${sql(e.table + '_f')} x where x.id = b.id and ${asOf}::date between x.effective_start_date and x.effective_end_date)
    group by b.id, b.code order by 3`;
}

export async function entityRow(e: Entity, id: string, asOf: string) {
  const [r] = await sql`
    select b.id, b.code, b.created_by as base_created_by, b.creation_date as base_creation_date, f.*
    from ${sql(e.table)} b left join ${sql(e.table + '_f')} f on f.id = b.id
      and ${asOf}::date between f.effective_start_date and f.effective_end_date
    where b.id = ${id}`;
  return r;
}

/** Options for a ref field: records effective on asOf, labelled "Parent › Name" where configured. */
export async function refOptions(entityKey: string, enterpriseId: string, asOf: string): Promise<Opt[]> {
  const e = ENTITIES[entityKey];
  const rows = await entityList(e, enterpriseId, asOf);
  let parentNames: Record<string, string> = {};
  if (e.parentRef) {
    const p = await refOptions(e.parentRef.entity, enterpriseId, asOf);
    parentNames = Object.fromEntries(p.map((o) => [o.value, o.label]));
  }
  return rows
    .map((r) => ({
      value: String(r.id),
      label: e.parentRef && parentNames[r[e.parentRef.field]] ? `${parentNames[r[e.parentRef.field]]} › ${r.name}` : r.name,
      parent: e.parentRef ? r[e.parentRef.field] : null,
      inactive: r.active_flag === 'N',
    }))
    .sort((a, b) => (e.parentRef ? a.label.localeCompare(b.label) : 0));
}

/** Map id -> name for an entity regardless of date (for history display). */
export async function refNames(entityKey: string, enterpriseId: string, asOf: string) {
  const e = ENTITIES[entityKey];
  const rows = await sql`
    select distinct on (b.id) b.id, f.name from ${sql(e.table)} b join ${sql(e.table + '_f')} f on f.id = b.id
    where b.enterprise_id = ${enterpriseId}
    order by b.id, (${asOf}::date between f.effective_start_date and f.effective_end_date) desc, f.effective_start_date desc`;
  return Object.fromEntries(rows.map((r) => [String(r.id), r.name as string]));
}

export { EOT };
