import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { lk, lookupOptions } from '@/lib/lookups';
import { fullName, personAsOf, nm } from '@/lib/people';
import { myClasses, studentScopeSql } from '@/lib/scope';
import { fmtDate, money, todayISO } from '@/lib/util';
import { PageHeader, Flash, Back, Badge, Empty, Select, STATUS_COLOR, type SP, s, here } from '@/components/ui';
import { AutoSubmit, CheckAll } from '@/components/client';
import { EventForm } from '@/components/EventForm';
import { saveEvent, addParticipants, updateParticipant } from '../actions';

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requirePriv(['CD_EVENT_SETUP_PRV', 'CD_EVENT_PARTICIPANT_PRV'], 'READ');
  const { id } = await params;
  const sp = await searchParams;
  const [ev] = await sql`select * from event where id = ${id} and enterprise_id = ${u.enterpriseId}`;
  if (!ev) notFound();
  const asOf = await getAsOf();
  const today = todayISO();
  const L = await lk();
  const back = here(`/events/${id}`, sp);
  const roles = await lookupOptions('PARTICIPATION', asOf);
  const parts = await sql`select ep.*, a.assignment_number, ${fullName()} full_name, ${nm('class', 'af.class_id', today)} class_name, d.payment_status
    from event_participant ep join person p on p.id = ep.person_id join assignment a on a.person_id = p.id and a.assignment_type = 'STUDENT'
    left join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    ${personAsOf(today)} left join fee_demand_v d on d.id = ep.fee_demand_id
    where ep.event_id = ${id} ${studentScopeSql(u, today)} order by full_name`;
  const classes = await myClasses(u, today);
  const cls = s(sp.cls);
  const pick = cls ? await sql`select a.person_id, a.assignment_number, ${fullName()} full_name from assignment a
      join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
      join assignment_status_f st on st.id = af.assignment_status_id and ${today}::date between st.effective_start_date and st.effective_end_date
      join person p on p.id = a.person_id ${personAsOf(today)}
      where a.assignment_type = 'STUDENT' and st.system_status_code = 'ACTIVE' and af.class_id = ${cls.split(':')[0]} and af.section_id = ${cls.split(':')[1]} ${studentScopeSql(u, today)}
        and not exists (select 1 from event_participant x where x.event_id = ${id} and x.person_id = a.person_id) order by full_name` : [];
  const closed = ['COMPLETED', 'CANCELLED'].includes(ev.status_code);
  return (
    <div className="max-w-6xl">
      <PageHeader title={ev.name} subtitle={<>{L('EVENT_TYPE', ev.event_type_code)} · {fmtDate(ev.start_date)}{ev.end_date !== ev.start_date && ` – ${fmtDate(ev.end_date)}`} · {ev.venue} · Fee {Number(ev.fee_amount) ? money(ev.fee_amount) : 'Free'} · <Badge color="blue">{L('EVENT_STATUS', ev.status_code)}</Badge></>}
        actions={<Link href="/events" className="btn">All events</Link>} />
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="card overflow-x-auto">
          <h2 className="h2">Participants ({parts.length})</h2>
          <table className="tbl"><thead><tr><th>Student</th><th>Class</th><th>Role</th><th>Achievement / Result</th><th>Fee</th><th></th></tr></thead>
            <tbody>{parts.map((r) => {
              const fid = `ep-${r.id}`;
              return (
                <tr key={r.id}>
                  <td><Link className="link" href={`/students/${r.person_id}?tab=events`}>{r.full_name}</Link><div className="text-xs text-gray-500">{r.assignment_number}</div></td>
                  <td>{r.class_name}</td>
                  <td><select name="participation_code" form={fid} defaultValue={r.participation_code ?? 'PARTICIPANT'} className="input w-36">{roles.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></td>
                  <td><input name="achievement" form={fid} defaultValue={r.achievement ?? ''} placeholder="e.g. Gold – Single stick" className="input" /></td>
                  <td>{r.payment_status && <Badge color={STATUS_COLOR[r.payment_status]}>{L('FEE_PAYMENT_STATUS', r.payment_status)}</Badge>}</td>
                  <td><form id={fid} action={updateParticipant.bind(null, id, r.id)} className="flex gap-1"><Back to={back} /><button className="btn btn-sm">Save</button><button name="_delete" value="1" className="btn btn-sm">✕</button></form></td>
                </tr>);
            })}</tbody></table>
          {!parts.length && <Empty>No students assigned yet.</Empty>}
        </div>
        {!closed && (
          <div className="card h-fit space-y-3">
            <h2 className="h2">Assign Students</h2>
            <form className="flex gap-2"><Select name="cls" options={classes.map((c) => ({ value: `${c.class_id}:${c.section_id}`, label: c.label }))} value={cls} empty="Pick a class" /><AutoSubmit /></form>
            <form action={addParticipants.bind(null, id)} className="space-y-2">
              <Back to={back} />
              {pick.length > 0 && <div className="max-h-72 space-y-1 overflow-y-auto rounded border p-2">
                <label className="flex items-center gap-2 text-xs font-semibold"><CheckAll name="person" /> Select all</label>
                {pick.map((p) => <label key={p.person_id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="person" value={p.person_id} /> {p.full_name} <span className="text-xs text-gray-500">{p.assignment_number}</span></label>)}
              </div>}
              <textarea name="numbers" placeholder="…or type student numbers (comma separated)" rows={2} className="input" />
              <Select name="participation_code" options={roles} value="PARTICIPANT" empty={false} />
              <button className="btn btn-primary w-full">Add</button>
            </form>
          </div>
        )}
      </div>
      {can(u, 'CD_EVENT_SETUP_PRV', 'WRITE') && <div className="mt-4"><h2 className="h2">Event Details</h2>
        <EventForm action={saveEvent.bind(null, id)} ev={ev} back={back} o={{ types: await lookupOptions('EVENT_TYPE', asOf), statuses: await lookupOptions('EVENT_STATUS', asOf), bus: await refOptions('business-units', u.enterpriseId, asOf) }} /></div>}
    </div>
  );
}
