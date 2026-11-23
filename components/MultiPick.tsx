'use client';
import { useMemo, useState } from 'react';

type Opt = { value: string; label: string; code?: string | null };

/**
 * Searchable multi-select: type to filter by name or code, tick any number of
 * values. Each chosen value is submitted as a hidden input named `name`.
 */
export function MultiPick({ name, options, placeholder = 'Search by code or name…', emptyText = 'None chosen – all' }: { name: string; options: Opt[]; placeholder?: string; emptyText?: string }) {
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle) || (o.code ?? '').toLowerCase().includes(needle)) : options;
  const toggle = (v: string) => setChosen((c) => (c.includes(v) ? c.filter((x) => x !== v) : [...c, v]));
  const allShownChosen = shown.length > 0 && shown.every((o) => chosen.includes(o.value));
  return (
    <div className="rounded-md border border-black/15 bg-white">
      {chosen.map((v) => <input key={v} type="hidden" name={name} value={v} />)}
      <div className="flex flex-wrap items-center gap-1 border-b border-black/10 p-2">
        {chosen.length === 0 && <span className="text-sm text-slate-500">{emptyText}</span>}
        {chosen.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800">
            {byValue.get(v)?.label ?? v}{byValue.get(v)?.code && <span className="font-mono text-[10px] text-slate-500">{byValue.get(v)?.code}</span>}
            <button type="button" aria-label="Remove" className="ml-0.5 text-slate-500 hover:text-red-600" onClick={() => toggle(v)}>×</button>
          </span>
        ))}
        {chosen.length > 0 && <button type="button" className="ml-auto text-xs text-slate-500 hover:text-red-600" onClick={() => setChosen([])}>Clear all</button>}
      </div>
      <div className="flex items-center gap-2 p-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="input" aria-label="Search" />
        <button type="button" className="btn btn-sm whitespace-nowrap" disabled={!shown.length}
          onClick={() => setChosen((c) => (allShownChosen ? c.filter((v) => !shown.some((o) => o.value === v)) : [...new Set([...c, ...shown.map((o) => o.value)])]))}>
          {allShownChosen ? 'Untick shown' : `Tick shown (${shown.length})`}
        </button>
      </div>
      <ul className="max-h-56 overflow-y-auto px-1 pb-1">
        {shown.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-sky-50">
              <input type="checkbox" checked={chosen.includes(o.value)} onChange={() => toggle(o.value)} />
              <span className="min-w-0 flex-1">{o.label}</span>
              {o.code && <span className="lov-code" title={o.code}>{o.code}</span>}
            </label>
          </li>
        ))}
        {!shown.length && <li className="px-2 py-1 text-sm text-slate-500">No match for “{q}”</li>}
      </ul>
    </div>
  );
}
