import { requireUser } from '@/lib/auth';
import { lk } from '@/lib/lookups';
import { PageHeader, Flash, Field, Badge, type SP } from '@/components/ui';
import { changePassword } from '../../actions';

export default async function Account({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  const L = await lk();
  return (
    <div className="max-w-md">
      <PageHeader title="My Account" subtitle={<>{u.username} · {u.roles.map((r) => <Badge key={r} color="blue">{r}</Badge>)}</>} />
      <Flash sp={await searchParams} />
      <form action={changePassword} className="card space-y-3">
        <h2 className="h2">Change Password</h2>
        <Field label="Current Password"><input type="password" name="current" className="input" required autoComplete="current-password" /></Field>
        <Field label="New Password"><input type="password" name="password" className="input" required minLength={6} autoComplete="new-password" /></Field>
        <Field label="Confirm New Password"><input type="password" name="confirm" className="input" required autoComplete="new-password" /></Field>
        <button className="btn btn-primary">Change Password</button>
      </form>
    </div>
  );
}
