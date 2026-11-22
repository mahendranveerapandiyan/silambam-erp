'use client';
import { useEffect, useRef, useState } from 'react';

/** Filters a child <select> by the value of a parent <select> (option data-parent). */
export function Cascade({ parent, child }: { parent: string; child: string }) {
  useEffect(() => {
    const p = document.querySelector<HTMLSelectElement>(`select[name="${parent}"]`);
    const c = document.querySelector<HTMLSelectElement>(`select[name="${child}"]`);
    if (!p || !c) return;
    const apply = (reset: boolean) => {
      for (const o of Array.from(c.options)) {
        if (!o.value) continue;
        const ok = !p.value || !o.dataset.parent || o.dataset.parent === p.value;
        o.hidden = !ok;
        o.disabled = !ok;
        if (!ok && o.selected && reset) c.value = '';
      }
    };
    apply(false);
    const h = () => apply(true);
    p.addEventListener('change', h);
    return () => p.removeEventListener('change', h);
  }, [parent, child]);
  return null;
}

/** Submits its form as soon as a field changes (filters, as-of date). */
export function AutoSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const h = () => form.requestSubmit();
    form.addEventListener('change', h);
    return () => form.removeEventListener('change', h);
  }, []);
  return <span ref={ref} hidden />;
}

export function ConfirmButton({ children, message, className = 'btn', name, value }: { children: React.ReactNode; message: string; className?: string; name?: string; value?: string }) {
  return (
    <button type="submit" name={name} value={value} className={className} data-confirm={message}>
      {children}
    </button>
  );
}

export function PrintButton() {
  return <button type="button" className="btn no-print" onClick={() => window.print()}>Print</button>;
}

/** Shows/hides elements depending on a select value: rows with data-show-for="A,B". */
export function ShowFor({ select }: { select: string }) {
  useEffect(() => {
    const el = document.querySelector<HTMLSelectElement>(`select[name="${select}"]`);
    if (!el) return;
    const apply = () => {
      document.querySelectorAll<HTMLElement>(`[data-show-for-${select}]`).forEach((n) => {
        const list = (n.getAttribute(`data-show-for-${select}`) || '').split(',');
        const show = list.includes(el.value);
        n.style.display = show ? '' : 'none';
        // hidden inputs are disabled so they are neither validated nor submitted
        n.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea').forEach((i) => (i.disabled = !show));
      });
    };
    apply();
    el.addEventListener('change', apply);
    return () => el.removeEventListener('change', apply);
  }, [select]);
  return null;
}

export function CheckAll({ name }: { name: string }) {
  const [on, setOn] = useState(false);
  return (
    <input type="checkbox" checked={on} title="Select all"
      onChange={(e) => {
        setOn(e.target.checked);
        document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]:not(:disabled)`).forEach((c) => (c.checked = e.target.checked));
      }} />
  );
}
