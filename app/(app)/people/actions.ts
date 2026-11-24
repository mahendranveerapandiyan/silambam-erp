'use server';
import { photoToJpeg } from '@/lib/images';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql, type Tx } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { act, backOf, formObj, fileToBytes, todayISO } from '@/lib/util';
import { dtChange, dtCorrectVersion } from '@/lib/dt';
import { nextNumber } from '@/lib/numbering';
import { makeUsername } from '@/lib/usernames';
import { checkAor, aorRowsFromForm } from '@/lib/aor';
import { assertStudentAccess, myClasses, seesAllStudents } from '@/lib/scope';
import { hireInTx, guard, personVals, assignmentVals, createLogin, assertAssignmentRefs, PERSON_FIELDS, hashForRequest, type HireExtras } from '@/lib/hire';
import { needsApproval, submitRequest } from '@/lib/approvals';
import type { HirePayload } from '@/lib/approvalHandlers';

const dirPriv = (k: PersonKind) => (k === 'STUDENT' ? 'CD_STUDENT_DIRECTORY_PRV' : 'CD_STAFF_DIRECTORY_PRV');
const actPriv = (k: PersonKind) => (k === 'STUDENT' ? 'CD_STUDENT_ACTION_PRV' : 'CD_STAFF_ACTION_PRV');
import { actionByType, actionInfo, academicYearOn, branchBusinessUnit, buLegalEmployer, classHierarchy, type PersonKind } from '@/lib/people';
import { generateStudentFees } from '@/lib/fees';
import { assertEffective } from '@/lib/integrity';
import { parseAttributes } from '@/lib/fields';
import { readIdForm, validateIdentifier, assertIdUnique, insertIdentifier, normId, employerCountry, personEmployerCountry } from '@/lib/identifiers';

const base = (k: PersonKind) => (k === 'STUDENT' ? '/students' : '/staff');

// ------------------------------------------------------------------ hire
export async function hirePerson(kind: PersonKind, fd: FormData) {
  const u = await requirePriv(kind === 'STUDENT' ? 'CD_STUDENT_ADMISSION_PRV' : 'CD_STAFF_HIRE_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    const x = await hireExtras(u, kind, o, fd);
    // a staff hire goes for approval when an active Staff Hire approval rule exists
    if (kind === 'STAFF' && await needsApproval(u.enterpriseId, 'STAFF_HIRE', hireFacts(o))) return submitHire(u, kind, o, x, 'STAFF_HIRE');
    let r = { personId: '', msg: '' };
    await sql.begin(async (tx) => { r = await hireInTx(tx, u, kind, o, x); });
    return { to: `${base(kind)}/${r.personId}`, msg: r.msg };
  });
}

/**
 * Send a hire / admission for approval. The form is checked first by doing the
 * hire and rolling it back, so mistakes show now rather than at approval;
 * temporary passwords are stored hashed.
 */
