import Link from 'next/link';
import { requirePriv, can } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP, s as one, here } from '@/components/ui';
import { ConfirmButton } from '@/components/client';
import { EditableForm } from '@/components/EditMode';
import { saveTemplate, deleteTemplate, saveSection, deleteSection } from './actions';

export default async function EvaluationTemplates({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_EVALUATION_TEMPLATE_PRV');
  const write = can(u, 'CD_EVALUATION_TEMPLATE_PRV', 'WRITE');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const back = here('/exams/templates', sp);
  const list = await sql`select t.*, (select count(*) from evaluation_section s where s.template_id = t.id)::int sections,
      (select count(distinct s.subject_id) from evaluation_section s where s.template_id = t.id)::int subjects,
      (select count(*) from exam e where e.evaluation_template_id = t.id)::int exams
    from evaluation_template t where t.enterprise_id = ${u.enterpriseId} order by t.active_flag desc, t.name`;
  const editId = one(sp.edit);
  const t = list.find((x) => String(x.id) === editId);
  const subjects = await refOptions('subjects', u.enterpriseId, asOf);

  return (
    <div className="max-w-6xl">
      <PageHeader title="Evaluation Templates"
        subtitle="How a subject is evaluated: sections (e.g. Lessons, Perfection, Speed & Stamina, Vanakkam Murai), each rating based or manual marks, with a weight % and a minimum and maximum. Chosen per subject of each grade in stop 5 of an exam's setup." />
      <Flash sp={sp} />
      <div className="card mb-4 overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Code</th><th>Name</th><th>Subjects</th><th>Sections</th><th>Used by exams</th><th>Active</th><th></th></tr></thead>
          <tbody>{list.map((x) => (
            <tr key={x.id} className={t && t.id === x.id ? 'bg-sky-50' : ''}>
              <td className="font-mono text-xs">{x.code}</td><td>{x.name}{x.description && <div className="text-xs text-slate-500">{x.description}</div>}</td>
              <td>{x.subjects}</td><td>{x.sections}</td><td>{x.exams}</td>
              <td><Badge color={x.active_flag === 'Y' ? 'green' : 'gray'}>{x.active_flag === 'Y' ? 'Active' : 'Inactive'}</Badge></td>
              <td className="whitespace-nowrap"><Link className="btn btn-sm" href={`/exams/templates?edit=${x.id}`}>{write ? 'Open / Edit' : 'View'}</Link></td>
            </tr>))}</tbody>
        </table>
        {!list.length && <Empty>No evaluation templates yet.</Empty>}
      </div>

      {t ? <Template /> : write && (
        <>
          <h2 className="h2">New Evaluation Template</h2>
          <form action={saveTemplate.bind(null, null)} className="card grid gap-3 sm:grid-cols-4">
            <Back to="/exams/templates" />
            <Field label="Code *"><input name="code" required className="input" placeholder="e.g. SILAMBAM_GRADE" /></Field>
            <Field label="Name *"><input name="name" required className="input" placeholder="e.g. Silambam Grade Evaluation" /></Field>
            <Field label="Copy sections from"><Select name="copy_from" options={list.map((x) => ({ value: String(x.id), label: x.name }))} empty="— Start empty —" /></Field>
            <Field label="Description"><input name="description" className="input" /></Field>
            <div className="sm:col-span-4"><button className="btn btn-primary">Create Template</button></div>
          </form>
        </>
      )}
    </div>
  );

  async function Template() {
    const secs = await sql`select s.*, (select name from subject_f f where f.id = s.subject_id order by effective_start_date desc limit 1) subject_name
      from evaluation_section s where s.template_id = ${t!.id} order by subject_name, s.display_seq, s.id`;
    const bySubject = new Map<string, typeof secs>();
    for (const s of secs) { const k = String(s.subject_id); if (!bySubject.has(k)) bySubject.set(k, [] as unknown as typeof secs); bySubject.get(k)!.push(s); }
    const addFor = one(sp.subject);
    const sectionRow = (sid: string, s?: (typeof secs)[number]) => (
      <form key={s?.id ?? `new-${sid}`} action={saveSection.bind(null, t!.id, s?.id ?? null)} className={`grid items-end gap-2 sm:grid-cols-[2fr_1.3fr_1fr_1fr_1fr_0.6fr_auto] ${s ? '' : 'rounded bg-green-50 p-2'}`}>
        <Back to={back} />
        <input type="hidden" name="subject_id" value={sid} />
        <input name="name" defaultValue={s?.name} placeholder="Section, e.g. Perfection" required className="input" disabled={!write} aria-label="Section" />
        <select name="input_type" defaultValue={s?.input_type ?? 'RATING'} className="input" disabled={!write} aria-label="Input type">
          <option value="RATING">Rating based</option><option value="MARK">Manual marks</option>
        </select>
        <input name="weight_pct" type="number" step="0.01" min="0.01" max="100" defaultValue={s ? Number(s.weight_pct) : ''} placeholder="Weight %" required className="input" disabled={!write} aria-label="Weight %" />
        <input name="min_rating" type="number" step="0.5" min="0" defaultValue={s ? Number(s.min_rating) : 0} className="input" disabled={!write} aria-label="Min" />
        <input name="max_rating" type="number" step="0.5" min="0.5" defaultValue={s ? Number(s.max_rating) : 10} required className="input" disabled={!write} aria-label="Max" />
        <input name="display_seq" type="number" defaultValue={s?.display_seq ?? (bySubject.get(sid)?.length ?? 0) + 1} className="input" disabled={!write} aria-label="Order" />
        {write && <div className="flex gap-1"><button className="btn btn-sm">{s ? 'Save' : 'Add'}</button></div>}
      </form>
    );
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="h2 mb-0">{t!.name}</h2><Link href="/exams/templates" className="btn btn-sm">Close</Link></div>
        <EditableForm action={saveTemplate.bind(null, t!.id)} canEdit={write}>
          <Back to={back} />
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Code *"><input name="code" defaultValue={t!.code} required className="input" /></Field>
            <Field label="Name *"><input name="name" defaultValue={t!.name} required className="input" /></Field>
            <Field label="Active"><select name="active_flag" defaultValue={t!.active_flag} className="input"><option value="Y">Yes</option><option value="N">No</option></select></Field>
            <Field label="Description"><input name="description" defaultValue={t!.description ?? ''} className="input" /></Field>
          </div>
        </EditableForm>

        {[...bySubject.entries()].map(([sid, rows]) => {
          const total = Math.round(rows.reduce((a, r) => a + Number(r.weight_pct), 0) * 100) / 100;
          return (
            <div key={sid} className="card space-y-2" id={`subject-${sid}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{rows[0].subject_name}</h3>
                <Badge color={Math.abs(total - 100) < 0.001 ? 'green' : 'amber'}>Weights total {total} %{Math.abs(total - 100) < 0.001 ? ' ✓' : ' – must be 100 %'}</Badge>
              </div>
              <div className="grid gap-2 text-xs font-semibold uppercase text-gray-600 sm:grid-cols-[2fr_1.3fr_1fr_1fr_1fr_0.6fr_auto]"><div>Section</div><div>Input</div><div>Weight %</div><div>Min</div><div>Max</div><div>Order</div><div /></div>
              {rows.map((r) => (
                <div key={r.id} className="flex items-end gap-1">
                  <div className="flex-1">{sectionRow(sid, r)}</div>
                  {write && <form action={deleteSection.bind(null, t!.id, r.id)}><Back to={back} /><ConfirmButton className="btn btn-sm" message={`Delete the ${r.name} section of ${r.subject_name}?`}>✕</ConfirmButton></form>}
                </div>
              ))}
              {write && total < 100 && sectionRow(sid)}
            </div>
          );
        })}
        {!bySubject.size && <div className="card muted">No sections yet. Choose a subject below and add its first section.</div>}

        {write && (
          <div className="card">
            <h3 className="mb-2 font-semibold">Add sections for a subject</h3>
            <form className="mb-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="edit" value={t!.id} />
              <Field label="Subject"><Select name="subject" options={subjects.filter((o) => !bySubject.has(o.value))} value={addFor} required /></Field>
              <button className="btn">Choose</button>
            </form>
            {addFor && !bySubject.has(addFor) && (
              <><p className="muted mb-1">First section of <b>{subjects.find((o) => o.value === addFor)?.label}</b> – entered by the examiner as a rating (chosen from Min to Max, e.g. 1 to 5) or as manual marks (typed, e.g. 0 to 25). The section weights of a subject must total 100 %.</p>{sectionRow(addFor)}</>
            )}
          </div>
        )}
        {write && (
          <form action={deleteTemplate.bind(null, t!.id)}><Back to={back} />
            <ConfirmButton className="btn btn-danger" message={`Delete the ${t!.name} evaluation template with all its sections?`}>Delete Template</ConfirmButton></form>
        )}
      </div>
    );
  }
}
