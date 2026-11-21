'use server';
import { sql } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getEntity, type Entity } from '@/lib/entities';
import { dtChange, dtCorrectVersion, dtDeleteLatest, dtEndDate, dtSpan } from '@/lib/dt';
import { assertDependentsWithin, assertRefsEffective, usages } from '@/lib/integrity';
import { act, backOf, formObj } from '@/lib/util';
import { parseAttributes } from '@/lib/fields';
import { validateEntity } from '@/lib/entityRules';

/** Field values from the form (multi-select lookups come as several values). */
async function parse(e: Entity, fd: FormData, enterpriseId: string) {
  const o = formObj(fd);
  const v: Record<string, any> = {};
  if (!o.name) throw new Error('Name is required');
  v.name = o.name;
  v.description = o.description ?? null;
  for (const f of e.fields) {
    if (f.showWhen && !f.showWhen.values.includes(o[f.showWhen.field] ?? '')) {
      v[f.name] = null; // not applicable for the chosen option
      continue;
    }
    if (f.type === 'multilookup') {
      const codes = fd.getAll(f.name).map(String).filter(Boolean);
      if (f.required && !codes.length) throw new Error(`${f.label} is required`);
      v[f.name] = codes.length ? codes.join(',') : null;
      continue;
    }
    const raw = o[f.name] ?? null;
    if (f.required && !raw) throw new Error(`${f.label} is required`);
    v[f.name] = f.type === 'number' ? (raw === null ? null : Number(raw)) : f.type === 'yesno' ? (raw === 'N' ? 'N' : 'Y') : raw;
    if (f.type === 'number' && raw !== null && Number.isNaN(v[f.name])) throw new Error(`${f.label} must be a number`);
  }
  v.attributes = await parseAttributes(enterpriseId, `setup:${e.key}`, fd);
  return { ...v, ...(e.fixed ?? {}) };
}

export async function createEntity(key: string, fd: FormData) {
  const u = await requirePriv(getEntity(key)!.priv, 'WRITE');
  const e = getEntity(key)!;
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    if (!o.code) throw new Error('Code is required');
    const start = o.effective_start_date;
    if (!start) throw new Error('Effective start date is required');
    const vals = await parse(e, fd, u.enterpriseId);
    let id = '';
    await sql.begin(async (tx) => {
      await assertRefsEffective(tx, key, vals, start);
      await validateEntity(tx, key, vals, { id: null, date: start });
      const [b] = await tx`insert into ${tx(e.table)} (enterprise_id, code, created_by) values (${u.enterpriseId}, ${o.code!.toUpperCase()}, ${u.username}) returning id`;
      id = b.id;
      await tx`insert into ${tx(e.table + '_f')} ${tx({ id, effective_start_date: start, ...vals, created_by: u.username, last_updated_by: u.username })}`;
    });
    return { to: `/setup/${key}/${id}`, msg: `${e.label} created` };
  });
}

/** Update (new version from a date) or correct the version current on that date. */
export async function updateEntity(key: string, id: string, fd: FormData) {
  const u = await requirePriv(getEntity(key)!.priv, 'WRITE');
  const e = getEntity(key)!;
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    const date = o.effective_date;
    if (!date) throw new Error('Effective date is required');
    const mode = o.mode === 'CORRECT' ? 'CORRECT' : 'UPDATE';
    const vals = await parse(e, fd, u.enterpriseId);
    await sql.begin(async (tx) => {
      let checkDate = date;
      if (mode === 'CORRECT') {
        const [cur] = await tx`select effective_start_date from ${tx(e.table + '_f')} where id = ${id} and ${date}::date between effective_start_date and effective_end_date`;
        if (cur) checkDate = cur.effective_start_date;
      }
      await assertRefsEffective(tx, key, vals, checkDate);
      await validateEntity(tx, key, vals, { id, date: checkDate });
      await dtChange(tx, e.table, id, date, mode, vals, u.username);
    });
    return { msg: mode === 'CORRECT' ? 'Record corrected' : `Record updated effective ${date}` };
  });
}

/** Correct a specific saved version, including moving its effective start date. */
export async function correctVersion(key: string, id: string, versionStart: string, fd: FormData) {
  const u = await requirePriv(getEntity(key)!.priv, 'WRITE');
  const e = getEntity(key)!;
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    const newStart = o.effective_start_date;
    if (!newStart) throw new Error('Effective start date is required');
    const vals = await parse(e, fd, u.enterpriseId);
    await sql.begin(async (tx) => {
      await assertRefsEffective(tx, key, vals, newStart);
      await validateEntity(tx, key, vals, { id, date: newStart });
      const r = await dtCorrectVersion(tx, e.table, id, versionStart, newStart, vals, u.username);
      // moving the record's very first start later must not orphan records that use it
      if (r.isFirst && newStart > versionStart) await assertDependentsWithin(tx, e.table, id, newStart, null, `start this ${e.label.toLowerCase()} on ${newStart}`);
    });
    return { to: `/setup/${key}/${id}?version=${newStart}`, msg: newStart === versionStart ? 'Version corrected' : `Version corrected; it now starts ${newStart}` };
  });
}

export async function endDateEntity(key: string, id: string, fd: FormData) {
  await requirePriv(getEntity(key)!.priv, 'WRITE');
  const e = getEntity(key)!;
  await act(backOf(fd), async () => {
    const d = formObj(fd).end_date;
    if (!d) throw new Error('End date is required');
    await sql.begin(async (tx) => {
      await assertDependentsWithin(tx, e.table, id, null, d, `end-date this ${e.label.toLowerCase()} on ${d}`);
      await dtEndDate(tx, e.table, id, d);
    });
    return { msg: `Record end-dated on ${d}` };
  });
}

export async function deleteLatestVersion(key: string, id: string, fd: FormData) {
  await requirePriv(getEntity(key)!.priv, 'WRITE');
  const e = getEntity(key)!;
  await act(backOf(fd), async () => {
    await sql.begin(async (tx) => {
      await dtDeleteLatest(tx, e.table, id);
      const span = await dtSpan(tx, e.table, id);
      await assertDependentsWithin(tx, e.table, id, span.start, span.end, 'remove the latest version');
    });
    return { to: `/setup/${key}/${id}`, msg: 'Latest change removed' };
  });
}

/** Delete a record completely – only when nothing uses it. */
export async function deleteEntity(key: string, id: string, fd: FormData) {
  const u = await requirePriv(getEntity(key)!.priv, 'WRITE');
  const e = getEntity(key)!;
  await act(backOf(fd), async () => {
    await sql.begin(async (tx) => {
      const used = await usages(tx, e.table, id);
      if (used.length) throw new Error(`Cannot delete: used by ${used.map((x) => `${x.label} (${x.count})`).join(', ')}. End-date it instead.`);
      await tx`delete from ${tx(e.table)} where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    });
    return { to: `/setup/${key}`, msg: `${e.label} deleted` };
  });
}
