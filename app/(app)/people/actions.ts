'use server';
import { photoToJpeg } from '@/lib/images';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql, type Tx } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { act, backOf, formObj, fileToBytes } from '@/lib/util';
import { dtChange, dtCorrectVersion } from '@/lib/dt';
import { nextNumber } from '@/lib/numbering';
import { assertStudentAccess, myClasses, seesAllStudents } from '@/lib/scope';

const dirPriv = (k: PersonKind) => (k === 'STUDENT' ? 'CD_STUDENT_DIRECTORY_PRV' : 'CD_STAFF_DIRECTORY_PRV');
const actPriv = (k: PersonKind) => (k === 'STUDENT' ? 'CD_STUDENT_ACTION_PRV' : 'CD_STAFF_ACTION_PRV');
import { actionByType, actionInfo, academicYearOn, buLegalEmployer, classHierarchy, type PersonKind } from '@/lib/people';
import { generateStudentFees } from '@/lib/fees';
import { assertEffective } from '@/lib/integrity';
import { parseAttributes } from '@/lib/fields';

/** Assignment columns that point at date-tracked setup records. */
const ASG_REFS: [string, string, string][] = [
  ['section_id', 'section', 'Section'], ['student_grade_id', 'student_grade', 'Grade'], ['house_id', 'house', 'House'],
  ['club_id', 'club', 'Club'], ['community_id', 'community', 'Community'], ['person_type_id', 'person_type', 'Person type'],
  ['assignment_status_id', 'assignment_status', 'Status'], ['location_id', 'location', 'Location'], ['job_id', 'job', 'Job'],
  ['staff_grade_id', 'staff_grade', 'Grade'], ['department_id', 'department', 'Department'], ['position_id', 'position', 'Position'],
];
async function assertAssignmentRefs(v: Record<string, any>, date: string) {
  for (const [col, table, label] of ASG_REFS) if (v[col]) await assertEffective(sql, table, v[col], date, label);
  if (v.academic_year_id) {
    const [y] = await sql`select name, start_date, end_date from academic_year where id = ${v.academic_year_id}`;
    if (y && (date < y.start_date || date > y.end_date)) throw new Error(`${date} is outside academic year ${y.name} (${y.start_date} – ${y.end_date}).`);
  }
}

const base = (k: PersonKind) => (k === 'STUDENT' ? '/students' : '/staff');

const PERSON_FIELDS = [
  'title_code', 'first_name', 'middle_name', 'last_name', 'known_as', 'gender_code', 'blood_group_code', 'marital_status_code', 'nationality_code',
  'religion_code', 'mother_tongue_code', 'phone', 'alt_phone', 'email', 'address_line1', 'address_line2', 'city', 'state_code', 'country_code',
  'postal_code', 'emergency_contact_name', 'emergency_contact_phone', 'medical_notes',
] as const;

function personVals(o: Record<string, string | null>) {
  if (!o.first_name) throw new Error('First name is required');
  return Object.fromEntries(PERSON_FIELDS.map((f) => [f, o[f] ?? null]));
}

async function guard(u: SessionUser, kind: PersonKind, personId: string | null, asOf: string) {
  if (kind === 'STUDENT' && personId) await assertStudentAccess(u, personId, asOf);
}

