import Link from 'next/link';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { fullName, personAsOf, nm } from '@/lib/people';
import { myClasses } from '@/lib/scope';
import { fmtDate } from '@/lib/util';
import { PageHeader, Flash, Back, Field, Badge, type SP } from '@/components/ui';
import { saveIncharge } from '../actions';

export default async function Incharges({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_CLASS_INCHARGE_PRV');
  const asOf = await getAsOf();
  const classes = await myClasses(u, asOf);
  const rows = await sql`
    select ci.*, a.assignment_number, ${fullName()} full_name, ${nm('class', 'ci.class_id', asOf)} class_name, ${nm('section', 'ci.section_id', asOf)} section_name,
      (select bf.name from class_f cf join business_unit_f bf on bf.id = cf.business_unit_id and ${asOf}::date between bf.effective_start_date and bf.effective_end_date
        where cf.id = ci.class_id and ${asOf}::date between cf.effective_start_date and cf.effective_end_date) bu_name,
      exists (select 1 from user_account ua where ua.person_id = ci.person_id) has_login
    from class_incharge ci join person p on p.id = ci.person_id join assignment a on a.person_id = p.id and a.assignment_type = 'STAFF'
    ${personAsOf(asOf)}
    where p.enterprise_id = ${u.enterpriseId}
    order by (${asOf}::date between ci.start_date and ci.end_date) desc, bu_name, class_name`;
  const staff = await sql`select a.assignment_number, ${fullName()} full_name from assignment a join person p on p.id = a.person_id ${personAsOf(asOf)}
    where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STAFF' order by full_name`;
  const uniqueClasses = [...new Map(classes.map((c) => [String(c.class_id), c])).values()];
  return (
    <div className="max-w-6xl">
      <PageHeader title="Class Incharges" subtitle="Incharges can mark attendance, collect fees and assign exams and events only for their own classes (date-effective)." />
      <Flash sp={await searchParams} />
      <form action={saveIncharge.bind(null, null)} className="card mb-4 grid items-end gap-3 sm:grid-cols-5">
        <Back to="/staff/incharges" />
        <Field label="Staff Number *">
          <input name="staff_number" list="staff-list" className="input" required />
          <datalist id="staff-list">{staff.map((s) => <option key={s.assignment_number} value={s.assignment_number}>{s.full_name}</option>)}</datalist>
        </Field>
        <Field label="Class › Section *" className="sm:col-span-2">
          <select name="class_section" className="input" required>
            <option value="" />
            {uniqueClasses.map((c) => <option key={'c' + c.class_id} value={`${c.class_id}:`}>{c.label.split(' › ').slice(0, 2).join(' › ')} (all sections)</option>)}
            {classes.map((c) => <option key={c.section_id} value={`${c.class_id}:${c.section_id}`}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="From *"><input type="date" name="start_date" defaultValue={asOf} className="input" required /></Field>
        <button className="btn btn-primary">Assign</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Staff</th><th>Branch</th><th>Class</th><th>Section</th><th>From</th><th>To</th><th>Login</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const active = asOf >= r.start_date && asOf <= r.end_date;
              return (
                <tr key={r.id} className={active ? '' : 'opacity-50'}>
                  <td><Link className="link" href={`/staff/${r.person_id}`}>{r.full_name}</Link> <span className="muted">{r.assignment_number}</span></td>
                  <td>{r.bu_name}</td><td>{r.class_name}</td><td>{r.section_name ?? 'All'}</td><td>{fmtDate(r.start_date)}</td><td>{fmtDate(r.end_date)}</td>
                  <td>{r.has_login ? <Badge color="green">Yes</Badge> : <Badge color="red">No login</Badge>}</td>
                  <td>
                    {active && (
                      <form action={saveIncharge.bind(null, r.id)} className="flex gap-1">
                        <Back to="/staff/incharges" /><input type="hidden" name="_end" value="1" />
                        <input type="date" name="end_date" defaultValue={asOf} className="input w-36" /><button className="btn btn-sm">End</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
