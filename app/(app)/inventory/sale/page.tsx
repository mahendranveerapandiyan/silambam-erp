import { requirePriv } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fullName, personAsOf, activeStaffPeriods } from '@/lib/people';
import { studentScopeSql } from '@/lib/scope';
import { refOptions } from '@/lib/dt';
import { lookupOptions } from '@/lib/lookups';
import { money, todayISO } from '@/lib/util';
import { PageHeader, Flash, Field, Back, Select, type SP, s } from '@/components/ui';
import { ShowFor } from '@/components/client';
import { sellItems } from '../actions';

export default async function Sale({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_INVENTORY_SALE_PRV');
  const sp = await searchParams;
  const today = todayISO();
  const items = await sql`select id, code, name, size_label, unit_price from item where enterprise_id = ${u.enterpriseId} and active_flag = 'Y' order by name, size_label`;
  const students = (await sql`select a.assignment_number, ${fullName()} full_name from assignment a
    join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    join person p on p.id = a.person_id ${personAsOf(today)}
    where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STUDENT' ${studentScopeSql(u, today)} order by full_name`)
    .map((x) => ({ value: x.assignment_number as string, label: (x.full_name || x.assignment_number) as string, code: x.assignment_number as string }));
  const staff = [...new Map((await activeStaffPeriods(u.enterpriseId)).filter((x) => today >= x.start_date && today <= x.end_date)
    .map((x) => [x.assignment_number, { value: x.assignment_number as string, label: (x.full_name || x.assignment_number) as string, code: x.assignment_number as string }])).values()];
  const [buyerTypes, bus, modes] = [await lookupOptions('SALE_BUYER_TYPE', today), await refOptions('business-units', u.enterpriseId, today), await lookupOptions('PAYMENT_MODE', today)];
  return (
    <div className="max-w-4xl">
      <PageHeader title="Sell Items" subtitle="Sticks, uniforms and gear – to a student (added to their fee page, marked paid when collected), a staff member or anyone else (paid now and recorded as income). Stock is reduced at the business unit." />
      <Flash sp={sp} />
      <form action={sellItems} className="card space-y-3">
        <Back to="/inventory/sale" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Sell To *"><Select name="buyer_type" options={buyerTypes} value={s(sp.buyer) ?? 'STUDENT'} empty={false} /></Field>
          <Field label="Date"><input name="txn_date" type="date" defaultValue={today} className="input" /></Field>
          <Field label="Reference"><input name="reference" className="input" /></Field>
        </div>
        <div data-show-for-buyer_type="STUDENT" className="grid gap-3 sm:grid-cols-3">
          <Field label="Student *" className="sm:col-span-2"><Select name="student_number" options={students} value={s(sp.student)} required empty="— Choose student —" /></Field>
        </div>
        <div data-show-for-buyer_type="STAFF" className="grid gap-3 sm:grid-cols-3">
          <Field label="Staff Member *" className="sm:col-span-2"><Select name="staff_number" options={staff} required empty="— Choose staff —" /></Field>
        </div>
        <div data-show-for-buyer_type="OTHER" className="grid gap-3 sm:grid-cols-3">
          <Field label="Buyer Name *"><input name="buyer_name" required className="input" /></Field>
          <Field label="Phone"><input name="buyer_phone" className="input" /></Field>
        </div>
        <div data-show-for-buyer_type="STAFF,OTHER" className="grid gap-3 sm:grid-cols-3">
          <Field label="Business Unit" help="Where the stock is taken from. Staff: empty = their own business unit."><Select name="business_unit_id" options={bus} empty="— Staff member's business unit —" /></Field>
          <Field label="Paid By *" help="Paid now – recorded in Finance as income"><Select name="payment_mode_code" options={modes} value="CASH" required /></Field>
        </div>
        <ShowFor select="buyer_type" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem] gap-2">
            <select name={`item_${i}`} className="input" defaultValue=""><option value="">{i === 0 ? 'Select item *' : '— another item —'}</option>
              {items.map((it) => <option key={it.id} value={it.id} data-code={it.code}>{it.name}{it.size_label ? ` – ${it.size_label}` : ''} · {money(it.unit_price)}</option>)}</select>
            <input name={`qty_${i}`} type="number" min="0" defaultValue={i === 0 ? 1 : ''} placeholder="Qty" className="input" />
          </div>
        ))}
        <button className="btn btn-primary">Record Sale</button>
      </form>
    </div>
  );
}
