'use server';
import { imageToPng } from '@/lib/images';
import { sql } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { act, backOf, formObj, fileToBytes, todayISO } from '@/lib/util';
import { assertStudentAccess } from '@/lib/scope';
import { generateStudentFees, recordPayment, addDemand } from '@/lib/fees';

const FREQS = ['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'ONE_TIME'];

// ------------------------------------------------------------ structures
export async function saveStructure(id: string | null, fd: FormData) {
  const u = await requirePriv('CD_FEE_STRUCTURE_PRV', 'WRITE');
  await act(backOf(fd, '/fees/structures'), async () => {
    const o = formObj(fd);
    if (!o.academic_year_id || !o.fee_type_code || !o.name) throw new Error('Academic year, fee type and name are required');
    const amounts = FREQS.map((f) => [f, o[`amt_${f}`]] as const).filter(([, v]) => v !== null && v !== undefined);
    if (!amounts.length) throw new Error('Enter at least one amount');
    if (amounts.some(([f]) => f === 'ONE_TIME') && amounts.length > 1) throw new Error('A one-time fee cannot also have recurring amounts');
    // a section decides its class; a class its branch; a branch its business unit (filled in when left empty, refused when they disagree)
    const [ay] = await sql`select start_date, end_date from academic_year where id = ${o.academic_year_id} and enterprise_id = ${u.enterpriseId}`;
    if (!ay) throw new Error('Academic year not found');
    const on = ay.start_date;
    const up = async (table: string, col: string, id: string) => {
      const [r] = await sql`select ${sql(col)} v from ${sql(table + '_f')} where id = ${id} order by (${on}::date between effective_start_date and effective_end_date) desc, effective_start_date desc limit 1`;
      return r?.v ? String(r.v) : null;
    };
    const fill = (field: string, value: string | null, what: string) => {
      if (!value) return;
      if (o[field] && String(o[field]) !== value) throw new Error(`The chosen ${what} does not match – leave it empty or pick the matching one.`);
      o[field] = value;
    };
    if (o.section_id) fill('class_id', await up('section', 'class_id', o.section_id), 'class (for the section)');
    if (o.class_id) fill('branch_id', await up('class', 'branch_id', o.class_id), 'branch (for the class)');
    if (o.branch_id) fill('business_unit_id', await up('branch', 'business_unit_id', o.branch_id), 'business unit (for the branch)');
    // individual student: by student number
    let personId: string | null = null;
    if (o.student_number) {
      const [st] = await sql`select person_id from assignment where enterprise_id = ${u.enterpriseId} and assignment_type = 'STUDENT' and upper(assignment_number) = upper(${o.student_number})`;
      if (!st) throw new Error(`No student with number ${o.student_number}`);
      personId = String(st.person_id);
    }
    const v = {
      academic_year_id: o.academic_year_id, fee_type_code: o.fee_type_code, name: o.name, description: o.description,
      business_unit_id: o.business_unit_id, branch_id: o.branch_id, class_id: o.class_id, section_id: o.section_id, person_id: personId,
      student_grade_id: o.student_grade_id, active_flag: o.active_flag === 'N' ? 'N' : 'Y',
    };
    let sid = id;
    await sql.begin(async (tx) => {
      if (sid) await tx`update fee_structure set ${tx({ ...v, last_updated_by: u.username, last_update_date: new Date() })} where id = ${sid} and enterprise_id = ${u.enterpriseId}`;
      else sid = (await tx`insert into fee_structure ${tx({ ...v, enterprise_id: u.enterpriseId, created_by: u.username })} returning id`)[0].id;
      await tx`delete from fee_structure_amount where fee_structure_id = ${sid}`;
      for (const [f, a] of amounts) {
        if (Number.isNaN(Number(a)) || Number(a) < 0) throw new Error(`Invalid amount for ${f}`);
        await tx`insert into fee_structure_amount values (${sid}, ${f}, ${Number(a)})`;
      }
    });
    return { to: `/fees/structures?ay=${o.academic_year_id}`, msg: `${o.name} fee structure has been ${id ? 'updated' : 'created'}.` };
  });
}

/** Delete a fee structure that has not been used – no fee lines were generated from it. */
export async function deleteStructure(id: string, fd: FormData) {
  const u = await requirePriv('CD_FEE_STRUCTURE_PRV', 'WRITE');
  await act(backOf(fd, '/fees/structures'), async () => {
    const [fs] = await sql`select name, academic_year_id from fee_structure where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    if (!fs) throw new Error('Fee structure not found');
    const [n] = await sql`select count(*)::int n from fee_demand where fee_structure_id = ${id}`;
    if (n.n > 0) throw new Error(`${fs.name} cannot be deleted: ${n.n} fee line(s) were generated from it. Roll them back first (Fees › Generate Fees) or set it inactive.`);
    await sql.begin(async (tx) => {
      // copies made for a later year stay; they just forget where they came from
      await tx`update fee_structure set copied_from_id = null where copied_from_id = ${id}`;
      await tx`delete from fee_structure where id = ${id}`;
    });
    return { to: `/fees/structures?ay=${fs.academic_year_id}`, msg: `${fs.name} fee structure has been deleted.` };
  });
}

export async function copyStructures(fd: FormData) {
  const u = await requirePriv('CD_FEE_STRUCTURE_PRV', 'WRITE');
  await act(backOf(fd, '/fees/structures'), async () => {
    const o = formObj(fd);
    if (!o.from_ay || !o.to_ay || o.from_ay === o.to_ay) throw new Error('Choose two different academic years');
    const pct = Number(o.increase_pct || 0);
    const round = Number(o.round_to || 1) || 1;
    let n = 0;
    await sql.begin(async (tx) => {
      const src = await tx`select * from fee_structure where enterprise_id = ${u.enterpriseId} and academic_year_id = ${o.from_ay} and active_flag = 'Y'`;
      for (const s of src) {
        const [dup] = await tx`select 1 from fee_structure where academic_year_id = ${o.to_ay} and copied_from_id = ${s.id}`;
        if (dup) continue;
        const [ns] = await tx`insert into fee_structure (enterprise_id, academic_year_id, fee_type_code, name, description, business_unit_id, branch_id, class_id, section_id, person_id, student_grade_id, copied_from_id, created_by)
          values (${u.enterpriseId}, ${o.to_ay}, ${s.fee_type_code}, ${s.name}, ${s.description}, ${s.business_unit_id}, ${s.branch_id}, ${s.class_id}, ${s.section_id}, ${s.person_id}, ${s.student_grade_id}, ${s.id}, ${u.username}) returning id`;
        for (const a of await tx`select * from fee_structure_amount where fee_structure_id = ${s.id}`) {
          const amt = Math.round((Number(a.amount) * (1 + pct / 100)) / round) * round;
          await tx`insert into fee_structure_amount values (${ns.id}, ${a.frequency_code}, ${amt})`;
        }
        n++;
      }
      // exam fees follow the same rule
      for (const e of await tx`select * from exam_fee where academic_year_id = ${o.from_ay}`) {
        const amt = Math.round((Number(e.amount) * (1 + pct / 100)) / round) * round;
        await tx`insert into exam_fee (academic_year_id, exam_type_code, student_grade_id, amount) values (${o.to_ay}, ${e.exam_type_code}, ${e.student_grade_id}, ${amt}) on conflict do nothing`;
      }
    });
    return { to: `/fees/structures?ay=${o.to_ay}`, msg: `${n} fee structure(s) have been copied${pct ? ` with a ${pct}% change` : ''}.` };
  });
}

// ------------------------------------------------------------- generate
/**
 * Scope for generating / rolling back fees: the narrowest of business unit,
 * branch, class, section or student. Levels above the chosen one are filled
 * in (and must match when also chosen). Returns a filter on the student's
 * assignment version (alias af) and a description for messages.
 */
async function feeScope(enterpriseId: string, o: Record<string, string | null>, on: string) {
  const up = async (table: string, col: string, id: string) => {
    const [r] = await sql`select ${sql(col)} v from ${sql(table + '_f')} where id = ${id} order by (${on}::date between effective_start_date and effective_end_date) desc, effective_start_date desc limit 1`;
    return r?.v ? String(r.v) : null;
  };
  const fill = (field: string, value: string | null, what: string) => {
    if (!value) return;
    if (o[field] && String(o[field]) !== value) throw new Error(`The chosen ${what} does not match – leave it empty or pick the matching one.`);
    o[field] = value;
  };
  let personId: string | null = null;
  if (o.student_number) {
    const [st] = await sql`select person_id from assignment where enterprise_id = ${enterpriseId} and assignment_type = 'STUDENT' and upper(assignment_number) = upper(${o.student_number})`;
    if (!st) throw new Error(`No student with number ${o.student_number}`);
    personId = String(st.person_id);
  }
  if (o.section_id) fill('class_id', await up('section', 'class_id', o.section_id), 'class (for the section)');
  if (o.class_id) fill('branch_id', await up('class', 'branch_id', o.class_id), 'branch (for the class)');
  if (o.branch_id) fill('business_unit_id', await up('branch', 'business_unit_id', o.branch_id), 'business unit (for the branch)');
  const name = async (table: string, id: string | null) => (id ? (await sql`select name from ${sql(table + '_f')} where id = ${id} order by effective_start_date desc limit 1`)[0]?.name : null);
  const what = o.student_number ? `student ${o.student_number}`
    : o.section_id ? `section ${await name('class', o.class_id)} › ${await name('section', o.section_id)}`
    : o.class_id ? `class ${await name('class', o.class_id)}`
    : o.branch_id ? `branch ${await name('branch', o.branch_id)}`
    : o.business_unit_id ? `business unit ${await name('business_unit', o.business_unit_id)}` : 'all business units';
  const where = sql`
    ${personId ? sql`and a.person_id = ${personId}` : sql``}
    ${o.business_unit_id ? sql`and af.business_unit_id = ${o.business_unit_id}` : sql``}
    ${o.branch_id ? sql`and af.branch_id = ${o.branch_id}` : sql``}
    ${o.class_id ? sql`and af.class_id = ${o.class_id}` : sql``}
    ${o.section_id ? sql`and af.section_id = ${o.section_id}` : sql``}`;
  return { where, what };
}

export async function generateFees(fd: FormData) {
  const u = await requirePriv('CD_FEE_GENERATE_PRV', 'WRITE');
  await act(backOf(fd, '/fees/generate'), async () => {
    const o = formObj(fd);
    if (!o.academic_year_id) throw new Error('Academic year is required');
    const feeTypes = fd.getAll('fee_types').map(String).filter(Boolean);
    const [ay] = await sql`select * from academic_year where id = ${o.academic_year_id} and enterprise_id = ${u.enterpriseId}`;
    if (!ay) throw new Error('Academic year not found');
    const t = todayISO();
    const onDate = t < ay.start_date ? ay.start_date : t > ay.end_date ? ay.end_date : t;
    const scope = await feeScope(u.enterpriseId, o, onDate);
    if (o._op === 'ROLLBACK') return rollbackFees(u, ay, scope, feeTypes, onDate);
    const students = await sql`
      select a.id assignment_id, a.person_id, a.original_start_date, af.* from assignment a
      join assignment_f af on af.id = a.id and ${onDate}::date between af.effective_start_date and af.effective_end_date
      join assignment_status_f st on st.id = af.assignment_status_id and ${onDate}::date between st.effective_start_date and st.effective_end_date
      where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STUDENT' and st.system_status_code = 'ACTIVE' ${scope.where}`;
    if (!students.length) throw new Error(`No active students found for ${scope.what} in ${ay.name}.`);
    let created = 0;
    const skipped = new Set<string>();
    await sql.begin(async (tx) => {
      for (const st of students) {
        const r = await generateStudentFees(tx, {
          enterpriseId: u.enterpriseId, personId: st.person_id, assignmentId: st.assignment_id, ay, asg: st,
          joinDate: st.original_start_date, by: u.username, feeTypes: feeTypes.length ? feeTypes : undefined,
        });
        created += r.created;
        r.skipped.forEach((x) => skipped.add(x));
      }
    });
    return { msg: `${created} fee installment(s) have been generated for ${students.length} active student(s) – ${scope.what}, ${ay.name}.${skipped.size ? ' Skipped: ' + [...skipped].join('; ') : ''}` };
  });
}

/**
 * Removes generated fee installments (from fee structures) for the scope, as
 * long as no payment has been recorded: a student whose generated lines in
 * scope have a receipt (active or cancelled) or a fee exception is skipped
 * entirely, so collected and audited fees are never touched.
 */
async function rollbackFees(u: SessionUser, ay: Record<string, any>, scope: { where: any; what: string }, feeTypes: string[], onDate: string) {
  // students in scope by their placement on the date (any status – withdrawn students included)
  const lines = await sql`
    select d.id, d.person_id, a.assignment_number,
      exists (select 1 from fee_allocation fa where fa.demand_id = d.id) paid,
      exists (select 1 from fee_exemption fe where fe.demand_id = d.id) excepted
    from fee_demand d
    join assignment a on a.person_id = d.person_id and a.assignment_type = 'STUDENT'
    join lateral (select * from assignment_f x where x.id = a.id order by (${onDate}::date between x.effective_start_date and x.effective_end_date) desc, x.effective_start_date desc limit 1) af on true
    where d.enterprise_id = ${u.enterpriseId} and d.academic_year_id = ${ay.id} and d.source_type = 'STRUCTURE'
      ${feeTypes.length ? sql`and d.fee_type_code in ${sql(feeTypes)}` : sql``}
      ${scope.where}`;
  if (!lines.length) throw new Error(`There are no generated fees to roll back for ${scope.what} in ${ay.name}.`);
  const blocked = new Map<string, string>();
  for (const l of lines) if (l.paid || l.excepted) blocked.set(String(l.person_id), l.assignment_number);
  const ids = lines.filter((l) => !blocked.has(String(l.person_id))).map((l) => l.id);
  const students = new Set(lines.filter((l) => !blocked.has(String(l.person_id))).map((l) => String(l.person_id)));
  if (ids.length) await sql`delete from fee_demand where id in ${sql(ids)}`;
  const kept = [...blocked.values()];
  const keptMsg = kept.length ? ` ${kept.length} student(s) kept because payments or fee exceptions are recorded: ${kept.slice(0, 10).join(', ')}${kept.length > 10 ? ` and ${kept.length - 10} more` : ''}.` : '';
  if (!ids.length) throw new Error(`Nothing was rolled back for ${scope.what}: payments or fee exceptions are recorded for ${kept.slice(0, 10).join(', ')}${kept.length > 10 ? ` and ${kept.length - 10} more` : ''}.`);
  return { msg: `${ids.length} generated fee installment(s) have been rolled back for ${students.size} student(s) – ${scope.what}, ${ay.name}.${keptMsg}` };
}

// ---------------------------------------------------- student fee page
async function demandPerson(demandId: string) {
  const [d] = await sql`select person_id, enterprise_id from fee_demand where id = ${demandId}`;
  if (!d) throw new Error('Fee line not found');
  return d.person_id as string;
}

/** Per-line status update: Paid / Partially paid / Exception full / Exception partial / Cancel. */
export async function demandAction(demandId: string, fd: FormData) {
  const u = await requirePriv('CD_FEE_COLLECT_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    const personId = await demandPerson(demandId);
    await assertStudentAccess(u, personId, await getAsOf());
    const [d] = await sql`select * from fee_demand_v where id = ${demandId}`;
    const [pend] = await sql`select coalesce(sum(amount), 0) p from fee_exemption where demand_id = ${demandId} and status_code = 'PENDING'`;
    const open = Number(d.balance_amount) - Number(pend.p);
    const amt = o.amount ? Number(o.amount) : NaN;
    switch (o.op) {
      case 'PAY_FULL':
      case 'PAY_PARTIAL': {
        const pay = o.op === 'PAY_FULL' ? Number(d.balance_amount) : amt;
        if (!(pay > 0)) throw new Error('Enter the amount received');
        if (o.op === 'PAY_PARTIAL' && pay >= Number(d.balance_amount)) throw new Error('Partial amount must be less than the balance; use "Mark Paid" instead');
        let receipt = '';
        await sql.begin(async (tx) => {
          receipt = (await recordPayment(tx, { enterpriseId: u.enterpriseId, personId, amount: pay, date: o.payment_date ?? todayISO(), mode: o.payment_mode_code ?? 'CASH', reference: o.reference, demandIds: [demandId], by: u.username })).receipt;
        });
        return { msg: `Payment has been recorded. Receipt ${receipt}.` };
      }
      case 'EXEMPT_FULL':
      case 'EXEMPT_PARTIAL': {
        const ex = o.op === 'EXEMPT_FULL' ? open : amt;
        if (!(ex > 0)) throw new Error('Enter the exception amount');
        if (ex > open + 0.001) throw new Error(`Exception exceeds the open balance (${open})`);
        if (!o.reason_code) throw new Error('Exception reason is required');
        const auto = can(u, 'CD_FEE_EXCEPTION_APPROVAL_PRV', 'WRITE');
        await sql`insert into fee_exemption (demand_id, amount, reason_code, remarks, status_code, requested_by, decided_by, decided_at)
          values (${demandId}, ${ex}, ${o.reason_code}, ${o.remarks}, ${auto ? 'APPROVED' : 'PENDING'}, ${u.username}, ${auto ? u.username : null}, ${auto ? new Date() : null})`;
        return { msg: auto ? 'The fee exception has been applied.' : 'The fee exception has been submitted for administrator approval.' };
      }
      case 'CANCEL': {
        if (!can(u, 'CD_FEE_CANCEL_PRV', 'WRITE')) throw new Error('You do not have permission to cancel fee lines');
        if (Number(d.paid_amount) > 0) throw new Error('This line has payments; cancel the payment receipts first');
        await sql`update fee_demand set cancelled_flag = 'Y', last_updated_by = ${u.username}, last_update_date = now() where id = ${demandId}`;
        return { msg: 'The fee line has been cancelled.' };
      }
    }
    throw new Error('Choose an action');
  });
}

