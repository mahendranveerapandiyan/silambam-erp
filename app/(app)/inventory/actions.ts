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
    return { to: '/inventory', msg: id ? 'Item saved' : 'Item created' };
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
    return { msg: 'Stock updated' };
  });
}

/** Sale to a student: reduces branch stock and adds the amount to the student's fee page. */
export async function sellToStudent(fd: FormData) {
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
          unit_price: it.unit_price, person_id: st.person_id, fee_demand_id: did, reference: o.reference, created_by: u.username })}`;
        total += amount;
      }
    });
    return { to: `/fees/students/${st.person_id}`, msg: `Sale of ₹${total} added to the student's fee page – mark it paid when collected` };
  });
}
