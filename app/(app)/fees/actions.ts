'use server';
import { sql } from '@/lib/db';
import { requireUser, hasRole, isAdmin } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { act, backOf, formObj, fileToBytes, todayISO } from '@/lib/util';
import { assertStudentAccess } from '@/lib/scope';
import { generateStudentFees, recordPayment, addDemand } from '@/lib/fees';

const FREQS = ['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'ONE_TIME'];

// ------------------------------------------------------------ structures
export async function saveStructure(id: string | null, fd: FormData) {
  const u = await requireUser('ACCOUNTANT');
  await act(backOf(fd, '/fees/structures'), async () => {
    const o = formObj(fd);
    if (!o.academic_year_id || !o.fee_type_code || !o.name) throw new Error('Academic year, fee type and name are required');
    const amounts = FREQS.map((f) => [f, o[`amt_${f}`]] as const).filter(([, v]) => v !== null && v !== undefined);
    if (!amounts.length) throw new Error('Enter at least one amount');
    if (amounts.some(([f]) => f === 'ONE_TIME') && amounts.length > 1) throw new Error('A one-time fee cannot also have recurring amounts');
    const v = {
      academic_year_id: o.academic_year_id, fee_type_code: o.fee_type_code, name: o.name, description: o.description,
      business_unit_id: o.business_unit_id, class_id: o.class_id, student_grade_id: o.student_grade_id, active_flag: o.active_flag === 'N' ? 'N' : 'Y',
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
    return { to: `/fees/structures?ay=${o.academic_year_id}`, msg: id ? 'Fee structure saved' : 'Fee structure created' };
  });
}

export async function copyStructures(fd: FormData) {
  const u = await requireUser('ACCOUNTANT');
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
        const [ns] = await tx`insert into fee_structure (enterprise_id, academic_year_id, fee_type_code, name, description, business_unit_id, class_id, student_grade_id, copied_from_id, created_by)
          values (${u.enterpriseId}, ${o.to_ay}, ${s.fee_type_code}, ${s.name}, ${s.description}, ${s.business_unit_id}, ${s.class_id}, ${s.student_grade_id}, ${s.id}, ${u.username}) returning id`;
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
    return { to: `/fees/structures?ay=${o.to_ay}`, msg: `${n} fee structure(s) copied${pct ? ` with ${pct}% change` : ''}` };
  });
}

// ------------------------------------------------------------- generate
export async function generateFees(fd: FormData) {
  const u = await requireUser('ACCOUNTANT');
  await act(backOf(fd, '/fees/generate'), async () => {
    const o = formObj(fd);
    if (!o.academic_year_id) throw new Error('Academic year is required');
    const feeTypes = fd.getAll('fee_types').map(String).filter(Boolean);
    const [ay] = await sql`select * from academic_year where id = ${o.academic_year_id} and enterprise_id = ${u.enterpriseId}`;
    const t = todayISO();
    const onDate = t < ay.start_date ? ay.start_date : t > ay.end_date ? ay.end_date : t;
    const students = await sql`
      select a.id assignment_id, a.person_id, a.original_start_date, af.* from assignment a
      join assignment_f af on af.id = a.id and ${onDate}::date between af.effective_start_date and af.effective_end_date
      join assignment_status_f st on st.id = af.assignment_status_id and ${onDate}::date between st.effective_start_date and st.effective_end_date
      where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STUDENT' and st.system_status_code = 'ACTIVE'
        ${o.business_unit_id ? sql`and af.business_unit_id = ${o.business_unit_id}` : sql``}`;
    let created = 0;
    const skipped = new Set<string>();
    await sql.begin(async (tx) => {
      for (const s of students) {
        const r = await generateStudentFees(tx, {
          enterpriseId: u.enterpriseId, personId: s.person_id, assignmentId: s.assignment_id, ay, asg: s,
          joinDate: s.original_start_date, by: u.username, feeTypes: feeTypes.length ? feeTypes : undefined,
        });
        created += r.created;
        r.skipped.forEach((x) => skipped.add(x));
      }
    });
    return { msg: `${created} fee installment(s) created for ${students.length} active student(s).${skipped.size ? ' Skipped: ' + [...skipped].join('; ') : ''}` };
  });
}

// ---------------------------------------------------- student fee page
async function demandPerson(demandId: string) {
  const [d] = await sql`select person_id, enterprise_id from fee_demand where id = ${demandId}`;
  if (!d) throw new Error('Fee line not found');
  return d.person_id as string;
}