/** One payment allocated across several selected lines (oldest first). */
export async function bulkPayment(personId: string, fd: FormData) {
  const u = await requirePriv('CD_FEE_COLLECT_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    await assertStudentAccess(u, personId, await getAsOf());
    const o = formObj(fd);
    const ids = fd.getAll('demand').map(String).filter(Boolean);
    const amount = Number(o.amount);
    if (!(amount > 0)) throw new Error('Enter the amount received');
    let receipt = '';
    await sql.begin(async (tx) => {
      receipt = (await recordPayment(tx, { enterpriseId: u.enterpriseId, personId, amount, date: o.payment_date ?? todayISO(), mode: o.payment_mode_code ?? 'CASH', reference: o.reference, remarks: o.remarks, demandIds: ids.length ? ids : undefined, by: u.username })).receipt;
    });
    return { msg: `Payment of ${amount} has been recorded. Receipt ${receipt}.` };
  });
}

export async function addCharge(personId: string, fd: FormData) {
  const u = await requirePriv('CD_FEE_CHARGE_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    if (!o.fee_type_code || !o.description || !o.amount || !o.due_date) throw new Error('Fee type, description, amount and due date are required');
    const [a] = await sql`select a.id, af.business_unit_id, af.academic_year_id from assignment a left join assignment_f af on af.id = a.id and ${o.due_date}::date between af.effective_start_date and af.effective_end_date where a.person_id = ${personId} and a.assignment_type = 'STUDENT'`;
    await addDemand(sql, { enterpriseId: u.enterpriseId, personId, feeType: o.fee_type_code, description: o.description, amount: Number(o.amount), dueDate: o.due_date, by: u.username, assignmentId: a?.id, buId: a?.business_unit_id, ayId: a?.academic_year_id });
    return { msg: 'The charge has been added.' };
  });
}

