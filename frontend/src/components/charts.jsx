/*
 * Small SVG charts for the dashboards. No chart library: each is a few paths sized by the box it sits in, in the
 * brand colours from index.css, and each carries its numbers for screen readers (a caption and an sr-only table, or
 * an aria-label). Picked from what reads at a glance without reading words (ui-ux-pro-max chart guidance):
 *   Sparkline  a figure's last few days, beside the figure
 *   AreaChart  a trend over days, with the average marked and the day in focus called out
 *   Gauge      one figure against a benchmark (today against a usual day)
 *   Donut      how a whole splits (how customers paid), with a legend that says it in words too
 *   HourBars   when the day was busy, the peak hour in full colour
 * Motion is CSS only (the line draws in, the arcs fill) and is switched off under reduced motion in index.css.
 */
import { useId, useState } from 'react';

const BRAND = 'var(--color-brand-500)';
const safeId = (id) => id.replace(/[^a-zA-Z0-9_-]/g, '');

/* Points to a smooth path: a monotone cubic (Fritsch-Carlson), so the curve never swings past a point it joins. A plain
   spline overshoots next to a sharp peak and draws dips that are not in the data. */
const smoothPath = (pts) => {
  const n = pts.length;
  if (n < 2) return n ? `M${pts[0][0]},${pts[0][1]}` : '';
  const dx = []; const m = [];
  for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0]); m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1)); }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i]; const b = t[i + 1] / m[i]; const r = a * a + b * b;
    if (r > 9) { const k = 3 / Math.sqrt(r); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${(pts[i][0] + h).toFixed(2)},${(pts[i][1] + t[i] * h).toFixed(2)} ${(pts[i + 1][0] - h).toFixed(2)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(2)} ${pts[i + 1][0].toFixed(2)},${pts[i + 1][1].toFixed(2)}`;
  }
  return d;
};

/* ── Sparkline ───────────────────────────────────────────────────────────── */
export const Sparkline = ({ values, tone = BRAND, className = 'h-9 w-full' }) => {
  const id = safeId(useId());
  if (!values?.length) return null;
  const W = 100; const H = 32;
  const max = Math.max(...values); const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [values.length === 1 ? W : (i / (values.length - 1)) * W, H - 3 - ((v - min) / span) * (H - 8)]);
  const line = smoothPath(pts);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.25" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={tone} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" className="chart-draw" pathLength="1" />
    </svg>
  );
};

/* ── Area chart ──────────────────────────────────────────────────────────────
   points: [{ key, label (tooltip), axis (under the chart, or ''), value, note }]. `focus` is the index called
   out when nothing is hovered (today). Hover or keyboard focus moves the call-out. */
export const AreaChart = ({ points, format, caption, focus = points.length - 1, height = 'h-52', className = '', averageLabel = 'Average', partialLast = false }) => {
  const id = safeId(useId());
  const [hover, setHover] = useState(null);
  const n = points.length;
  const W = 1000; const H = 300;
  const peak = Math.max(...points.map((p) => p.value), 0);
  const top = peak > 0 ? peak * 1.15 : 1;
  const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v) => H - (v / top) * H;
  const pts = points.map((p, i) => [x(i), y(p.value)]);
  // today is only part of a day: the curve stops at the last full day and a dashed straight line runs on to today
  const split = partialLast && n > 2;
  const line = smoothPath(split ? pts.slice(0, -1) : pts);
  const tail = split ? ` L${pts[n - 1][0].toFixed(2)},${pts[n - 1][1].toFixed(2)}` : '';
  const avg = n ? points.reduce((s, p) => s + p.value, 0) / n : 0;
  const shown = hover ?? focus;
  const sp = points[shown];
  const left = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const bubbleLeft = Math.min(88, Math.max(12, left(shown)));

  return (
    <figure className={className}>
      <div className={`relative ${height}`} onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75].map((f) => <span key={f} aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${f * 100}%` }} />)}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND} stopOpacity="0.28" />
              <stop offset="100%" stopColor={BRAND} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={`${line}${tail} L${x(n - 1)},${H} L${x(0)},${H} Z`} fill={`url(#${id})`} className="chart-fade" />
          <path d={line} fill="none" stroke={BRAND} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" className="chart-draw" pathLength="1" />
          {split && <path d={`M${pts[n - 2][0].toFixed(2)},${pts[n - 2][1].toFixed(2)}${tail}`} fill="none" stroke={BRAND} strokeWidth="2.5" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
          {avg > 0 && <line x1="0" x2={W} y1={y(avg)} y2={y(avg)} stroke="var(--color-ink-400)" strokeWidth="1.25" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />}
        </svg>
        {avg > 0 && (
          <span aria-hidden="true" className="absolute left-0 -translate-y-full rounded bg-surface/90 px-1.5 text-[11px] font-medium text-ink-500" style={{ top: `${(y(avg) / H) * 100}%` }}>
            {averageLabel} {format(avg)}
          </span>
        )}
        {/* the day in focus: a guide line, a dot on the curve and its figure */}
        {sp && (
          <>
            <span aria-hidden="true" className="pointer-events-none absolute bottom-0 w-px bg-brand-500/30" style={{ left: `${left(shown)}%`, top: `${(y(sp.value) / H) * 100}%` }} />
            <span aria-hidden="true" className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-brand-500 shadow-sm ring-4 ring-brand-500/15"
                  style={{ left: `${left(shown)}%`, top: `${(y(sp.value) / H) * 100}%` }} />
            <span aria-hidden="true" className="pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-lg bg-ink-900 px-2.5 py-1.5 text-center shadow-md"
                  style={{ left: `${bubbleLeft}%`, top: `${(y(sp.value) / H) * 100}%` }}>
              <span className="tabular block text-small font-semibold text-white">{format(sp.value)}</span>
              <span className="block text-[11px] text-white/70">{sp.label}{sp.note ? ` · ${sp.note}` : ''}</span>
            </span>
          </>
        )}
        {/* hit areas, one per point, centred on it */}
        {points.map((p, i) => (
          <button key={p.key} type="button" aria-label={`${p.label}: ${format(p.value)}${p.note ? `, ${p.note}` : ''}`}
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  className="absolute inset-y-0 -translate-x-1/2 focus:outline-none"
                  style={{ left: `${left(i)}%`, width: `${n > 1 ? 100 / (n - 1) : 100}%` }} />
        ))}
      </div>
      <div aria-hidden="true" className="relative mt-2 h-4 text-[11px] text-ink-400">
        {points.map((p, i) => p.axis && (
          <span key={p.key} className={`absolute -translate-x-1/2 whitespace-nowrap ${i === focus ? 'font-semibold text-ink-900' : ''}`}
                style={{ left: `${Math.min(96, Math.max(4, left(i)))}%` }}>{p.axis}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>{points.map((p) => <tr key={p.key}><th>{p.label}</th><td>{format(p.value)}</td>{p.note && <td>{p.note}</td>}</tr>)}</tbody>
      </table>
    </figure>
  );
};

/* ── Gauge ───────────────────────────────────────────────────────────────────
   A half ring filled to value/target (past the target the ring is full and turns green). */
export const Gauge = ({ value, target, label, children }) => {
  const ratio = target > 0 ? value / target : 0;
  const fill = Math.max(0, Math.min(1, ratio));
  const done = ratio >= 1;
  return (
    <div className="relative mx-auto w-full max-w-[15rem]" role="img" aria-label={label}>
      <svg viewBox="0 0 100 56" className="w-full overflow-visible" aria-hidden="true">
        <path d="M8 50 A42 42 0 0 1 92 50" fill="none" stroke="var(--color-surface-3)" strokeWidth="9" strokeLinecap="round" pathLength="100" />
        <path d="M8 50 A42 42 0 0 1 92 50" fill="none" stroke={done ? 'var(--color-success)' : BRAND} strokeWidth="9" strokeLinecap="round" pathLength="100"
              strokeDasharray={`${fill * 100} 100`} className="chart-arc" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">{children}</div>
    </div>
  );
};

/* ── Donut ───────────────────────────────────────────────────────────────────
   parts: [{ key, label, value, color }]. The legend repeats every share in words and numbers. */
export const Donut = ({ parts, format, centerValue, centerLabel, label }) => {
  const total = parts.reduce((s, p) => s + p.value, 0);
  let acc = 0;
  const gap = parts.filter((p) => p.value > 0).length > 1 ? 0.8 : 0;
  return (
    <div className="flex flex-col items-center gap-5 min-[480px]:flex-row md:flex-col xl:flex-row">
      <div className="relative h-36 w-36 shrink-0" role="img" aria-label={label}>
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--color-surface-3)" strokeWidth="5.5" />
          {total > 0 && parts.map((p) => {
            const len = (p.value / total) * 100;
            const el = len > 0 && (
              <circle key={p.key} cx="21" cy="21" r="15.9155" fill="none" stroke={p.color} strokeWidth="5.5"
                      strokeDasharray={`${Math.max(0, len - gap)} ${100 - Math.max(0, len - gap)}`} strokeDashoffset={-acc} className="chart-arc" />
            );
            acc += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="tabular text-small font-semibold text-ink-900">{centerValue}</span>
          <span className="text-[11px] text-ink-500">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2.5">
        {parts.filter((p) => p.value > 0).map((p) => (
          <li key={p.key} className="min-w-0">
            <span className="flex items-center gap-2 text-small">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="min-w-0 flex-1 truncate font-medium text-ink-900">{p.label}</span>
              <span className="tabular shrink-0 font-semibold text-ink-900">{total ? Math.round((p.value / total) * 100) : 0}%</span>
            </span>
            <span className="tabular block pl-[18px] text-caption text-ink-500">{format(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* ── Hour bars ───────────────────────────────────────────────────────────────
   hours: [{ hour (0–23), value, count }], filled across the hours the day actually used; the busiest in brand. */
const hourText = (h) => new Date(2000, 0, 1, h).toLocaleTimeString('en-IN', { hour: 'numeric' });
export const HourBars = ({ hours, format, caption }) => {
  const [hover, setHover] = useState(null);
  if (!hours.length) return null;
  const lo = Math.min(...hours.map((h) => h.hour)); const hi = Math.max(...hours.map((h) => h.hour));
  const byHour = new Map(hours.map((h) => [h.hour, h]));
  const all = Array.from({ length: hi - lo + 1 }, (_, i) => byHour.get(lo + i) || { hour: lo + i, value: 0, count: 0 });
  const max = Math.max(...all.map((h) => h.value), 1);
  const peak = all.reduce((a, b) => (b.value > a.value ? b : a));
  const shown = hover != null ? all[hover] : peak;
  return (
    <figure>
      <p className="tabular h-5 text-small text-ink-700">
        <span className="font-semibold text-ink-900">{hourText(shown.hour)}</span> · {format(shown.value)} · {shown.count} bill{shown.count === 1 ? '' : 's'}
      </p>
      <div className="mt-3 flex h-40 items-end gap-1" onMouseLeave={() => setHover(null)}>
        {all.map((h, i) => (
          <button key={h.hour} type="button" aria-label={`${hourText(h.hour)}: ${format(h.value)}, ${h.count} bills`}
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  className="group flex h-full min-w-0 flex-1 items-end focus:outline-none">
            <span className={`block w-full rounded-t-[4px] transition-colors duration-(--duration-fast) ${h === shown ? 'bg-brand-500' : 'bg-brand-200 group-hover:bg-brand-400'} group-focus-visible:ring-2 group-focus-visible:ring-brand-700`}
                  style={{ height: `${h.value ? Math.max(4, (h.value / max) * 100) : 2}%` }} />
          </button>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1.5 flex justify-between text-[11px] text-ink-400"><span>{hourText(lo)}</span><span>{hourText(hi)}</span></div>
      <table className="sr-only"><caption>{caption}</caption><tbody>{all.map((h) => <tr key={h.hour}><th>{hourText(h.hour)}</th><td>{format(h.value)}</td><td>{h.count} bills</td></tr>)}</tbody></table>
    </figure>
  );
};
