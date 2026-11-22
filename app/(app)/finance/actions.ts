'use server';
import { sql } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { act, backOf, formObj, todayISO } from '@/lib/util';

export async function saveTxn(fd: FormData) {
  const u = await requirePriv('CD_FINANCE_TXN_PRV', 'WRITE');
  await act(backOf(fd, '/finance'), async () => {
    const o = formObj(fd);
    if (o._delete) {
      await sql`delete from finance_txn where id = ${o._delete} and enterprise_id = ${u.enterpriseId}`;
      return { msg: 'The entry has been deleted.' };
    }
    if (o.category) [o.txn_kind, o.category_code] = o.category.split(':');
    if (!o.txn_kind || !o.category_code || !o.amount) throw new Error('Type, category and amount are required');
    await sql`insert into finance_txn ${sql({ enterprise_id: u.enterpriseId, business_unit_id: o.business_unit_id, txn_date: o.txn_date ?? todayISO(), txn_kind: o.txn_kind,
      category_code: o.category_code, amount: Number(o.amount), payment_mode_code: o.payment_mode_code, description: o.description, reference: o.reference, created_by: u.username })}`;
    return { msg: `The ${o.txn_kind === 'INCOME' ? 'income' : 'expense'} entry has been recorded.` };
  });
}
