import 'server-only';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql, type Tx } from './db';
import type { SessionUser } from './auth';
import { nextNumber } from './numbering';
import { makeUsername } from './usernames';
import { checkAor, aorRowsFromForm } from './aor';
import { assertStudentAccess, myClasses, seesAllStudents } from './scope';
import { actionByType, actionInfo, academicYearOn, branchBusinessUnit, buLegalEmployer, classHierarchy, type PersonKind } from './people';
import { generateStudentFees } from './fees';
import { assertEffective } from './integrity';
import { readIdForm, validateIdentifier, assertIdUnique, insertIdentifier, normId, employerCountry } from './identifiers';

// Hire (staff) / admission (students). Used by the Hire / New Admission pages
// directly, and by the approval engine when a request (e.g. the staff
// Admission Form) is finally approved.

/** Assignment columns that point at date-tracked setup records. */
const ASG_REFS: [string, string, string][] = [
  ['section_id', 'section', 'Section'], ['student_grade_id', 'student_grade', 'Grade'], ['house_id', 'house', 'House'],
  ['club_id', 'club', 'Club'], ['community_id', 'community', 'Community'], ['person_type_id', 'person_type', 'Person type'],
  ['assignment_status_id', 'assignment_status', 'Status'], ['location_id', 'location', 'Location'], ['job_id', 'job', 'Job'],
  ['staff_grade_id', 'staff_grade', 'Grade'], ['department_id', 'department', 'Department'], ['position_id', 'position', 'Position'],
];
export async function assertAssignmentRefs(v: Record<string, any>, date: string) {
  for (const [col, table, label] of ASG_REFS) if (v[col]) await assertEffective(sql, table, v[col], date, label);
  if (v.academic_year_id) {
    const [y] = await sql`select name, start_date, end_date from academic_year where id = ${v.academic_year_id}`;
    if (y && (date < y.start_date || date > y.end_date)) throw new Error(`${date} is outside academic year ${y.name} (${y.start_date} – ${y.end_date}).`);
  }
}


export const PERSON_FIELDS = [
  'title_code', 'first_name', 'middle_name', 'last_name', 'known_as', 'gender_code', 'blood_group_code', 'marital_status_code', 'nationality_code',
  'religion_code', 'mother_tongue_code', 'phone', 'alt_phone', 'email', 'address_line1', 'address_line2', 'city', 'state_code', 'country_code',
  'postal_code', 'emergency_contact_name', 'emergency_contact_phone', 'medical_notes',
] as const;

export function personVals(o: Record<string, string | null>) {
  if (!o.first_name) throw new Error('First name is required');
  return Object.fromEntries(PERSON_FIELDS.map((f) => [f, o[f] ?? null]));
}

export async function guard(u: SessionUser, kind: PersonKind, personId: string | null, asOf: string) {
  if (kind === 'STUDENT' && personId) await assertStudentAccess(u, personId, asOf);
}

