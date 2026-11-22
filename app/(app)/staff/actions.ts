'use server';
import { sql } from '@/lib/db';
import { requirePriv } from '@/lib/auth';
import { act, backOf, formObj } from '@/lib/util';
import { assertEffective } from '@/lib/integrity';

/** Assign a staff member as incharge of a class (or one section) for an academic year. */
export async function saveIncharge(fd: FormData) {
  const u = await requirePriv('CD_CLASS_INCHARGE_PRV', 'WRITE');
  await act(backOf(fd, '/staff/incharges'), async () => {
    const o = formObj(fd);
    if (!o.academic_year_id || !o.staff_number || !o.class_section) throw new Error('Academic year, staff number and class are required');
    const [ay] = await sql`select * from academic_year where id = ${o.academic_year_id} and enterprise_id = ${u.enterpriseId}`;
    if (!ay) throw new Error('Academic year not found');
    const start = o.start_date ?? ay.start_date;
    const end = o.end_date ?? ay.end_date;
    if (start < ay.start_date || end > ay.end_date || end < start)
      throw new Error(`Dates must be within ${ay.name} (${ay.start_date} – ${ay.end_date}) and the end must not be before the start.`);
    const [p] = await sql`select a.person_id, a.id from assignment a where a.enterprise_id = ${u.enterpriseId} and a.assignment_type = 'STAFF' and upper(a.assignment_number) = upper(${o.staff_number})`;
    if (!p) throw new Error(`No staff member with number ${o.staff_number}`);
    const [active] = await sql`select 1 from assignment_f af join assignment_status_f st on st.id = af.assignment_status_id and ${start}::date between st.effective_start_date and st.effective_end_date
      where af.id = ${p.id} and ${start}::date between af.effective_start_date and af.effective_end_date and st.system_status_code = 'ACTIVE'`;
    if (!active) throw new Error(`Staff ${o.staff_number} is not active on ${start}.`);
    const [classId, sectionId] = o.class_section.split(':');
    await assertEffective(sql, 'class', classId, start, 'Class');
    if (sectionId) await assertEffective(sql, 'section', sectionId, start, 'Section');
    const [dup] = await sql`select 1 from class_incharge where person_id = ${p.person_id} and class_id = ${classId} and section_id is not distinct from ${sectionId || null}
      and daterange(start_date, end_date, '[]') && daterange(${start}::date, ${end}::date, '[]')`;
    if (dup) throw new Error('This staff member is already incharge of that class/section for overlapping dates.');
    await sql`insert into class_incharge ${sql({ person_id: p.person_id, class_id: classId, section_id: sectionId || null, academic_year_id: ay.id, start_date: start, end_date: end, primary_flag: 'Y', created_by: u.username })}`;
    const [acct] = await sql`select id from user_account where person_id = ${p.person_id}`;
    if (acct) await sql`insert into user_role values (${acct.id}, 'INCHARGE') on conflict do nothing`;
    return { msg: acct ? `The incharge has been assigned for ${ay.name} (Incharge role added to their login)` : `The incharge has been assigned for ${ay.name}. This staff member has no login yet – create one under Users.` };
  });
}

/** End an incharge assignment early (within its academic year). */
export async function endIncharge(id: string, fd: FormData) {
  await requirePriv('CD_CLASS_INCHARGE_PRV', 'WRITE');
  await act(backOf(fd, '/staff/incharges'), async () => {
    const d = formObj(fd).end_date;
    const [ci] = await sql`select * from class_incharge where id = ${id}`;
    if (!ci || !d) throw new Error('Choose the end date');
    if (d < ci.start_date) throw new Error('End date cannot be before the start date');
    await sql`update class_incharge set end_date = ${d} where id = ${id}`;
    return { msg: 'The incharge assignment has been end-dated.' };
  });
}

/** Delete a staff member's latest incharge assignment (e.g. entered by mistake). */
export async function deleteIncharge(id: string, fd: FormData) {
  await requirePriv('CD_CLASS_INCHARGE_PRV', 'WRITE');
  await act(backOf(fd, '/staff/incharges'), async () => {
    const [ci] = await sql`select * from class_incharge where id = ${id}`;
    if (!ci) throw new Error('Not found');
    const [latest] = await sql`select id from class_incharge where person_id = ${ci.person_id} order by start_date desc, id desc limit 1`;
    if (String(latest.id) !== String(id)) throw new Error("Only the staff member's latest incharge assignment can be deleted.");
    await sql`delete from class_incharge where id = ${id}`;
    return { msg: 'The incharge assignment has been deleted.' };
  });
}
