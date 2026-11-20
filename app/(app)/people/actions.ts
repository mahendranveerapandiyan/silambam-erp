'use server';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql, type Tx } from '@/lib/db';
import { requireUser, isAdmin, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { act, backOf, formObj, fileToBytes } from '@/lib/util';
import { dtChange } from '@/lib/dt';
import { nextNumber } from '@/lib/numbering';
import { assertStudentAccess, myClasses } from '@/lib/scope';
import { actionByType, actionInfo, academicYearOn, buLegalEmployer, classHierarchy, type PersonKind } from '@/lib/people';
import { generateStudentFees } from '@/lib/fees';

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
  if (kind === 'STAFF' && !isAdmin(u)) throw new Error('Only administrators can manage staff.');
  if (kind === 'STUDENT' && personId) await assertStudentAccess(u, personId, asOf);
}

/** Assignment attribute values from a submitted form. */
async function assignmentVals(u: SessionUser, kind: PersonKind, o: Record<string, string | null>, date: string) {
  if (kind === 'STUDENT') {
    if (!o.class_section) throw new Error('Class / Section is required');
    const [classId, sectionId] = o.class_section.split(':');
    if (!isAdmin(u)) {
      const allowed = (await myClasses(u, date)).some((c) => String(c.class_id) === classId && String(c.section_id) === sectionId);
      if (!allowed) throw new Error('You can only place students in your own classes.');
    }
    const h = await classHierarchy(classId, date);
    let ay = o.academic_year_id;
    if (!ay) ay = (await academicYearOn(u.enterpriseId, date))?.id ?? null;
    return {
      class_id: classId, section_id: sectionId || null, business_unit_id: h.business_unit_id, legal_employer_id: h.legal_employer_id,
      academic_year_id: ay, student_grade_id: o.student_grade_id, house_id: o.house_id, club_id: o.club_id, community_id: o.community_id,
      fee_frequency_code: o.fee_frequency_code ?? 'MONTHLY', person_type_id: o.person_type_id, comments: o.comments,
    };
  }
  if (!o.business_unit_id) throw new Error('Business unit is required');
  return {
    business_unit_id: o.business_unit_id, legal_employer_id: await buLegalEmployer(o.business_unit_id, date), location_id: o.location_id,
    job_id: o.job_id, staff_grade_id: o.staff_grade_id, department_id: o.department_id, position_id: o.position_id,
    employment_type_code: o.employment_type_code, employment_category_code: o.employment_category_code, payroll_status_code: o.payroll_status_code,
    person_type_id: o.person_type_id, comments: o.comments,
  };
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
  const u = await requireUser(kind === 'STUDENT' ? 'INCHARGE' : 'ADMIN');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    const date = o.hire_date;
    if (!date) throw new Error(`${kind === 'STUDENT' ? 'Admission' : 'Hire'} date is required`);
    await guard(u, kind, null, date);
    const photo = await fileToBytes(fd.get('photo'));
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
        const pv = personVals(o);
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
        id: a.id, effective_start_date: date, action_id: hire.id, action_reason_code: o.action_reason_code ?? 'NEW_JOINER',
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
  const u = await requireUser(kind === 'STUDENT' ? 'INCHARGE' : 'ADMIN');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    if (!o.effective_date) throw new Error('Effective date is required');
    await guard(u, kind, personId, await getAsOf());
    await sql.begin(async (tx) => {
      await dtChange(tx, 'person', personId, o.effective_date!, o.mode === 'CORRECT' ? 'CORRECT' : 'UPDATE', personVals(o), u.username);
      await tx`update person set date_of_birth = ${o.date_of_birth} where id = ${personId}`;
    });
    return { msg: 'Personal details saved' };
  });
}

export async function uploadPhoto(kind: PersonKind, personId: string, fd: FormData) {
  const u = await requireUser(kind === 'STUDENT' ? 'INCHARGE' : 'ADMIN');
  await act(backOf(fd), async () => {
    await guard(u, kind, personId, await getAsOf());
    const photo = await fileToBytes(fd.get('photo'));
    if (!photo) throw new Error('Choose an image');
    await sql`insert into person_photo (person_id, mime, data) values (${personId}, ${photo.mime}, ${photo.data})
      on conflict (person_id) do update set mime = excluded.mime, data = excluded.data, last_update_date = now()`;
    return { msg: 'Photo updated' };
  });
}

export async function regenerateQr(kind: PersonKind, personId: string, fd: FormData) {
  const u = await requireUser('ADMIN');
  await act(backOf(fd), async () => {
    await guard(u, kind, personId, await getAsOf());
    await sql`update person set qr_token = ${crypto.randomBytes(12).toString('hex')} where id = ${personId}`;
    return { msg: 'New QR code issued. Old ID cards no longer scan.' };
  });
}

export async function saveContact(kind: PersonKind, personId: string, contactId: string | null, fd: FormData) {
  const u = await requireUser(kind === 'STUDENT' ? 'INCHARGE' : 'ADMIN');
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
  const u = await requireUser(kind === 'STUDENT' ? 'INCHARGE' : 'ADMIN');
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
  await requireUser('ADMIN');
  await act(backOf(fd), async () => {
    const [a] = await sql`select id from assignment where person_id = ${personId} and assignment_type = ${kind}`;
    const { dtDeleteLatest } = await import('@/lib/dt');
    await sql.begin((tx) => dtDeleteLatest(tx, 'assignment', a.id));
    return { msg: 'Latest assignment change removed' };
  });
}