/** Assignment attribute values from a submitted form. */
async function assignmentVals(u: SessionUser, kind: PersonKind, o: Record<string, string | null>, date: string): Promise<Record<string, any>> {
  if (kind === 'STUDENT') {
    // separate Branch / Class / Section fields (older "class:section" value still accepted)
    const [csClass, csSection] = (o.class_section ?? '').split(':');
    const classId = o.class_id ?? csClass;
    const sectionId = o.section_id ?? csSection;
    if (!classId) throw new Error('Class is required');
    if (!sectionId) throw new Error('Section is required');
    const [sec] = await sql`select class_id from section_f where id = ${sectionId} and ${date}::date between effective_start_date and effective_end_date`;
    if (!sec) throw new Error(`The section is not effective on ${date}.`);
    if (String(sec.class_id) !== String(classId)) throw new Error('That section does not belong to the chosen class.');
    if (!seesAllStudents(u)) {
      const allowed = (await myClasses(u, date)).some((c) => String(c.class_id) === String(classId) && String(c.section_id) === String(sectionId));
      if (!allowed) throw new Error('You can only place students in your own classes.');
    }
    const h = await classHierarchy(classId, date);
    if (o.business_unit_id && String(o.business_unit_id) !== String(h.business_unit_id)) throw new Error('That class does not belong to the chosen branch on this date.');
    let ay = o.academic_year_id;
    if (!ay) ay = (await academicYearOn(u.enterpriseId, date))?.id ?? null;
    const sv = {
      class_id: classId, section_id: sectionId || null, business_unit_id: h.business_unit_id, legal_employer_id: h.legal_employer_id,
      academic_year_id: ay, student_grade_id: o.student_grade_id, house_id: o.house_id, club_id: o.club_id, community_id: o.community_id,
      fee_frequency_code: o.fee_frequency_code ?? 'MONTHLY', person_type_id: o.person_type_id, comments: o.comments,
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
  if (!o.business_unit_id) throw new Error('Business unit is required');
  const le = await buLegalEmployer(o.business_unit_id, date);
  if (o.legal_employer_id && String(o.legal_employer_id) !== String(le)) throw new Error('That business unit does not belong to the chosen legal employer on this date.');
  const fv = {
    business_unit_id: o.business_unit_id, legal_employer_id: le, location_id: o.location_id,
    job_id: o.job_id, staff_grade_id: o.staff_grade_id, department_id: o.department_id, position_id: o.position_id,
    employment_type_code: o.employment_type_code, employment_category_code: o.employment_category_code, payroll_status_code: o.payroll_status_code,
    person_type_id: o.person_type_id, comments: o.comments,
  };
  await assertAssignmentRefs({ ...fv, assignment_status_id: o.assignment_status_id }, date);
  return fv;
}

async function createLogin(tx: Tx, u: SessionUser, username: string, password: string, display: string, personId: string | null, roles: string[], students: string[] = []) {
  if (password.length < 6) throw new Error('Login password must be at least 6 characters');
  const [ex] = await tx`select id from user_account where lower(username) = lower(${username})`;
  let uid = ex?.id;
  if (!uid) {
    const [n] = await tx`insert into user_account (enterprise_id, username, password_hash, display_name, person_id, must_change_password, created_by)
      values (${u.enterpriseId}, ${username.toLowerCase()}, ${await bcrypt.hash(password, 10)}, ${display}, ${personId}, 'Y', ${u.username}) returning id`;
    uid = n.id;
  }
  for (const r of roles) await tx`insert into user_role values (${uid}, ${r}) on conflict do nothing`;
  for (const s of students) await tx`insert into user_student_access values (${uid}, ${s}) on conflict do nothing`;
}

// ------------------------------------------------------------------ hire
export async function hirePerson(kind: PersonKind, fd: FormData) {
  const u = await requirePriv(kind === 'STUDENT' ? 'CD_STUDENT_ADMISSION_PRV' : 'CD_STAFF_HIRE_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    const date = o.hire_date;
    if (!date) throw new Error(`${kind === 'STUDENT' ? 'Admission' : 'Hire'} date is required`);
    await guard(u, kind, null, date);
    const photo = await photoToJpeg(fd.get('photo'));
    let personId = '';
    let msg = '';
    await sql.begin(async (tx) => {
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
        pv.attributes = await parseAttributes(u.enterpriseId, kind, fd);
        const pnum = (await nextNumber(tx, u.enterpriseId, 'PERSON', { date })) ?? o.person_number;
        if (!pnum) throw new Error('Person number is required (manual numbering)');
        const [p] = await tx`insert into person (enterprise_id, person_number, date_of_birth, qr_token, created_by)
          values (${u.enterpriseId}, ${pnum}, ${o.date_of_birth}, ${crypto.randomBytes(12).toString('hex')}, ${u.username}) returning id`;
        personId = p.id;
        await tx`insert into person_f ${tx({ id: personId, effective_start_date: date, ...pv, created_by: u.username, last_updated_by: u.username })}`;
      }
      const av = await assignmentVals(u, kind, o, date);
      const hire = o.action_id ? await actionInfo(o.action_id, date) : await actionByType(u.enterpriseId, kind, 'HIRE', date);
      if (!hire) throw new Error(`No ${kind === 'STUDENT' ? 'admission' : 'hire'} action is configured`);
      const anum = (await nextNumber(tx, u.enterpriseId, kind, { buId: av.business_unit_id, leId: av.legal_employer_id, date })) ?? o.assignment_number;
      if (!anum) throw new Error(`${kind === 'STUDENT' ? 'Student' : 'Staff'} number is required (manual numbering)`);
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
      if (photo) await tx`insert into person_photo (person_id, mime, data) values (${personId}, ${photo.mime}, ${photo.data}) on conflict (person_id) do update set mime = excluded.mime, data = excluded.data`;
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
        if (o.student_login === 'Y' && o.parent_password) await createLogin(tx, u, anum, o.parent_password, display, personId, ['STUDENT']);
      } else if (o.login_username && o.login_password) {
        const roles = fd.getAll('login_roles').map(String).filter((r) => ['INCHARGE', 'STAFF', 'ACCOUNTANT'].includes(r));
        await createLogin(tx, u, o.login_username, o.login_password, display, personId, roles.length ? roles : ['STAFF']);
      }
      // fees for the academic year
      if (kind === 'STUDENT' && o.generate_fees === 'Y' && av.academic_year_id) {
        const [ay] = await tx`select * from academic_year where id = ${av.academic_year_id}`;
        const r = await generateStudentFees(tx, { enterpriseId: u.enterpriseId, personId, assignmentId: a.id, ay, asg: av, joinDate: date, by: u.username });
        msg = ` · ${r.created} fee installment(s) created`;
      }
      msg = `${kind === 'STUDENT' ? 'Student admitted' : 'Staff hired'}: ${anum}${msg}`;
    });
    return { to: `${base(kind)}/${personId}`, msg };
  });
}

