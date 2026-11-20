'use server';
import { sql } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getEntity, type Entity } from '@/lib/entities';
import { dtChange, dtDeleteLatest, dtEndDate } from '@/lib/dt';
import { act, backOf, formObj } from '@/lib/util';

function parse(e: Entity, o: Record<string, string | null>) {
  const v: Record<string, any> = {};
  if (!o.name) throw new Error('Name is required');
  v.name = o.name;
  v.description = o.description ?? null;
  for (const f of e.fields) {
    const raw = o[f.name] ?? null;
    if (f.required && !raw) throw new Error(`${f.label} is required`);
    v[f.name] = f.type === 'number' ? (raw === null ? null : Number(raw)) : f.type === 'yesno' ? (raw === 'N' ? 'N' : 'Y') : raw;
    if (f.type === 'number' && raw !== null && Number.isNaN(v[f.name])) throw new Error(`${f.label} must be a number`);
  }
  return { ...v, ...(e.fixed ?? {}) };
}

export async function createEntity(key: string, fd: FormData) {
  const u = await requireUser('ADMIN');
  const e = getEntity(key)!;
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    if (!o.code) throw new Error('Code is required');
    if (!o.effective_start_date) throw new Error('Effective start date is required');
    const vals = parse(e, o);
    let id = '';
    await sql.begin(async (tx) => {
      const [b] = await tx`insert into ${tx(e.table)} (enterprise_id, code, created_by) values (${u.enterpriseId}, ${o.code!.toUpperCase()}, ${u.username}) returning id`;
      id = b.id;
      await tx`insert into ${tx(e.table + '_f')} ${tx({ id, effective_start_date: o.effective_start_date, ...vals, created_by: u.username, last_updated_by: u.username })}`;
    });
    return { to: `/setup/${key}/${id}`, msg: `${e.label} created` };
  });
}

export async function updateEntity(key: string, id: string, fd: FormData) {
  const u = await requireUser('ADMIN');
  const e = getEntity(key)!;
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    if (!o.effective_date) throw new Error('Effective date is required');
    const mode = o.mode === 'CORRECT' ? 'CORRECT' : 'UPDATE';
    await sql.begin((tx) => dtChange(tx, e.table, id, o.effective_date!, mode, parse(e, o), u.username));
    return { msg: mode === 'CORRECT' ? 'Record corrected' : `Record updated effective ${o.effective_date}` };
  });
}

export async function endDateEntity(key: string, id: string, fd: FormData) {
  await requireUser('ADMIN');
  const e = getEntity(key)!;
  await act(backOf(fd), async () => {
    const d = formObj(fd).end_date;
    if (!d) throw new Error('End date is required');
    await sql.begin((tx) => dtEndDate(tx, e.table, id, d));
    return { msg: `Record end-dated on ${d}` };
  });
}

export async function deleteLatestVersion(key: string, id: string, fd: FormData) {
  await requireUser('ADMIN');
  const e = getEntity(key)!;
  await act(backOf(fd), async () => {
    await sql.begin((tx) => dtDeleteLatest(tx, e.table, id));
    return { msg: 'Latest change removed' };
  });
}