async function submitHire(u: SessionUser, kind: PersonKind, o: Record<string, string | null>, x: HireExtras, process: 'STUDENT_ADMISSION' | 'STAFF_HIRE') {
  class DryRunOk extends Error {}
  try {
    await sql.begin(async (tx) => { await hireInTx(tx, u, kind, o, x); throw new DryRunOk(); });
  } catch (e) {
    if (!(e instanceof DryRunOk)) throw e;
  }
  const form = { ...o };
  for (const k of ['parent_password', 'login_password']) form[k] = await hashForRequest(form[k]);
  const name = [o.first_name, o.last_name].filter(Boolean).join(' ') || o.existing_person_number || 'New person';
  const placement = kind === 'STUDENT' && o.class_id
    ? (await sql`select (select name from class_f where id = ${o.class_id} order by effective_start_date desc limit 1) c,
        (select name from section_f where id = ${o.section_id} order by effective_start_date desc limit 1) s`)[0]
    : null;
  const payload: HirePayload = { o: form, attributes: x.attributes, loginRoles: x.loginRoles, photo: x.photo ? { mime: x.photo.mime, b64: x.photo.data.toString('base64') } : null };
  const r = await sql.begin((tx) => submitRequest(tx, u, {
    process, payload, facts: hireFacts(o),
    title: `${kind === 'STUDENT' ? 'Admission' : 'Hire'}: ${name}`,
    summary: [placement ? `${placement.c} › ${placement.s}` : null, `from ${o.hire_date}`, o.fee_amount ? `fee ${o.fee_amount} (${o.fee_frequency_code})` : null].filter(Boolean).join(' · '),
  }));
  if (!r) {
    // a "No approval required" rule matched: do it now
    let done = { personId: '', msg: '' };
    await sql.begin(async (tx) => { done = await hireInTx(tx, u, kind, o, x); });
    return { to: `${base(kind)}/${done.personId}`, msg: `${done.msg} No approval was required.` };
  }
  const [done] = r.status === 'APPROVED' ? await sql`select result_ref, result_message from approval_request where id = ${r.id}` : [];
  if (done?.result_ref) return { to: `${base(kind)}/${done.result_ref}`, msg: `${done.result_message} (no approver was needed)` };
  return { to: `/approvals/requests/${r.id}`, msg: `The ${kind === 'STUDENT' ? 'admission' : 'hire'} of ${name} has been submitted for approval.` };
}

/** What approval rule conditions can test on a hire / admission. */
function hireFacts(o: Record<string, string | null>) {
  return { BUSINESS_UNIT: o.business_unit_id, BRANCH: o.branch_id, CLASS: o.class_id, DEPARTMENT: o.department_id, JOB: o.job_id };
}

/** Photo, additional fields and login roles of a hire / admission form. */
async function hireExtras(u: SessionUser, kind: PersonKind, o: Record<string, string | null>, fd: FormData): Promise<HireExtras> {
  return {
    photo: await photoToJpeg(fd.get('photo')),
    attributes: o.existing_person_number ? {} : await parseAttributes(u.enterpriseId, kind, fd),
    loginRoles: fd.getAll('login_roles').map(String),
  };
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
    return { msg: 'The personal details have been updated.' };
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
    return { msg: 'The photo has been updated.' };
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
      return { msg: 'The contact has been removed.' };
    }
    if (!o.name || !o.relationship_code) throw new Error('Relationship and name are required');
    const v = { relationship_code: o.relationship_code, name: o.name, phone: o.phone, email: o.email, occupation: o.occupation, primary_flag: o.primary_flag === 'Y' ? 'Y' : 'N' };
    if (v.primary_flag === 'Y') await sql`update person_contact set primary_flag = 'N' where person_id = ${personId}`;
    if (contactId) await sql`update person_contact set ${sql({ ...v, last_updated_by: u.username, last_update_date: new Date() })} where id = ${contactId} and person_id = ${personId}`;
    else await sql`insert into person_contact ${sql({ person_id: personId, ...v, created_by: u.username })}`;
    return { msg: `Contact ${o.name} has been ${contactId ? 'updated' : 'added'}.` };
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
    const correcting = o.mode === 'CORRECT';
    const [first] = await sql`select min(effective_start_date) d from assignment_f where id = ${a.id}`;
    const firstVersion = cur.effective_start_date === first.d;
    // the first version is the hire / admission: correcting it keeps a hire action, and only it may have one
    if (correcting && firstVersion && action.action_type_code !== 'HIRE')
      throw new Error(`This is the ${kind === 'STUDENT' ? 'admission' : 'hire'} version – it can only be corrected with a ${kind === 'STUDENT' ? 'admission' : 'hire'} action.`);
    if (action.action_type_code === 'HIRE' && !(correcting && firstVersion)) throw new Error('Use Re-admission / Rehire for a person who already has a record.');
    if (action.action_type_code === 'REHIRE' && cur.system_status_code !== 'INACTIVE') throw new Error('Rehire / Re-admission is only for inactive records.');
    if (cur.system_status_code === 'INACTIVE' && action.action_type_code !== 'REHIRE' && !correcting) throw new Error('This record is inactive. Use Re-admission / Rehire first.');
    const terminating = action.action_type_code === 'TERMINATION';
    const vals = terminating ? {} : await assignmentVals(u, kind, o, date, personId);
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
    return { to: `${base(kind)}/${personId}?tab=assignment`, msg: correcting ? `The ${action.name} record from ${cur.effective_start_date} has been corrected.` : `${action.name} has been recorded effective ${date}.` };
  });
}

