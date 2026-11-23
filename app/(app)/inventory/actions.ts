'use server';
import { sql } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { act, backOf, formObj, todayISO } from '@/lib/util';
import { addDemand } from '@/lib/fees';
import { assertStudentAccess } from '@/lib/scope';
import { academicYearOn } from '@/lib/people';

export async function saveItem(id: string | null, fd: FormData) {
  const u = await requirePriv('CD_INVENTORY_ITEM_PRV', 'WRITE');
  await act(backOf(fd, '/inventory'), async () => {
    const o = formObj(fd);
    if (!o.code || !o.name || !o.category_code) throw new Error('Code, name and category are required');
    const v = { code: o.code.toUpperCase(), name: o.name, category_code: o.category_code, size_label: o.size_label, uom_code: o.uom_code ?? 'EA',
      unit_price: Number(o.unit_price || 0), reorder_level: Number(o.reorder_level || 0), active_flag: o.active_flag === 'N' ? 'N' : 'Y' };
    if (id) await sql`update item set ${sql({ ...v, last_updated_by: u.username, last_update_date: new Date() })} where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    else await sql`insert into item ${sql({ ...v, enterprise_id: u.enterpriseId, created_by: u.username })}`;
    return { to: '/inventory', msg: `${o.name} item has been ${id ? 'updated' : 'created'}.` };
  });
}

export async function stockEntry(fd: FormData) {
  const u = await requirePriv('CD_STOCK_ENTRY_PRV', 'WRITE');
  await act(backOf(fd, '/inventory/stock'), async () => {
    const o = formObj(fd);
    if (!o.item_id || !o.business_unit_id || !o.txn_type_code || !o.quantity) throw new Error('Item, branch, type and quantity are required');
    let q = Number(o.quantity);
    if (!q) throw new Error('Quantity cannot be zero');
    if (o.txn_type_code === 'RECEIPT' || o.txn_type_code === 'RETURN') q = Math.abs(q);
    if (o.txn_type_code === 'SALE') throw new Error('Use “Sell to Student” for sales');
    if (q < 0) {
      const [s] = await sql`select coalesce(sum(quantity),0) q from stock_txn where item_id = ${o.item_id} and business_unit_id = ${o.business_unit_id}`;
      if (Number(s.q) + q < 0) throw new Error(`Only ${s.q} in stock at this branch`);
    }
    await sql`insert into stock_txn ${sql({ item_id: o.item_id, business_unit_id: o.business_unit_id, txn_date: o.txn_date ?? todayISO(), txn_type_code: o.txn_type_code,
      quantity: q, unit_price: o.unit_price ? Number(o.unit_price) : null, reference: o.reference, remarks: o.remarks, created_by: u.username })}`;
    return { msg: 'The stock has been updated.' };
  });
}

/** Sale to a student: reduces branch stock and adds the amount to the student's fee page. */
/**
 * Sell items to a student (amount added to their fee page), a staff member or
 * anyone else (paid at once and recorded as income). Stock is reduced at the
 * buyer's business unit (students, staff) or the chosen one.
 */
export async function sellItems(fd: FormData) {
  const buyer = formObj(fd).buyer_type ?? 'STUDENT';
  if (buyer === 'STUDENT') return sellToStudent(fd);
  return sellToOthers(fd, buyer === 'STAFF' ? 'STAFF' : 'OTHER');
}

async function sellToStudent(fd: FormData) {
  const u = await requirePriv('CD_INVENTORY_SALE_PRV', 'WRITE');
  await act(backOf(fd, '/inventory/sale'), async () => {
    const o = formObj(fd);
    const date = o.txn_date ?? todayISO();
    if (!o.student_number) throw new Error('Student number is required');
    const [st] = await sql`select a.id, a.person_id, af.business_unit_id from assignment a
      join assignment_f af on af.id = a.id and ${date}::date between af.effective_start_date and af.effective_end_date
      where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STUDENT' and upper(a.assignment_number) = upper(${o.student_number})`;
    if (!st) throw new Error(`No active student with number ${o.student_number}`);
    await assertStudentAccess(u, st.person_id, date);
    const lines = [0, 1, 2, 3, 4].map((i) => ({ item: o[`item_${i}`], qty: Number(o[`qty_${i}`] || 0) })).filter((l) => l.item && l.qty > 0);
    if (!lines.length) throw new Error('Add at least one item');
    const ay = await academicYearOn(u.enterpriseId, date);
    let total = 0;
    await sql.begin(async (tx) => {
      for (const l of lines) {
        const [it] = await tx`select * from item where id = ${l.item}`;
        const [s] = await tx`select coalesce(sum(quantity),0) q from stock_txn where item_id = ${l.item} and business_unit_id = ${st.business_unit_id}`;
        if (Number(s.q) < l.qty) throw new Error(`${it.name}${it.size_label ? ' (' + it.size_label + ')' : ''}: only ${s.q} in stock at the student's branch`);
        const amount = Number(it.unit_price) * l.qty;
        const did = await addDemand(tx, { enterpriseId: u.enterpriseId, personId: st.person_id, feeType: 'INVENTORY',
          description: `${it.name}${it.size_label ? ' (' + it.size_label + ')' : ''} × ${l.qty}`, amount, dueDate: date, by: u.username,
          sourceType: 'SALE', ayId: ay?.id, buId: st.business_unit_id, assignmentId: st.id });
        await tx`insert into stock_txn ${tx({ item_id: l.item, business_unit_id: st.business_unit_id, txn_date: date, txn_type_code: 'SALE', quantity: -l.qty,
          unit_price: it.unit_price, person_id: st.person_id, buyer_type: 'STUDENT', fee_demand_id: did, reference: o.reference, created_by: u.username })}`;
        total += amount;
      }
    });
    return { to: `/fees/students/${st.person_id}`, msg: `Sale of ₹${total} added to the student's fee page – mark it paid when collected` };
  });
}

