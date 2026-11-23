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
    <div className="flex min-h-screen items-center justify-center p-4" style={{ background: 'radial-gradient(circle at 80% 10%, var(--accent-color) 0%, transparent 45%), var(--sidebar-bg)' }}>
      <form action={login} className="card w-full max-w-sm space-y-4 p-8">
        <div className="text-center">
          {e?.logo_url && <img src={e.logo_url} alt="" className="mx-auto mb-2 h-16" />}
          <div className="mb-1 text-3xl font-extrabold tracking-tight text-slate-900">ca<span style={{ color: 'var(--accent-color)' }}>M</span>pus d<span style={{ color: 'var(--accent-color)' }}>A</span>y</div>
          {e?.name && <h1 className="text-base font-semibold">{e.name}</h1>}
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