export async function cancelPayment(paymentId: string, fd: FormData) {
  const u = await requirePriv('CD_FEE_CANCEL_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    await sql`update fee_payment set status_code = 'CANCELLED', remarks = coalesce(remarks || ' · ', '') || ${'Cancelled by ' + u.username} where id = ${paymentId}`;
    return { msg: 'The receipt has been cancelled; its amounts are outstanding again.' };
  });
}

export async function changeFrequency(personId: string, fd: FormData) {
  const u = await requirePriv('CD_FEE_COLLECT_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    const date = o.effective_date ?? todayISO();
    await assertStudentAccess(u, personId, date);
    if (!o.fee_frequency_code) throw new Error('Choose a frequency');
    const [a] = await sql`select id from assignment where person_id = ${personId} and assignment_type = 'STUDENT'`;
    const { dtChange } = await import('@/lib/dt');
    const { actionByType } = await import('@/lib/people');
    const chg = await actionByType(u.enterpriseId, 'STUDENT', 'ASSIGNMENT_CHANGE', date);
    await sql.begin(async (tx) => {
      await dtChange(tx, 'assignment', a.id, date, 'UPDATE', { fee_frequency_code: o.fee_frequency_code, action_id: chg?.id ?? null, action_reason_code: null, comments: 'Fee frequency changed' }, u.username);
      // cancel future unpaid tuition lines so they can be regenerated at the new frequency
      if (o.regenerate === 'Y') {
        const lines = await tx`select id from fee_demand_v where person_id = ${personId} and fee_type_code = 'TUITION' and period_start >= ${date} and paid_amount = 0 and exempted_amount = 0 and cancelled_flag = 'N'`;
        for (const l of lines) await tx`update fee_demand set cancelled_flag = 'Y' where id = ${l.id}`;
        const [cur] = await tx`select a.id assignment_id, a.original_start_date, af.* from assignment a join assignment_f af on af.id = a.id and ${date}::date between af.effective_start_date and af.effective_end_date where a.id = ${a.id}`;
        const [ay] = await tx`select * from academic_year where id = ${cur.academic_year_id}`;
        if (ay) await generateStudentFees(tx, { enterpriseId: u.enterpriseId, personId, assignmentId: a.id, ay, asg: cur, joinDate: date > cur.original_start_date ? date : cur.original_start_date, by: u.username, feeTypes: ['TUITION'] });
      }
    });
    return { msg: 'The fee frequency has been changed.' };
  });
}

