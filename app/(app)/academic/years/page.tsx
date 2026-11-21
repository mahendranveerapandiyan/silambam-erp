import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { lookupOptions } from '@/lib/lookups';
import { fmtDate } from '@/lib/util';
import { PageHeader, Flash, Back, Select, Badge, type SP } from '@/components/ui';
import { saveAcademicYear } from '../actions';

export default async function Years({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_ACADEMIC_YEAR_PRV');
  const write = can(u, 'CD_ACADEMIC_YEAR_PRV', 'WRITE');
  const asOf = await getAsOf();
  const years = await sql`select y.*, (select count(*) from fee_structure f where f.academic_year_id = y.id)::int fees, (select count(*) from exam e where e.academic_year_id = y.id)::int exams
    from academic_year y where enterprise_id = ${u.enterpriseId} order by start_date desc`;
  const statuses = await lookupOptions('ACADEMIC_YEAR_STATUS', asOf);
  const cols = 'grid grid-cols-[8rem_1fr_9rem_9rem_9rem_6rem_auto] gap-2 items-center';
  const Row = ({ y }: { y?: any }) => (
    <form action={saveAcademicYear.bind(null, y?.id ?? null)} className={`${cols} border-b border-black/5 py-1.5 ${y ? '' : 'rounded bg-green-50 px-1'}`}>
      <Back to="/academic/years" />
      {y ? <input value={y.code} disabled title="Code cannot be changed" className="input" /> : <input name="code" placeholder="AY2026" className="input uppercase" required />}
      <input name="name" defaultValue={y?.name} placeholder="Academic Year 2026-27" className="input" required />
      <input type="date" name="start_date" defaultValue={y?.start_date} className="input" required />
      <input type="date" name="end_date" defaultValue={y?.end_date} className="input" required />
      <Select name="status_code" options={statuses} value={y?.status_code ?? 'OPEN'} empty={false} />
      <span className="text-xs text-gray-500">{y && <>{y.fees} fees · {y.exams} exams</>}</span>
      {write ? <button className={`btn btn-sm ${y ? '' : 'btn-primary'}`}>{y ? 'Save' : 'Add'}</button> : <span />}
    </form>
  );
  const cur = years.find((y) => asOf >= y.start_date && asOf <= y.end_date);
  return (
    <div className="max-w-6xl">
      <PageHeader title="Academic Years" subtitle={<>Defined at enterprise level; years cannot overlap; the code is locked once created. Current year on {fmtDate(asOf)}: {cur ? <Badge color="green">{cur.name}</Badge> : <Badge color="red">none</Badge>}</>} />
      <Flash sp={await searchParams} />
      <div className="card overflow-x-auto">
        <div className="min-w-[900px]">
          <div className={`${cols} border-b pb-1 text-xs font-semibold uppercase text-gray-600`}><div>Code</div><div>Name</div><div>Start</div><div>End</div><div>Status</div><div>Usage</div><div /></div>
          {years.map((y) => <Row key={y.id} y={y} />)}
          {write && <Row />}
        </div>
      </div>
      <p className="muted mt-3">Fee structures and exams are defined per academic year. Use <b>Fees › Fee Structures › Copy</b> to carry fees into a new year.</p>
    </div>
  );
}
