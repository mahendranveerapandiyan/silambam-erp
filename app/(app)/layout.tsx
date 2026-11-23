import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { menuFor } from '@/lib/menu';
import { enterpriseInfo } from '@/lib/theme';
import { NavLinks } from '@/components/NavLinks';
import { Icon } from '@/components/icons';
import { logout } from '../actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  // portal-only users (parents / students) use the separate portal layout
  if (!can(u, 'CD_DASHBOARD_PRV') && !can(u, 'CD_MY_PROFILE_PRV') && can(u, 'CD_PORTAL_PRV')) redirect('/portal');
  const ent = await enterpriseInfo(u.enterpriseId);
  const menu = menuFor(u.privs);
  const [photo] = u.personId ? await sql`select 1 from person_photo where person_id = ${u.personId}` : [];
  const roles = u.roles.length ? (await sql`select string_agg(name, ' · ' order by name) n from app_role where code in ${sql(u.roles)}`)[0]?.n : '';
  const initials = u.displayName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="min-h-screen">
      <input id="nav" type="checkbox" className="peer hidden" />
      {/* sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col overflow-y-auto peer-checked:flex lg:flex no-print" style={{ background: 'var(--sidebar-bg)', color: 'var(--sidebar-text)' }}>
        <Link href="/" className="flex items-center gap-2 px-6 pb-2 pt-5">
          <span className="text-lg font-extrabold tracking-tight text-white">ca<span className="text-[var(--accent-color)]">M</span>pus d<span className="text-[var(--accent-color)]">A</span>y</span>
        </Link>
        <div className="flex flex-col items-center px-6 pb-6 pt-4 text-center">
          <div className="rounded-full p-1 ring-2 ring-[var(--accent-color)]/70">
            {photo ? <img src={`/api/photo/${u.personId}`} alt="" className="h-20 w-20 rounded-full object-cover" />
              : <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-2xl font-bold text-slate-900">{initials}</div>}
          </div>
          <div className="mt-3 text-base font-semibold uppercase tracking-wide text-white">{u.displayName}</div>
          <div className="text-xs text-slate-400">{u.username}{roles ? ` · ${roles}` : ''}</div>
        </div>
        <NavLinks menu={menu} />
      </aside>
      <label htmlFor="nav" className="fixed inset-0 z-30 hidden bg-black/40 peer-checked:block lg:!hidden" aria-hidden="true" />
      {/* page */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/70 px-4 backdrop-blur no-print lg:px-8" style={{ background: 'color-mix(in srgb, var(--header-bg) 90%, transparent)', color: 'var(--header-text)' }}>
          <label htmlFor="nav" className="cursor-pointer rounded-lg p-2 hover:bg-slate-100 lg:hidden" aria-label="Menu"><Icon name="menu" /></label>
          <Link href="/" className="flex min-w-0 items-center gap-2">
            {ent?.logo_url && <img src={ent.logo_url} alt="" className="h-9 w-9 rounded-lg object-contain" />}
            <span className="truncate text-lg font-semibold">{ent?.short_name || ent?.name}</span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/account" className="hidden rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 sm:block">My Account</Link>
            <form action={logout}><button className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100" title="Logout"><Icon name="logout" className="h-4 w-4" /><span className="hidden sm:inline">Logout</span></button></form>
          </div>
        </header>
        <main className="p-4 lg:p-8">
          {u.mustChangePassword && (
            <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 no-print">
              You are using a temporary password. <Link href="/account" className="link">Change it now</Link>.
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
