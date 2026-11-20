import 'server-only';
import { sql, type Row } from './db';
import type { SessionUser } from './auth';
import { studentScopeSql } from './scope';
import { fullName, personAsOf } from './people';
import { ageOn, todayISO } from './util';

export type Eligibility = Row & { checks: { label: string; ok: boolean; detail: string }[]; eligible: boolean };

/**
 * Students (in the user's scope) that could sit this exam, each with the result
 * of every eligibility rule configured on the exam.
 */
export async function eligibleStudents(u: SessionUser, exam: Row): Promise<Eligibility[]> {
  const [ay] = await sql`select * from academic_year where id = ${exam.academic_year_id}`;
  const today = todayISO();
  const asOf = exam.exam_date < today ? exam.exam_date : today < ay.start_date ? ay.start_date : today;
  const attTo = asOf > ay.end_date ? ay.end_date : asOf;
  const rows = await sql`
    select a.id assignment_id, a.person_id, a.assignment_number, p.date_of_birth, ${fullName()} full_name, af.student_grade_id, af.class_id, af.business_unit_id,
      (select name from student_grade_f g where g.id = af.student_grade_id and ${asOf}::date between g.effective_start_date and g.effective_end_date) grade_name,
      (select min(x.effective_start_date) from assignment_f x where x.id = a.id and x.student_grade_id is not distinct from af.student_grade_id and x.effective_start_date <= ${asOf}
         and not exists (select 1 from assignment_f y where y.id = a.id and y.effective_start_date > x.effective_start_date and y.effective_start_date <= ${asOf}
                         and y.student_grade_id is distinct from af.student_grade_id)) grade_since,
      (select count(*) filter (where lv.tag in ('PRESENT')) + 0.5 * count(*) filter (where lv.tag = 'HALF') from student_attendance sa
         join lookup_value lv on lv.lookup_type = 'ATTENDANCE_STATUS' and lv.lookup_code = sa.status_code
         where sa.person_id = a.person_id and sa.attendance_date between ${ay.start_date} and ${attTo}) att_present,
      (select count(*) from student_attendance sa join lookup_value lv on lv.lookup_type = 'ATTENDANCE_STATUS' and lv.lookup_code = sa.status_code
         where sa.person_id = a.person_id and sa.attendance_date between ${ay.start_date} and ${attTo} and lv.tag is distinct from 'EXCLUDE') att_total,
      (select coalesce(sum(balance_amount), 0) from fee_demand_v d where d.person_id = a.person_id and d.cancelled_flag = 'N' and d.due_date <= ${asOf}
         and d.source_id is distinct from ${exam.id}) fees_due,
      (select e.name from exam_candidate c join exam e on e.id = c.exam_id where c.person_id = a.person_id and c.academic_year_id = ${exam.academic_year_id}
         and c.exam_type_code = 'GRADE_EXAM' and c.exam_id <> ${exam.id}) other_grade_exam,
      exists (select 1 from exam_candidate c where c.exam_id = ${exam.id} and c.person_id = a.person_id) assigned
    from assignment a
    join assignment_f af on af.id = a.id and ${asOf}::date between af.effective_start_date and af.effective_end_date
    join assignment_status_f st on st.id = af.assignment_status_id and ${asOf}::date between st.effective_start_date and st.effective_end_date
    join person p on p.id = a.person_id ${personAsOf(asOf)}
    where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STUDENT' and st.system_status_code = 'ACTIVE' ${studentScopeSql(u, asOf)}
      ${exam.business_unit_id ? sql`and af.business_unit_id = ${exam.business_unit_id}` : sql``}
      ${exam.class_id ? sql`and af.class_id = ${exam.class_id}` : sql``}
    order by full_name`;
  return rows.map((r) => {
    const checks: Eligibility['checks'] = [];
    if (exam.from_grade_id) checks.push({ label: 'Grade', ok: String(r.student_grade_id) === String(exam.from_grade_id), detail: r.grade_name ?? 'none' });
    if (exam.min_attendance_pct !== null) {
      const pct = Number(r.att_total) ? (Number(r.att_present) / Number(r.att_total)) * 100 : 0;
      checks.push({ label: 'Attendance', ok: pct >= Number(exam.min_attendance_pct), detail: `${pct.toFixed(0)}% (${r.att_total} days)` });
    }
    if (exam.fees_cleared_flag === 'Y') checks.push({ label: 'Fees cleared', ok: Number(r.fees_due) <= 0, detail: Number(r.fees_due) > 0 ? `₹${Number(r.fees_due)} due` : 'clear' });
    if (exam.min_months_in_grade !== null && r.grade_since) {
      const [y1, m1] = r.grade_since.split('-').map(Number);
      const [y2, m2] = asOf.split('-').map(Number);
      const months = (y2 - y1) * 12 + (m2 - m1);
      checks.push({ label: 'Months in grade', ok: months >= Number(exam.min_months_in_grade), detail: `${months} since ${r.grade_since}` });
    }
    if (exam.min_age !== null) {
      const age = ageOn(r.date_of_birth, exam.exam_date);
      checks.push({ label: 'Age', ok: age !== null && age >= Number(exam.min_age), detail: age === null ? 'DOB missing' : `${age} yrs` });
    }
    if (exam.exam_type_code === 'GRADE_EXAM') checks.push({ label: 'One grade exam / year', ok: !r.other_grade_exam, detail: r.other_grade_exam ? `already in ${r.other_grade_exam}` : 'ok' });
    return { ...r, checks, eligible: checks.every((c) => c.ok) };
  });
}

/** Exam fee for a student: by exam type and the grade being examined. */
export async function examFeeFor(exam: Row, currentGradeId: string | null) {
  const grade = exam.exam_type_code === 'GRADE_EXAM' ? exam.target_grade_id ?? currentGradeId : currentGradeId;
  if (!grade) return null;
  const [f] = await sql`select amount from exam_fee where academic_year_id = ${exam.academic_year_id} and exam_type_code = ${exam.exam_type_code} and student_grade_id = ${grade}`;
  return f ? Number(f.amount) : null;
}
