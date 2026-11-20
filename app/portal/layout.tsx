import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { enterpriseInfo } from '@/lib/theme';
import { logout } from '../actions';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const ent = await enterpriseInfo(u.enterpriseId);
  return (
    <div className="min-h-screen">
      <header className="flex h-12 items-center gap-3 px-4 no-print" style={{ background: 'var(--header-bg)', color: 'var(--header-text)' }}>
        <Link href="/portal" className="font-semibold">{ent?.short_name || ent?.name} · Portal</Link>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link href="/portal/account" className="hover:underline">{u.displayName}</Link>
          <form action={logout}><button className="rounded px-2 py-1 hover:bg-white/10">Logout</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}
