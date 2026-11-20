import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { getEntity } from '@/lib/entities';
import { entityRow, dtHistory, refNames } from '@/lib/dt';
import { lk } from '@/lib/lookups';
import { fmtDate, fmtDateTime } from '@/lib/util';
import { EntityFields } from '@/components/EntityFields';
import { ConfirmButton } from '@/components/client';
import { PageHeader, Flash, Field, Back, Badge, type SP, here } from '@/components/ui';
import { updateEntity, endDateEntity, deleteLatestVersion } from '../../actions';

export default async function EntityDetail({ params, searchParams }: { params: Promise<{ entity: string; id: string }>; searchParams: SP }) {
  const u = await requireUser('ADMIN');
  const { entity, id } = await params;
  const sp = await searchParams;
  const e = getEntity(entity);
  if (!e) notFound();
  const asOf = await getAsOf();
  const row = await entityRow(e, id, asOf);
  if (!row) notFound();
  const history = await dtHistory(e.table, id);
  const L = await lk();
  const refMaps: Record<string, Record<string, string>> = {};
  for (const f of e.fields) if (f.type === 'ref') refMaps[f.name] = await refNames(f.ref!, u.enterpriseId, asOf);
  const effective = !!row.effective_start_date;
  const back = here(`/setup/${entity}/${id}`, sp);
  const fmt = (f: (typeof e.fields)[number], v: any) =>
    v === null || v === undefined ? '' : f.type === 'lookup' ? L(f.lookup!, v) : f.type === 'ref' ? refMaps[f.name][String(v)] ?? v : f.type === 'yesno' ? L('YES_NO', v) : String(v);
  return (
    <div className="max-w-6xl">
      <PageHeader title={`${e.label}: ${row.name ?? history[0]?.name ?? ''}`}
        subtitle={<>Code <b>{row.code}</b> · viewing as of <b>{fmtDate(asOf)}</b></>}
        actions={<Link href={`/setup/${entity}`} className="btn">Back to list</Link>} />
      <Flash sp={sp} />
      {!effective ? (
        <div className="card mb-4 border-amber-300 bg-amber-50 text-sm">
          This record is not effective on {fmtDate(asOf)}. Change the <b>As of</b> date in the header to a date within one of the versions below to view or edit it.
        </div>
      ) : (
        <form action={updateEntity.bind(null, entity, id)} className="card mb-4">
          <Back to={back} />
          <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md bg-black/[0.03] p-3">
            <Field label="Change Mode">
              <select name="mode" className="input" defaultValue="UPDATE">
                <option value="UPDATE">Update – new version from effective date</option>
                <option value="CORRECT">Correct – fix the current version</option>
              </select>
            </Field>
            <Field label="Effective Date"><input type="date" name="effective_date" defaultValue={asOf} className="input" required /></Field>
            <div className="muted pb-2">Current version: {fmtDate(row.effective_start_date)} → {fmtDate(row.effective_end_date)}</div>
          </div>
          <div className="grid-form">
            <Field label="Code"><input value={row.code} disabled className="input" /></Field>
            <Field label="Name *"><input name="name" defaultValue={row.name} required className="input" /></Field>
            <EntityFields e={e} values={row} asOf={asOf} enterpriseId={u.enterpriseId} />
            <Field label="Description" className="sm:col-span-2 lg:col-span-3"><textarea name="description" defaultValue={row.description ?? ''} className="input" rows={2} /></Field>
          </div>
          <div className="mt-4"><button className="btn btn-primary">Save</button></div>
        </form>
      )}

      <div className="card mb-4">
        <h2 className="h2">Date-Effective History</h2>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>From</th><th>To</th><th>Name</th>{e.fields.map((f) => <th key={f.name}>{f.label}</th>)}<th>Last Updated</th></tr></thead>
            <tbody>
              {history.map((h) => {
                const cur = asOf >= h.effective_start_date && asOf <= h.effective_end_date;
                return (
                  <tr key={h.effective_start_date} className={cur ? 'bg-amber-50' : ''}>
                    <td>{fmtDate(h.effective_start_date)} {cur && <Badge color="amber">as of</Badge>}</td>
                    <td>{fmtDate(h.effective_end_date)}</td>
                    <td>{h.name}</td>
                    {e.fields.map((f) => <td key={f.name}>{fmt(f, h[f.name])}</td>)}
                    <td className="whitespace-nowrap text-xs text-gray-500">{h.last_updated_by} · {fmtDateTime(h.last_update_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <form action={endDateEntity.bind(null, entity, id)} className="card">
          <Back to={back} />
          <h2 className="h2">End Date (Inactivate)</h2>
          <p className="muted mb-2">The record stops being effective after this date. Later versions are removed.</p>
          <div className="flex gap-2"><input type="date" name="end_date" defaultValue={asOf} className="input max-w-[12rem]" required />
            <ConfirmButton className="btn btn-danger" message="End-date this record?">End Date</ConfirmButton></div>
        </form>
        {history.length > 1 && (
          <form action={deleteLatestVersion.bind(null, entity, id)} className="card">
            <Back to={back} />
            <h2 className="h2">Undo Last Change</h2>
            <p className="muted mb-2">Removes the latest version ({fmtDate(history[0].effective_start_date)}) and re-opens the previous one.</p>
            <ConfirmButton className="btn" message="Remove the latest version?">Delete Latest Version</ConfirmButton>
          </form>
        )}
      </div>
    </div>
  );
}
