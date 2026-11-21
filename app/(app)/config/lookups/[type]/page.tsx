import Link from 'next/link';
import { EditableForm, EditScope } from '@/components/EditMode';
import { notFound } from 'next/navigation';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { lookupPrivs } from '@/lib/menu';
import { lookupUsage, describeUsage } from '@/lib/lookupUsage';
import { PageHeader, Flash, Badge, Back, type SP } from '@/components/ui';
import { ConfirmButton } from '@/components/client';
import { saveLookupValue, deleteLookupValue, updateLookupType } from '../../actions';

const cols = 'grid grid-cols-[7rem_1fr_1fr_5rem_4rem_4.5rem_8.5rem_8.5rem_7rem_auto] gap-1.5 items-center';

export default async function LookupValues({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: SP }) {
  const u = await requirePriv(lookupPrivs((await params).type));
  const write = canAny(u, lookupPrivs((await params).type), 'WRITE');
  const { type } = await params;
  const sp = await searchParams;
  const [t] = await sql`select * from lookup_type where lookup_type = ${type}`;
  if (!t) notFound();
  const values = await sql`select * from lookup_value where lookup_type = ${type} order by display_seq, meaning`;
  const usage = await lookupUsage(type);
  const parents = t.parent_lookup_type ? await sql`select lookup_code, meaning from lookup_value where lookup_type = ${t.parent_lookup_type} order by display_seq, meaning` : [];
  const back = `/config/lookups/${type}`;
  const sys = t.access_level === 'SYSTEM' || !write;
  const ParentSel = ({ v, form }: { v?: string; form: string }) =>
    t.parent_lookup_type ? (
      <select name="parent_code" form={form} defaultValue={v ?? ''} className="input"><option value="" />{parents.map((p) => <option key={p.lookup_code} value={p.lookup_code}>{p.meaning}</option>)}</select>
    ) : <span className="text-xs text-gray-400">—</span>;
  return (
    <div>
      <PageHeader title={t.meaning} subtitle={<><span className="font-mono">{t.lookup_type}</span> · Module {t.module_code} · <Badge color={sys ? 'red' : t.access_level === 'EXTENSIBLE' ? 'amber' : 'green'}>{t.access_level}</Badge>{t.parent_lookup_type && <> · depends on <Link className="link" href={`/config/lookups/${t.parent_lookup_type}`}>{t.parent_lookup_type}</Link></>}</>}
        actions={<Link href="/config/lookups" className="btn">All lookups</Link>} />
      <Flash sp={sp} />
      <EditScope canEdit={write} label="Edit">
      <form action={updateLookupType.bind(null, type)} className="card mb-4 flex flex-wrap items-end gap-2">
        <Back to={back} />
        <label className="flex-1"><span className="label">Meaning (locked)</span><input value={t.meaning} disabled className="input" /></label>
        <label className="flex-[2]"><span className="label">Description</span><input name="description" defaultValue={t.description ?? ''} className="input" /></label>
        {write && <button className="btn">Save</button>}
      </form>
      <div className="card overflow-x-auto">
        <div className="min-w-[1100px]">
          <div className={`${cols} border-b pb-1 text-xs font-semibold uppercase text-gray-600`}>
            <div>Code</div><div>Meaning</div><div>Description</div><div>Tag</div><div>Seq</div><div>Enabled</div><div>Start Date</div><div>End Date</div><div>Parent</div><div />
          </div>
          {values.map((v) => {
            const fid = `f-${v.lookup_code}`;
            return (
              <div key={v.lookup_code} className={`${cols} border-b border-black/5 py-1`}>
                <div className="font-mono text-xs">{v.lookup_code}{v.system_flag === 'Y' && <span title="Used by application logic"> 🔒</span>}
                  {usage.get(v.lookup_code) && <div className="font-sans text-[10px] text-blue-700" title={describeUsage(usage.get(v.lookup_code)!)}>in use ({usage.get(v.lookup_code)!.count}){usage.get(v.lookup_code)!.last && (usage.get(v.lookup_code)!.last === '4712-12-31' ? ' · ongoing' : ` to ${usage.get(v.lookup_code)!.last}`)}</div>}</div>
                <input name="meaning" form={fid} defaultValue={v.meaning} className="input" />
                <input name="description" form={fid} defaultValue={v.description ?? ''} className="input" />
                <input name="tag" form={fid} defaultValue={v.tag ?? ''} className="input" />
                <input name="display_seq" form={fid} type="number" defaultValue={v.display_seq} className="input" />
                <select name="enabled_flag" form={fid} defaultValue={v.enabled_flag} className="input"><option value="Y">Yes</option><option value="N">No</option></select>
                <input name="start_date" form={fid} type="date" defaultValue={v.start_date} className="input" />
                <input name="end_date" form={fid} type="date" defaultValue={v.end_date} className="input" />
                <ParentSel v={v.parent_code} form={fid} />
                <div className="flex gap-1">
                  {write && <form id={fid} action={saveLookupValue.bind(null, type)}><Back to={back} /><input type="hidden" name="lookup_code" value={v.lookup_code} /><button className="btn btn-sm">Save</button></form>}
                  {!sys && v.system_flag !== 'Y' && !usage.get(v.lookup_code) && (
                    <form action={deleteLookupValue.bind(null, type, v.lookup_code)}><Back to={back} /><ConfirmButton className="btn btn-sm" message={`Delete ${v.lookup_code}? Prefer disabling values already in use.`}>✕</ConfirmButton></form>
                  )}
                </div>
              </div>
            );
          })}
          {!sys && (
            <div className={`${cols} mt-2 rounded bg-green-50 py-2`}>
              <input name="lookup_code" form="f-new" placeholder="NEW_CODE" className="input uppercase" required />
              <input name="meaning" form="f-new" placeholder="Meaning" className="input" required />
              <input name="description" form="f-new" className="input" />
              <input name="tag" form="f-new" className="input" />
              <input name="display_seq" form="f-new" type="number" defaultValue={(values.at(-1)?.display_seq ?? 0) + 10} className="input" />
              <select name="enabled_flag" form="f-new" className="input"><option value="Y">Yes</option><option value="N">No</option></select>
              <input name="start_date" form="f-new" type="date" defaultValue="1951-01-01" className="input" />
              <input name="end_date" form="f-new" type="date" defaultValue="4712-12-31" className="input" />
              <ParentSel form="f-new" />
              <form id="f-new" action={saveLookupValue.bind(null, type)}><Back to={back} /><input type="hidden" name="_new" value="1" /><button className="btn btn-primary btn-sm">Add</button></form>
            </div>
          )}
        </div>
        <p className="muted mt-3">Values are offered in forms only while enabled and between their start and end dates (relative to the As-of date). 🔒 values are used by application logic and cannot be disabled or deleted. Values marked “in use” cannot be deleted, and their end date cannot be earlier than the last date they are used.</p>
      </div>
      </EditScope>
    </div>
  );
}
