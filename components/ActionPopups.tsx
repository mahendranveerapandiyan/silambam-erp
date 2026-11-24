'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * App-wide pop-ups for actions:
 *  • Result: after every save / update / delete the server redirects with ?ok=… or ?err=…;
 *    the message is shown in a pop-up that stays until OK is clicked.
 *  • Confirmation: any submit button marked data-confirm="…", or labelled Delete / Remove,
 *    asks before the form is sent.
 */
export function ActionPopups() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const ok = sp.get('ok');
  const err = sp.get('err');
  const [closed, setClosed] = useState<string | null>(null);
  const key = ok || err ? `${pathname}?${ok ?? ''}|${err ?? ''}|${sp.get('n') ?? ''}` : null;
  const showResult = !!key && closed !== key;

  const okBtn = useRef<HTMLButtonElement>(null);
  const yesBtn = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState<{ message: string; button: HTMLButtonElement; danger: boolean } | null>(null);

  const closeResult = useCallback(() => {
    setClosed(key);
    const q = new URLSearchParams(sp.toString());
    q.delete('ok'); q.delete('err'); q.delete('n');
    const s = q.toString();
    // instant, no reload: Next.js keeps useSearchParams in step with history.replaceState
    window.history.replaceState(window.history.state, '', (s ? `${pathname}?${s}` : pathname) + window.location.hash);
  }, [key, sp, pathname]);

  // confirmation for delete / remove (and any button with data-confirm)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const b = (e.target as Element | null)?.closest?.('button');
      if (!(b instanceof HTMLButtonElement) || b.type !== 'submit' || !b.form || b.disabled) return;
      if (b.dataset.confirmed === '1') return;
      const text = (b.textContent ?? '').trim();
      const msg = b.dataset.confirm ?? (/\b(delete|remove)\b/i.test(text) ? `Are you sure you want to ${text.charAt(0).toLowerCase()}${text.slice(1)}? This cannot be undone.` : null);
      if (!msg) return;
      e.preventDefault();
      e.stopPropagation();
      setConfirm({ message: msg, button: b, danger: /\b(delete|remove|cancel|undo)\b/i.test(text + ' ' + msg) });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  const answer = (yes: boolean) => {
    const c = confirm;
    setConfirm(null);
    if (!yes || !c) { c?.button.focus(); return; }
    c.button.dataset.confirmed = '1';
    c.button.form?.requestSubmit(c.button);
    setTimeout(() => { delete c.button.dataset.confirmed; }, 0);
  };

  useEffect(() => { if (showResult) okBtn.current?.focus(); }, [showResult]);
  useEffect(() => { if (confirm) yesBtn.current?.focus(); }, [confirm]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirm) answer(false);
      else if (showResult) closeResult();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (confirm) {
    return (
      <div className="popup-backdrop" role="presentation">
        <div role="alertdialog" aria-modal="true" aria-labelledby="cd-confirm-title" className="popup">
          <div className={`popup-icon ${confirm.danger ? 'popup-icon-warn' : 'popup-icon-info'}`} aria-hidden>!</div>
          <h2 id="cd-confirm-title" className="popup-title">Please confirm</h2>
          <p className="popup-text">{confirm.message}</p>
          <div className="popup-actions">
            <button type="button" className="btn" onClick={() => answer(false)}>No, keep it</button>
            <button ref={yesBtn} type="button" className={`btn ${confirm.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => answer(true)}>Yes, continue</button>
          </div>
        </div>
      </div>
    );
  }
  if (!showResult) return null;
  return (
    <div className="popup-backdrop" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="cd-result-title" className="popup">
        <div className={`popup-icon ${err ? 'popup-icon-err' : 'popup-icon-ok'}`} aria-hidden>{err ? '✕' : '✓'}</div>
        <h2 id="cd-result-title" className="popup-title">{err ? 'Not completed' : 'Done'}</h2>
        <p className="popup-text">{err ?? ok}</p>
        <div className="popup-actions">
          <button ref={okBtn} type="button" className="btn btn-primary min-w-24" onClick={closeResult}>OK</button>
        </div>
      </div>
    </div>
  );
}
