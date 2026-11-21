'use client';
import { useEffect, useRef, useState } from 'react';

export type DatedOpt = { value: string; label: string; start: string; end: string; parent?: string | null; inactive?: boolean };

const valOf = (name?: string) =>
  name ? (document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)?.value ?? '') : '';

/**
 * Select whose options depend on a date field in the same form: only records
 * effective on that date are offered, labelled with their name on that date.
 * Optionally filtered by a parent select (e.g. State by Country).
 */
export function DatedSelect({
  name, options, dateField, value, required, empty = '— Select —', parentField, disabled, className = 'input',
}: { name: string; options: DatedOpt[]; dateField: string; value?: string | null; required?: boolean; empty?: string | false; parentField?: string; disabled?: boolean; className?: string }) {
  const [date, setDate] = useState<string>('');
  const [parent, setParent] = useState<string>('');
  const [sel, setSel] = useState<string>(value ?? '');
  const ref = useRef<HTMLSelectElement>(null);
  // other components (e.g. position autofill) can set the value: el.dispatchEvent(new CustomEvent('cd:set', { detail: v }))
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: Event) => {
      setSel(String((e as CustomEvent).detail ?? ''));
      setTimeout(() => el.dispatchEvent(new Event('change', { bubbles: true })), 0);
    };
    el.addEventListener('cd:set', h);
    return () => el.removeEventListener('cd:set', h);
  }, []);

  useEffect(() => {
    const d = document.querySelector<HTMLInputElement>(`[name="${dateField}"]`);
    const p = parentField ? document.querySelector<HTMLSelectElement>(`[name="${parentField}"]`) : null;
    const sync = () => { setDate(valOf(dateField)); setParent(valOf(parentField)); };
    sync();
    d?.addEventListener('input', sync); d?.addEventListener('change', sync);
    p?.addEventListener('change', sync);
    return () => { d?.removeEventListener('input', sync); d?.removeEventListener('change', sync); p?.removeEventListener('change', sync); };
  }, [dateField, parentField]);

  const visible: DatedOpt[] = [];
  const seen = new Set<string>();
  for (const o of options) {
    if (seen.has(o.value)) continue;
    if (date && (date < o.start || date > o.end)) continue;
    if (parentField && parent && o.parent && o.parent !== parent) continue;
    seen.add(o.value);
    visible.push(o);
  }
  const missing = sel && !visible.some((o) => o.value === sel);
  const missingLabel = missing ? options.find((o) => o.value === sel)?.label : null;

  return (
    <>
      <select ref={ref} name={name} value={missing ? '' : sel} onChange={(e) => setSel(e.target.value)} required={required} disabled={disabled} className={className}>
        {empty !== false && <option value="">{empty}</option>}
        {visible.map((o) => <option key={o.value} value={o.value} data-parent={o.parent ?? ''}>{o.label}{o.inactive ? ' (inactive)' : ''}</option>)}
      </select>
      {missing && <span className="mt-0.5 block text-xs text-amber-700">“{missingLabel ?? sel}” is not effective on {date || 'this date'} – choose another.</span>}
    </>
  );
}
