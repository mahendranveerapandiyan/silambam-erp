import type { SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { personAsOf, fullName, nm, type PersonKind } from '@/lib/people';
import { enterpriseInfo } from '@/lib/theme';
import { lk } from '@/lib/lookups';
import { PrintButton } from '../client';

export async function IdCards({ u, kind, personIds, asOf }: { u: SessionUser; kind: PersonKind; personIds: string[]; asOf: string }) {
  if (!personIds.length) return <div className="muted">No people selected.</div>;
  const ent = await enterpriseInfo(u.enterpriseId);
  const L = await lk();
  const rows = await sql`
    select p.id, p.date_of_birth, a.assignment_number, ${fullName()} full_name, pf.blood_group_code, pf.phone,
      ${nm('business_unit', 'af.business_unit_id', asOf)} bu_name, ${nm('class', 'af.class_id', asOf)} class_name,
      ${nm('job', 'af.job_id', asOf)} job_name, exists (select 1 from person_photo ph where ph.person_id = p.id) has_photo
    from person p join assignment a on a.person_id = p.id and a.assignment_type = ${kind}
    left join assignment_f af on af.id = a.id and ${asOf}::date between af.effective_start_date and af.effective_end_date
    ${personAsOf(asOf)}
    where p.id in ${sql(personIds)} order by full_name`;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between no-print"><h1 className="h1">ID Cards ({rows.length})</h1><PrintButton /></div>
      <div className="flex flex-wrap gap-4">
        {rows.map((r) => (
          <div key={r.id} className="w-[54mm] overflow-hidden rounded-lg border border-black/20 bg-white text-center text-[10px] leading-tight shadow-sm" style={{ breakInside: 'avoid' }}>
            <div className="px-2 py-1.5 font-bold text-[11px]" style={{ background: 'var(--header-bg)', color: 'var(--header-text)' }}>{ent?.name}</div>
            <div className="flex justify-center gap-1 p-2">
              {r.has_photo ? <img src={`/api/photo/${r.id}`} alt="" className="h-[22mm] w-[18mm] rounded object-cover" /> : <div className="h-[22mm] w-[18mm] rounded bg-gray-200" />}
              <img src={`/api/qr/${r.id}`} alt="" className="h-[22mm] w-[22mm]" />
            </div>
            <div className="px-2 pb-2">
              <div className="text-[12px] font-bold">{r.full_name}</div>
              <div className="font-mono font-semibold">{r.assignment_number}</div>
              <div>{kind === 'STUDENT' ? r.class_name : r.job_name} · {r.bu_name}</div>
              <div>{r.blood_group_code && `Blood: ${L('BLOOD_GROUP', r.blood_group_code)} · `}{r.phone}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