// --------------------------------------------------------- personal info
export async function updatePerson(kind: PersonKind, personId: string, fd: FormData) {
  const u = await requirePriv(dirPriv(kind), 'WRITE');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    if (!o.effective_date) throw new Error('Effective date is required');
    await guard(u, kind, personId, await getAsOf());
    const [cur] = await sql`select attributes from person_f where id = ${personId} and ${o.effective_date}::date between effective_start_date and effective_end_date`;
    const vals: Record<string, any> = personVals(o);
    vals.attributes = await parseAttributes(u.enterpriseId, kind, fd, cur?.attributes ?? {});
    await sql.begin(async (tx) => {
      await dtChange(tx, 'person', personId, o.effective_date!, o.mode === 'CORRECT' ? 'CORRECT' : 'UPDATE', vals, u.username);
      await tx`update person set date_of_birth = ${o.date_of_birth} where id = ${personId}`;
    });
    return { msg: 'Personal details saved' };
  });
}

export async function uploadPhoto(kind: PersonKind, personId: string, fd: FormData) {
  const u = await requirePriv(dirPriv(kind), 'WRITE');
  await act(backOf(fd), async () => {
    await guard(u, kind, personId, await getAsOf());
    const photo = await photoToJpeg(fd.get('photo'));
    if (!photo) throw new Error('Choose an image');
    await sql`insert into person_photo (person_id, mime, data) values (${personId}, ${photo.mime}, ${photo.data})
      on conflict (person_id) do update set mime = excluded.mime, data = excluded.data, last_update_date = now()`;
    return { msg: 'Photo updated' };
  });
}

export async function regenerateQr(kind: PersonKind, personId: string, fd: FormData) {
  const u = await requirePriv(dirPriv(kind), 'WRITE');
  await act(backOf(fd), async () => {
    await guard(u, kind, personId, await getAsOf());
    await sql`update person set qr_token = ${crypto.randomBytes(12).toString('hex')} where id = ${personId}`;
    return { msg: 'New QR code issued. Old ID cards no longer scan.' };
  });
}

export async function saveContact(kind: PersonKind, personId: string, contactId: string | null, fd: FormData) {
  const u = await requirePriv(dirPriv(kind), 'WRITE');
  await act(backOf(fd), async () => {
    await guard(u, kind, personId, await getAsOf());
    const o = formObj(fd);
    if (o._delete && contactId) {
      await sql`delete from person_contact where id = ${contactId} and person_id = ${personId}`;
      return { msg: 'Contact removed' };
    }
    if (!o.name || !o.relationship_code) throw new Error('Relationship and name are required');
    const v = { relationship_code: o.relationship_code, name: o.name, phone: o.phone, email: o.email, occupation: o.occupation, primary_flag: o.primary_flag === 'Y' ? 'Y' : 'N' };
    if (v.primary_flag === 'Y') await sql`update person_contact set primary_flag = 'N' where person_id = ${personId}`;
    if (contactId) await sql`update person_contact set ${sql({ ...v, last_updated_by: u.username, last_update_date: new Date() })} where id = ${contactId} and person_id = ${personId}`;
    else await sql`insert into person_contact ${sql({ person_id: personId, ...v, created_by: u.username })}`;
    return { msg: 'Contact saved' };
  });
}

