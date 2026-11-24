import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { attendanceSettings } from '@/lib/attendance';
import { EditableForm } from '@/components/EditMode';
import { PageHeader, Flash, Field, type SP } from '@/components/ui';
import { saveAttendanceSettings } from '../actions';

const COUNTS = [['PRESENT', 'Present (1 day)'], ['HALF', 'Half day'], ['ABSENT', 'Absent (0)'], ['EXCLUDE', 'Not counted (excused)']] as const;

export default async function AttendanceSettings({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_ATTENDANCE_SETTINGS_PRV');
  const write = can(u, 'CD_ATTENDANCE_SETTINGS_PRV', 'WRITE');
  const s = await attendanceSettings(u.enterpriseId);
  const statuses = await sql`select lookup_code, meaning, tag from lookup_value where lookup_type = 'ATTENDANCE_STATUS' and enabled_flag = 'Y' order by display_seq, meaning`;
  const yn = (name: string, v: boolean) => (
    <select name={name} defaultValue={v ? 'Y' : 'N'} className="input"><option value="Y">Yes – record in and out times</option><option value="N">No – present / absent only</option></select>
  );
  return (
    <div className="max-w-4xl">
      <PageHeader title="Attendance Settings" subtitle="How far back attendance may be marked, whether in / out times are captured, and how attendance % is calculated." />
      <Flash sp={await searchParams} />
      <EditableForm action={saveAttendanceSettings} canEdit={write}>
        <div className="space-y-5">
          <section>
            <h2 className="h2">Back-dated Marking</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Student attendance – days back *" help="e.g. 7 = today and the 7 days before. 0 = today only."><input name="student_back_days" type="number" min={0} max={366} defaultValue={s.student_back_days} required className="input" /></Field>
              <Field label="Staff attendance – days back *"><input name="staff_back_days" type="number" min={0} max={366} defaultValue={s.staff_back_days} required className="input" /></Field>
            </div>
            <p className="muted mt-1">Future dates can never be marked. Roles with <b>Mark attendance for any past date</b> (Configuration › Roles) are not limited – by default only Administrators. Student attendance can be marked only on the class&apos;s <b>Training Days</b> (Configuration › Classes).</p>
          </section>
          <section>
            <h2 className="h2">In / Out Times</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Students" help="Yes: times on the attendance sheet; first QR scan = in, second = out">{yn('capture_student_times', s.capture_student_times)}</Field>
              <Field label="Staff" help="Yes: times on the staff sheet; first QR scan = in, second = out">{yn('capture_staff_times', s.capture_staff_times)}</Field>
            </div>
          </section>
          <section>
            <h2 className="h2">Attendance % Calculation</h2>
            <p className="muted mb-2">Attendance % = days counted as present ÷ days counted. Each status counts as:</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {statuses.map((st) => (
                <Field key={st.lookup_code} label={st.meaning}>
                  <select name={`counts_${st.lookup_code}`} defaultValue={st.tag ?? 'ABSENT'} className="input">
                    {COUNTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
              ))}
              <Field label="A half day counts as *" help="Fraction of a day, e.g. 0.5"><input name="half_day_value" type="number" min={0} max={1} step="0.05" defaultValue={s.half_day_value} required className="input" /></Field>
            </div>
            <p className="muted mt-1">New statuses can be added under Configuration › Lookups › Attendance Status.</p>
          </section>
        </div>
      </EditableForm>
    </div>
  );
}
