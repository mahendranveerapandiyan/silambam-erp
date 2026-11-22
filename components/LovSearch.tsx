'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Item = { value: string; label: string; code: string; group: string; index: number };

const setSelectValue = (sel: HTMLSelectElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, v);
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
};

/** Plain placeholder entries such as "— Select —" have no code and an empty value. */
function readItems(sel: HTMLSelectElement): Item[] {
  return Array.from(sel.options).filter((o) => !o.hidden).map((o, index) => ({
    value: o.value, label: o.text, code: o.dataset.code ?? '',
    group: o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : '', index,
  }));
}

/**
 * Makes every drop-down (list of values) in the app searchable: clicking a
 * select – or pressing Enter / Space / ↓ on it – opens a list showing each
 * value with its code, filtered as you type by code or name. The original
 * <select> stays the form field, so validation, read-only mode and dependent
 * lists keep working. Phones keep their native picker.
 */
export function LovSearch() {
  const [sel, setSel] = useState<HTMLSelectElement | null>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number; up: boolean }>({ left: 0, top: 0, width: 0, maxH: 300, up: false });
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const close = useCallback((refocus = true) => { setSel((s) => { if (s && refocus) s.focus(); return null; }); setQ(''); }, []);

  /** Place the list under (or above) the select; false when the select is off screen. */
  const place = useCallback((s: HTMLSelectElement) => {
    const r = s.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return false;
    const below = window.innerHeight - r.bottom - 8;
    const up = below < 220 && r.top > below;
    // a little wider than the field when there is room, so long names and codes fit
    const width = Math.min(Math.max(r.width, 340), 520, window.innerWidth - 16);
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: up ? r.top - 4 : r.bottom + 4, width, maxH: Math.min(360, (up ? r.top : below) - 8), up });
    return true;
  }, []);

  const open = useCallback((s: HTMLSelectElement) => {
    place(s);
    setQ('');
    const items = readItems(s);
    setActive(Math.max(0, items.findIndex((i) => i.value === s.value)));
    setSel(s);
  }, [place]);

  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const usable = (t: EventTarget | null) => {
      const s = t instanceof HTMLSelectElement ? t : null;
      return s && !s.multiple && !s.matches(':disabled') && !s.dataset.native && s.size <= 1 ? s : null;
    };
    const onDown = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node)) return;
      const s = !coarse && e.button === 0 ? usable(e.target) : null;
      if (s) { e.preventDefault(); s.focus({ preventScroll: true }); open(s); return; }
      setSel((cur) => (cur ? null : cur));
    };
    const onKey = (e: KeyboardEvent) => {
      const s = usable(e.target);
      if (!s || coarse) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'F4' || (e.key === 'ArrowDown' && e.altKey) || (e.key === 'ArrowDown' && !e.ctrlKey)) {
        // Enter on a select inside a form would otherwise do nothing useful
        e.preventDefault(); open(s);
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  useEffect(() => {
    if (!sel) return;
    // the list follows the select when the page scrolls; it closes once the select leaves the screen
    const follow = (e: Event) => { if (panel.current?.contains(e.target as Node)) return; if (!place(sel)) close(false); };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => { window.removeEventListener('scroll', follow, true); window.removeEventListener('resize', follow); };
  }, [sel, close, place]);

  useLayoutEffect(() => { if (sel) input.current?.focus(); }, [sel]);

  const items = sel ? readItems(sel) : [];
  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter((i) => i.value !== '' && (i.label.toLowerCase().includes(needle) || i.code.toLowerCase().includes(needle))) : items;
  const act = Math.min(active, Math.max(0, shown.length - 1));

  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${act}"]`)?.scrollIntoView({ block: 'nearest' }); }, [act, sel, q]);

  if (!sel) return null;
  const pick = (it: Item | undefined) => { if (!it) return; const s = sel; close(); setSelectValue(s, it.value); };
  const withSearch = items.length > 1;

  return createPortal(
    <div ref={panel} role="dialog" className="lov-panel" style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}>
      {withSearch && (
        <input ref={input} value={q} placeholder="Search by code or name…" className="lov-search" aria-label="Search"
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(shown[act]); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
            else if (e.key === 'Tab') close();
          }} />
      )}
      <ul ref={list} role="listbox" className="lov-list" style={{ maxHeight: pos.maxH - (withSearch ? 44 : 0) }}>
        {shown.map((it, i) => (
          <li key={`${it.index}`} data-i={i} role="option" aria-selected={it.value === sel.value}
            className={`lov-item ${i === act ? 'lov-active' : ''} ${it.value === sel.value ? 'lov-selected' : ''} ${it.value === '' ? 'lov-empty' : ''}`}
            onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(it); }}>
            <span className="lov-label">{it.group && <span className="lov-group">{it.group} · </span>}{it.label}</span>
            {it.code && it.code !== it.label && <span className="lov-code" title={it.code}>{it.code}</span>}
          </li>
        ))}
        {!shown.length && <li className="lov-none">No match for “{q}”</li>}
      </ul>
    </div>,
    document.body,
  );
}