// ------------------------------------------------------ assignment actions
export async function assignmentAction(kind: PersonKind, personId: string, fd: FormData) {
  const u = await requirePriv(actPriv(kind), 'WRITE');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    const date = o.effective_date;
    if (!date || !o.action_id) throw new Error('Action and effective date are required');
    await guard(u, kind, personId, date);
    const action = await actionInfo(o.action_id, date);
    if (action.person_category !== kind) throw new Error('This action does not apply here');
    const [a] = await sql`select id from assignment where person_id = ${personId} and assignment_type = ${kind}`;
    if (!a) throw new Error('No assignment found');
    const [cur] = await sql`select af.*, st.system_status_code from assignment_f af
      left join assignment_status_f st on st.id = af.assignment_status_id and ${date}::date between st.effective_start_date and st.effective_end_date
      where af.id = ${a.id} and ${date}::date between af.effective_start_date and af.effective_end_date`;
    if (!cur) throw new Error(`No assignment version is effective on ${date}`);
    if (action.action_type_code === 'HIRE') throw new Error('Use Re-admission / Rehire for a person who already has a record.');
    if (action.action_type_code === 'REHIRE' && cur.system_status_code !== 'INACTIVE') throw new Error('Rehire / Re-admission is only for inactive records.');
    if (cur.system_status_code === 'INACTIVE' && action.action_type_code !== 'REHIRE') throw new Error('This record is inactive. Use Re-admission / Rehire first.');
    const terminating = action.action_type_code === 'TERMINATION';
    const vals = terminating ? {} : await assignmentVals(u, kind, o, date);
    await sql.begin((tx) =>
      dtChange(tx, 'assignment', a.id, date, o.mode === 'CORRECT' ? 'CORRECT' : 'UPDATE', {
        ...vals,
        action_id: action.id,
        action_reason_code: o.action_reason_code,
        assignment_status_id: o.assignment_status_id ?? action.assignment_status_id ?? cur.assignment_status_id,
        comments: o.comments,
      }, u.username),
    );
    if (terminating && kind === 'STAFF') await sql`update class_incharge set end_date = ${date} where person_id = ${personId} and end_date > ${date}`;
    return { to: `${base(kind)}/${personId}?tab=assignment`, msg: `${action.name} recorded effective ${date}` };
  });
}

export async function undoAssignment(kind: PersonKind, personId: string, fd: FormData) {
  await requirePriv(actPriv(kind), 'WRITE');
  await act(backOf(fd), async () => {
    const [a] = await sql`select id from assignment where person_id = ${personId} and assignment_type = ${kind}`;
    const { dtDeleteLatest } = await import('@/lib/dt');
    await sql.begin((tx) => dtDeleteLatest(tx, 'assignment', a.id));
    return { msg: 'Latest assignment change removed' };
  });
}

/**
 * Change the original admission / hire date. The first assignment version (and
 * the personal record, if it started on the old date or later) move with it.
 * Moving later is refused when attendance, payments or exams exist before the
 * new date; unpaid fee lines that end before the new date are cancelled.
 */
