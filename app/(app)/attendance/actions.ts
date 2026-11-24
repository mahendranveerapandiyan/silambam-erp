'use server';
import { sql } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { act, backOf, formObj, todayISO } from '@/lib/util';
import { myClasses, studentScopeSql } from '@/lib/scope';
import { assertMarkableDate, notTrainingDayReason, attendanceSettings } from '@/lib/attendance';

export async function saveStudentAttendance(fd: FormData) {
  const u = await requirePriv('CD_STUDENT_ATTENDANCE_PRV', 'WRITE');
  await act(backOf(fd, '/attendance/students'), async () => {
    const o = formObj(fd);
    const date = o.date;
    if (!date || !o.cls) throw new Error('Date and class are required');
    await assertMarkableDate(u, 'STUDENT', date);
    const [classId, sectionId] = o.cls.split(':');
    if (!(await myClasses(u, date)).some((c) => String(c.class_id) === classId && String(c.section_id) === sectionId)) throw new Error('Not your class on this date');
    const notTraining = await notTrainingDayReason(classId, date);
    if (notTraining) throw new Error(notTraining);
    const times = (await attendanceSettings(u.enterpriseId)).capture_student_times;
    const ts = (t: string | null) => (times && t ? `${date}T${t}:00+05:30` : null);
    const students = await sql`select a.id assignment_id, a.person_id, af.business_unit_id from assignment a
      join assignment_f af on af.id = a.id and ${date}::date between af.effective_start_date and af.effective_end_date
      where a.assignment_type = 'STUDENT' and af.class_id = ${classId} and af.section_id = ${sectionId} ${studentScopeSql(u, date)}`;
    let n = 0;
    await sql.begin(async (tx) => {
      for (const s of students) {
        const status = o[`st_${s.person_id}`];
        if (!status) continue;
        const remarks = o[`rm_${s.person_id}`];
        await tx`insert into student_attendance (person_id, assignment_id, attendance_date, business_unit_id, class_id, section_id, status_code, source_code, remarks, marked_by, check_in_time, check_out_time)
          values (${s.person_id}, ${s.assignment_id}, ${date}, ${s.business_unit_id}, ${classId}, ${sectionId}, ${status}, 'MANUAL', ${remarks}, ${u.username}, ${ts(o[`in_${s.person_id}`])}, ${ts(o[`out_${s.person_id}`])})
          on conflict (person_id, attendance_date) do update set status_code = excluded.status_code, remarks = excluded.remarks,
            ${times ? tx`check_in_time = excluded.check_in_time, check_out_time = excluded.check_out_time,` : tx``}
            class_id = excluded.class_id, section_id = excluded.section_id, marked_by = excluded.marked_by, marked_at = now(),
            source_code = case when student_attendance.status_code = excluded.status_code then student_attendance.source_code else 'MANUAL' end`;
        n++;
      }
    });
    return { msg: `Attendance saved for ${n} student(s)` };
  });
}

export async function saveStaffAttendance(fd: FormData) {
  const u = await requirePriv('CD_STAFF_ATTENDANCE_PRV', 'WRITE');
  await act(backOf(fd, '/attendance/staff'), async () => {
    const o = formObj(fd);
    const date = o.date;
    if (!date) throw new Error('Date is required');
    await assertMarkableDate(u, 'STAFF', date);
    const times = (await attendanceSettings(u.enterpriseId)).capture_staff_times;
    const staff = await sql`select a.id assignment_id, a.person_id, af.business_unit_id from assignment a
      join assignment_f af on af.id = a.id and ${date}::date between af.effective_start_date and af.effective_end_date
      where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STAFF' ${o.bu ? sql`and af.business_unit_id = ${o.bu}` : sql``}`;
    const ts = (t: string | null) => (times && t ? `${date}T${t}:00+05:30` : null);
    let n = 0;
    await sql.begin(async (tx) => {
      for (const s of staff) {
        const status = o[`st_${s.person_id}`];
        if (!status) continue;
        await tx`insert into staff_attendance (person_id, assignment_id, attendance_date, business_unit_id, status_code, check_in_time, check_out_time, source_code, reason, marked_by)
          values (${s.person_id}, ${s.assignment_id}, ${date}, ${s.business_unit_id}, ${status}, ${ts(o[`in_${s.person_id}`])}, ${ts(o[`out_${s.person_id}`])}, 'MANUAL', ${o[`rs_${s.person_id}`]}, ${u.username})
          on conflict (person_id, attendance_date) do update set status_code = excluded.status_code, check_in_time = excluded.check_in_time,
            check_out_time = excluded.check_out_time, reason = excluded.reason, marked_by = excluded.marked_by, marked_at = now(),
            source_code = case when staff_attendance.status_code = excluded.status_code and staff_attendance.check_in_time is not distinct from excluded.check_in_time then staff_attendance.source_code else 'MANUAL' end`;
        n++;
      }
    });
    return { msg: `Staff attendance saved for ${n} record(s)` };
  });
}

