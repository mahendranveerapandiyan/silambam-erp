'use server';
import { sql } from '@/lib/db';
import { requirePriv } from '@/lib/auth';
import { act, backOf, formObj } from '@/lib/util';
import { CATEGORY_FIELDS, OPERATORS } from '@/lib/tournament';

const PRIV = 'CD_GAME_SETUP_PRV';

export async function saveCategory(id: string | null, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd, '/events/categories'), async () => {
    const o = formObj(fd);
    if (!o.name) throw new Error('The category name is required');
    const code = (o.code ?? o.name).toUpperCase().trim().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    const [dup] = await sql`select 1 from competition_category where enterprise_id = ${u.enterpriseId} and (code = ${code} or lower(name) = lower(${o.name})) and id <> ${id ?? 0}`;
    if (dup) throw new Error(`A category named ${o.name} already exists`);
    const v = { code, name: o.name, description: o.description, active_flag: o.active_flag === 'N' ? 'N' : 'Y' };
    if (id) {
      await sql`update competition_category set ${sql(v)} where id = ${id} and enterprise_id = ${u.enterpriseId}`;
      return { msg: `${o.name} category has been updated.` };
    }
    const [c] = await sql`insert into competition_category ${sql({ ...v, enterprise_id: u.enterpriseId, created_by: u.username })} returning id`;
    return { to: `/events/categories?edit=${c.id}`, msg: `${o.name} category has been created. Now add its rules (e.g. Gender is Female, Age below 7).` };
  });
}

export async function deleteCategory(id: string, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd, '/events/categories'), async () => {
    const [c] = await sql`select * from competition_category where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    if (!c) throw new Error('Category not found');
    const [used] = await sql`select count(*)::int n from event_competition where category_id = ${id}`;
    if (used.n) throw new Error(`${c.name} is used in ${used.n} competition(s) – make it inactive instead.`);
    await sql`delete from competition_category where id = ${id}`;
    return { to: '/events/categories', msg: `${c.name} category has been deleted.` };
  });
}

export async function saveRule(categoryId: string, ruleId: string | null, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd), async () => {
    const [c] = await sql`select * from competition_category where id = ${categoryId} and enterprise_id = ${u.enterpriseId}`;
    if (!c) throw new Error('Category not found');
    const o = formObj(fd);
    if (o._delete && ruleId) {
      await sql`delete from competition_category_rule where id = ${ruleId} and category_id = ${categoryId}`;
      return { msg: 'The rule has been removed.' };
    }
    const f = CATEGORY_FIELDS.find((x) => x.code === o.field_code);
    if (!f) throw new Error('Choose a field');
    if (!OPERATORS.some(([k]) => k === o.operator)) throw new Error('Choose a condition');
    const multi = fd.getAll('value_multi').map(String).filter(Boolean);
    const value = o.operator === 'IN' && multi.length ? multi.join(',') : o.value;
    if (!value) throw new Error('Enter the value to compare with');
    if (f.kind === 'number' && value.split(',').some((x) => Number.isNaN(Number(x)))) throw new Error(`${f.label} needs a number`);
    if (f.kind === 'code' && ['LT', 'LE', 'GT', 'GE'].includes(o.operator!)) throw new Error(`${f.label} can only be compared with is / is not / is one of`);
    if (ruleId) await sql`update competition_category_rule set field_code = ${f.code}, operator = ${o.operator}, value = ${value} where id = ${ruleId} and category_id = ${categoryId}`;
    else await sql`insert into competition_category_rule (category_id, field_code, operator, value) values (${categoryId}, ${f.code}, ${o.operator}, ${value})`;
    return { to: `/events/categories?edit=${categoryId}`, msg: `The rule has been ${ruleId ? 'updated' : 'added'} to ${c.name}.` };
  });
}
