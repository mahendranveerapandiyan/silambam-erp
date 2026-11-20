'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { MenuGroup } from '@/lib/menu';

export function NavLinks({ menu }: { menu: MenuGroup[] }) {
  const path = usePathname();
  const all = menu.flatMap((g) => g.items.map((i) => i.href));
  const best = all.filter((h) => (h === '/' ? path === '/' : path === h || path.startsWith(h + '/'))).sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === best;
  return (
    <nav className="py-2 text-sm">
      {menu.map((g) => {
        const open = g.items.some((i) => isActive(i.href));
        return (
          <details key={g.label} open={open || g.label === 'Home'} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2 text-xs font-bold uppercase tracking-wider opacity-70 hover:opacity-100">
              {g.label}<span className="transition group-open:rotate-90">›</span>
            </summary>
            {g.items.map((i) => (
              <Link key={i.href} href={i.href}
                onClick={() => { const n = document.getElementById('nav') as HTMLInputElement | null; if (n) n.checked = false; }}
                className={`block border-l-2 py-1.5 pl-6 pr-3 ${isActive(i.href) ? 'border-[var(--primary-color)] bg-white/10 font-semibold' : 'border-transparent opacity-85 hover:bg-white/5'}`}>
                {i.label}
              </Link>
            ))}
          </details>
        );
      })}
    </nav>
  );
}
