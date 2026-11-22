// Dashboard charts (server-rendered SVG/HTML, hover tooltips via CSS).
// Two-series palette: sky blue + black (identity is also given by the legend,
// hover labels and the table view, as black is a neutral rather than a hue).
import type { ReactNode } from 'react';

export const SKY = '#0284c7';
export const INK = '#1e293b';

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-slate-600">
      {items.map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}
    </div>
  );
}

/** Grouped bars: a (sky) next to b (black) per category, one axis. */
export function GroupedBars({ data, aLabel, bLabel, fmt, height = 220 }: {
  data: { label: string; a: number; b: number }[]; aLabel: string; bLabel: string; fmt: (n: number) => string; height?: number;
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  return (
    <div>
      <div className="mb-3 flex justify-end"><Legend items={[[SKY, aLabel], [INK, bLabel]]} /></div>
      <div className="relative flex gap-2 pl-12" style={{ height }}>
        {ticks.map((t) => (
          <div key={t} className="pointer-events-none absolute left-12 right-0 border-t border-slate-200/80" style={{ bottom: `${(t / top) * 100}%` }}>
            <span className="absolute -left-12 -top-2 w-10 text-right text-[10px] text-slate-400">{short(t)}</span>
          </div>
        ))}
        {data.map((d) => (
          <div key={d.label} className="group relative flex h-full flex-1 items-end justify-center gap-[2px]">
            <div className="w-[34%] max-w-4 rounded-t-[4px]" style={{ height: `${(d.a / top) * 100}%`, minHeight: d.a ? 2 : 0, background: SKY }} />
            <div className="w-[34%] max-w-4 rounded-t-[4px]" style={{ height: `${(d.b / top) * 100}%`, minHeight: d.b ? 2 : 0, background: INK }} />
            <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block">
              <b>{d.label}</b><br />{aLabel}: {fmt(d.a)}<br />{bLabel}: {fmt(d.b)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2 pl-12">{data.map((d) => <div key={d.label} className="flex-1 text-center text-[10px] uppercase text-slate-500">{d.label}</div>)}</div>
    </div>
  );
}

/** Single-value donut (percentage) with the number in the middle. */
export function Donut({ pct, size = 150, caption }: { pct: number | null; size?: number; caption?: ReactNode }) {
  const r = 52, c = 2 * Math.PI * r;
  const v = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={pct === null ? 'No data' : `${Math.round(v)} percent`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke={pct === null ? '#e2e8f0' : INK} strokeWidth="14" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={SKY} strokeWidth="14" strokeLinecap="butt"
          strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 60 60)" />
        <circle cx="60" cy="60" r="44" fill="white" />
        <text x="60" y="66" textAnchor="middle" className="fill-slate-900" style={{ fontSize: 22, fontWeight: 600 }}>{pct === null ? '—' : `${Math.round(v)}%`}</text>
      </svg>
      {caption}
    </div>
  );
}

/** Area + line for a daily percentage series (0–100). */
export function AreaTrend({ points, height = 140 }: { points: { label: string; value: number | null }[]; height?: number }) {
  const W = 600, H = height, pad = 6;
  const xs = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, points.length - 1);
  const ys = (v: number) => H - pad - (v / 100) * (H - 2 * pad);
  const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.value !== null) as { label: string; value: number; i: number }[];
  if (!valid.length) return <div className="flex items-center justify-center text-sm text-slate-400" style={{ height }}>No attendance recorded in this period</div>;
  const line = valid.map((p, k) => `${k ? 'L' : 'M'}${xs(p.i).toFixed(1)},${ys(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${xs(valid.at(-1)!.i).toFixed(1)},${H - pad} L${xs(valid[0].i).toFixed(1)},${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none" role="img" aria-label="Attendance trend">
      <defs><linearGradient id="skyfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={SKY} stopOpacity="0.35" /><stop offset="100%" stopColor={SKY} stopOpacity="0.02" /></linearGradient></defs>
      {[25, 50, 75].map((g) => <line key={g} x1={pad} x2={W - pad} y1={ys(g)} y2={ys(g)} stroke="#e2e8f0" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
      <path d={area} fill="url(#skyfill)" />
      <path d={line} fill="none" stroke={INK} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {valid.map((p) => (
        <g key={p.i}>
          <circle cx={xs(p.i)} cy={ys(p.value)} r="9" fill="transparent"><title>{`${p.label}: ${Math.round(p.value)}% present`}</title></circle>
        </g>
      ))}
    </svg>
  );
}

/** Month calendar; days with marks are highlighted (title = details). */
export function MiniCalendar({ month, today, marks }: { month: string; today: string; marks: Record<string, string[]> }) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className={`py-1 font-semibold ${i === 0 ? 'text-red-500' : 'text-slate-500'}`}>{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const iso = `${month}-${String(d).padStart(2, '0')}`;
          const mk = marks[iso];
          const isToday = iso === today;
          return (
            <div key={i} title={mk?.join('\n')}
              className={`flex h-7 items-center justify-center rounded-md ${isToday ? 'bg-slate-900 font-semibold text-white' : mk ? 'bg-[var(--accent-color)] font-semibold text-white' : i % 7 === 0 ? 'text-red-500' : 'text-slate-700'}`}>
              {d}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-900" />Today</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--accent-color)]" />Exam / event</span>
      </div>
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? raw;
}
function short(n: number) {
  return n >= 1e7 ? `${+(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${+(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n);
}
