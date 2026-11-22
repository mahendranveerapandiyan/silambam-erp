import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, can } from '@/lib/auth';
import { menuFor } from '@/lib/menu';
import { enterpriseInfo } from '@/lib/theme';
import { NavLinks } from '@/components/NavLinks';
import { logout } from '../actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  // portal-only users (parents / students) use the separate portal layout
  if (!can(u, 'CD_DASHBOARD_PRV') && !can(u, 'CD_MY_PROFILE_PRV') && can(u, 'CD_PORTAL_PRV')) redirect('/portal');
  const ent = await enterpriseInfo(u.enterpriseId);
  const menu = menuFor(u.privs);
  return (
    <div className="min-h-screen">
      <input id="nav" type="checkbox" className="peer hidden" />
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 px-3 no-print" style={{ background: 'var(--header-bg)', color: 'var(--header-text)' }}>
        <label htmlFor="nav" className="cursor-pointer rounded px-2 py-1 text-lg hover:bg-white/10 lg:hidden" aria-label="Menu">☰</label>
        <Link href="/" className="flex items-center gap-2 font-semibold">
          {ent?.has_logo && <img src="/api/logo" alt="" className="h-8 w-8 rounded object-contain bg-white" />}
          <span className="truncate">{ent?.short_name || ent?.name}</span>
          <span className="hidden rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-bold tracking-tight sm:inline">caMpus dAy</span>
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/account" className="hidden text-sm opacity-90 hover:underline sm:inline">{u.displayName}</Link>
          <form action={logout}><button className="rounded px-2 py-1 text-sm hover:bg-white/10">Logout</button></form>
        </div>
      </header>
      <aside className="fixed bottom-0 left-0 top-12 z-20 hidden w-60 overflow-y-auto pb-8 peer-checked:block lg:block no-print"
        style={{ background: 'var(--sidebar-bg)', color: 'var(--sidebar-text)' }}>
        <NavLinks menu={menu} />
      </aside>
      <main className="p-4 lg:ml-60 lg:p-6">
        {u.mustChangePassword && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 no-print">
            You are using a temporary password. <Link href="/account" className="link">Change it now</Link>.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
