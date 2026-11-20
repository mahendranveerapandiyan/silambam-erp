'use client';
import { useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { setAsOf } from '@/app/actions';

export function AsOfPicker({ value, today }: { value: string; today: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  const form = useRef<HTMLFormElement>(null);
  const q = new URLSearchParams(sp.toString());
  q.delete('ok');
  q.delete('err');
  const back = q.toString() ? `${path}?${q}` : path;
  return (
    <form ref={form} action={setAsOf} className="flex items-center gap-1.5 text-sm">
      <input type="hidden" name="_back" value={back} />
      <span className="hidden opacity-80 sm:inline">As of</span>
      <input type="date" name="asof" defaultValue={value} onChange={() => form.current?.requestSubmit()}
        className={`rounded border px-1.5 py-0.5 text-sm text-gray-900 ${value !== today ? 'border-yellow-300 bg-yellow-100' : 'border-white/30 bg-white'}`} />
      {value !== today && (
        <button name="asof" value="" className="rounded bg-white/20 px-1.5 py-0.5 text-xs hover:bg-white/30" title="Reset to today">Today</button>
      )}
    </form>
  );
}