export async function undoAssignment(kind: PersonKind, personId: string, fd: FormData) {
  await requirePriv(actPriv(kind), 'WRITE');
  await act(backOf(fd), async () => {
    const [a] = await sql`select id from assignment where person_id = ${personId} and assignment_type = ${kind}`;
    const { dtDeleteLatest } = await import('@/lib/dt');
    await sql.begin((tx) => dtDeleteLatest(tx, 'assignment', a.id));
    return { msg: 'The latest assignment change has been removed.' };
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
    if (newDate === oldDate) return { msg: 'The date is unchanged.' };
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
    return { msg: `${kind === 'STUDENT' ? 'Admission' : 'Hire'} date has been changed to ${newDate}.${cancelled ? ` ${cancelled} unpaid fee line(s) before that date have been cancelled.` : ''}` };
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
    if (blockers.length) throw new Error(kind === 'STUDENT'
      ? `Cannot delete – ${blockers.join(', ')} recorded. Delete the receipts on the student's fee page (Fees › Collect Fees) first, or use a Withdrawal action.`
      : `Cannot delete – found ${blockers.join(', ')}. Use a Termination action instead.`);
    let number = '';
    let who = '';
    await sql.begin(async (tx) => {
      const [a] = await tx`select id, assignment_number, original_start_date from assignment where person_id = ${personId} and assignment_type = ${kind}`;
      number = a.assignment_number;
      const [pn] = await tx`select trim(concat_ws(' ', first_name, last_name)) n from person_f where id = ${personId} order by effective_start_date desc limit 1`;
      who = pn?.n ?? '';
      if (kind === 'STUDENT') {
        // everything recorded for the student (payments already ruled out); attendance and
        // assignment history go with the assignment, fee exceptions with their fee lines
        await tx`delete from exam_candidate where assignment_id = ${a.id} or person_id = ${personId}`;
        await tx`delete from event_participant where person_id = ${personId}`;
        await tx`delete from fee_demand where assignment_id = ${a.id} or person_id = ${personId}`;
        await tx`delete from fee_structure where person_id = ${personId}`;
        // parent logins that could see only this child stop working
        await tx`update user_account ua set active_flag = 'N', last_updated_by = ${u.username}, last_update_date = now()
          where ua.person_id is null and exists (select 1 from user_student_access x where x.user_id = ua.id and x.person_id = ${personId})
            and not exists (select 1 from user_student_access y where y.user_id = ua.id and y.person_id <> ${personId})`;
        await tx`delete from user_student_access where person_id = ${personId}`;
        await tx`update stock_txn set person_id = null where person_id = ${personId}`; // items stay sold; only the link goes
      } else {
        await tx`delete from fee_demand where assignment_id = ${a.id}`;
      }
      await tx`delete from assignment where id = ${a.id}`;
      const [other] = await tx`select 1 from assignment where person_id = ${personId}`;
      // logins of this person stop working
      await tx`update user_account set active_flag = 'N', last_updated_by = ${u.username}, last_update_date = now() where person_id = ${personId}`;
      if (!other) await tx`delete from person where id = ${personId}`;
      // no counter to rewind: the next number is always the highest in use + 1,
      // so deleting the newest record gives its number back automatically
    });
    return { to: base, msg: `${kind === 'STUDENT' ? 'Student' : 'Staff'} ${number}${who ? ` (${who})` : ''} has been deleted.` };
  });
}