/** Assignment attribute values from a submitted form. */
export async function assignmentVals(u: SessionUser, kind: PersonKind, o: Record<string, string | null>, date: string, personId: string | null = null): Promise<Record<string, any>> {
  if (kind === 'STUDENT') {
    // separate Branch / Class / Section fields (older "class:section" value still accepted)
    const [csClass, csSection] = (o.class_section ?? '').split(':');
    const classId = o.class_id ?? csClass;
    const sectionId = o.section_id ?? csSection;
    if (!classId) throw new Error('Class is required');
    if (!sectionId) throw new Error('Section is required');
    if (!o.fee_frequency_code) throw new Error('Fee frequency is required');
    // fee on the assignment (first preference when fees are generated)
    let feeAmount: number | null = null;
    if (o.fee_amount) {
      feeAmount = Number(o.fee_amount);
      if (!Number.isFinite(feeAmount) || feeAmount < 0) throw new Error('Fee amount must be 0 or more');
      if ((o.fee_type_code ?? 'TUITION') !== 'TUITION') throw new Error('Only the Tuition Fee can be set on the assignment.');
    }
    const [sec] = await sql`select class_id from section_f where id = ${sectionId} and ${date}::date between effective_start_date and effective_end_date`;
    if (!sec) throw new Error(`The section is not effective on ${date}.`);
    if (String(sec.class_id) !== String(classId)) throw new Error('That section does not belong to the chosen class.');
    if (!seesAllStudents(u)) {
      const allowed = (await myClasses(u, date)).some((c) => String(c.class_id) === String(classId) && String(c.section_id) === String(sectionId));
      if (!allowed) throw new Error('You can only place students in your own classes.');
    }
    const h = await classHierarchy(classId, date);
    if (o.branch_id && String(o.branch_id) !== String(h.branch_id)) throw new Error('That class does not belong to the chosen branch on this date.');
    if (o.business_unit_id && String(o.business_unit_id) !== String(h.business_unit_id)) throw new Error('That class does not belong to the chosen business unit on this date.');
    let ay = o.academic_year_id;
    if (!ay) ay = (await academicYearOn(u.enterpriseId, date))?.id ?? null;
    const sv = {
      class_id: classId, section_id: sectionId || null, branch_id: h.branch_id, business_unit_id: h.business_unit_id, legal_employer_id: h.legal_employer_id,
      academic_year_id: ay, student_grade_id: o.student_grade_id, house_id: o.house_id, club_id: o.club_id, community_id: o.community_id,
      fee_frequency_code: o.fee_frequency_code, fee_type_code: feeAmount === null ? null : (o.fee_type_code ?? 'TUITION'), fee_amount: feeAmount,
      person_type_id: o.person_type_id, comments: o.comments,
    };
    await assertAssignmentRefs({ ...sv, assignment_status_id: o.assignment_status_id }, date);
    return sv;
  }
  // a chosen position supplies any details left blank
  if (o.position_id) {
    const [pf] = await sql`select * from position_f where id = ${o.position_id} and ${date}::date between effective_start_date and effective_end_date`;
    if (pf) {
      o.business_unit_id ??= pf.business_unit_id && String(pf.business_unit_id);
      o.department_id ??= pf.department_id && String(pf.department_id);
      o.job_id ??= pf.job_id && String(pf.job_id);
      o.staff_grade_id ??= pf.staff_grade_id && String(pf.staff_grade_id);
      o.employment_type_code ??= pf.full_time_flag === 'N' ? 'PART_TIME' : 'FULL_TIME';
    }
  }
  // a branch decides its business unit
  if (o.branch_id) {
    const bu = await branchBusinessUnit(o.branch_id, date);
    if (o.business_unit_id && String(o.business_unit_id) !== bu) throw new Error('That branch does not belong to the chosen business unit on this date.');
    o.business_unit_id = bu;
  }
  if (!o.business_unit_id) throw new Error('Business unit is required');
  // manager: an active staff member on the date, not the person themselves
  if (o.manager_person_id) {
    if (personId && String(o.manager_person_id) === String(personId)) throw new Error('A staff member cannot be their own manager.');
    const [m] = await sql`select 1 from assignment a join assignment_f af on af.id = a.id and ${date}::date between af.effective_start_date and af.effective_end_date
      join assignment_status_f st on st.id = af.assignment_status_id and ${date}::date between st.effective_start_date and st.effective_end_date
      where a.person_id = ${o.manager_person_id} and a.assignment_type = 'STAFF' and st.system_status_code = 'ACTIVE'`;
    if (!m) throw new Error(`The chosen manager is not an active staff member on ${date}.`);
  }
  const le = await buLegalEmployer(o.business_unit_id, date);
  if (o.legal_employer_id && String(o.legal_employer_id) !== String(le)) throw new Error('That business unit does not belong to the chosen legal employer on this date.');
  const fv = {
    business_unit_id: o.business_unit_id, branch_id: o.branch_id, legal_employer_id: le, location_id: o.location_id, manager_person_id: o.manager_person_id,
    job_id: o.job_id, staff_grade_id: o.staff_grade_id, department_id: o.department_id, position_id: o.position_id,
    employment_type_code: o.employment_type_code, employment_category_code: o.employment_category_code, payroll_status_code: o.payroll_status_code,
    person_type_id: o.person_type_id, comments: o.comments,
  };
  await assertAssignmentRefs({ ...fv, assignment_status_id: o.assignment_status_id }, date);
  return fv;
}

/** Prefix of a password that was already hashed (stored in an approval request instead of the plain text). */
export const HASHED = 'bcrypt:';
export const hashForRequest = async (pw: string | null | undefined) => {
  if (!pw || pw.startsWith(HASHED)) return pw ?? null;
  if (pw.length < 6) throw new Error('Login password must be at least 6 characters');
  return HASHED + (await bcrypt.hash(pw, 10));
};

export async function createLogin(tx: Tx, u: SessionUser, username: string, password: string, display: string, personId: string | null, roles: string[], students: string[] = []) {
  const prehashed = password.startsWith(HASHED);
  if (!prehashed && password.length < 6) throw new Error('Login password must be at least 6 characters');
  const [ex] = await tx`select id, active_flag from user_account where lower(username) = lower(${username})`;
  let uid = ex?.id;
  // an existing login that was switched off (e.g. a parent whose only child was deleted) is reactivated with the new password
  if (ex && ex.active_flag === 'N')
    await tx`update user_account set active_flag = 'Y', password_hash = ${prehashed ? password.slice(HASHED.length) : await bcrypt.hash(password, 10)}, must_change_password = 'Y',
      last_updated_by = ${u.username}, last_update_date = now() where id = ${uid}`;
  if (!uid) {
    const [n] = await tx`insert into user_account (enterprise_id, username, password_hash, display_name, person_id, must_change_password, created_by)
      values (${u.enterpriseId}, ${username.toLowerCase()}, ${prehashed ? password.slice(HASHED.length) : await bcrypt.hash(password, 10)}, ${display}, ${personId}, 'Y', ${u.username}) returning id`;
    uid = n.id;
  }
  for (const r of roles) await tx`insert into user_role values (${uid}, ${r}) on conflict do nothing`;
  for (const s of students) await tx`insert into user_student_access values (${uid}, ${s}) on conflict do nothing`;
}