export async function changeStartDate(kind: PersonKind, personId: string, fd: FormData) {
  const u = await requirePriv(actPriv(kind), 'WRITE');
  await act(backOf(fd), async () => {
    const newDate = formObj(fd).new_date;
    if (!newDate) throw new Error('Choose the new date');
    await guard(u, kind, personId, newDate);
    const [a] = await sql`select * from assignment where person_id = ${personId} and assignment_type = ${kind}`;
    if (!a) throw new Error('No record found');
    const oldDate = a.original_start_date as string;
    if (newDate === oldDate) return { msg: 'Date unchanged' };
    let cancelled = 0;
    await sql.begin(async (tx) => {
      const [first] = await tx`select * from assignment_f where id = ${a.id} order by effective_start_date limit 1`;
      // everything the first version points at must exist on the new date
      await assertAssignmentRefs(first, newDate);
      if (first.class_id) await assertEffective(tx, 'class', first.class_id, newDate, 'Class');
      if (first.business_unit_id) await assertEffective(tx, 'business_unit', first.business_unit_id, newDate, 'Business unit');
      if (newDate > oldDate) {
        const att = kind === 'STUDENT' ? 'student_attendance' : 'staff_attendance';
        const [n] = await tx`select count(*)::int n from ${tx(att)} where person_id = ${personId} and attendance_date < ${newDate}`;
        if (n.n) throw new Error(`${n.n} attendance record(s) exist before ${newDate}. Remove them first or choose an earlier date.`);
        const [p] = await tx`select count(*)::int n from fee_payment where person_id = ${personId} and status_code = 'ACTIVE' and payment_date < ${newDate}`;
        if (p.n) throw new Error(`${p.n} fee payment(s) were recorded before ${newDate}. Cancel them first or choose an earlier date.`);
        const [e] = await tx`select count(*)::int n from exam_candidate c join exam x on x.id = c.exam_id where c.person_id = ${personId} and x.exam_date < ${newDate}`;
        if (e.n) throw new Error(`${e.n} exam(s) before ${newDate} include this person.`);
      }
      await dtCorrectVersion(tx, 'assignment', a.id, first.effective_start_date, newDate, {}, u.username);
      await tx`update assignment set original_start_date = ${newDate} where id = ${a.id}`;
      // personal record: start no later than the hire date
      const [pf] = await tx`select effective_start_date from person_f where id = ${personId} order by effective_start_date limit 1`;
      if (pf && (newDate < pf.effective_start_date || pf.effective_start_date === oldDate)) {
        const [other] = await tx`select min(original_start_date) d from assignment where person_id = ${personId} and id <> ${a.id}`;
        const target = other?.d && other.d < newDate ? other.d : newDate;
        if (target !== pf.effective_start_date) await dtCorrectVersion(tx, 'person', personId, pf.effective_start_date, target, {}, u.username);
      }
      if (kind === 'STUDENT' && newDate > oldDate) {
        const lines = await tx`select id from fee_demand_v where person_id = ${personId} and cancelled_flag = 'N' and paid_amount = 0 and exempted_amount = 0
          and coalesce(period_end, due_date) < ${newDate}`;
        for (const l of lines) await tx`update fee_demand set cancelled_flag = 'Y', last_updated_by = ${u.username}, last_update_date = now() where id = ${l.id}`;
        cancelled = lines.length;
      }
    });
    return { msg: `${kind === 'STUDENT' ? 'Admission' : 'Hire'} date changed to ${newDate}${cancelled ? ` · ${cancelled} unpaid fee line(s) before that date cancelled` : ''}` };
  });
}

/** Delete a staff member / student entered by mistake (see deletionBlockers). */
export async function deletePerson(kind: PersonKind, personId: string, fd: FormData) {
  const u = await requirePriv(kind === 'STUDENT' ? 'CD_STUDENT_ADMISSION_PRV' : 'CD_STAFF_HIRE_PRV', 'WRITE');
  const base = kind === 'STUDENT' ? '/students' : '/staff';
  await act(backOf(fd), async () => {
    await guard(u, kind, personId, (await getAsOf()));
    const { deletionBlockers } = await import('@/lib/people');
    const blockers = await deletionBlockers(personId, kind);
    if (blockers.length) throw new Error(`Cannot delete – found ${blockers.join(', ')}. Use a ${kind === 'STUDENT' ? 'Withdrawal' : 'Termination'} action instead.`);
    let number = '';
    await sql.begin(async (tx) => {
      const [a] = await tx`select id, assignment_number from assignment where person_id = ${personId} and assignment_type = ${kind}`;
      number = a.assignment_number;
      await tx`delete from fee_demand where assignment_id = ${a.id} or (person_id = ${personId} and ${kind} = 'STUDENT')`;
      await tx`delete from assignment where id = ${a.id}`;
      const [other] = await tx`select 1 from assignment where person_id = ${personId}`;
      // logins of this person stop working
      await tx`update user_account set active_flag = 'N', last_updated_by = ${u.username}, last_update_date = now() where person_id = ${personId}`;
      if (!other) await tx`delete from person where id = ${personId}`;
    });
    return { to: base, msg: `${kind === 'STUDENT' ? 'Student' : 'Staff'} ${number} deleted` };
  });
}