export type ScanResult = { ok: boolean; message: string; name?: string; number?: string; photo?: string | null; status?: string };

/** Called by the QR scanner page. `code` is the QR payload or a typed student/staff number. */
export async function scanAttendance(mode: 'STUDENT' | 'STAFF', code: string): Promise<ScanResult> {
  const u = await requirePriv('CD_QR_SCAN_PRV', 'WRITE');
  if (mode === 'STAFF' && !can(u, 'CD_STAFF_ATTENDANCE_PRV', 'WRITE')) return { ok: false, message: 'You do not have permission to mark staff attendance.' };
  const date = todayISO();
  const raw = code.trim();
  const token = raw.startsWith('SILAMBAM:') ? raw.slice(9) : null;
  const [p] = await sql`
    select p.id person_id, a.id assignment_id, a.assignment_number, af.business_unit_id, af.class_id, af.section_id, st.system_status_code,
      (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = p.id order by (${date}::date between x.effective_start_date and x.effective_end_date) desc, x.effective_start_date desc limit 1) full_name,
      exists (select 1 from person_photo ph where ph.person_id = p.id) has_photo
    from person p join assignment a on a.person_id = p.id and a.assignment_type = ${mode}
    left join assignment_f af on af.id = a.id and ${date}::date between af.effective_start_date and af.effective_end_date
    left join assignment_status_f st on st.id = af.assignment_status_id and ${date}::date between st.effective_start_date and st.effective_end_date
    where p.enterprise_id = ${u.enterpriseId} and ${token ? sql`p.qr_token = ${token}` : sql`upper(a.assignment_number) = upper(${raw})`}`;
  if (!p) return { ok: false, message: `Not recognised as a ${mode.toLowerCase()} QR / number` };
  const who = { name: p.full_name, number: p.assignment_number, photo: p.has_photo ? `/api/photo/${p.person_id}` : null };
  if (p.system_status_code !== 'ACTIVE') return { ok: false, ...who, message: 'Not active today' };
  if (mode === 'STUDENT') {
    const [allowed] = await sql`select 1 from assignment_f af where af.id = ${p.assignment_id} and ${date}::date between af.effective_start_date and af.effective_end_date ${studentScopeSql(u, date)}`;
    if (!allowed) return { ok: false, ...who, message: 'Student is not in your class' };
    const notTraining = p.class_id ? await notTrainingDayReason(String(p.class_id), date) : null;
    if (notTraining) return { ok: false, ...who, message: notTraining };
    const times = (await attendanceSettings(u.enterpriseId)).capture_student_times;
    const [ex] = await sql`select status_code, check_in_time, check_out_time from student_attendance where person_id = ${p.person_id} and attendance_date = ${date}`;
    if (ex?.status_code === 'P' || ex?.status_code === 'L') {
      // with times captured, the second scan of the day is the check-out
      if (times && ex.check_in_time && !ex.check_out_time) {
        await sql`update student_attendance set check_out_time = now(), marked_by = ${u.username}, marked_at = now() where person_id = ${p.person_id} and attendance_date = ${date}`;
        return { ok: true, ...who, status: 'OUT', message: 'Checked OUT' };
      }
      return { ok: true, ...who, status: ex.status_code, message: times && ex.check_out_time ? 'Already checked in and out today' : 'Already marked present today' };
    }
    await sql`insert into student_attendance (person_id, assignment_id, attendance_date, business_unit_id, class_id, section_id, status_code, source_code, check_in_time, marked_by)
      values (${p.person_id}, ${p.assignment_id}, ${date}, ${p.business_unit_id}, ${p.class_id}, ${p.section_id}, 'P', 'QR', ${times ? sql`now()` : null}, ${u.username})
      on conflict (person_id, attendance_date) do update set status_code = 'P', source_code = 'QR', check_in_time = excluded.check_in_time, marked_by = excluded.marked_by, marked_at = now()`;
    return { ok: true, ...who, status: 'P', message: times ? 'Marked PRESENT – checked IN' : 'Marked PRESENT' };
  }
  const staffTimes = (await attendanceSettings(u.enterpriseId)).capture_staff_times;
  if (!staffTimes) {
    const [sx] = await sql`select status_code from staff_attendance where person_id = ${p.person_id} and attendance_date = ${date}`;
    if (sx?.status_code === 'P') return { ok: true, ...who, status: 'P', message: 'Already marked present today' };
    await sql`insert into staff_attendance (person_id, assignment_id, attendance_date, business_unit_id, status_code, source_code, marked_by)
      values (${p.person_id}, ${p.assignment_id}, ${date}, ${p.business_unit_id}, 'P', 'QR', ${u.username})
      on conflict (person_id, attendance_date) do update set status_code = 'P', source_code = 'QR', marked_by = excluded.marked_by, marked_at = now()`;
    return { ok: true, ...who, status: 'P', message: 'Marked PRESENT' };
  }
  const [ex] = await sql`select check_in_time, check_out_time from staff_attendance where person_id = ${p.person_id} and attendance_date = ${date}`;
  if (ex?.check_in_time && !ex.check_out_time) {
    await sql`update staff_attendance set check_out_time = now(), marked_by = ${u.username}, marked_at = now() where person_id = ${p.person_id} and attendance_date = ${date}`;
    return { ok: true, ...who, status: 'OUT', message: 'Checked OUT' };
  }
  if (ex?.check_out_time) return { ok: true, ...who, message: 'Already checked in and out today' };
  await sql`insert into staff_attendance (person_id, assignment_id, attendance_date, business_unit_id, status_code, check_in_time, source_code, marked_by)
    values (${p.person_id}, ${p.assignment_id}, ${date}, ${p.business_unit_id}, 'P', now(), 'QR', ${u.username})
    on conflict (person_id, attendance_date) do update set status_code = 'P', check_in_time = now(), source_code = 'QR', marked_by = excluded.marked_by`;
  return { ok: true, ...who, status: 'IN', message: 'Checked IN' };
}

