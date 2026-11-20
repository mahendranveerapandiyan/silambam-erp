import { requireUser } from '@/lib/auth';
import { Flash, Field, type SP } from '@/components/ui';
import { changePassword } from '../../actions';

export default async function PortalAccount({ searchParams }: { searchParams: SP }) {
  await requireUser();
  return (
    <div className="max-w-md">
      <Flash sp={await searchParams} />
      <form action={changePassword} className="card space-y-3">
        <h1 className="h2">Change Password</h1>
        <Field label="Current Password"><input type="password" name="current" className="input" required /></Field>
        <Field label="New Password"><input type="password" name="password" className="input" required minLength={6} /></Field>
        <Field label="Confirm New Password"><input type="password" name="confirm" className="input" required /></Field>
        <button className="btn btn-primary">Change Password</button>
      </form>
    </div>
  );
}
