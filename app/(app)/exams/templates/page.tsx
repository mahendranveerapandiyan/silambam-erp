import Link from 'next/link';
import { requirePriv, can } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP, s as one, here } from '@/components/ui';
import { ConfirmButton } from '@/components/client';
import { EditableForm } from '@/components/EditMode';
import { saveTemplate, deleteTemplate, saveSection, saveSectionValue } from './actions';

export default async function EvaluationTemplates({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_EVALUATION_TEMPLATE_PRV');
  const write = can(u, 'CD_EVALUATION_TEMPLATE_PRV', 'WRITE');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const back = here('/exams/templates', sp);
  const list = await sql`select t.*, (select count(*) from evaluation_section s where s.template_id = t.id)::int sections,
      (select coalesce(sum(s.weight_pct), 0)::float from evaluation_section s where s.template_id = t.id) weight_total,
      (select count(distinct es.exam_id) from exam_subject es left join exam_subject_component c on c.exam_subject_id = es.id
        where es.evaluation_template_id = t.id or c.evaluation_template_id = t.id)::int exams
    from evaluation_template t where t.enterprise_id = ${u.enterpriseId} order by t.active_flag desc, t.name`;
  const editId = one(sp.edit);
  const t = list.find((x) => String(x.id) === editId);

  return (
    <div className="max-w-6xl">
      <PageHeader title="Evaluation Templates"
        subtitle="How a subject is evaluated: sections (e.g. Lessons, Perfection, Speed & Stamina, Vanakkam Murai), each a list of values or entered by the examiner, with a weight (marks) and the Min / Max that may be entered. A template can be used for any subject whose Maximum marks equal its total weight – chosen in stop 5 of an exam's setup." />
      <Flash sp={sp} />
      <div className="card mb-4 overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Code</th><th>Name</th><th>Sections</th><th>Total Weight</th><th>Used by exams</th><th>Active</th><th></th></tr></thead>
          <tbody>{list.map((x) => (
            <tr key={x.id} className={t && t.id === x.id ? 'bg-sky-50' : ''}>
              <td className="font-mono text-xs">{x.code}</td><td>{x.name}{x.description && <div className="text-xs text-slate-500">{x.description}</div>}</td>
              <td>{x.sections}</td><td>{x.sections ? <>{x.weight_total} <span className="text-xs text-slate-500">→ for subjects with max {x.weight_total}</span></> : '—'}</td><td>{x.exams}</td>
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
    const secs = await sql`select s.* from evaluation_section s where s.template_id = ${t!.id} order by s.display_seq, s.id`;
    const vals = secs.length ? await sql`select * from evaluation_section_value where section_id in ${sql(secs.map((x) => x.id))} order by display_seq, value` : [];
    const total = Math.round(secs.reduce((a, r) => a + Number(r.weight_pct), 0) * 100) / 100;
    const cols = 'sm:grid-cols-[2fr_1.4fr_1fr_1fr_1fr_0.6fr_auto_auto]';
    const sectionRow = (s?: (typeof secs)[number]) => (
      <form key={s?.id ?? `new-${secs.length}`} action={saveSection.bind(null, t!.id, s?.id ?? null)} className={`grid items-center gap-2 ${cols} ${s ? '' : 'rounded bg-green-50 p-2'}`}>
        <Back to={back} />
        <input name="name" defaultValue={s?.name} placeholder="e.g. Perfection" required className="input" disabled={!write} aria-label="Section" />
        <select name="input_type" defaultValue={s?.input_type ?? 'ENTRY'} className="input" disabled={!write} aria-label="Input type">
          <option value="ENTRY">User entered</option><option value="LOV">List of values (LOV)</option>
        </select>
        <input name="weight_pct" type="number" step="0.01" min="0.01" defaultValue={s ? Number(s.weight_pct) : ''} placeholder="Weight" required className="input" disabled={!write} aria-label="Weight" />
        <input name="min_rating" type="number" step="0.01" min="0" defaultValue={s ? Number(s.min_rating) : 0} className="input" disabled={!write} aria-label="Min" />
        <input name="max_rating" type="number" step="0.01" min="0.01" defaultValue={s ? Number(s.max_rating) : 10} required className="input" disabled={!write} aria-label="Max" />
        <input name="display_seq" type="number" defaultValue={s?.display_seq ?? secs.length + 1} className="input" disabled={!write} aria-label="Order" />
        {write ? <button className="btn btn-sm">{s ? 'Save' : 'Add'}</button> : <span />}
        {write && s ? <ConfirmButton className="btn btn-sm" message={`Delete the ${s.name} section?`} name="_delete" value="1">✕</ConfirmButton> : <span />}
      </form>
    );
    const lovEditor = (s: (typeof secs)[number]) => {
      const mine = vals.filter((v) => String(v.section_id) === String(s.id));
      return (
        <div key={`lov-${s.id}`} className="mb-2 ml-4 rounded border-l-4 border-sky-200 bg-sky-50/50 p-2" data-lov-for={s.name}>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-600">{s.name} – list values <span className="font-normal normal-case">(label shown to the examiner = value counted, between {Number(s.min_rating)} and {Number(s.max_rating)})</span></div>
          <div className="flex flex-wrap items-center gap-1">
            {mine.map((v) => (
              <form key={v.id} action={saveSectionValue.bind(null, t!.id, s.id, v.id)} className="inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-sm">
                <Back to={back} /><input type="hidden" name="label" value={v.label} /><input type="hidden" name="value" value={Number(v.value)} />
                {v.label}{v.label !== String(Number(v.value)) && <span className="text-xs text-slate-500">= {Number(v.value)}</span>}
                {write && <ConfirmButton className="text-slate-400 hover:text-red-600" name="_delete" value="1" message={`Remove ${v.label} from ${s.name}?`}>×</ConfirmButton>}
              </form>))}
            {!mine.length && <span className="text-sm text-amber-700">No values yet – add at least one.</span>}
            {write && (
              <form action={saveSectionValue.bind(null, t!.id, s.id, null)} className="ml-2 inline-flex items-center gap-1">
                <Back to={back} />
                <input name="label" placeholder="Label, e.g. Excellent" className="input h-8 w-40" aria-label={`${s.name} value label`} />
                <input name="value" type="number" step="0.01" min={Number(s.min_rating)} max={Number(s.max_rating)} placeholder="Value" required className="input h-8 w-24" aria-label={`${s.name} value`} />
                <button className="btn btn-sm">+ Add value</button>
              </form>)}
          </div>
        </div>
      );
    };
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

        <div className="card space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">Sections</h3>
            {secs.length > 0 && <Badge color="blue">Total weight {total} – fits subjects with Maximum marks {total}</Badge>}
          </div>
          <p className="muted">User entered: the examiner types a value between Min and Max. List of values: the examiner picks from the values you add (e.g. Excellent = 10, Good = 7). Min and Max are the only values that can be entered. The weight is in marks: a section scores weight × value ÷ Max, and the template fits a subject (or a part of a combined subject) whose Maximum marks equal the total weight.</p>
          <div className={`hidden gap-2 text-xs font-semibold uppercase text-gray-600 sm:grid ${cols}`}><div>Section</div><div>Input</div><div>Weight (marks)</div><div>Min</div><div>Max</div><div>Order</div><div /><div /></div>
          {secs.map((r) => [sectionRow(r), r.input_type === 'LOV' ? lovEditor(r) : null])}
          {write && sectionRow()}
          {!secs.length && !write && <Empty>No sections yet.</Empty>}
        </div>
        {write && (
          <form action={deleteTemplate.bind(null, t!.id)}><Back to={back} />
            <ConfirmButton className="btn btn-danger" message={`Delete the ${t!.name} evaluation template with all its sections?`}>Delete Template</ConfirmButton></form>
        )}
      </div>
    );
  }
}