async function sellToOthers(fd: FormData, buyer: 'STAFF' | 'OTHER') {
  const u = await requirePriv('CD_INVENTORY_SALE_PRV', 'WRITE');
  await act(backOf(fd, '/inventory/sale'), async () => {
    const o = formObj(fd);
    const date = o.txn_date ?? todayISO();
    if (!o.payment_mode_code) throw new Error('Choose how the buyer paid');
    let personId: string | null = null;
    let buId = o.business_unit_id;
    let who = o.buyer_name ?? '';
    if (buyer === 'STAFF') {
      if (!o.staff_number) throw new Error('Choose the staff member');
      const [sf] = await sql`select a.person_id, af.business_unit_id, a.assignment_number,
          (select trim(concat_ws(' ', first_name, last_name)) from person_f x where x.id = a.person_id order by effective_start_date desc limit 1) n
        from assignment a join assignment_f af on af.id = a.id and ${date}::date between af.effective_start_date and af.effective_end_date
        where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STAFF' and upper(a.assignment_number) = upper(${o.staff_number})`;
      if (!sf) throw new Error(`No staff member with number ${o.staff_number} on ${date}`);
      personId = String(sf.person_id);
      buId ??= String(sf.business_unit_id);
      who = `${sf.n} (${sf.assignment_number})`;
    } else if (!who.trim()) throw new Error("Enter the buyer's name");
    if (!buId) throw new Error('Choose the business unit the stock is taken from');
    const lines = [0, 1, 2, 3, 4].map((i) => ({ item: o[`item_${i}`], qty: Number(o[`qty_${i}`] || 0) })).filter((l) => l.item && l.qty > 0);
    if (!lines.length) throw new Error('Add at least one item');
    let total = 0;
    const desc: string[] = [];
    await sql.begin(async (tx) => {
      const ids: string[] = [];
      for (const l of lines) {
        const [it] = await tx`select * from item where id = ${l.item} and enterprise_id = ${u.enterpriseId}`;
        if (!it) throw new Error('Item not found');
        const label = `${it.name}${it.size_label ? ' (' + it.size_label + ')' : ''}`;
        const [s] = await tx`select coalesce(sum(quantity),0) q from stock_txn where item_id = ${l.item} and business_unit_id = ${buId}`;
        if (Number(s.q) < l.qty) throw new Error(`${label}: only ${s.q} in stock at this business unit`);
        const [t] = await tx`insert into stock_txn ${tx({ item_id: l.item, business_unit_id: buId, txn_date: date, txn_type_code: 'SALE', quantity: -l.qty,
          unit_price: it.unit_price, person_id: personId, buyer_type: buyer, buyer_name: buyer === 'OTHER' ? who.trim() : null, buyer_phone: buyer === 'OTHER' ? o.buyer_phone : null,
          reference: o.reference, created_by: u.username })} returning id`;
        ids.push(String(t.id));
        total += Number(it.unit_price) * l.qty;
        desc.push(`${label} × ${l.qty}`);
      }
      // paid at once: recorded as income
      const [fin] = await tx`insert into finance_txn ${tx({ enterprise_id: u.enterpriseId, business_unit_id: buId, txn_date: date, txn_kind: 'INCOME', category_code: 'INVENTORY_SALE',
        amount: total, payment_mode_code: o.payment_mode_code, description: `Sale to ${buyer === 'STAFF' ? 'staff' : ''} ${who.trim()}: ${desc.join(', ')}`.replace('  ', ' '),
        reference: o.reference, created_by: u.username })} returning id`;
      await tx`update stock_txn set finance_txn_id = ${fin.id} where id in ${tx(ids)}`;
    });
    return { msg: `Sale of ₹${total} to ${who.trim()} has been recorded and paid (${desc.join(', ')}). The amount is in Finance as income.` };
  });
}
