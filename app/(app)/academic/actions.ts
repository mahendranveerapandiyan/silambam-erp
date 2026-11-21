'use server';
import { sql } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { act, backOf, formObj } from '@/lib/util';

export async function saveAcademicYear(id: string | null, fd: FormData) {
  const u = await requirePriv('CD_ACADEMIC_YEAR_PRV', 'WRITE');
  await act(backOf(fd, '/academic/years'), async () => {
    const o = formObj(fd);
    if ((!id && !o.code) || !o.name || !o.start_date || !o.end_date) throw new Error('Code, name, start and end dates are required');
    const v = { name: o.name, start_date: o.start_date, end_date: o.end_date, status_code: o.status_code ?? 'OPEN', last_updated_by: u.username, last_update_date: new Date() };
    // the code is fixed once the year is created
    if (id) await sql`update academic_year set ${sql(v)}, object_version_number = object_version_number + 1 where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    else await sql`insert into academic_year ${sql({ ...v, code: o.code!.toUpperCase(), enterprise_id: u.enterpriseId, created_by: u.username })}`;
    return { msg: id ? 'Academic year saved' : 'Academic year created' };
  });
}
