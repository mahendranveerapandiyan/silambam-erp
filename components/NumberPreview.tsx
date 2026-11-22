'use client';
import { useEffect, useState } from 'react';
import type { NumberPreviews } from '@/lib/numbering';

function fmt(rule: NonNullable<NumberPreviews>['rule'], n: number, scopeCode: string | null, year: string) {
  const parts = [rule.prefix, rule.include_scope_code_flag === 'Y' && rule.scope_code !== 'ENTERPRISE' ? scopeCode : null,
    rule.include_year_flag === 'Y' ? year : null, String(n).padStart(rule.padding || 1, '0'), rule.suffix].filter((p) => p !== null && p !== undefined && p !== '');
  return parts.join(rule.separator ?? '');
}

/** Shows the auto-generated number the new student / staff member will get, for the chosen branch and date. */
export function NumberPreview({ previews, watch, dateField }: { previews: NumberPreviews; watch: string; dateField: string }) {
  const [bu, setBu] = useState('');
  const [date, setDate] = useState('');
  useEffect(() => {
    const el = document.querySelector<HTMLSelectElement>(`select[name="${watch}"]`);
    const d = document.querySelector<HTMLInputElement>(`[name="${dateField}"]`);
    const sync = () => { setBu(el?.value ?? ''); setDate(d?.value ?? ''); };
    sync();
    el?.addEventListener('change', sync); d?.addEventListener('change', sync); d?.addEventListener('input', sync);
    return () => { el?.removeEventListener('change', sync); d?.removeEventListener('change', sync); d?.removeEventListener('input', sync); };
  }, [watch, dateField]);
  let text = 'Auto-generated';
  if (previews) {
    const r = previews.rule;
    const scope = r.scope_code === 'ENTERPRISE' ? '0' : previews.buToScope[bu];
    if (!scope) text = 'Choose the branch to see the number';
    else {
      const year = (date || new Date().toISOString()).slice(0, 4);
      const last = previews.counters[`${scope}|${r.reset_yearly_flag === 'Y' ? year : 'ALL'}`];
      text = fmt(r, last === undefined ? r.start_number : last + 1, previews.scopeCodes[scope] ?? null, year);
    }
  }
  return <input value={text} readOnly className="input bg-slate-50 font-mono" title="Final number is assigned when you save" />;
}
