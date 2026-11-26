import Link from 'next/link';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PageHeader, Flash, Field, Select, Back, Badge, Empty, type SP, s as one, here } from '@/components/ui';
import { ConfirmButton } from '@/components/client';
import { EditableForm } from '@/components/EditMode';
import { saveScale, deleteScale, saveBand } from './actions';

/** Exams › Grading Ranges: the rating for each range of marks (out of 100). */
export default async function GradingRanges({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_GRADING_RANGE_PRV');
  const write = can(u, 'CD_GRADING_RANGE_PRV', 'WRITE');
  const sp = await searchParams;
  const back = here('/exams/grading', sp);
  const list = await sql`select s.*, (select count(*) from grading_band b where b.scale_id = s.id)::int bands,
      (select string_agg(b.rating || ' ' || (b.mark_from::float)::text || '–' || (b.mark_to::float)::text, ' · ' order by b.mark_from desc) from grading_band b where b.scale_id = s.id) summary,
      (select count(*) from exam e where e.grading_scale_id = s.id)::int exams
    from grading_scale s where s.enterprise_id = ${u.enterpriseId} order by s.active_flag desc, s.name`;
  const sc = list.find((x) => String(x.id) === one(sp.edit));

  return (
    <div className="max-w-6xl">
      <PageHeader title="Grading Ranges" subtitle="The rating for each range of marks – e.g. 90 to 100 = A+, 75 to 89.99 = A. Marks are out of 100 (a subject's mark and the overall % are converted). Attached to an exam in stop 6 of its setup." />
      <Flash sp={sp} />
      <div className="card mb-4 overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Code</th><th>Name</th><th>Ranges</th><th>Used by exams</th><th>Active</th><th></th></tr></thead>
          <tbody>{list.map((x) => (
            <tr key={x.id} className={sc && sc.id === x.id ? 'bg-sky-50' : ''}>
              <td className="font-mono text-xs">{x.code}</td><td>{x.name}{x.description && <div className="text-xs text-slate-500">{x.description}</div>}</td>
              <td className="text-xs">{x.summary ?? <span className="text-amber-700">no ranges yet</span>}</td><td>{x.exams}</td>
              <td><Badge color={x.active_flag === 'Y' ? 'green' : 'gray'}>{x.active_flag === 'Y' ? 'Active' : 'Inactive'}</Badge></td>
              <td><Link className="btn btn-sm" href={`/exams/grading?edit=${x.id}`}>{write ? 'Open / Edit' : 'View'}</Link></td>
            </tr>))}</tbody>
        </table>
        {!list.length && <Empty>No grading ranges yet.</Empty>}
      </div>
      {sc ? <Scale /> : write && (
        <>
          <h2 className="h2">New Grading Range</h2>
          <form action={saveScale.bind(null, null)} className="card grid gap-3 sm:grid-cols-4">
            <Back to="/exams/grading" />
            <Field label="Code *"><input name="code" required className="input" placeholder="e.g. STANDARD" /></Field>
            <Field label="Name *"><input name="name" required className="input" placeholder="e.g. Standard Grading" /></Field>
            <Field label="Copy ranges from"><Select name="copy_from" options={list.map((x) => ({ value: String(x.id), label: x.name }))} empty="— Start empty —" /></Field>
            <Field label="Description"><input name="description" className="input" /></Field>
            <div className="sm:col-span-4"><button className="btn btn-primary">Create Grading Range</button></div>
          </form>
        </>
      )}
    </div>
  );

  async function Scale() {
    const bands = await sql`select * from grading_band where scale_id = ${sc!.id} order by mark_from desc`;
    const cols = 'sm:grid-cols-[1fr_1fr_1.2fr_2fr_auto_auto]';
    const lowest = bands.length ? Math.min(...bands.map((b) => Number(b.mark_from))) : null;
    const row = (b?: (typeof bands)[number]) => (
      <form key={b?.id ?? `new-${bands.length}`} action={saveBand.bind(null, sc!.id, b?.id ?? null)} className={`grid items-center gap-2 ${cols} ${b ? '' : 'rounded bg-green-50 p-2'}`}>
        <Back to={back} />
        <input name="mark_from" type="number" step="0.01" min="0" max="100" defaultValue={b ? Number(b.mark_from) : ''} required className="input" disabled={!write} aria-label="Mark From" />
        <input name="mark_to" type="number" step="0.01" min="0" max="100" defaultValue={b ? Number(b.mark_to) : lowest !== null ? Math.max(0, Math.round((lowest - 0.01) * 100) / 100) : 100} required className="input" disabled={!write} aria-label="Mark To" />
        <input name="rating" defaultValue={b?.rating} placeholder="e.g. A+" required className="input" disabled={!write} aria-label="Rating" />
        <input name="description" defaultValue={b?.description ?? ''} placeholder="e.g. Outstanding (optional)" className="input" disabled={!write} aria-label="Description" />
        {write ? <button className="btn btn-sm">{b ? 'Save' : 'Add'}</button> : <span />}
        {write && b ? <ConfirmButton className="btn btn-sm" name="_delete" value="1" message={`Delete the ${b.rating} range?`}>✕</ConfirmButton> : <span />}
      </form>
    );
    // gaps between ranges (marks that would get no rating)
    const sorted = [...bands].sort((a, b) => Number(a.mark_from) - Number(b.mark_from));
    const gaps: string[] = [];
    if (sorted.length && Number(sorted[0].mark_from) > 0) gaps.push(`0–${Number(sorted[0].mark_from)}`);
    for (let i = 1; i < sorted.length; i++) if (Number(sorted[i].mark_from) - Number(sorted[i - 1].mark_to) > 0.011) gaps.push(`${Number(sorted[i - 1].mark_to)}–${Number(sorted[i].mark_from)}`);
    if (sorted.length && Number(sorted[sorted.length - 1].mark_to) < 100) gaps.push(`${Number(sorted[sorted.length - 1].mark_to)}–100`);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="h2 mb-0">{sc!.name}</h2><Link href="/exams/grading" className="btn btn-sm">Close</Link></div>
        <EditableForm action={saveScale.bind(null, sc!.id)} canEdit={write}>
          <Back to={back} />
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Code *"><input name="code" defaultValue={sc!.code} required className="input" /></Field>
            <Field label="Name *"><input name="name" defaultValue={sc!.name} required className="input" /></Field>
            <Field label="Active"><select name="active_flag" defaultValue={sc!.active_flag} className="input"><option value="Y">Yes</option><option value="N">No</option></select></Field>
            <Field label="Description"><input name="description" defaultValue={sc!.description ?? ''} className="input" /></Field>
          </div>
        </EditableForm>
        <div className="card space-y-2">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">Mark Ranges</h3>
            {bands.length > 0 && (gaps.length ? <Badge color="amber">Not covered: {gaps.join(', ')}</Badge> : <Badge color="green">0 to 100 covered ✓</Badge>)}</div>
          <p className="muted">Marks out of 100. Ranges may not overlap – e.g. 90 to 100, then 75 to 89.99. A mark in no range gets no rating.</p>
          <div className={`hidden gap-2 text-xs font-semibold uppercase text-gray-600 sm:grid ${cols}`}><div>Mark From</div><div>Mark To</div><div>Rating</div><div>Description</div><div /><div /></div>
          {bands.map((b) => row(b))}
          {write && row()}
          {!bands.length && !write && <Empty>No ranges yet.</Empty>}
        </div>
        {write && (
          <form action={deleteScale.bind(null, sc!.id)}><Back to={back} />
            <ConfirmButton className="btn btn-danger" message={`Delete the ${sc!.name} grading range?`}>Delete Grading Range</ConfirmButton></form>)}
      </div>
    );
  }
}
