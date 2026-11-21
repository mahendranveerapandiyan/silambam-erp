import Link from 'next/link';
import { getUser, homeFor } from '@/lib/auth';

export default async function Forbidden() {
  const u = await getUser();
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card max-w-md text-center">
        <h1 className="h1 mb-2">Access denied</h1>
        <p className="muted mb-4">Your roles do not include the privilege for this page or action. Ask an administrator to add it to one of your roles.</p>
        <Link href={u ? homeFor(u) : '/login'} className="btn btn-primary">Go to my home page</Link>
      </div>
    </div>
  );
}
