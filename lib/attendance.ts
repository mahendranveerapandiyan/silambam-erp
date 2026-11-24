import 'server-only';
import { sql } from './db';
import { can, type SessionUser } from './auth';
import { todayISO, addDays } from './util';

export type AttendanceSettings = {
  student_back_days: number; staff_back_days: number; capture_student_times: boolean; capture_staff_times: boolean; half_day_value: number;
};

/** Attendance › Attendance Settings (defaults when not saved yet). */
export async function attendanceSettings(enterpriseId: string): Promise<AttendanceSettings> {
  const [r] = await sql`select * from attendance_setting where enterprise_id = ${enterpriseId}`;
  return {
    student_back_days: r ? Number(r.student_back_days) : 7,
    staff_back_days: r ? Number(r.staff_back_days) : 7,
    capture_student_times: r ? r.capture_student_times === 'Y' : false,
    capture_staff_times: r ? r.capture_staff_times === 'Y' : true,
    half_day_value: r ? Number(r.half_day_value) : 0.5,
  };
}

const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });

/**
 * The dates a user may mark attendance for: today and up to N days back
 * (Attendance Settings); never the future. Users with "Mark attendance for any
 * past date" have no back limit.
 */
export async function markableRange(u: SessionUser, kind: 'STUDENT' | 'STAFF') {
  const s = await attendanceSettings(u.enterpriseId);
  const today = todayISO();
  const anyDate = can(u, 'CD_ATTENDANCE_ANY_DATE_PRV', 'WRITE');
  const days = kind === 'STUDENT' ? s.student_back_days : s.staff_back_days;
  return { min: anyDate ? null : addDays(today, -days), max: today, days, anyDate };
}

export async function assertMarkableDate(u: SessionUser, kind: 'STUDENT' | 'STAFF', date: string) {
  const r = await markableRange(u, kind);
  if (date > r.max) throw new Error('Attendance cannot be marked for a future date.');
  if (r.min && date < r.min)
    throw new Error(`Attendance can be marked only for the last ${r.days} day(s) – from ${fmt(r.min)}. Ask an administrator to correct older dates.`);
}

const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const dayCode = (date: string) => DAY_CODES[new Date(`${date}T00:00:00`).getDay()];

/** The class's training days on a date (DAY_OF_WEEK codes); empty = not limited. */
export async function trainingDays(classId: string, date: string) {
  const [c] = await sql`select cf.name, cf.training_days from class_f cf where cf.id = ${classId}
    order by (${date}::date between cf.effective_start_date and cf.effective_end_date) desc, cf.effective_start_date desc limit 1`;
  const codes = String(c?.training_days ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return { name: (c?.name as string) ?? 'This class', codes };
}

/** Null when attendance may be taken on that date for the class; otherwise the reason. */
export async function notTrainingDayReason(classId: string, date: string) {
  const { name, codes } = await trainingDays(classId, date);
  if (!codes.length || codes.includes(dayCode(date))) return null;
  const names = Object.fromEntries((await sql`select lookup_code, meaning from lookup_value where lookup_type = 'DAY_OF_WEEK'`).map((r) => [r.lookup_code, r.meaning]));
  return `${name} trains on ${codes.map((c) => names[c] ?? c).join(', ')} only – ${fmt(date)} is not a training day.`;
}

/** How each attendance status counts in attendance % (from the ATTENDANCE_STATUS lookup tag). */
export async function attendanceWeights(enterpriseId: string) {
  const s = await attendanceSettings(enterpriseId);
  const tags = Object.fromEntries((await sql`select lookup_code, tag from lookup_value where lookup_type = 'ATTENDANCE_STATUS'`).map((r) => [r.lookup_code, r.tag as string | null]));
  return { tags, half: s.half_day_value };
}
