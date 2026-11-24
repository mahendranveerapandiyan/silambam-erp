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
      await sql`insert into evaluation_section (template_id, subject_id, name, weight_pct, min_rating, max_rating, display_seq)
        select ${t.id}, subject_id, name, weight_pct, min_rating, max_rating, display_seq from evaluation_section where template_id = ${o.copy_from}`;
    }
    return { to: `/exams/templates?edit=${t.id}`, msg: `${o.name} evaluation template has been created. Now add the sections for each subject.` };
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
    if (!o.subject_id || !o.name) throw new Error('Subject and section name are required');
    const w = Number(o.weight_pct), min = Number(o.min_rating ?? 0), max = Number(o.max_rating);
    if (!(w > 0 && w <= 100)) throw new Error('The weight must be above 0 and at most 100 %');
    if (!(max > 0)) throw new Error('The maximum rating must be above 0');
    if (Number.isNaN(min) || min < 0 || min > max) throw new Error('The minimum rating must be between 0 and the maximum');
    const [others] = await sql`select coalesce(sum(weight_pct), 0)::float t from evaluation_section where template_id = ${templateId} and subject_id = ${o.subject_id} and id <> ${secId ?? 0}`;
    if (others.t + w > 100.001) throw new Error(`The section weights of a subject cannot exceed 100 % – ${100 - others.t} % is left for this subject.`);
    const v = { subject_id: o.subject_id, name: o.name, weight_pct: w, min_rating: min, max_rating: max, display_seq: Number(o.display_seq ?? 0) };
    if (secId) await sql`update evaluation_section set ${sql(v)} where id = ${secId} and template_id = ${templateId}`;
    else await sql`insert into evaluation_section ${sql({ ...v, template_id: templateId })}`;
    const left = 100 - others.t - w;
    return { msg: `${o.name} section has been ${secId ? 'updated' : 'added'}.${left > 0.001 ? ` ${Math.round(left * 100) / 100} % of the subject's weight is still to be given to sections.` : ''}` };
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
