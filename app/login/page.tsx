import { redirect } from 'next/navigation';
import { login } from '../actions';
import { getUser, homeFor } from '@/lib/auth';
import { enterpriseInfo } from '@/lib/theme';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const u = await getUser();
  if (u) redirect(homeFor(u));
  const { err } = await searchParams;
  const e = await enterpriseInfo();
  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ background: 'var(--header-bg)' }}>
      <form action={login} className="card w-full max-w-sm space-y-4">
        <div className="text-center">
          {e?.has_logo && <img src="/api/logo" alt="" className="mx-auto mb-2 h-16" />}
          <h1 className="text-xl font-bold">{e?.name ?? 'Silambam ERP'}</h1>
          <p className="muted">Sign in to continue</p>
        </div>
        {err && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
        <label className="block"><span className="label">Username</span><input name="username" className="input" autoComplete="username" required autoFocus /></label>
        <label className="block"><span className="label">Password</span><input name="password" type="password" className="input" autoComplete="current-password" required /></label>
        <button className="btn btn-primary w-full">Sign in</button>
      </form>
    </div>
  );
}
