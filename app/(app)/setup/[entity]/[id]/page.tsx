import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { getEntity, type Field as EField } from '@/lib/entities';
import { entityRow, dtHistory, datedRefOptions, datedLookupOptions, nameOn, type DatedOpt } from '@/lib/dt';
import { usages } from '@/lib/integrity';
import { activeFields, fieldDisplay } from '@/lib/fields';
import { fmtDate, fmtDateTime } from '@/lib/util';
import { EntityFields } from '@/components/EntityFields';
import { ConfirmButton } from '@/components/client';
import { PageHeader, Flash, Field, Back, Badge, type SP, here, s } from '@/components/ui';
import { updateEntity, correctVersion, endDateEntity, deleteLatestVersion, deleteEntity } from '../../actions';

export default async function EntityDetail({ params, searchParams }: { params: Promise<{ entity: string; id: string }>; searchParams: SP }) {
  const u = await requirePriv(getEntity((await params).entity)?.priv ?? 'CD_NONE', 'READ');
  const { entity, id } = await params;
  const sp = await searchParams;
  const e = getEntity(entity);
  if (!e) notFound();
  const asOf = await getAsOf();
  const row = await entityRow(e, id, asOf);
  if (!row) notFound();
  const history = await dtHistory(e.table, id);
  const versionStart = s(sp.version);
  const version = versionStart ? history.find((h) => h.effective_start_date === versionStart) : null;
  const back = here(`/setup/${entity}/${id}`, sp);
  const used = await usages(sql, e.table, id);

  // names as they were on each history row's date
  const dated: Record<string, DatedOpt[]> = {};
  for (const f of e.fields) {
    if (f.type === 'ref') dated[f.name] = await datedRefOptions(f.ref!, u.enterpriseId);
    if (f.type === 'lookup' || f.type === 'multilookup' || f.type === 'yesno') dated[f.name] = await datedLookupOptions(f.type === 'yesno' ? 'YES_NO' : f.lookup!);
  }
  const fmt = (f: EField, v: any, date: string) => {
    if (v === null || v === undefined || v === '') return '';
    if (f.type === 'multilookup') return String(v).split(',').map((c) => nameOn(dated[f.name], c, date)).join(', ');
    if (f.type === 'ref' || f.type === 'lookup' || f.type === 'yesno') return nameOn(dated[f.name], v, date);
    if (f.type === 'color') return <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ background: v }} />{v}</span>;
    return String(v);
  };
  const extra = await activeFields(u.enterpriseId, `setup:${entity}`);
  const showExtra = await fieldDisplay(extra);
  const effective = !!row.effective_start_date;
  const prevOfVersion = version ? history.find((h) => h.effective_end_date < version.effective_start_date) : null;

  return (
    <div className="max-w-6xl">
      <PageHeader title={`${e.label}: ${row.name ?? history[0]?.name ?? ''}`}
        subtitle={<>Code <b>{row.code}</b> (locked) · viewing as of <b>{fmtDate(asOf)}</b> · {history.length} version(s)</>}
        actions={<Link href={`/setup/${entity}`} className="btn">Back to list</Link>} />
      <Flash sp={sp} />

      {version ? (
        <form action={correctVersion.bind(null, entity, id, version.effective_start_date)} className="card mb-4 border-blue-300">
          <Back to={back} />
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-blue-50 p-3 text-sm">
            <span>
              <b>Correcting the version {fmtDate(version.effective_start_date)} → {fmtDate(version.effective_end_date)}.</b>{' '}
              {prevOfVersion ? <>Changing the start date also moves the end of the previous version (starts {fmtDate(prevOfVersion.effective_start_date)}).</> : <>This is the first version – you can move the record&apos;s start date.</>}
            </span>
            <Link href={`/setup/${entity}/${id}`} className="btn btn-sm">Cancel</Link>
          </div>
          <div className="grid-form">
            <Field label="Effective Start Date *"><input type="date" name="effective_start_date" defaultValue={version.effective_start_date}
              max={version.effective_end_date === '4712-12-31' ? undefined : version.effective_end_date} required className="input" /></Field>
            <Field label="Effective End Date"><input value={fmtDate(version.effective_end_date)} disabled className="input" /></Field>
            <Field label="Code"><input value={row.code} disabled className="input" /></Field>
            <Field label="Name *"><input name="name" defaultValue={version.name} required className="input" /></Field>
            <EntityFields e={e} values={{ ...version, id }} enterpriseId={u.enterpriseId} dateField="effective_start_date" />
            <Field label="Description" className="sm:col-span-2 lg:col-span-3"><textarea name="description" defaultValue={version.description ?? ''} className="input" rows={2} /></Field>
          </div>
          <div className="mt-4"><button className="btn btn-primary">Save Correction</button></div>
        </form>
      ) : !effective ? (
        <div className="card mb-4 border-amber-300 bg-amber-50 text-sm">
          This record is not effective on {fmtDate(asOf)}. Use <b>Correct</b> on a version below, or change the <b>As of</b> date in the header.
        </div>
      ) : (
        <form action={updateEntity.bind(null, entity, id)} className="card mb-4">
          <Back to={back} />
          <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md bg-black/[0.03] p-3">
            <Field label="Change Mode">
              <select name="mode" className="input" defaultValue="UPDATE">
                <option value="UPDATE">Update – new version from effective date</option>
                <option value="CORRECT">Correct – fix the version current on that date</option>
              </select>
            </Field>
            <Field label="Effective Date"><input type="date" name="effective_date" defaultValue={asOf} className="input" required /></Field>
            <div className="muted pb-2">Current version: {fmtDate(row.effective_start_date)} → {fmtDate(row.effective_end_date)}</div>
          </div>
          <div className="grid-form">
            <Field label="Code"><input value={row.code} disabled className="input" /></Field>
            <Field label="Name *"><input name="name" defaultValue={row.name} required className="input" /></Field>
            <EntityFields e={e} values={row} enterpriseId={u.enterpriseId} dateField="effective_date" />
            <Field label="Description" className="sm:col-span-2 lg:col-span-3"><textarea name="description" defaultValue={row.description ?? ''} className="input" rows={2} /></Field>
          </div>
          <div className="mt-4"><button className="btn btn-primary">Save</button></div>
        </form>
      )}

      <div className="card mb-4">
        <h2 className="h2">Date-Effective History</h2>
        <p className="muted mb-2">Names of related records are shown as they were on each version&apos;s start date. Use <b>Correct</b> to change any saved version, including its start date.</p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>From</th><th>To</th><th>Name</th>{e.fields.map((f) => <th key={f.name}>{f.label}</th>)}{extra.map((f) => <th key={f.field_code}>{f.label}</th>)}<th>Last Updated</th><th></th></tr></thead>
            <tbody>
              {history.map((h) => {
                const cur = asOf >= h.effective_start_date && asOf <= h.effective_end_date;
                const editing = version?.effective_start_date === h.effective_start_date;
                return (
                  <tr key={h.effective_start_date} className={editing ? 'bg-blue-50' : cur ? 'bg-amber-50' : ''}>
                    <td className="whitespace-nowrap">{fmtDate(h.effective_start_date)} {cur && <Badge color="amber">as of</Badge>}</td>
                    <td className="whitespace-nowrap">{fmtDate(h.effective_end_date)}</td>
                    <td>{h.name}</td>
                    {e.fields.map((f) => <td key={f.name}>{fmt(f, h[f.name], h.effective_start_date)}</td>)}
                    {extra.map((f) => <td key={f.field_code}>{showExtra(f, h.attributes?.[f.field_code])}</td>)}
                    <td className="whitespace-nowrap text-xs text-gray-500">{h.last_updated_by} · {fmtDateTime(h.last_update_date)}</td>
                    <td><Link href={`/setup/${entity}/${id}?version=${h.effective_start_date}`} className="btn btn-sm">Correct</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <form action={endDateEntity.bind(null, entity, id)} className="card">
          <Back to={back} />
          <h2 className="h2">End Date (Inactivate)</h2>
          <p className="muted mb-2">The record stops being effective after this date. Later versions are removed. Not allowed while other records still use it after that date.</p>
          <div className="flex gap-2"><input type="date" name="end_date" defaultValue={asOf} className="input" required />
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
        <form action={deleteEntity.bind(null, entity, id)} className="card">
          <Back to={back} />
          <h2 className="h2">Delete {e.label}</h2>
          {used.length ? (
            <p className="text-sm text-gray-600">Cannot be deleted – it is used by: <b>{used.map((x) => `${x.label} (${x.count})`).join(', ')}</b>. End-date it instead.</p>
          ) : (
            <>
              <p className="muted mb-2">Not used anywhere. Deleting removes the record and all its history permanently.</p>
              <ConfirmButton className="btn btn-danger" message={`Permanently delete ${row.code}?`}>Delete</ConfirmButton>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