/** Per-line status update: Paid / Partially paid / Exception full / Exception partial / Cancel. */
export async function demandAction(demandId: string, fd: FormData) {
  const u = await requireUser('INCHARGE', 'ACCOUNTANT');
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
        return { msg: `Payment recorded · Receipt ${receipt}` };
      }
      case 'EXEMPT_FULL':
      case 'EXEMPT_PARTIAL': {
        const ex = o.op === 'EXEMPT_FULL' ? open : amt;
        if (!(ex > 0)) throw new Error('Enter the exception amount');
        if (ex > open + 0.001) throw new Error(`Exception exceeds the open balance (${open})`);
        if (!o.reason_code) throw new Error('Exception reason is required');
        const auto = hasRole(u, 'ACCOUNTANT');
        await sql`insert into fee_exemption (demand_id, amount, reason_code, remarks, status_code, requested_by, decided_by, decided_at)
          values (${demandId}, ${ex}, ${o.reason_code}, ${o.remarks}, ${auto ? 'APPROVED' : 'PENDING'}, ${u.username}, ${auto ? u.username : null}, ${auto ? new Date() : null})`;
        return { msg: auto ? 'Exception applied' : 'Exception submitted for administrator approval' };
      }
      case 'CANCEL': {
        if (!isAdmin(u)) throw new Error('Only administrators can cancel fee lines');
        if (Number(d.paid_amount) > 0) throw new Error('This line has payments; cancel the payment receipts first');
        await sql`update fee_demand set cancelled_flag = 'Y', last_updated_by = ${u.username}, last_update_date = now() where id = ${demandId}`;
        return { msg: 'Fee line cancelled' };
      }
    }
    throw new Error('Choose an action');
  });
}

/** One payment allocated across several selected lines (oldest first). */
export async function bulkPayment(personId: string, fd: FormData) {
  const u = await requireUser('INCHARGE', 'ACCOUNTANT');
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
    return { msg: `Payment of ${amount} recorded · Receipt ${receipt}` };
  });
}

export async function addCharge(personId: string, fd: FormData) {
  const u = await requireUser('ACCOUNTANT');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    if (!o.fee_type_code || !o.description || !o.amount || !o.due_date) throw new Error('Fee type, description, amount and due date are required');
    const [a] = await sql`select a.id, af.business_unit_id, af.academic_year_id from assignment a left join assignment_f af on af.id = a.id and ${o.due_date}::date between af.effective_start_date and af.effective_end_date where a.person_id = ${personId} and a.assignment_type = 'STUDENT'`;
    await addDemand(sql, { enterpriseId: u.enterpriseId, personId, feeType: o.fee_type_code, description: o.description, amount: Number(o.amount), dueDate: o.due_date, by: u.username, assignmentId: a?.id, buId: a?.business_unit_id, ayId: a?.academic_year_id });
    return { msg: 'Charge added' };
  });
}

export async function cancelPayment(paymentId: string, fd: FormData) {
  const u = await requireUser('ADMIN');
  await act(backOf(fd), async () => {
    await sql`update fee_payment set status_code = 'CANCELLED', remarks = coalesce(remarks || ' · ', '') || ${'Cancelled by ' + u.username} where id = ${paymentId}`;
    return { msg: 'Receipt cancelled; the amounts are outstanding again' };
  });
}

export async function changeFrequency(personId: string, fd: FormData) {
  const u = await requireUser('INCHARGE', 'ACCOUNTANT');
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
    return { msg: 'Fee frequency changed' };
  });
}

// ----------------------------------------------------------- exemptions
export async function decideExemption(id: string, decision: 'APPROVED' | 'REJECTED', fd: FormData) {
  const u = await requireUser('ACCOUNTANT');
  await act(backOf(fd, '/fees/exemptions'), async () => {
    const [e] = await sql`select e.*, d.balance_amount from fee_exemption e join fee_demand_v d on d.id = e.demand_id where e.id = ${id}`;
    if (!e || e.status_code !== 'PENDING') throw new Error('Request is no longer pending');
    if (decision === 'APPROVED' && Number(e.amount) > Number(e.balance_amount) + 0.001) throw new Error('Exception now exceeds the open balance (payments were recorded since)');
    await sql`update fee_exemption set status_code = ${decision}, decided_by = ${u.username}, decided_at = now() where id = ${id}`;
    return { msg: `Exception ${decision.toLowerCase()}` };
  });
}

// ------------------------------------------------------------ payment QR
export async function uploadPaymentQr(fd: FormData) {
  const u = await requireUser('INCHARGE', 'ACCOUNTANT');
  await act('/fees/payment-qr', async () => {
    const o = formObj(fd);
    const img = await fileToBytes(fd.get('image'));
    if (!img) throw new Error('Choose the QR image');
    if (!o.label) throw new Error('Label is required (e.g. "GPay – Coach Ravi")');
    const branchLevel = isAdmin(u) && o.business_unit_id;
    if (!branchLevel && !u.personId) throw new Error('Your login is not linked to a staff record');
    await sql`insert into payment_qr (person_id, business_unit_id, label, upi_id, mime, data, created_by)
      values (${branchLevel ? null : u.personId}, ${branchLevel ? o.business_unit_id : null}, ${o.label}, ${o.upi_id}, ${img.mime}, ${img.data}, ${u.username})`;
    return { msg: 'Payment QR uploaded – it now appears on student fee pages' };
  });
}

export async function togglePaymentQr(id: string, fd: FormData) {
  const u = await requireUser('INCHARGE', 'ACCOUNTANT');
  await act('/fees/payment-qr', async () => {
    const [q] = await sql`select * from payment_qr where id = ${id}`;
    if (!q) throw new Error('Not found');
    if (!isAdmin(u) && String(q.person_id) !== String(u.personId)) throw new Error('You can only manage your own QR codes');
    if (formObj(fd)._delete) await sql`delete from payment_qr where id = ${id}`;
    else await sql`update payment_qr set active_flag = case active_flag when 'Y' then 'N' else 'Y' end where id = ${id}`;
  });
}