// ------------------------------------------------------------ settings
export async function saveAttendanceSettings(fd: FormData) {
  const u = await requirePriv('CD_ATTENDANCE_SETTINGS_PRV', 'WRITE');
  await act('/attendance/settings', async () => {
    const o = formObj(fd);
    const days = (k: string) => {
      const n = Number(o[k]);
      if (!Number.isInteger(n) || n < 0 || n > 366) throw new Error('Days back must be a whole number between 0 and 366');
      return n;
    };
    const half = Number(o.half_day_value ?? 0.5);
    if (!(half >= 0 && half <= 1)) throw new Error('A half day must count between 0 and 1');
    const v = { student_back_days: days('student_back_days'), staff_back_days: days('staff_back_days'), capture_student_times: o.capture_student_times === 'Y' ? 'Y' : 'N',
      capture_staff_times: o.capture_staff_times === 'Y' ? 'Y' : 'N', half_day_value: half, last_updated_by: u.username, last_update_date: new Date() };
    await sql.begin(async (tx) => {
      await tx`insert into attendance_setting ${tx({ enterprise_id: u.enterpriseId, ...v })}
        on conflict (enterprise_id) do update set ${tx(v)}`;
      // how each status counts in attendance % (kept as the ATTENDANCE_STATUS lookup tag)
      for (const [k, val] of Object.entries(o)) {
        if (!k.startsWith('counts_') || !val) continue;
        if (!['PRESENT', 'ABSENT', 'HALF', 'EXCLUDE'].includes(val)) throw new Error('Unknown counting option');
        await tx`update lookup_value set tag = ${val}, last_updated_by = ${u.username}, last_update_date = now() where lookup_type = 'ATTENDANCE_STATUS' and lookup_code = ${k.slice(7)}`;
      }
    });
    return { msg: 'The attendance settings have been updated.' };
  });
}
