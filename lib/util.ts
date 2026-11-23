import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { friendlyError } from './db';

export function todayISO(tz = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function addDays(d: string, n: number) {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
export function addMonths(d: string, n: number) {
  const x = new Date(d + 'T00:00:00Z');
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x.toISOString().slice(0, 10);
}
export function fmtDate(d?: string | null) {
  if (!d) return '';
  if (d === '4712-12-31') return '—';
  const [y, m, dd] = d.slice(0, 10).split('-');
  return `${dd}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]}-${y}`;
}
export function fmtDateTime(d?: string | Date | null) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}
export function money(n: number | string | null | undefined, sym = '₹') {
  const v = Number(n || 0);
  return `${sym}${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
export function ageOn(dob: string | null | undefined, on: string) {
  if (!dob) return null;
  const [y1, m1, d1] = dob.split('-').map(Number);
  const [y2, m2, d2] = on.split('-').map(Number);
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
}

/** FormData -> plain object of trimmed strings ('' becomes null). */
export function formObj(fd: FormData): Record<string, string | null> {
  const o: Record<string, string | null> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== 'string' || k.startsWith('$ACTION')) continue;
    const t = v.trim();
    o[k] = t === '' ? null : t;
  }
  return o;
}
export function req(o: Record<string, string | null>, ...keys: string[]) {
  for (const k of keys) if (!o[k]) throw new Error(`${k.replace(/_id$|_code$/, '').replace(/_/g, ' ')} is required`);
}

function withParam(url: string, k: string, v: string) {
  // keep a #fragment at the end (e.g. /fees/generate?x=1#installments)
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const [p, q = ''] = (hashAt >= 0 ? url.slice(0, hashAt) : url).split('?');
  const sp = new URLSearchParams(q);
  sp.delete('ok');
  sp.delete('err');
  sp.set(k, v);
  return `${p}?${sp.toString()}${hash}`;
}

/**
 * Standard server-action wrapper: runs fn, then redirects back with ?ok=
 * or ?err= so the page can show a banner. fn may return a different
 * destination path, or { to, msg }.
 */
export async function act(back: string, fn: () => Promise<void | string | { to?: string; msg?: string }>) {
  let dest: string;
  try {
    const r = await fn();
    const to = typeof r === 'string' ? r : r?.to;
    const msg = (typeof r === 'object' && r?.msg) || 'Saved successfully';
    dest = withParam(to || back, 'ok', msg);
  } catch (e) {
    unstable_rethrow(e);
    console.error(e);
    dest = withParam(back, 'err', friendlyError(e));
  }
  revalidatePath('/', 'layout');
  redirect(dest);
}

export function backOf(fd: FormData, fallback = '/') {
  const b = fd.get('_back');
  return typeof b === 'string' && b.startsWith('/') ? b : fallback;
}

export async function fileToBytes(f: FormDataEntryValue | null, maxBytes = 2_000_000) {
  if (!f || typeof f === 'string' || f.size === 0) return null;
  if (f.size > maxBytes) throw new Error(`File too large (max ${Math.round(maxBytes / 1e6)} MB)`);
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) throw new Error('Only PNG, JPG, WEBP or GIF images are allowed');
  return { mime: f.type, data: Buffer.from(await f.arrayBuffer()) };
}
