'use client';
import { useEffect, useState } from 'react';

const clean = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Shows the user name a new staff login will get (Configuration › User Name Rules). */
export function UsernamePreview({ method, separator }: { method: string; separator: string }) {
  const [v, setV] = useState({ first: '', last: '', email: '' });
  useEffect(() => {
    const get = (n: string) => document.querySelector<HTMLInputElement>(`[name="${n}"]`);
    const sync = () => setV({ first: get('first_name')?.value ?? '', last: get('last_name')?.value ?? '', email: get('email')?.value ?? '' });
    sync();
    const els = ['first_name', 'last_name', 'email'].map(get).filter(Boolean) as HTMLInputElement[];
    els.forEach((e) => e.addEventListener('input', sync));
    return () => els.forEach((e) => e.removeEventListener('input', sync));
  }, []);
  const text = method === 'STAFF_NUMBER' ? 'Same as the staff number'
    : method === 'EMAIL' ? (v.email.trim().toLowerCase() || 'Email id (fill in Email above)')
    : ([clean(v.first), clean(v.last)].filter(Boolean).join(separator) || 'first' + separator + 'last');
  return <input value={text} readOnly className="input bg-slate-50 font-mono" title="From Configuration › User Name Rules" />;
}

/**
 * Username box on Users › New User: when a staff / student number is linked the
 * user name is generated (User Name Rules), so the box is locked; parents type it.
 */
export function UsernameField() {
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    const p = document.querySelector<HTMLInputElement>('[name="person_number"]');
    const sync = () => setLinked(!!p?.value.trim());
    sync();
    p?.addEventListener('input', sync);
    return () => p?.removeEventListener('input', sync);
  }, []);
  return linked
    ? <input value="Set automatically from User Name Rules" readOnly className="input bg-slate-50 text-slate-500" />
    : <input name="username" required className="input lowercase" placeholder="e.g. parent's mobile number" autoComplete="off" />;
}