// ----------------------------------------------------------- exemptions
export async function decideExemption(id: string, decision: 'APPROVED' | 'REJECTED', fd: FormData) {
  const u = await requirePriv('CD_FEE_EXCEPTION_APPROVAL_PRV', 'WRITE');
  await act(backOf(fd, '/fees/exemptions'), async () => {
    const [e] = await sql`select e.*, d.balance_amount from fee_exemption e join fee_demand_v d on d.id = e.demand_id where e.id = ${id}`;
    if (!e || e.status_code !== 'PENDING') throw new Error('Request is no longer pending');
    if (decision === 'APPROVED' && Number(e.amount) > Number(e.balance_amount) + 0.001) throw new Error('Exception now exceeds the open balance (payments were recorded since)');
    await sql`update fee_exemption set status_code = ${decision}, decided_by = ${u.username}, decided_at = now() where id = ${id}`;
    return { msg: `The fee exception has been ${decision.toLowerCase()}.` };
  });
}

// ------------------------------------------------------------ payment QR
export async function uploadPaymentQr(fd: FormData) {
  const u = await requirePriv('CD_PAYMENT_QR_PRV', 'WRITE');
  await act('/fees/payment-qr', async () => {
    const o = formObj(fd);
    const img = await imageToPng(fd.get('image'));
    if (!img) throw new Error('Choose the QR image');
    if (!o.label) throw new Error('Label is required (e.g. "GPay – Coach Ravi")');
    const branchLevel = can(u, 'CD_ALL_STUDENTS_DATA_PRV') && o.business_unit_id;
    if (!branchLevel && !u.personId) throw new Error('Your login is not linked to a staff record');
    await sql`insert into payment_qr (person_id, business_unit_id, label, upi_id, mime, data, created_by)
      values (${branchLevel ? null : u.personId}, ${branchLevel ? o.business_unit_id : null}, ${o.label}, ${o.upi_id}, ${img.mime}, ${img.data}, ${u.username})`;
    return { msg: 'The payment QR has been uploaded. It now appears on student fee pages.' };
  });
}

export async function togglePaymentQr(id: string, fd: FormData) {
  const u = await requirePriv('CD_PAYMENT_QR_PRV', 'WRITE');
  await act('/fees/payment-qr', async () => {
    const [q] = await sql`select * from payment_qr where id = ${id}`;
    if (!q) throw new Error('Not found');
    if (!can(u, 'CD_ALL_STUDENTS_DATA_PRV') && String(q.person_id) !== String(u.personId)) throw new Error('You can only manage your own QR codes');
    if (formObj(fd)._delete) await sql`delete from payment_qr where id = ${id}`;
    else await sql`update payment_qr set active_flag = case active_flag when 'Y' then 'N' else 'Y' end where id = ${id}`;
  });
}
