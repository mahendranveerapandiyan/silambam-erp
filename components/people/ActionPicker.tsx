'use client';
import { useEffect, useState } from 'react';
import { DatedSelect, type DatedOpt } from '../DatedSelect';
import { Field } from '../ui';

type Version = { start: string; end: string; action_id: string | null; action_reason_code: string | null; first: boolean };

/**
 * Action + reason for an assignment change.
 *  • Update: any non-hire action.
 *  • Correct the first version: it is the hire / admission, so the action stays the hire action.
 *  • Correct a later version: defaults to that version's own action.
 */
export function ActionPicker({ other, otherReasons, hire, hireReasons, versions, initialDate }: {
  other: DatedOpt[]; otherReasons: DatedOpt[]; hire: DatedOpt[]; hireReasons: DatedOpt[]; versions: Version[]; initialDate: string;
}) {
  const [mode, setMode] = useState('UPDATE');
  const [date, setDate] = useState(initialDate);
  useEffect(() => {
    const m = document.querySelector<HTMLSelectElement>('select[name="mode"]');
    const d = document.querySelector<HTMLInputElement>('input[name="effective_date"]');
    const sync = () => { setMode(m?.value ?? 'UPDATE'); setDate(d?.value ?? ''); };
    sync();
    m?.addEventListener('change', sync); d?.addEventListener('input', sync); d?.addEventListener('change', sync);
    return () => { m?.removeEventListener('change', sync); d?.removeEventListener('input', sync); d?.removeEventListener('change', sync); };
  }, []);
  const v = mode === 'CORRECT' ? versions.find((x) => date >= x.start && date <= x.end) : undefined;
  if (v?.first) {
    const act = hire.find((h) => h.value === v.action_id) ?? hire[0];
    return (
      <>
        <Field label="Action *" help="Correcting the first version – it stays the hire / admission action">
          <input value={act?.label ?? 'Hire'} readOnly className="input bg-slate-50" />
          <input type="hidden" name="action_id" value={act?.value ?? ''} />
        </Field>
        <Field label="Action Reason">
          <DatedSelect key={`r-hire-${act?.value}`} name="action_reason_code" options={hireReasons.filter((r) => r.parent === act?.value)} dateField="effective_date" value={v.action_reason_code ?? ''} />
        </Field>
      </>
    );
  }
  const keep = v && other.some((o) => o.value === v.action_id) ? v : undefined;
  return (
    <>
      <Field label="Action *" help={keep ? 'Correcting – defaults to this version’s action' : undefined}>
        <DatedSelect key={`a-${keep?.start ?? 'new'}`} name="action_id" options={other} dateField="effective_date" value={keep?.action_id ?? ''} required />
      </Field>
      <Field label="Action Reason">
        <DatedSelect key={`r-${keep?.start ?? 'new'}`} name="action_reason_code" options={otherReasons} dateField="effective_date" parentField="action_id" value={keep?.action_reason_code ?? ''} />
      </Field>
    </>
  );
}
