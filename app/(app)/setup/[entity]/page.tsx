import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { getEntity } from '@/lib/entities';
import { entityList, entityNotEffective, refNames } from '@/lib/dt';
import { lk } from '@/lib/lookups';
import { fmtDate } from '@/lib/util';
import { PageHeader, Flash, Badge, Empty, type SP, s } from '@/components/ui';

export default async function EntityList({ params, searchParams }: { params: Promise<{ entity: string }>; searchParams: SP }) {
  const u = await requirePriv(getEntity((await params).entity)?.priv ?? 'CD_NONE');
  const { entity } = await params;
  const sp = await searchParams;
  const e = getEntity(entity);
  if (!e) notFound();
  const asOf = await getAsOf();
  const q = s(sp.q);
  const [rows, others, L] = [await entityList(e, u.enterpriseId, asOf, q), await entityNotEffective(e, u.enterpriseId, asOf), await lk()];
  const listFields = e.fields.filter((f) => f.list);
  const refMaps: Record<string, Record<string, string>> = {};
  for (const f of listFields) if (f.type === 'ref') refMaps[f.name] = await refNames(f.ref!, u.enterpriseId, asOf);
  const show = (f: (typeof listFields)[number], v: any) => {
    if (v === null || v === undefined || v === '') return '';
    if (f.type === 'lookup') return L(f.lookup!, v);
    if (f.type === 'multilookup') return String(v).split(',').map((c) => L(f.lookup!, c)).join(', ');
    if (f.type === 'yesno') return v === 'Y' ? <Badge color="green">Yes</Badge> : <Badge color="gray">No</Badge>;
    if (f.type === 'ref') return refMaps[f.name][String(v)] ?? v;
    if (f.type === 'time') return String(v).slice(0, 5);
    if (f.type === 'color') return <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ background: v }} />{v}</span>;
    return String(v);
  };
  return (
    <div>
      <PageHeader title={e.plural} subtitle={<>{e.description} Showing records effective on <b>{fmtDate(asOf)}</b>.</>}
        actions={can(u, e.priv, 'WRITE') ? <Link href={`/setup/${entity}/new`} className="btn btn-primary">+ Create {e.label}</Link> : null} />
      <Flash sp={sp} />
      <div className="card">
        <form className="mb-3 flex gap-2">
          <input name="q" defaultValue={q ?? ''} placeholder="Search code or name" className="input max-w-xs" />
          <button className="btn">Search</button>
        </form>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Code</th><th>Name</th>{listFields.map((f) => <th key={f.name}>{f.label}</th>)}<th>Effective From</th><th>Effective To</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link className="link" href={`/setup/${entity}/${r.id}`}>{r.code}</Link></td>
                  <td>{r.name}</td>
                  {listFields.map((f) => <td key={f.name}>{show(f, r[f.name])}</td>)}
                  <td>{fmtDate(r.effective_start_date)}</td>
                  <td>{fmtDate(r.effective_end_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty />}
        </div>
      </div>
      {entity === 'positions' && rows.length > 0 && <PositionTree rows={rows} />}
      {others.length > 0 && (
        <div className="card mt-4">
          <h2 className="h2">Not effective on {fmtDate(asOf)} (future-dated or ended)</h2>
          <table className="tbl">
            <thead><tr><th>Code</th><th>Name</th><th>First Start</th><th>Last End</th></tr></thead>
            <tbody>{others.map((r) => (
              <tr key={r.id}><td><Link className="link" href={`/setup/${entity}/${r.id}`}>{r.code}</Link></td><td>{r.name}</td><td>{fmtDate(r.first_start)}</td><td>{fmtDate(r.last_end)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Position hierarchy as of the date (parent → children). */
function PositionTree({ rows }: { rows: any[] }) {
  const byParent = new Map<string, any[]>();
  const ids = new Set(rows.map((r) => String(r.id)));
  for (const r of rows) {
    const p = r.parent_position_id && ids.has(String(r.parent_position_id)) ? String(r.parent_position_id) : 'ROOT';
    byParent.set(p, [...(byParent.get(p) ?? []), r]);
  }
  const Node = ({ r, depth }: { r: any; depth: number }): React.ReactNode => (
    <li>
      <div className="flex items-center gap-2 py-0.5" style={{ paddingLeft: depth * 20 }}>
        <span className="text-gray-400">{depth ? '└' : '•'}</span>
        <Link className="link" href={`/setup/positions/${r.id}`}>{r.name}</Link>
        <span className="text-xs text-gray-500">{r.code} · headcount {r.headcount}</span>
      </div>
      {(byParent.get(String(r.id)) ?? []).length > 0 && <ul>{byParent.get(String(r.id))!.map((c) => <Node key={c.id} r={c} depth={depth + 1} />)}</ul>}
    </li>
  );
  return (
    <div className="card mt-4">
      <h2 className="h2">Position Hierarchy</h2>
      <ul className="text-sm">{(byParent.get('ROOT') ?? []).map((r) => <Node key={r.id} r={r} depth={0} />)}</ul>
    </div>
  );
}
