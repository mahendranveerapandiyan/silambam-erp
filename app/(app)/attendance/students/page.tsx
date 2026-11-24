import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { myClasses, studentScopeSql } from '@/lib/scope';
import { fullName, personAsOf } from '@/lib/people';
import { lookupOptions } from '@/lib/lookups';
import { todayISO, fmtDate, fmtDateTime } from '@/lib/util';
import { PageHeader, Flash, Select, Back, Badge, Empty, STATUS_COLOR, type SP, s, here } from '@/components/ui';
import { AutoSubmit } from '@/components/client';
import { saveStudentAttendance } from '../actions';
import { markableRange, attendanceSettings, trainingDays, notTrainingDayReason } from '@/lib/attendance';

const hhmm = (t: any) => (t ? new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '');

export default async function StudentAttendance({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_STUDENT_ATTENDANCE_PRV');
  const sp = await searchParams;
  const date = s(sp.date) ?? todayISO();
  const classes = await myClasses(u, date);
  const cls = s(sp.cls) ?? (classes.length === 1 ? `${classes[0].class_id}:${classes[0].section_id}` : null);
  const statuses = await lookupOptions('ATTENDANCE_STATUS', date);
  const range = await markableRange(u, 'STUDENT');
  const times = (await attendanceSettings(u.enterpriseId)).capture_student_times;
  const training = cls ? await trainingDays(cls.split(':')[0], date) : null;
  const dayNames = Object.fromEntries((await lookupOptions('DAY_OF_WEEK', date)).map((d) => [d.value, d.label]));
  const blocked = date > range.max ? 'Attendance cannot be marked for a future date.'
    : range.min && date < range.min ? `Attendance can be marked only for the last ${range.days} day(s), from ${fmtDate(range.min)}. Older dates are shown read-only.`
    : cls ? await notTrainingDayReason(cls.split(':')[0], date) : null;
  let rows: any[] = [];
  if (cls) {
    const [c, sec] = cls.split(':');
    rows = await sql`
      select a.person_id, a.assignment_number, ${fullName()} full_name, sa.status_code, sa.source_code, sa.remarks, sa.check_in_time, sa.check_out_time, sa.marked_by,
        exists (select 1 from person_photo ph where ph.person_id = a.person_id) has_photo
      from assignment a
      join assignment_f af on af.id = a.id and ${date}::date between af.effective_start_date and af.effective_end_date
      join assignment_status_f st on st.id = af.assignment_status_id and ${date}::date between st.effective_start_date and st.effective_end_date
      join person p on p.id = a.person_id ${personAsOf(date)}
      left join student_attendance sa on sa.person_id = a.person_id and sa.attendance_date = ${date}
      where a.assignment_type = 'STUDENT' and af.class_id = ${c} and af.section_id = ${sec} and st.system_status_code = 'ACTIVE' ${studentScopeSql(u, date)}
      order by full_name`;
  }
  const marked = rows.filter((r) => r.status_code).length;
  const present = rows.filter((r) => r.status_code === 'P' || r.status_code === 'L').length;
  return (
    <div className="max-w-6xl">
      <PageHeader title="Student Attendance" subtitle={cls ? `${fmtDate(date)} · ${marked}/${rows.length} marked · ${present} present` : 'Choose a date and class'} />
      <Flash sp={sp} />
      <form className="card mb-4 flex flex-wrap gap-2">
        <input type="date" name="date" defaultValue={date} min={range.min ?? undefined} max={range.max} className="input w-44" />
        <Select name="cls" options={classes.map((c) => ({ value: `${c.class_id}:${c.section_id}`, label: c.label }))} value={cls} empty="Select class / section" className="input max-w-md" />
        <AutoSubmit />
        {training && training.codes.length > 0 && <span className="self-center text-sm text-slate-600">Training days: <b>{training.codes.map((c) => dayNames[c] ?? c).join(', ')}</b></span>}
      </form>
      {blocked && <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{blocked}</div>}
      {cls && (
        <form action={saveStudentAttendance} className="card">
          <Back to={here('/attendance/students', { date, cls })} />
          <input type="hidden" name="date" value={date} /><input type="hidden" name="cls" value={cls} />
          <p className="muted mb-3">Students without a saved record are pre-selected as Present. Change anyone absent, then Save. QR scans appear here automatically.</p>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th></th><th>Student</th><th>Status</th>{times && <><th>In</th><th>Out</th></>}<th>Remarks</th><th>Recorded</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.person_id}>
                  <td className="w-10">{r.has_photo ? <img src={`/api/photo/${r.person_id}`} alt="" loading="lazy" className="h-9 w-9 rounded-full object-cover" /> : <div className="h-9 w-9 rounded-full bg-black/10" />}</td>
                  <td><div className="font-medium">{r.full_name}</div><div className="font-mono text-xs text-gray-500">{r.assignment_number}</div></td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {statuses.map((x) => (
                        <label key={x.value} className="cursor-pointer">
                          <input type="radio" name={`st_${r.person_id}`} value={x.value} defaultChecked={(r.status_code ?? 'P') === x.value} className="peer sr-only" />
                          <span className="inline-block rounded border border-black/15 px-2 py-1 text-xs peer-checked:border-transparent peer-checked:bg-[var(--primary-color)] peer-checked:text-white">{x.label}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                  {times && <>
                    <td><input type="time" name={`in_${r.person_id}`} defaultValue={hhmm(r.check_in_time)} className="input w-28" /></td>
                    <td><input type="time" name={`out_${r.person_id}`} defaultValue={hhmm(r.check_out_time)} className="input w-28" /></td>
                  </>}
                  <td><input name={`rm_${r.person_id}`} defaultValue={r.remarks ?? ''} className="input" /></td>
                  <td className="text-xs">{r.status_code ? <><Badge color={STATUS_COLOR[r.status_code]}>{r.source_code === 'QR' ? 'QR' : 'Manual'}</Badge> {r.marked_by}{r.check_in_time && <> · {fmtDateTime(r.check_in_time)}</>}</> : <span className="text-amber-700">not saved</span>}</td>
                </tr>))}
              </tbody>
            </table>
            {!rows.length && <Empty>No active students in this class on this date.</Empty>}
          </div>
          {rows.length > 0 && !blocked && <button className="btn btn-primary mt-4">Save Attendance</button>}
        </form>
      )}
    </div>
  );
}
