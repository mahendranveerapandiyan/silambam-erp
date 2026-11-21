'use server';
import { sql } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { act, backOf, formObj, todayISO } from '@/lib/util';
import { addDemand, cancelDemandIfUnpaid } from '@/lib/fees';
import { assertStudentAccess } from '@/lib/scope';
import { academicYearOn } from '@/lib/people';

export async function saveEvent(id: string | null, fd: FormData) {
  const u = await requirePriv('CD_EVENT_SETUP_PRV', 'WRITE');
  await act(backOf(fd, '/events'), async () => {
    const o = formObj(fd);
    if (!o.name || !o.event_type_code || !o.start_date) throw new Error('Name, type and start date are required');
    const v = { name: o.name, event_type_code: o.event_type_code, business_unit_id: o.business_unit_id, start_date: o.start_date, end_date: o.end_date ?? o.start_date,
      venue: o.venue, description: o.description, fee_amount: Number(o.fee_amount || 0), status_code: o.status_code ?? 'PLANNED' };
    let eid = id;
    if (id) await sql`update event set ${sql({ ...v, last_updated_by: u.username, last_update_date: new Date() })} where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    else eid = (await sql`insert into event ${sql({ ...v, enterprise_id: u.enterpriseId, created_by: u.username })} returning id`)[0].id;
    return { to: `/events/${eid}`, msg: id ? 'Event saved' : 'Event created – now assign students' };
  });
}

export async function addParticipants(eventId: string, fd: FormData) {
  const u = await requirePriv('CD_EVENT_PARTICIPANT_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const [ev] = await sql`select * from event where id = ${eventId} and enterprise_id = ${u.enterpriseId}`;
    if (!ev) throw new Error('Event not found');
    if (['COMPLETED', 'CANCELLED'].includes(ev.status_code)) throw new Error('Event is closed');
    const o = formObj(fd);
    const ids = new Set(fd.getAll('person').map(String));
    for (const n of (o.numbers ?? '').split(/[\s,]+/).filter(Boolean)) {
      const [r] = await sql`select person_id from assignment where enterprise_id = ${u.enterpriseId} and assignment_type = 'STUDENT' and upper(assignment_number) = upper(${n})`;
      if (!r) throw new Error(`No student with number ${n}`);
      ids.add(String(r.person_id));
    }
    if (!ids.size) throw new Error('Select students');
    const date = todayISO();
    const ay = await academicYearOn(u.enterpriseId, ev.start_date);
    let n = 0;
    await sql.begin(async (tx) => {
      for (const pid of ids) {
        await assertStudentAccess(u, pid, date);
        const [ex] = await tx`select 1 from event_participant where event_id = ${eventId} and person_id = ${pid}`;
        if (ex) continue;
        let did: string | null = null;
        if (Number(ev.fee_amount) > 0) {
          const [a] = await tx`select a.id, af.business_unit_id from assignment a join assignment_f af on af.id = a.id and ${date}::date between af.effective_start_date and af.effective_end_date where a.person_id = ${pid} and a.assignment_type = 'STUDENT'`;
          did = await addDemand(tx, { enterpriseId: u.enterpriseId, personId: pid, feeType: 'EVENT', description: `${ev.name} – event fee`, amount: Number(ev.fee_amount),
            dueDate: ev.start_date < date ? date : ev.start_date, by: u.username, sourceType: 'EVENT', sourceId: eventId, ayId: ay?.id, buId: a?.business_unit_id, assignmentId: a?.id });
        }
        await tx`insert into event_participant (event_id, person_id, participation_code, fee_demand_id, assigned_by) values (${eventId}, ${pid}, ${o.participation_code ?? 'PARTICIPANT'}, ${did}, ${u.username})`;
        n++;
      }
    });
    return { msg: `${n} student(s) added${Number(ev.fee_amount) > 0 ? ' – event fee added to their fee pages' : ''}` };
  });
}

export async function updateParticipant(eventId: string, rowId: string, fd: FormData) {
  const u = await requirePriv('CD_EVENT_PARTICIPANT_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const [r] = await sql`select * from event_participant where id = ${rowId} and event_id = ${eventId}`;
    if (!r) throw new Error('Not found');
    await assertStudentAccess(u, r.person_id, todayISO());
    const o = formObj(fd);
    if (o._delete) {
      await sql.begin(async (tx) => {
        if (!(await cancelDemandIfUnpaid(tx, r.fee_demand_id))) throw new Error('Event fee already paid – cannot remove');
        await tx`delete from event_participant where id = ${rowId}`;
      });
      return { msg: 'Participant removed' };
    }
    await sql`update event_participant set participation_code = ${o.participation_code}, achievement = ${o.achievement} where id = ${rowId}`;
    return { msg: 'Saved' };
  });
}
