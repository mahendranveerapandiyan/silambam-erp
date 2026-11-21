'use client';
import { useEffect, useState } from 'react';
import { countryAllowed } from '@/lib/countryRule';

export type EmployerWatch = { leField?: string; buField: string; leCountry: Record<string, string>; buCountry: Record<string, string> };

/**
 * Identification type select: only types offered for the legal employer's
 * country (Identification Type tag). On the hire page the country follows the
 * chosen legal employer / branch; on a profile it is fixed.
 */
export function IdTypeSelect({ name, options, value, required, fixedCountry, watch, countryNames }: {
  name: string; options: { value: string; label: string; rule: string | null }[]; value?: string | null; required?: boolean;
  fixedCountry?: string | null; watch?: EmployerWatch; countryNames: Record<string, string>;
}) {
  const [country, setCountry] = useState<string | null>(fixedCountry ?? null);
  const [sel, setSel] = useState(value ?? '');
  useEffect(() => {
    if (!watch) return;
    const le = watch.leField ? document.querySelector<HTMLSelectElement>(`select[name="${watch.leField}"]`) : null;
    const bu = document.querySelector<HTMLSelectElement>(`select[name="${watch.buField}"]`);
    const sync = () => setCountry((le?.value && watch.leCountry[le.value]) || (bu?.value && watch.buCountry[bu.value]) || null);
    sync();
    le?.addEventListener('change', sync); bu?.addEventListener('change', sync);
    return () => { le?.removeEventListener('change', sync); bu?.removeEventListener('change', sync); };
  }, [watch]);
  const visible = options.filter((o) => countryAllowed(o.rule, country));
  const ok = !sel || visible.some((o) => o.value === sel);
  return (
    <>
      <select name={name} value={ok ? sel : ''} onChange={(e) => setSel(e.target.value)} required={required} className="input">
        <option value="">— Select —</option>
        {visible.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="mt-0.5 block text-xs text-gray-500">
        {country ? `Types for ${countryNames[country] ?? country} (legal employer)` : watch ? 'Choose the legal employer / branch to narrow the list' : ''}
      </span>
      {!ok && <span className="block text-xs text-amber-700">Not used in this country – choose another type.</span>}
    </>
  );
}
