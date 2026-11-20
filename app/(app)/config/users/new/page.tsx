import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { PageHeader, Flash, type SP } from '@/components/ui';
import { UserForm } from '@/components/UserForm';
import { saveUser } from '../../actions';

export default async function NewUser({ searchParams }: { searchParams: SP }) {
  await requireUser('ADMIN');
  return (
    <div className="max-w-5xl">
      <PageHeader title="New User" actions={<Link href="/config/users" className="btn">Back</Link>} />
      <Flash sp={await searchParams} />
      <UserForm action={saveUser.bind(null, null)} back="/config/users/new" />
    </div>
  );
}
