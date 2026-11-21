'use server';
import { sql } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { act, backOf, formObj } from '@/lib/util';

export async function saveIncharge(id: string | null, fd: FormData) {
  const u = await requirePriv('CD_CLASS_INCHARGE_PRV', 'WRITE');
  await act(backOf(fd, '/staff/incharges'), async () => {
    const o = formObj(fd);
    if (o._end && id) {
      await sql`update class_incharge set end_date = ${o.end_date ?? new Date().toISOString().slice(0, 10)} where id = ${id}`;
      return { msg: 'Incharge assignment end-dated' };
    }
    if (!o.staff_number || !o.class_section || !o.start_date) throw new Error('Staff number, class and start date are required');
    const [p] = await sql`select person_id from assignment where enterprise_id = ${u.enterpriseId} and assignment_type = 'STAFF' and upper(assignment_number) = upper(${o.staff_number})`;
    if (!p) throw new Error(`No staff member with number ${o.staff_number}`);
    const [classId, sectionId] = o.class_section.split(':');
    await sql`insert into class_incharge ${sql({ person_id: p.person_id, class_id: classId, section_id: sectionId || null, start_date: o.start_date, end_date: o.end_date ?? '4712-12-31', primary_flag: o.primary_flag ?? 'Y', created_by: u.username })}`;
    const [acct] = await sql`select id from user_account where person_id = ${p.person_id}`;
    if (acct) await sql`insert into user_role values (${acct.id}, 'INCHARGE') on conflict do nothing`;
    return { msg: acct ? 'Incharge assigned (Incharge role added to their login)' : 'Incharge assigned. Note: this staff member has no login yet – create one under Users.' };
  });
}
