'use client';
import { useEffect, useRef, useState } from 'react';
import type { ScanResult } from '@/app/(app)/attendance/actions';

type Log = ScanResult & { at: string };

/** Camera QR scanner (html5-qrcode) + manual number entry. */
export function Scanner({ onScan, canStaff }: { onScan: (mode: 'STUDENT' | 'STAFF', code: string) => Promise<ScanResult>; canStaff: boolean }) {
  const [mode, setMode] = useState<'STUDENT' | 'STAFF'>('STUDENT');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<Log[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const scanner = useRef<any>(null);
  const last = useRef<{ code: string; t: number }>({ code: '', t: 0 });
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const handle = async (code: string) => {
    const now = Date.now();
    if (code === last.current.code && now - last.current.t < 4000) return;
    last.current = { code, t: now };
    const r = await onScan(modeRef.current, code);
    try { navigator.vibrate?.(r.ok ? 80 : [60, 60, 60]); } catch {}
    setLog((l) => [{ ...r, at: new Date().toLocaleTimeString() }, ...l].slice(0, 50));
  };

  const start = async () => {
    setErr(null);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      scanner.current = new Html5Qrcode('qr-reader');
      await scanner.current.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, (text: string) => handle(text), () => {});
      setRunning(true);
    } catch (e: any) {
      setErr('Camera not available: ' + (e?.message || e) + '. Use manual entry below (the page must be opened over HTTPS for camera access).');
    }
  };
  const stop = async () => {
    try { await scanner.current?.stop(); } catch {}
    setRunning(false);
  };
  useEffect(() => () => { scanner.current?.stop?.().catch(() => {}); }, []);

  const latest = log[0];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          <button className={`btn ${mode === 'STUDENT' ? 'btn-primary' : ''}`} onClick={() => setMode('STUDENT')}>Students</button>
          {canStaff && <button className={`btn ${mode === 'STAFF' ? 'btn-primary' : ''}`} onClick={() => setMode('STAFF')}>Staff (in / out)</button>}
          <span className="flex-1" />
          {running ? <button className="btn" onClick={stop}>Stop camera</button> : <button className="btn btn-primary" onClick={start}>Start camera</button>}
        </div>
        <div id="qr-reader" className="mx-auto w-full max-w-sm overflow-hidden rounded-lg bg-black/5" style={{ minHeight: running ? undefined : 0 }} />
        {err && <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">{err}</div>}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const v = (f.elements.namedItem('code') as HTMLInputElement).value; if (v) { last.current = { code: '', t: 0 }; handle(v); f.reset(); } }}>
          <input name="code" placeholder={`Type ${mode === 'STUDENT' ? 'student' : 'staff'} number`} className="input" />
          <button className="btn">Mark</button>
        </form>
        {latest && (
          <div className={`flex items-center gap-3 rounded-lg p-3 ${latest.ok ? 'bg-green-100' : 'bg-red-100'}`}>
            {latest.photo ? <img src={latest.photo} alt="" className="h-16 w-16 rounded object-cover" /> : <div className="h-16 w-16 rounded bg-black/10" />}
            <div><div className="text-lg font-bold">{latest.name ?? 'Unknown'}</div><div className="font-mono text-sm">{latest.number}</div><div className="font-semibold">{latest.message}</div></div>
          </div>
        )}
      </div>
      <div className="card">
        <h2 className="h2">Scanned this session ({log.length})</h2>
        <table className="tbl"><thead><tr><th>Time</th><th>Name</th><th>Number</th><th>Result</th></tr></thead>
          <tbody>{log.map((l, i) => <tr key={i}><td>{l.at}</td><td>{l.name}</td><td className="font-mono text-xs">{l.number}</td><td className={l.ok ? 'text-green-700' : 'text-red-700'}>{l.message}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