/** Inputs that come from the form itself rather than its text fields. */
export type HireExtras = { photo: { mime: string; data: Buffer } | null; attributes: Record<string, unknown>; loginRoles: string[] };

/**
 * The hire / admission, inside the caller's transaction. `u` is the person
 * doing it (for an approved request: the requester). Returns the new person.
 */
export async function hireInTx(tx: Tx, u: SessionUser, kind: PersonKind, o: Record<string, string | null>, x: HireExtras): Promise<{ personId: string; msg: string }> {
  const date = o.hire_date;
  if (!date) throw new Error(`${kind === 'STUDENT' ? 'Admission' : 'Hire'} date is required`);
  await guard(u, kind, null, date);
  const ids = [readIdForm(o, 'id1'), readIdForm(o, 'id2')].filter((y): y is NonNullable<typeof y> => !!y);
  if (ids.length === 2 && ids[0].type === ids[1].type && normId(ids[0].number) === normId(ids[1].number)) throw new Error('The two identification documents are the same');
  let personId = '';
  let msg = '';
    // person: new or existing (e.g. a senior student joining as staff)
    if (o.existing_person_number) {
      const [p] = await tx`select p.id from person p left join assignment a on a.person_id = p.id
        where p.enterprise_id = ${u.enterpriseId} and (upper(p.person_number) = upper(${o.existing_person_number}) or upper(a.assignment_number) = upper(${o.existing_person_number})) limit 1`;
      if (!p) throw new Error(`No person found with number ${o.existing_person_number}`);
      personId = p.id;
      const [dup] = await tx`select assignment_number from assignment where person_id = ${personId} and assignment_type = ${kind}`;
      if (dup) throw new Error(`This person already has a ${kind.toLowerCase()} record (${dup.assignment_number}). Use the Re-admission / Rehire action instead.`);
    } else {
      const pv: Record<string, any> = personVals(o);
      pv.attributes = x.attributes;
      const pnum = (await nextNumber(tx, u.enterpriseId, 'PERSON', { date })) ?? o.person_number;
      if (!pnum) throw new Error('Person number is required (manual numbering)');
      const [ptaken] = await tx`select 1 from person where enterprise_id = ${u.enterpriseId} and upper(person_number) = upper(${pnum})`;
      if (ptaken) throw new Error(`Person number ${pnum} is already used. Enter a different number.`);
      const [p] = await tx`insert into person (enterprise_id, person_number, date_of_birth, qr_token, created_by)
        values (${u.enterpriseId}, ${pnum}, ${o.date_of_birth}, ${crypto.randomBytes(12).toString('hex')}, ${u.username}) returning id`;
      personId = p.id;
      await tx`insert into person_f ${tx({ id: personId, effective_start_date: date, ...pv, created_by: u.username, last_updated_by: u.username })}`;
    }
    const av = await assignmentVals(u, kind, o, date);
    // identification: mandatory unless an existing person already has one;
    // the types allowed follow the legal employer's country
    const [hasId] = await tx`select 1 from person_identifier where person_id = ${personId}`;
    if (!ids.length && !hasId) throw new Error('Identification details are required (type and number)');
    const country = await employerCountry(tx, av.legal_employer_id, date);
    for (const [i, x] of ids.entries()) {
      await validateIdentifier(tx, x, country);
      await assertIdUnique(tx, u.enterpriseId, x, personId);
      const [same] = await tx`select 1 from person_identifier where person_id = ${personId} and id_type_code = ${x.type} and id_number_norm = ${normId(x.number)}`;
      if (!same) await insertIdentifier(tx, u.enterpriseId, personId, x, i === 0 && !hasId, u.username);
    }
    const hire = o.action_id ? await actionInfo(o.action_id, date) : await actionByType(u.enterpriseId, kind, 'HIRE', date);
    if (!hire) throw new Error(`No ${kind === 'STUDENT' ? 'admission' : 'hire'} action is configured`);
    const anum = (await nextNumber(tx, u.enterpriseId, kind, { buId: av.business_unit_id, leId: av.legal_employer_id, branchId: av.branch_id, date })) ?? o.assignment_number;
    if (!anum) throw new Error(`${kind === 'STUDENT' ? 'Student' : 'Staff'} number is required (manual numbering)`);
    const [taken] = await tx`select a.person_id, (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = a.person_id order by effective_start_date desc limit 1) who
      from assignment a where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = ${kind} and upper(a.assignment_number) = upper(${anum})`;
    if (taken) throw new Error(`${kind === 'STUDENT' ? 'Student' : 'Staff'} number ${anum} is already used by ${taken.who ?? 'another person'}. Enter a different number.`);
    const [a] = await tx`insert into assignment (enterprise_id, person_id, assignment_type, assignment_number, original_start_date, created_by)
      values (${u.enterpriseId}, ${personId}, ${kind}, ${anum}, ${date}, ${u.username}) returning id`;
    if (!av.person_type_id) {
      const [pt] = await tx`select f.id from person_type b join person_type_f f on f.id = b.id and ${date}::date between f.effective_start_date and f.effective_end_date
        where b.enterprise_id = ${u.enterpriseId} and f.person_category = ${kind} order by b.id limit 1`;
      av.person_type_id = pt?.id ?? null;
    }
    await tx`insert into assignment_f ${tx({
      id: a.id, effective_start_date: date, action_id: hire.id, action_reason_code: o.action_reason_code ?? (kind === 'STUDENT' ? 'NEW_ADMISSION' : 'HIRE'),
      assignment_status_id: o.assignment_status_id ?? hire.assignment_status_id, ...av, created_by: u.username, last_updated_by: u.username,
    })}`;
    // areas of responsibility entered on the form
    for (const r of aorRowsFromForm(o)) {
      const v = await checkAor(tx, kind, personId, r, date);
      await tx`insert into area_of_responsibility ${tx({ enterprise_id: u.enterpriseId, person_id: personId, person_category: kind, aor_type_code: v.aor_type_code,
        academic_year_id: v.academic_year_id, start_date: v.start_date, end_date: v.end_date, remarks: v.remarks, created_by: u.username, last_updated_by: u.username })}`;
    }
    if (x.photo) await tx`insert into person_photo (person_id, mime, data) values (${personId}, ${x.photo.mime}, ${x.photo.data}) on conflict (person_id) do update set mime = excluded.mime, data = excluded.data`;
    // guardians
    for (const rel of ['FATHER', 'MOTHER', 'GUARDIAN']) {
      const name = o[`${rel.toLowerCase()}_name`];
      if (name) await tx`insert into person_contact (person_id, relationship_code, name, phone, email, occupation, primary_flag, created_by)
        values (${personId}, ${rel}, ${name}, ${o[`${rel.toLowerCase()}_phone`]}, ${o[`${rel.toLowerCase()}_email`]}, ${o[`${rel.toLowerCase()}_occupation`]}, ${rel === (o.primary_contact ?? 'FATHER') ? 'Y' : 'N'}, ${u.username})`;
    }
    // logins
    const display = [o.first_name, o.last_name].filter(Boolean).join(' ') || anum;
    if (kind === 'STUDENT') {
      if (o.parent_username && o.parent_password) await createLogin(tx, u, o.parent_username, o.parent_password, `Parent of ${display}`, null, ['PARENT'], [personId]);
      if (o.student_login === 'Y') {
        if (!o.parent_password) throw new Error('Enter the temporary password to create the student login.');
        // students: user name = student number (Configuration › User Name Rules)
        await createLogin(tx, u, await makeUsername(tx, u.enterpriseId, 'STUDENT', { number: anum }), o.parent_password, display, personId, ['STUDENT']);
      }
    } else if (o.login_password) {
      // staff: user name from Configuration › User Name Rules (staff number, first + last name or email id)
      const username = await makeUsername(tx, u.enterpriseId, 'STAFF', { number: anum, first: o.first_name, last: o.last_name, email: o.email });
      const roles = x.loginRoles.filter((r) => ['INCHARGE', 'STAFF', 'ACCOUNTANT'].includes(r));
      await createLogin(tx, u, username, o.login_password, display, personId, roles.length ? roles : ['STAFF']);
      msg += ` Login user name: ${username}.`;
    }
    // fees for the academic year
    if (kind === 'STUDENT' && o.generate_fees === 'Y' && av.academic_year_id) {
      const [ay] = await tx`select * from academic_year where id = ${av.academic_year_id}`;
      const r = await generateStudentFees(tx, { enterpriseId: u.enterpriseId, personId, assignmentId: a.id, ay, asg: av, joinDate: date, by: u.username });
      msg = ` ${r.created} fee installment(s) have been created.`;
    }
    msg = `${display} has been ${kind === 'STUDENT' ? 'admitted as student' : 'hired as staff'} ${anum}.${msg}`;
  return { personId, msg };
}
