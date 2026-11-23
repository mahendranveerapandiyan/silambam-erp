import 'server-only';
import { sql, type Tx, type Row } from './db';
import { addDays, addMonths } from './util';
import { nextNumber } from './numbering';

/** Months per installment for each frequency (from the FEE_FREQUENCY lookup tag). */
export async function frequencyMonths(tx: Tx = sql): Promise<Record<string, number>> {
  const rows = await tx`select lookup_code, tag from lookup_value where lookup_type = 'FEE_FREQUENCY'`;
  return Object.fromEntries(rows.map((r) => [r.lookup_code, Number(r.tag || 0)]));
}

/**
 * Fee structures applying to a student. When several structures exist for
 * the same fee type, the most specific wins
 * (student > section > grade > class > branch > business unit > all).
 */
export async function applicableStructures(tx: Tx, enterpriseId: string, ayId: string,
  a: { person_id?: string | null; business_unit_id?: string | null; branch_id?: string | null; class_id?: string | null; section_id?: string | null; student_grade_id?: string | null },
  feeTypes?: string[]) {
  // weights make the most specific structure win: student > section > grade > class > branch > business unit
  const rows = await tx`
    select fs.*, (case when fs.person_id is not null then 64 else 0 end + case when fs.section_id is not null then 16 else 0 end
      + case when fs.student_grade_id is not null then 8 else 0 end + case when fs.class_id is not null then 4 else 0 end
      + case when fs.branch_id is not null then 2 else 0 end + case when fs.business_unit_id is not null then 1 else 0 end) score
    from fee_structure fs
    where fs.enterprise_id = ${enterpriseId} and fs.academic_year_id = ${ayId} and fs.active_flag = 'Y'
      and (fs.person_id is null or fs.person_id = ${a.person_id ?? null})
      and (fs.business_unit_id is null or fs.business_unit_id = ${a.business_unit_id ?? null})
      and (fs.branch_id is null or fs.branch_id = ${a.branch_id ?? null})
      and (fs.class_id is null or fs.class_id = ${a.class_id ?? null})
      and (fs.section_id is null or fs.section_id = ${a.section_id ?? null})
      and (fs.student_grade_id is null or fs.student_grade_id = ${a.student_grade_id ?? null})
      ${feeTypes?.length ? tx`and fs.fee_type_code in ${tx(feeTypes)}` : tx``}
    order by fs.fee_type_code, score desc, fs.id`;
  const best = new Map<string, Row>();
  for (const r of rows) if (!best.has(r.fee_type_code)) best.set(r.fee_type_code, r);
  const out: (Row & { amounts: Record<string, number> })[] = [];
  for (const s of best.values()) {
    const amounts = await tx`select frequency_code, amount from fee_structure_amount where fee_structure_id = ${s.id}`;
    out.push({ ...(s as Row), amounts: Object.fromEntries(amounts.map((x) => [x.frequency_code, Number(x.amount)])) as Record<string, number> });
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monLabel = (d: string) => `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;

/**
 * Creates fee demands (installments) for one student for an academic year.
 * Recurring structures use the student's own fee frequency; ONE_TIME
 * structures create a single demand. Existing/overlapping demands are skipped,
 * so it is safe to run repeatedly.
 */
export async function generateStudentFees(
  tx: Tx,
  p: { enterpriseId: string; personId: string; assignmentId: string; ay: Row; asg: Row; joinDate: string; by: string; feeTypes?: string[] },
) {
  const months = await frequencyMonths(tx);
  const structures = await applicableStructures(tx, p.enterpriseId, p.ay.id, { ...p.asg, person_id: p.personId }, p.feeTypes);
  let created = 0;
  const skipped: string[] = [];
  for (const s of structures) {
    const oneTime = s.amounts.ONE_TIME !== undefined && Object.keys(s.amounts).length === 1;
    if (oneTime) {
      const [ex] = await tx`select 1 from fee_demand where person_id = ${p.personId} and fee_structure_id = ${s.id} and cancelled_flag = 'N'`;
      if (ex) continue;
      const start = p.joinDate > p.ay.start_date ? p.joinDate : p.ay.start_date;
      await tx`insert into fee_demand ${tx({
        enterprise_id: p.enterpriseId, person_id: p.personId, assignment_id: p.assignmentId, academic_year_id: p.ay.id, business_unit_id: p.asg.business_unit_id,
        fee_type_code: s.fee_type_code, fee_structure_id: s.id, source_type: 'STRUCTURE', description: s.name, frequency_code: 'ONE_TIME',
        period_label: p.ay.name, period_start: start, period_end: p.ay.end_date, due_date: start, amount: s.amounts.ONE_TIME, created_by: p.by,
      })}`;
      created++;
      continue;
    }
    const freq = p.asg.fee_frequency_code || 'MONTHLY';
    const amount = s.amounts[freq];
    const n = months[freq] || 1;
    if (amount === undefined) {
      skipped.push(`${s.name}: no amount defined for ${freq}`);
      continue;
    }
    for (let start = p.ay.start_date as string; start <= p.ay.end_date; start = addMonths(start, n)) {
      let end = addDays(addMonths(start, n), -1);
      if (end > p.ay.end_date) end = p.ay.end_date;
      if (end < p.joinDate) continue; // joined after this period
      const [overlap] = await tx`
        select 1 from fee_demand where person_id = ${p.personId} and fee_type_code = ${s.fee_type_code} and academic_year_id = ${p.ay.id}
          and cancelled_flag = 'N' and daterange(period_start, period_end, '[]') && daterange(${start}::date, ${end}::date, '[]')`;
      if (overlap) continue;
      const label = n === 1 ? monLabel(start) : `${monLabel(start)} – ${monLabel(end)}`;
      await tx`insert into fee_demand ${tx({
        enterprise_id: p.enterpriseId, person_id: p.personId, assignment_id: p.assignmentId, academic_year_id: p.ay.id, business_unit_id: p.asg.business_unit_id,
        fee_type_code: s.fee_type_code, fee_structure_id: s.id, source_type: 'STRUCTURE', description: s.name, frequency_code: freq,
        period_label: label, period_start: start, period_end: end, due_date: addDays(start, 9), amount, created_by: p.by,
      })}`;
      created++;
    }
  }
  return { created, skipped };
}

/** Adds a one-off demand (exam, event, inventory sale, manual). */
export async function addDemand(tx: Tx, d: {
  enterpriseId: string; personId: string; feeType: string; description: string; amount: number; dueDate: string; by: string;
  sourceType?: string; sourceId?: string | null; ayId?: string | null; buId?: string | null; assignmentId?: string | null;
}) {
  const [r] = await tx`insert into fee_demand ${tx({
    enterprise_id: d.enterpriseId, person_id: d.personId, assignment_id: d.assignmentId ?? null, academic_year_id: d.ayId ?? null,
    business_unit_id: d.buId ?? null, fee_type_code: d.feeType, source_type: d.sourceType ?? 'MANUAL', source_id: d.sourceId ?? null,
    description: d.description, period_label: null, due_date: d.dueDate, amount: d.amount, created_by: d.by,
  })} returning id`;
  return r.id as string;
}

/** Cancels a demand when nothing has been paid against it; returns false if it had payments. */
export async function cancelDemandIfUnpaid(tx: Tx, demandId: string | null) {
  if (!demandId) return true;
  const [d] = await tx`select paid_amount from fee_demand_v where id = ${demandId}`;
  if (!d) return true;
  if (Number(d.paid_amount) > 0) return false;
  await tx`update fee_demand set cancelled_flag = 'Y', last_update_date = now() where id = ${demandId}`;
  return true;
}

/**
 * Records a payment and allocates it to the given demands (in order), or to
 * the oldest open demands when none are given. Returns the receipt number.
 */
export async function recordPayment(tx: Tx, p: {
  enterpriseId: string; personId: string; amount: number; date: string; mode: string; reference?: string | null; remarks?: string | null;
  demandIds?: string[]; by: string; buId?: string | null;
}) {
  if (!(p.amount > 0)) throw new Error('Payment amount must be greater than zero');
  await tx`select id from fee_demand where person_id = ${p.personId} for update`;
  const open = await tx`
    select id, balance_amount, business_unit_id from fee_demand_v
    where person_id = ${p.personId} and cancelled_flag = 'N' and balance_amount > 0
      ${p.demandIds?.length ? tx`and id in ${tx(p.demandIds)}` : tx``}
    order by due_date, id`;
  const totalOpen = open.reduce((a, r) => a + Number(r.balance_amount), 0);
  if (p.amount > totalOpen + 0.001) throw new Error(`Amount exceeds the outstanding balance (${totalOpen.toFixed(2)}).`);
  const buId = p.buId ?? open[0]?.business_unit_id ?? null;
  const [br] = await tx`select af.branch_id from assignment a join assignment_f af on af.id = a.id and ${p.date}::date between af.effective_start_date and af.effective_end_date
    where a.person_id = ${p.personId} and a.assignment_type = 'STUDENT'`;
  const receipt = (await nextNumber(tx, p.enterpriseId, 'RECEIPT', { buId, branchId: br?.branch_id ?? null, date: p.date })) ?? `R-${Date.now()}`;
  const [pay] = await tx`insert into fee_payment ${tx({
    enterprise_id: p.enterpriseId, receipt_number: receipt, person_id: p.personId, business_unit_id: buId, payment_date: p.date,
    amount: p.amount, payment_mode_code: p.mode, reference: p.reference ?? null, remarks: p.remarks ?? null, collected_by: p.by, created_by: p.by,
  })} returning id`;
  let left = p.amount;
  for (const d of open) {
    if (left <= 0) break;
    const a = Math.min(left, Number(d.balance_amount));
    await tx`insert into fee_allocation values (${pay.id}, ${d.id}, ${a})`;
    left = Math.round((left - a) * 100) / 100;
  }
  return { receipt, paymentId: pay.id as string };
}

/** Student fee totals for a set of demands. */
export function totals(rows: Row[]) {
  const t = { due: 0, paid: 0, exempted: 0, balance: 0, overdue: 0 };
  for (const r of rows) {
    if (r.cancelled_flag === 'Y') continue;
    t.due += Number(r.amount);
    t.paid += Number(r.paid_amount);
    t.exempted += Number(r.exempted_amount);
    t.balance += Number(r.balance_amount);
  }
  return t;
}

/** Payment QR images to show for a student: their class incharges' + branch QRs. */
export async function paymentQrsFor(personId: string, asOf: string) {
  return sql`
    select q.id, q.label, q.upi_id from payment_qr q
    where q.active_flag = 'Y' and (
      q.person_id in (
        select ci.person_id from class_incharge ci
        join assignment a on a.person_id = ${personId} and a.assignment_type = 'STUDENT'
        join assignment_f af on af.id = a.id and ${asOf}::date between af.effective_start_date and af.effective_end_date
        where ${asOf}::date between ci.start_date and ci.end_date and ci.class_id = af.class_id and (ci.section_id is null or ci.section_id = af.section_id))
      or q.business_unit_id = (
        select af.business_unit_id from assignment a join assignment_f af on af.id = a.id and ${asOf}::date between af.effective_start_date and af.effective_end_date
        where a.person_id = ${personId} and a.assignment_type = 'STUDENT'))
    order by q.business_unit_id nulls first, q.id`;
}
