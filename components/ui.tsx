import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Opt } from '@/lib/lookups';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="h1">{title}</h1>
        {subtitle && <div className="muted mt-0.5">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
    </div>
  );
}

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === 'string' ? sp.ok : null;
  const err = typeof sp.err === 'string' ? sp.err : null;
  if (!ok && !err) return null;
  return (
    <div className={`mb-4 rounded-md border px-3 py-2 text-sm no-print ${err ? 'border-red-300 bg-red-50 text-red-800' : 'border-green-300 bg-green-50 text-green-800'}`}>
      {err ?? ok}
    </div>
  );
}

export function Field({ label, children, help, className = '' }: { label: string; children: ReactNode; help?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {help && <span className="mt-0.5 block text-xs text-gray-500">{help}</span>}
    </label>
  );
}

export function Select({
  name, options, value, required, empty = '— Select —', disabled, id, className = 'input',
}: { name: string; options: Opt[]; value?: string | null; required?: boolean; empty?: string | false; disabled?: boolean; id?: string; className?: string }) {
  return (
    <select name={name} id={id} defaultValue={value ?? ''} required={required} disabled={disabled} className={className}>
      {empty !== false && <option value="">{empty}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} data-parent={o.parent ?? ''}>
          {o.label}
          {o.inactive ? ' (inactive)' : ''}
        </option>
      ))}
    </select>
  );
}

const tone: Record<string, string> = {
  green: 'bg-green-100 text-green-800', red: 'bg-red-100 text-red-800', amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-800', gray: 'bg-gray-100 text-gray-700', purple: 'bg-purple-100 text-purple-800',
};
export function Badge({ children, color = 'gray' }: { children: ReactNode; color?: keyof typeof tone | string }) {
  return <span className={`badge ${tone[color] ?? tone.gray}`}>{children}</span>;
}

export const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'green', SUSPENDED: 'amber', INACTIVE: 'red',
  PAID: 'green', UNPAID: 'red', PARTIAL: 'amber', FULL_EXEMPT: 'purple', PARTIAL_EXEMPT: 'blue', CANCELLED: 'gray',
  PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', PASS: 'green', FAIL: 'red', ABSENT: 'gray',
  P: 'green', L: 'amber', A: 'red', LV: 'blue', HD: 'amber', H: 'gray',
};

export function Stat({ label, value, sub, href }: { label: string; value: ReactNode; sub?: ReactNode; href?: string }) {
  const body = (
    <div className="card h-full">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="muted mt-0.5">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export function Empty({ children = 'No records found.' }: { children?: ReactNode }) {
  return <div className="py-6 text-center text-sm text-gray-500">{children}</div>;
}

export function Tabs({ tabs, active, base }: { tabs: [string, string][]; active: string; base: string }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-black/10 no-print">
      {tabs.map(([k, l]) => (
        <Link key={k} href={`${base}${base.includes('?') ? '&' : '?'}tab=${k}`}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${active === k ? 'border-[var(--primary-color)] text-[var(--primary-color)]' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          {l}
        </Link>
      ))}
    </div>
  );
}

/** Hidden "return to" field used by the act() action wrapper. */
export function Back({ to }: { to: string }) {
  return <input type="hidden" name="_back" value={to} />;
}

/** Build the current path with query (minus flash params) for _back. */
export function here(path: string, sp: Record<string, string | string[] | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && k !== 'ok' && k !== 'err') q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export type SP = Promise<Record<string, string | string[] | undefined>>;
export const s = (v: string | string[] | undefined) => (typeof v === 'string' && v !== '' ? v : null);
