import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PageHeader, Flash, type SP } from '@/components/ui';
import { UserForm } from '@/components/UserForm';
import { saveUser } from '../../actions';

export default async function EditUser({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const me = await requirePriv('CD_USER_PRV', 'READ');
  const { id } = await params;
  const [user] = await sql`select u.*, coalesce((select assignment_number from assignment a where a.person_id = u.person_id order by assignment_type limit 1), p.person_number) linked_number
    from user_account u left join person p on p.id = u.person_id where u.id = ${id}`;
  if (!user) notFound();
  const roles = (await sql`select role_code from user_role where user_id = ${id}`).map((r) => r.role_code);
  const students = await sql`
    select usa.person_id, a.assignment_number || ' – ' || pf.first_name || coalesce(' ' || pf.last_name, '') label
    from user_student_access usa join assignment a on a.person_id = usa.person_id and a.assignment_type = 'STUDENT'
    join lateral (select * from person_f x where x.id = usa.person_id order by x.effective_start_date desc limit 1) pf on true
    where usa.user_id = ${id}`;
  return (
    <div className="max-w-5xl">
      <PageHeader title={`User: ${user.username}`} actions={<Link href="/config/users" className="btn">Back</Link>} />
      <Flash sp={await searchParams} />
      <UserForm canEdit={can(me, 'CD_USER_PRV', 'WRITE')} allRoles={await sql`select code, name, description, active_flag from app_role order by system_flag desc, name`} action={saveUser.bind(null, id)} user={user} roles={roles} students={students} back={`/config/users/${id}`} />
    </div>
  );
}
