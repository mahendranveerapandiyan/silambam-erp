'use server';
import { sql } from '@/lib/db';
import { requirePriv } from '@/lib/auth';
import { act, backOf, formObj } from '@/lib/util';
import { applyGrades } from '@/lib/examSetup';

const PRIV = 'CD_GRADING_RANGE_PRV';

async function load(enterpriseId: string, id: string) {
  const [s] = await sql`select * from grading_scale where id = ${id} and enterprise_id = ${enterpriseId}`;
  if (!s) throw new Error('Grading range not found');
  return s;
}
/** Exams using the scale get their unpublished ratings refreshed. */
async function refresh(scaleId: string) {
  await sql.begin(async (tx) => {
    for (const e of await tx`select id from exam where grading_scale_id = ${scaleId}`) await applyGrades(tx as unknown as typeof sql, String(e.id));
  });
}

export async function saveScale(id: string | null, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd, '/exams/grading'), async () => {
    const o = formObj(fd);
    if (!o.code || !o.name) throw new Error('Code and name are required');
    const code = o.code.toUpperCase().replace(/\s+/g, '_');
    const [dup] = await sql`select 1 from grading_scale where enterprise_id = ${u.enterpriseId} and code = ${code} and id <> ${id ?? 0}`;
    if (dup) throw new Error(`Grading range code ${code} already exists`);
    const v = { code, name: o.name, description: o.description, active_flag: o.active_flag === 'N' ? 'N' : 'Y' };
    if (id) {
      await load(u.enterpriseId, id);
      await sql`update grading_scale set ${sql({ ...v, last_updated_by: u.username, last_update_date: new Date() })} where id = ${id}`;
      return { msg: `${o.name} grading range has been updated.` };
    }
    const [s] = await sql`insert into grading_scale ${sql({ ...v, enterprise_id: u.enterpriseId, created_by: u.username })} returning id`;
    if (o.copy_from) {
      await load(u.enterpriseId, o.copy_from);
      await sql`insert into grading_band (scale_id, mark_from, mark_to, rating, description) select ${s.id}, mark_from, mark_to, rating, description from grading_band where scale_id = ${o.copy_from}`;
    }
    return { to: `/exams/grading?edit=${s.id}`, msg: `${o.name} grading range has been created. Now add its mark ranges.` };
  });
}

export async function deleteScale(id: string, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd, '/exams/grading'), async () => {
    const s = await load(u.enterpriseId, id);
    const [e] = await sql`select count(*)::int n, string_agg(name, ', ') names from exam where grading_scale_id = ${id}`;
    if (e.n) throw new Error(`${s.name} is used by ${e.n} exam(s): ${e.names}. Make it inactive instead.`);
    await sql`delete from grading_scale where id = ${id}`;
    return { to: '/exams/grading', msg: `${s.name} grading range has been deleted.` };
  });
}

/** Add, change or delete one mark range (Mark From – Mark To → Rating); ranges may not overlap. */
export async function saveBand(scaleId: string, bandId: string | null, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd), async () => {
    const sc = await load(u.enterpriseId, scaleId);
    const o = formObj(fd);
    if (o._delete && bandId) {
      const [d] = await sql`delete from grading_band where id = ${bandId} and scale_id = ${scaleId} returning rating`;
      await refresh(scaleId);
      return { msg: `The ${d?.rating ?? ''} range has been deleted.` };
    }
    const from = Number(o.mark_from), to = Number(o.mark_to);
    if (!o.rating) throw new Error('The rating is required (e.g. A+, Distinction)');
    if (o.mark_from === null || o.mark_to === null || Number.isNaN(from) || Number.isNaN(to)) throw new Error('Mark From and Mark To are required');
    if (from < 0 || to > 100) throw new Error('Marks are out of 100 – use values from 0 to 100');
    if (from > to) throw new Error('Mark From cannot be more than Mark To');
    const [clash] = await sql`select rating, mark_from, mark_to from grading_band where scale_id = ${scaleId} and id <> ${bandId ?? 0}
      and ${from} <= mark_to and ${to} >= mark_from limit 1`;
    if (clash) throw new Error(`${from}–${to} overlaps the ${clash.rating} range (${Number(clash.mark_from)}–${Number(clash.mark_to)}) of ${sc.name}.`);
    const v = { mark_from: from, mark_to: to, rating: o.rating, description: o.description };
    if (bandId) await sql`update grading_band set ${sql(v)} where id = ${bandId} and scale_id = ${scaleId}`;
    else await sql`insert into grading_band ${sql({ ...v, scale_id: scaleId })}`;
    await refresh(scaleId);
    return { msg: `${o.rating} (${from}–${to}) has been ${bandId ? 'updated' : 'added'}.` };
  });
}
