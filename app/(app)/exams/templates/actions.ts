'use server';
import { sql, type Row } from '@/lib/db';
import { requirePriv } from '@/lib/auth';
import { act, backOf, formObj } from '@/lib/util';

const PRIV = 'CD_EVALUATION_TEMPLATE_PRV';

async function load(enterpriseId: string, id: string) {
  const [t] = await sql`select * from evaluation_template where id = ${id} and enterprise_id = ${enterpriseId}`;
  if (!t) throw new Error('Template not found');
  return t;
}
async function noRatings(t: Row) {
  const [r] = await sql`select count(distinct e.id)::int n, string_agg(distinct e.name, ', ') names from exam_section_rating x
    join evaluation_section s on s.id = x.section_id join exam_candidate c on c.id = x.candidate_id join exam e on e.id = c.exam_id where s.template_id = ${t.id}`;
  if (r.n) throw new Error(`Ratings have already been entered with ${t.name} (${r.names}) – its sections can no longer be changed. Copy it to a new template instead.`);
}

export async function saveTemplate(id: string | null, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd, '/exams/templates'), async () => {
    const o = formObj(fd);
    if (!o.code || !o.name) throw new Error('Code and name are required');
    const code = o.code.toUpperCase().replace(/\s+/g, '_');
    const [dup] = await sql`select 1 from evaluation_template where enterprise_id = ${u.enterpriseId} and code = ${code} and id <> ${id ?? 0}`;
    if (dup) throw new Error(`Template code ${code} already exists`);
    const v = { code, name: o.name, description: o.description, active_flag: o.active_flag === 'N' ? 'N' : 'Y' };
    if (id) {
      await load(u.enterpriseId, id);
      await sql`update evaluation_template set ${sql({ ...v, last_updated_by: u.username, last_update_date: new Date() })} where id = ${id}`;
      return { msg: `${o.name} evaluation template has been updated.` };
    }
    const [t] = await sql`insert into evaluation_template ${sql({ ...v, enterprise_id: u.enterpriseId, created_by: u.username })} returning id`;
    if (o.copy_from) {
      await load(u.enterpriseId, o.copy_from);
      await sql`insert into evaluation_section (template_id, name, input_type, weight_pct, min_rating, max_rating, display_seq)
        select ${t.id}, name, input_type, weight_pct, min_rating, max_rating, display_seq from evaluation_section where template_id = ${o.copy_from}`;
    }
    return { to: `/exams/templates?edit=${t.id}`, msg: `${o.name} evaluation template has been created. Now add its sections.` };
  });
}

export async function deleteTemplate(id: string, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd, '/exams/templates'), async () => {
    const t = await load(u.enterpriseId, id);
    const [e] = await sql`select count(*)::int n, string_agg(name, ', ') names from exam where evaluation_template_id = ${id}`;
    if (e.n) throw new Error(`${t.name} is used by ${e.n} exam(s): ${e.names}. Make it inactive instead.`);
    await sql`delete from evaluation_template where id = ${id}`;
    return { to: '/exams/templates', msg: `${t.name} evaluation template has been deleted.` };
  });
}

export async function saveSection(templateId: string, secId: string | null, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd), async () => {
    const t = await load(u.enterpriseId, templateId);
    await noRatings(t);
    const o = formObj(fd);
    if (o._delete && secId) {
      const [d] = await sql`delete from evaluation_section where id = ${secId} and template_id = ${templateId} returning name`;
      return { msg: `${d?.name ?? 'The section'} section has been deleted.` };
    }
    if (!o.name) throw new Error('The section name is required');
    const w = Number(o.weight_pct), min = Number(o.min_rating ?? 0), max = Number(o.max_rating);
    if (!(w > 0 && w <= 100)) throw new Error('The weight must be above 0 and at most 100 %');
    const kind = o.input_type === 'MARK' ? 'marks' : 'rating';
    if (!(max > 0)) throw new Error(`The maximum ${kind} must be above 0`);
    if (Number.isNaN(min) || min < 0 || min > max) throw new Error(`The minimum ${kind} must be between 0 and the maximum`);
    const v = { name: o.name, input_type: o.input_type === 'MARK' ? 'MARK' : 'RATING', weight_pct: w, min_rating: min, max_rating: max, display_seq: Number(o.display_seq ?? 0) };
    if (secId) await sql`update evaluation_section set ${sql(v)} where id = ${secId} and template_id = ${templateId}`;
    else await sql`insert into evaluation_section ${sql({ ...v, template_id: templateId })}`;
    const [tot] = await sql`select coalesce(sum(min_rating), 0)::float mn, coalesce(sum(max_rating), 0)::float mx from evaluation_section where template_id = ${templateId}`;
    return { msg: `${o.name} section has been ${secId ? 'updated' : 'added'}. ${t.name} now totals Min ${tot.mn} / Max ${tot.mx}.` };
  });
}

export async function deleteSection(templateId: string, secId: string, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd), async () => {
    const t = await load(u.enterpriseId, templateId);
    await noRatings(t);
    const [s] = await sql`delete from evaluation_section where id = ${secId} and template_id = ${templateId} returning name`;
    return { msg: `${s?.name ?? 'The section'} section has been deleted.` };
  });
}
