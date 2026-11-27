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
      await sql.begin(async (tx) => {
        for (const sec of await tx`select * from evaluation_section where template_id = ${o.copy_from} order by display_seq, id`) {
          const [ns] = await tx`insert into evaluation_section (template_id, name, input_type, weight_pct, min_rating, max_rating, display_seq)
            values (${t.id}, ${sec.name}, ${sec.input_type}, ${sec.weight_pct}, ${sec.min_rating}, ${sec.max_rating}, ${sec.display_seq}) returning id`;
          await tx`insert into evaluation_section_value (section_id, label, value, display_seq) select ${ns.id}, label, value, display_seq from evaluation_section_value where section_id = ${sec.id}`;
        }
      });
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
    const lov = o.input_type === 'LOV';
    if (!(w > 0)) throw new Error('The weight must be above 0 (it is in marks – the weights of a template must total the Maximum marks of the subject it is used for)');
    if (!(max > 0)) throw new Error('Max must be above 0');
    if (Number.isNaN(min) || min < 0 || min > max) throw new Error('Min must be between 0 and Max');
    if (secId && lov) {
      const [out] = await sql`select string_agg(label, ', ') l from evaluation_section_value where section_id = ${secId} and (value < ${min} or value > ${max})`;
      if (out.l) throw new Error(`The list values ${out.l} are outside ${min}–${max} – change or remove them first.`);
    }
    const v = { name: o.name, input_type: lov ? 'LOV' : 'ENTRY', weight_pct: w, min_rating: min, max_rating: max, display_seq: Number(o.display_seq ?? 0) };
    let sid = secId;
    if (secId) await sql`update evaluation_section set ${sql(v)} where id = ${secId} and template_id = ${templateId}`;
    else sid = String((await sql`insert into evaluation_section ${sql({ ...v, template_id: templateId })} returning id`)[0].id);
    // a new list section starts with whole-number values Min..Max (up to 21), which can then be renamed or removed
    if (lov && !secId && Number.isInteger(min) && Number.isInteger(max) && max - min <= 20)
      for (let x = min; x <= max; x++) await sql`insert into evaluation_section_value (section_id, label, value, display_seq) values (${sid}, ${String(x)}, ${x}, ${x}) on conflict do nothing`;
    const [tot] = await sql`select coalesce(sum(weight_pct), 0)::float w from evaluation_section where template_id = ${templateId}`;
    return { msg: `${o.name} section has been ${secId ? 'updated' : 'added'}. ${t.name} now has a total weight of ${tot.w} – it fits subjects with ${tot.w} maximum marks.` };
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

/** Add, rename or remove a value of a list (LOV) section, e.g. "Excellent" = 10. */
export async function saveSectionValue(templateId: string, sectionId: string, valueId: string | null, fd: FormData) {
  const u = await requirePriv(PRIV, 'WRITE');
  await act(backOf(fd), async () => {
    const t = await load(u.enterpriseId, templateId);
    await noRatings(t);
    const [sec] = await sql`select * from evaluation_section where id = ${sectionId} and template_id = ${templateId}`;
    if (!sec) throw new Error('Section not found');
    const o = formObj(fd);
    if (o._delete && valueId) {
      const [d] = await sql`delete from evaluation_section_value where id = ${valueId} and section_id = ${sectionId} returning label`;
      return { msg: `${d?.label ?? 'The value'} has been removed from ${sec.name}.` };
    }
    const val = Number(o.value);
    if (o.value === null || Number.isNaN(val)) throw new Error('The value (a number) is required');
    if (val < Number(sec.min_rating) || val > Number(sec.max_rating)) throw new Error(`${sec.name} values must be between its Min ${Number(sec.min_rating)} and Max ${Number(sec.max_rating)}`);
    const label = o.label ?? String(val);
    const [dup] = await sql`select label from evaluation_section_value where section_id = ${sectionId} and value = ${val} and id <> ${valueId ?? 0}`;
    if (dup) throw new Error(`${sec.name} already has the value ${val} (${dup.label})`);
    if (valueId) await sql`update evaluation_section_value set label = ${label}, value = ${val} where id = ${valueId} and section_id = ${sectionId}`;
    else await sql`insert into evaluation_section_value (section_id, label, value, display_seq) values (${sectionId}, ${label}, ${val}, ${Math.round(val * 100)})`;
    return { msg: `${label} (${val}) has been ${valueId ? 'updated' : 'added'} to ${sec.name}.` };
  });
}
