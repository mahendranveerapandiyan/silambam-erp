import Link from 'next/link';
import { requirePriv, can } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { fullName, personAsOf, nm, academicYearOn, activeStaffPeriods } from '@/lib/people';
import { myClasses } from '@/lib/scope';
import { fmtDate } from '@/lib/util';
import { PageHeader, Flash, Back, Field, Badge, Select, Empty, type SP, s } from '@/components/ui';
import { AutoSubmit, ConfirmButton } from '@/components/client';
import { saveIncharge, endIncharge, deleteIncharge } from '../actions';

export default async function Incharges({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_CLASS_INCHARGE_PRV');
  const sp = await searchParams;
  const asOf = await getAsOf();
  const years = await sql`select * from academic_year where enterprise_id = ${u.enterpriseId} order by start_date desc`;
  const ayId = s(sp.ay) ?? String((await academicYearOn(u.enterpriseId, asOf))?.id ?? years[0]?.id ?? '');
  const ay = years.find((y) => String(y.id) === ayId);
  const write = can(u, 'CD_CLASS_INCHARGE_PRV', 'WRITE');
  const back = `/staff/incharges?ay=${ayId}`;
  if (!ay) {
    return (
      <div className="max-w-3xl"><PageHeader title="Class Incharges" />
        <div className="card"><Empty>Create an academic year first (Academic Structure › Academic Years). Incharges are assigned per academic year.</Empty></div></div>
    );
  }
  const onDate = asOf < ay.start_date ? ay.start_date : asOf > ay.end_date ? ay.end_date : asOf;
  const classes = await myClasses(u, onDate);
  const rows = await sql`
    select ci.*, a.assignment_number, ${fullName()} full_name, ${nm('class', 'ci.class_id', onDate)} class_name, ${nm('section', 'ci.section_id', onDate)} section_name,
      (select bf.name from class_f cf join branch_f bf on bf.id = cf.branch_id and ${onDate}::date between bf.effective_start_date and bf.effective_end_date
        where cf.id = ci.class_id and ${onDate}::date between cf.effective_start_date and cf.effective_end_date) bu_name,
      exists (select 1 from user_account ua where ua.person_id = ci.person_id) has_login,
      ci.id = (select x.id from class_incharge x where x.person_id = ci.person_id order by x.start_date desc, x.id desc limit 1) is_latest
    from class_incharge ci join person p on p.id = ci.person_id join assignment a on a.person_id = p.id and a.assignment_type = 'STAFF'
    ${personAsOf(onDate)}
    where p.enterprise_id = ${u.enterpriseId} and (ci.academic_year_id = ${ay.id} or (ci.academic_year_id is null and ci.start_date <= ${ay.end_date} and ci.end_date >= ${ay.start_date}))
    order by bu_name, class_name, full_name`;
  // staff who are active at some point during the selected academic year
  const staff = [...new Map((await activeStaffPeriods(u.enterpriseId))
    .filter((x) => x.start_date <= ay.end_date && x.end_date >= ay.start_date)
    .map((x) => [x.assignment_number, { value: x.assignment_number as string, label: (x.full_name || x.assignment_number) as string, code: x.assignment_number as string }])).values()]
    .sort((a, b) => a.label.localeCompare(b.label));
  const uniqueClasses = [...new Map(classes.map((c) => [String(c.class_id), c])).values()];
  return (
    <div className="max-w-6xl">
      <PageHeader title="Class Incharges" subtitle="Assigned per academic year. Incharges mark attendance, collect fees and assign exams and events only for their own classes on those dates." />
      <Flash sp={sp} />
      <form className="card mb-4 flex flex-wrap items-center gap-2">
        <span className="label mb-0">Academic Year</span>
        <Select name="ay" options={years.map((y) => ({ value: String(y.id), label: `${y.name} (${fmtDate(y.start_date)} – ${fmtDate(y.end_date)})` }))} value={ayId} empty={false} className="input max-w-md" />
        <AutoSubmit />
      </form>
      {write && (
        <form action={saveIncharge} className="card mb-4 grid items-end gap-3 sm:grid-cols-6">
          <Back to={back} /><input type="hidden" name="academic_year_id" value={ay.id} />
          <Field label="Staff *" help={`Active staff during ${ay.name}`}>
            <Select name="staff_number" options={staff} required empty={staff.length ? '— Select staff —' : '— No active staff in this year —'} />
          </Field>
          <Field label="Class › Section *" className="sm:col-span-2">
            <select name="class_section" className="input" required>
              <option value="" />
              {uniqueClasses.map((c) => <option key={'c' + c.class_id} value={`${c.class_id}:`}>{c.label.split(' › ').slice(0, 2).join(' › ')} (all sections)</option>)}
              {classes.map((c) => <option key={c.section_id} value={`${c.class_id}:${c.section_id}`}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="From"><input type="date" name="start_date" defaultValue={ay.start_date} min={ay.start_date} max={ay.end_date} className="input" /></Field>
          <Field label="To"><input type="date" name="end_date" defaultValue={ay.end_date} min={ay.start_date} max={ay.end_date} className="input" /></Field>
          <button className="btn btn-primary">Assign</button>
        </form>
      )}
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Staff</th><th>Branch</th><th>Class</th><th>Section</th><th>From</th><th>To</th><th>Login</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link className="link" href={`/staff/${r.person_id}?tab=classes`}>{r.full_name}</Link> <span className="muted">{r.assignment_number}</span></td>
                <td>{r.bu_name}</td><td>{r.class_name}</td><td>{r.section_name ?? 'All'}</td><td>{fmtDate(r.start_date)}</td><td>{fmtDate(r.end_date)}</td>
                <td>{r.has_login ? <Badge color="green">Yes</Badge> : <Badge color="red">No login</Badge>}</td>
                <td>
                  {write && (
                    <div className="flex flex-wrap gap-1">
                      <form action={endIncharge.bind(null, r.id)} className="flex gap-1">
                        <Back to={back} /><input type="date" name="end_date" defaultValue={r.end_date} min={r.start_date} max={ay.end_date} className="input w-36" /><button className="btn btn-sm">End</button>
                      </form>
                      {r.is_latest && (
                        <form action={deleteIncharge.bind(null, r.id)}><Back to={back} /><ConfirmButton className="btn btn-sm" message="Delete this incharge assignment?">Delete</ConfirmButton></form>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty>No incharges assigned for {ay.name} yet.</Empty>}
        {write && rows.length > 0 && <p className="muted mt-2">Delete is offered on each staff member&apos;s latest incharge assignment.</p>}
      </div>
    </div>
  );
}
