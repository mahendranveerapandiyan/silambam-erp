'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { MenuGroup } from '@/lib/menu';
import { Icon, GROUP_ICON } from './icons';

export function NavLinks({ menu }: { menu: MenuGroup[] }) {
  const path = usePathname();
  const all = menu.flatMap((g) => g.items.map((i) => i.href));
  const best = all.filter((h) => (h === '/' ? path === '/' : path === h || path.startsWith(h + '/'))).sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === best;
  const close = () => { const n = document.getElementById('nav') as HTMLInputElement | null; if (n) n.checked = false; };
  return (
    <nav className="space-y-1 px-3 pb-6 text-sm">
      {menu.map((g) => {
        const open = g.items.some((i) => isActive(i.href));
        return (
          <details key={g.label} open={open || g.label === 'Home'} className="group">
            <summary className={`flex cursor-pointer list-none items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/5 ${open ? 'text-white' : 'text-slate-300'}`}>
              <span className={open ? 'text-[var(--accent-color)]' : 'text-slate-400'}><Icon name={GROUP_ICON[g.label] ?? 'home'} /></span>
              <span className="flex-1 font-medium">{g.label}</span>
              <span className="text-slate-500 transition group-open:rotate-90"><Icon name="chevron" className="h-4 w-4" /></span>
            </summary>
            <div className="mb-1 ml-5 mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} onClick={close}
                  className={`block rounded-lg px-3 py-1.5 transition ${isActive(i.href) ? 'bg-[var(--accent-color)] font-semibold text-white shadow-[0_4px_14px_rgba(14,165,233,0.35)]' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
                  {i.label}
                </Link>
              ))}
            </div>
          </details>
        );
      })}
    </nav>
  );
}
