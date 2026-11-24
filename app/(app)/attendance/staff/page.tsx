import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fullName, personAsOf, nm } from '@/lib/people';
import { lookupOptions } from '@/lib/lookups';
import { refOptions } from '@/lib/dt';
import { todayISO, fmtDate } from '@/lib/util';
import { PageHeader, Flash, Select, Back, Badge, Empty, type SP, s, here } from '@/components/ui';
import { AutoSubmit } from '@/components/client';
import { markableRange, attendanceSettings } from '@/lib/attendance';
import { saveStaffAttendance } from '../actions';

const hhmm = (t: any) => (t ? new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '');

export default async function StaffAttendance({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_STAFF_ATTENDANCE_PRV');
  const sp = await searchParams;
  const date = s(sp.date) ?? todayISO();
  const bu = s(sp.bu);
  const [statuses, bus] = [await lookupOptions('ATTENDANCE_STATUS', date), await refOptions('business-units', u.enterpriseId, date)];
  const range = await markableRange(u, 'STAFF');
  const times = (await attendanceSettings(u.enterpriseId)).capture_staff_times;
  const outOfRange = date > range.max ? 'Attendance cannot be marked for a future date.' : range.min && date < range.min ? `Staff attendance can be marked only for the last ${range.days} day(s), from ${fmtDate(range.min)}. Older dates are shown read-only.` : null;
  const rows = await sql`
    select a.person_id, a.assignment_number, ${fullName()} full_name, ${nm('job', 'af.job_id', date)} job_name, coalesce(${nm('branch', 'af.branch_id', date)}, ${nm('business_unit', 'af.business_unit_id', date)}) bu_name,
      sa.status_code, sa.check_in_time, sa.check_out_time, sa.reason, sa.source_code
    from assignment a
    join assignment_f af on af.id = a.id and ${date}::date between af.effective_start_date and af.effective_end_date
    join assignment_status_f st on st.id = af.assignment_status_id and ${date}::date between st.effective_start_date and st.effective_end_date
    join person p on p.id = a.person_id ${personAsOf(date)}
    left join staff_attendance sa on sa.person_id = a.person_id and sa.attendance_date = ${date}
    where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STAFF' and st.system_status_code = 'ACTIVE' ${bu ? sql`and af.business_unit_id = ${bu}` : sql``}
    order by bu_name, full_name`;
  return (
    <div className="max-w-6xl">
      <PageHeader title="Staff Attendance" subtitle={`${fmtDate(date)} · ${rows.filter((r) => r.status_code).length}/${rows.length} recorded. Staff can also check in/out by scanning their QR on the QR Scan page.`} />
      <Flash sp={sp} />
      <form className="card mb-4 flex flex-wrap gap-2">
        <input type="date" name="date" defaultValue={date} min={range.min ?? undefined} max={range.max} className="input w-44" />
        <Select name="bu" options={bus} value={bu} empty="All business units" className="input max-w-xs" />
        <AutoSubmit />
      </form>
      {outOfRange && <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{outOfRange}</div>}
      <form action={saveStaffAttendance} className="card overflow-x-auto">
        <Back to={here('/attendance/staff', { date, bu: bu ?? '' })} />
        <input type="hidden" name="date" value={date} /><input type="hidden" name="bu" value={bu ?? ''} />
        <table className="tbl">
          <thead><tr><th>Staff</th><th>Branch</th><th>Status</th>{times && <><th>In</th><th>Out</th></>}<th>Reason (manual override)</th><th>Source</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.person_id}>
              <td><div className="font-medium">{r.full_name}</div><div className="text-xs text-gray-500">{r.assignment_number} · {r.job_name}</div></td>
              <td>{r.bu_name}</td>
              <td><select name={`st_${r.person_id}`} defaultValue={r.status_code ?? ''} className="input w-32"><option value="">—</option>{statuses.map((x) => <option key={x.value} value={x.value} data-code={x.value}>{x.label}</option>)}</select></td>
              {times && <>
                <td><input type="time" name={`in_${r.person_id}`} defaultValue={hhmm(r.check_in_time)} className="input w-28" /></td>
                <td><input type="time" name={`out_${r.person_id}`} defaultValue={hhmm(r.check_out_time)} className="input w-28" /></td>
              </>}
              <td><input name={`rs_${r.person_id}`} defaultValue={r.reason ?? ''} className="input" /></td>
              <td>{r.source_code && <Badge color={r.source_code === 'QR' ? 'blue' : 'gray'}>{r.source_code}</Badge>}</td>
            </tr>))}</tbody>
        </table>
        {!rows.length && <Empty />}
        {rows.length > 0 && !outOfRange && <button className="btn btn-primary mt-4">Save</button>}
      </form>
    </div>
  );
}
