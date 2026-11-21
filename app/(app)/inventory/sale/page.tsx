import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fullName, personAsOf } from '@/lib/people';
import { studentScopeSql } from '@/lib/scope';
import { money, todayISO } from '@/lib/util';
import { PageHeader, Flash, Field, Back, type SP, s } from '@/components/ui';
import { sellToStudent } from '../actions';

export default async function Sale({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_INVENTORY_SALE_PRV');
  const sp = await searchParams;
  const today = todayISO();
  const items = await sql`select id, code, name, size_label, unit_price from item where enterprise_id = ${u.enterpriseId} and active_flag = 'Y' order by name, size_label`;
  const students = await sql`select a.assignment_number, ${fullName()} full_name from assignment a
    join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    join person p on p.id = a.person_id ${personAsOf(today)}
    where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STUDENT' ${studentScopeSql(u, today)} order by full_name`;
  return (
    <div className="max-w-4xl">
      <PageHeader title="Sell to Student" subtitle="Sticks, uniforms and gear. Stock is reduced at the student's branch and the amount is added to the student's fee page, where staff mark it paid." />
      <Flash sp={sp} />
      <form action={sellToStudent} className="card space-y-3">
        <Back to="/inventory/sale" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Student Number *"><input name="student_number" list="students" defaultValue={s(sp.student) ?? ''} className="input" required /></Field>
          <datalist id="students">{students.map((x) => <option key={x.assignment_number} value={x.assignment_number}>{x.full_name}</option>)}</datalist>
          <Field label="Date"><input name="txn_date" type="date" defaultValue={today} className="input" /></Field>
          <Field label="Reference"><input name="reference" className="input" /></Field>
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem] gap-2">
            <select name={`item_${i}`} className="input" defaultValue=""><option value="">{i === 0 ? 'Select item *' : '— another item —'}</option>
              {items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.size_label ? ` – ${it.size_label}` : ''} · {money(it.unit_price)}</option>)}</select>
            <input name={`qty_${i}`} type="number" min="0" defaultValue={i === 0 ? 1 : ''} placeholder="Qty" className="input" />
          </div>
        ))}
        <button className="btn btn-primary">Record Sale</button>
      </form>
    </div>
  );
}
