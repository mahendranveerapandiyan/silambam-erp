import 'server-only';
import { sql, type Row } from './db';
import type { Facts } from './approvals';

const ageOn = (dob: string | null | undefined, on: string) => {
  if (!dob) return null;
  let age = Number(on.slice(0, 4)) - Number(dob.slice(0, 4));
  if (on.slice(5) < dob.slice(5)) age--;
  return age;
};

/** What approval rule conditions can test on a hire / admission (from its form). */
export async function hireFacts(o: Record<string, string | null>): Promise<Facts> {
  const date = o.hire_date ?? new Date().toISOString().slice(0, 10);
  let le = o.legal_employer_id;
  if (!le && o.business_unit_id) {
    const [b] = await sql`select legal_employer_id from business_unit_f where id = ${o.business_unit_id}
      order by (${date}::date between effective_start_date and effective_end_date) desc, effective_start_date desc limit 1`;
    le = b?.legal_employer_id ? String(b.legal_employer_id) : null;
  }
  return {
    LEGAL_EMPLOYER: le, BUSINESS_UNIT: o.business_unit_id, BRANCH: o.branch_id, CLASS: o.class_id, SECTION: o.section_id,
    ACADEMIC_YEAR: o.academic_year_id, STUDENT_GRADE: o.student_grade_id, HOUSE: o.house_id, CLUB: o.club_id, COMMUNITY: o.community_id,
    FEE_FREQUENCY: o.fee_frequency_code, FEE_TYPE: o.fee_amount ? (o.fee_type_code ?? 'TUITION') : null, FEE_AMOUNT: o.fee_amount ? Number(o.fee_amount) : null,
    LOCATION: o.location_id, DEPARTMENT: o.department_id, JOB: o.job_id, POSITION: o.position_id, STAFF_GRADE: o.staff_grade_id,
    EMPLOYMENT_TYPE: o.employment_type_code, EMPLOYMENT_CATEGORY: o.employment_category_code, PAYROLL_STATUS: o.payroll_status_code,
    PERSON_TYPE: o.person_type_id, ACTION_REASON: o.action_reason_code, GENDER: o.gender_code, NATIONALITY: o.nationality_code,
    RELIGION: o.religion_code, MOTHER_TONGUE: o.mother_tongue_code, AGE: ageOn(o.date_of_birth, date),
  };
}

/** What approval rule conditions can test on a fee exception: the fee line and the student's placement on the date. */
export async function feeExceptionFacts(d: Row, exceptionAmount: number, reasonCode: string | null, personId: string, date: string): Promise<Facts> {
  const [af] = await sql`select af.* from assignment a join assignment_f af on af.id = a.id
    where a.person_id = ${personId} and a.assignment_type = 'STUDENT'
    order by (${date}::date between af.effective_start_date and af.effective_end_date) desc, af.effective_start_date desc limit 1`;
  const [pf] = await sql`select gender_code from person_f where id = ${personId}
    order by (${date}::date between effective_start_date and effective_end_date) desc, effective_start_date desc limit 1`;
  const line = Number(d.amount);
  return {
    FEE_TYPE: d.fee_type_code, AMOUNT: exceptionAmount, FEE_LINE_AMOUNT: line,
    EXCEPTION_PERCENT: line > 0 ? Math.round((exceptionAmount / line) * 10000) / 100 : null,
    EXCEPTION_REASON: reasonCode, ACADEMIC_YEAR: d.academic_year_id ?? af?.academic_year_id,
    BUSINESS_UNIT: af?.business_unit_id ?? d.business_unit_id, BRANCH: af?.branch_id, CLASS: af?.class_id, SECTION: af?.section_id,
    STUDENT_GRADE: af?.student_grade_id, HOUSE: af?.house_id, CLUB: af?.club_id, COMMUNITY: af?.community_id,
    FEE_FREQUENCY: af?.fee_frequency_code, GENDER: pf?.gender_code,
  };
}
