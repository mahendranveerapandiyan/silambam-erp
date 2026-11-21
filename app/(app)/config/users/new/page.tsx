import Link from 'next/link';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PageHeader, Flash, type SP } from '@/components/ui';
import { UserForm } from '@/components/UserForm';
import { saveUser } from '../../actions';

export default async function NewUser({ searchParams }: { searchParams: SP }) {
  await requirePriv('CD_USER_PRV', 'WRITE');
  return (
    <div className="max-w-5xl">
      <PageHeader title="New User" actions={<Link href="/config/users" className="btn">Back</Link>} />
      <Flash sp={await searchParams} />
      <UserForm allRoles={await sql`select code, name, description, active_flag from app_role order by system_flag desc, name`} action={saveUser.bind(null, null)} back="/config/users/new" />
    </div>
  );
}