// ------------------------------------------------------------ identification
export async function saveIdentifier(kind: PersonKind, personId: string, rowId: string | null, fd: FormData) {
  const u = await requirePriv(dirPriv(kind), 'WRITE');
  await act(backOf(fd), async () => {
    await guard(u, kind, personId, await getAsOf());
    const o = formObj(fd);
    if (o._delete && rowId) {
      const [n] = await sql`select count(*)::int n from person_identifier where person_id = ${personId}`;
      if (n.n <= 1) throw new Error('At least one identification document must remain. Add the new one before removing this.');
      await sql`delete from person_identifier where id = ${rowId} and person_id = ${personId}`;
      return { msg: 'The identification document has been removed.' };
    }
    const x = readIdForm(o, 'idf');
    if (!x) throw new Error('Enter the identification type and number');
    await sql.begin(async (tx) => {
      await validateIdentifier(tx, x, await personEmployerCountry(tx, personId, await getAsOf(), kind));
      await assertIdUnique(tx, u.enterpriseId, x, null, rowId);
      const primary = o.idf_primary === 'Y';
      if (primary) await tx`update person_identifier set primary_flag = 'N' where person_id = ${personId}`;
      if (rowId) {
        await tx`update person_identifier set id_type_code = ${x.type}, id_number = ${x.number.toUpperCase()}, issuing_country_code = ${x.country ?? null},
          issue_date = ${x.issue ?? null}, expiry_date = ${x.expiry ?? null}, primary_flag = ${primary ? 'Y' : 'N'}, last_updated_by = ${u.username}, last_update_date = now()
          where id = ${rowId} and person_id = ${personId}`;
      } else {
        const [any] = await tx`select 1 from person_identifier where person_id = ${personId}`;
        await insertIdentifier(tx, u.enterpriseId, personId, x, primary || !any, u.username);
      }
    });
    return { msg: 'The identification document has been saved.' };
  });
}

// ------------------------------------------------------------ areas of responsibility
export async function saveAor(kind: PersonKind, personId: string, aorId: string | null, fd: FormData) {
  const u = await requirePriv(actPriv(kind), 'WRITE');
  await act(backOf(fd), async () => {
    await guard(u, kind, personId, await getAsOf());
    const o = formObj(fd);
    if (o._delete) {
      const [r] = await sql`delete from area_of_responsibility where id = ${aorId} and person_id = ${personId} returning aor_type_code`;
      if (!r) throw new Error('Responsibility not found');
      const [m] = await sql`select meaning from lookup_value where lookup_type = ${kind === 'STUDENT' ? 'STUDENT_AOR' : 'STAFF_AOR'} and lookup_code = ${r.aor_type_code}`;
      return { msg: `The responsibility ${m?.meaning ?? r.aor_type_code} has been deleted.` };
    }
    const [a] = await sql`select original_start_date from assignment where person_id = ${personId} and assignment_type = ${kind}`;
    if (!a) throw new Error('No assignment found');
    const v = await checkAor(sql, kind, personId, { type: o.aor_type_code, academicYearId: o.academic_year_id, start: o.start_date, end: o.end_date, remarks: o.remarks },
      todayISO() > a.original_start_date ? todayISO() : a.original_start_date, aorId);
    const vals = { aor_type_code: v.aor_type_code, academic_year_id: v.academic_year_id, start_date: v.start_date, end_date: v.end_date, remarks: v.remarks, last_updated_by: u.username, last_update_date: new Date() };
    if (aorId) await sql`update area_of_responsibility set ${sql(vals)} where id = ${aorId} and person_id = ${personId}`;
    else await sql`insert into area_of_responsibility ${sql({ ...vals, enterprise_id: u.enterpriseId, person_id: personId, person_category: kind, created_by: u.username })}`;
    return { msg: `The responsibility ${v.meaning} has been ${aorId ? 'updated' : 'added'}.` };
  });
}

// ------------------------------------------------------------ admission form (staff)
/** Admission by staff: the same form as New Admission, limited to the staff member's classes, always approved first. */
export async function submitAdmissionForm(fd: FormData) {
  const u = await requirePriv('CD_ADMISSION_FORM_PRV', 'WRITE');
  await act(backOf(fd, '/students/admission-form'), async () => {
    const o = formObj(fd);
    const x = await hireExtras(u, 'STUDENT', o, fd);
    return submitHire(u, 'STUDENT', o, x, 'STUDENT_ADMISSION');
  });
}
