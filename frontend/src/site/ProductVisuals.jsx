/*
 * The FlowXP product UI, rendered as a marketing visual.
 *
 * The brief is explicit: "Do NOT use generic stock imagery. The product UI
 * itself should be the visual centerpiece." So this borrows the real app's
 * chrome (sidebar, topbar, stat tiles, the same colour tokens) at a
 * illustrative scale, rather than an abstract graphic that merely gestures at
 * "software". Every number here is fixed sample data and is never wired to
 * an API — see the note in database.js's plan seed for the same principle
 * applied to pricing: a mockup that looks live and isn't is worse than one
 * that plainly isn't trying to be.
 *
 * Built as small pieces (StatTile, AreaChart, ...) because the brief asks for
 * this UI in two places — a compact hero visual and a fuller "dashboard
 * showcase" section — and composing two layouts from shared pieces is a
 * smaller, more honest diff than two independent mockups that will drift.
 */
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, prefersReducedMotion } from '../animations/gsap.js';
import { staggerReveal } from '../animations/reveal.js';
import { revealOnScroll } from '../animations/scroll.js';
import { counterAnimation } from '../animations/counters.js';

/* ── Sidebar icons ──────────────────────────────────────────────────────── */
const NAV_ICONS = ['Dashboard', 'Billing', 'Products', 'Inventory', 'Reports', 'AI'];

const MockSidebar = ({ active = 'Dashboard' }) => (
  <div className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-2 py-4 sm:flex">
    {NAV_ICONS.map((label) => (
      <div
        key={label}
        title={label}
        className={`flex h-8 w-8 items-center justify-center rounded-lg text-[9px] font-bold ${
          label === active ? 'bg-brand-500 text-white' : 'text-ink-400'
        }`}
      >
        {label.slice(0, 2).toUpperCase()}
      </div>
    ))}
  </div>
);

const MockTopbar = ({ business = 'Corner Café' }) => (
  <div className="flex h-10 items-center justify-between border-b border-line px-4">
    <div className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
      <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
      <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
    </div>
    <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-[10px] font-medium text-ink-500">
      flowxp.managerxp.com/app
    </div>
    <div className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-semibold text-ink-700">
      {business} <span className="text-ink-400">▾</span>
    </div>
  </div>
);

/* ── Stat tile — the number counts up when it enters view ────────────────── */
export const StatTile = ({ label, value, format, trend, tone = 'default', className = '' }) => {
  const valueRef = useRef(null);
  const rootRef = useRef(null);

  useGSAP(() => {
    const target = valueRef.current;
    if (!target) return;
    const numeric = typeof value === 'number' ? value : null;
    if (numeric == null) { target.textContent = value; return; }

    // counterAnimation() itself checks prefers-reduced-motion and, when set,
    // writes the final value instantly rather than ticking to it — so this
    // observer firing under reduced motion still does the right thing with
    // no special-casing here.
    //
    // An IntersectionObserver rather than ScrollTrigger: this tile is one of
    // many identical small counters, and giving each one its own
    // ScrollTrigger instance is meaningfully more overhead than the
    // browser's native, purpose-built "is this visible" API.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        counterAnimation(target, numeric, { duration: 1.3, format });
        observer.disconnect();
      }
    }, { threshold: 0.4 });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div ref={rootRef} className={`rounded-xl border border-line bg-surface p-3 ${className}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span ref={valueRef} className="text-lg font-extrabold tabular-nums text-ink-900">
          {typeof value === 'number' ? '0' : value}
        </span>
        {trend && (
          <span className={`text-[10px] font-bold ${tone === 'warning' ? 'text-warning' : 'text-success'}`}>
            {trend}
          </span>
        )}
      </p>
    </div>
  );
};

/* ── Sales chart — a hand-authored SVG area, animated with a stroke draw-in.
   A charting library is a large dependency for seven fixed data points that
   never change; an SVG path is a stdlib-level tool that already does this. */
const CHART_POINTS = [22, 28, 25, 34, 31, 40, 48]; // sample week, thousands ₹
const CHART_DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const buildAreaPath = (points, width, height) => {
  const max = Math.max(...points);
  const min = Math.min(...points) * 0.85;
  const stepX = width / (points.length - 1);
  const toY = (v) => height - ((v - min) / (max - min)) * height;

  const coords = points.map((v, i) => [i * stepX, toY(v)]);
  const line = coords.reduce((d, [x, y], i) => `${d}${i === 0 ? 'M' : 'L'}${x},${y} `, '');
  const area = `${line}L${width},${height} L0,${height} Z`;
  return { line, area };
};

export const SalesChart = ({ className = '' }) => {
  const width = 280;
  const height = 88;
  const { line, area } = buildAreaPath(CHART_POINTS, width, height);
  const pathRef = useRef(null);
  const areaRef = useRef(null);

  useGSAP(() => {
    const path = pathRef.current;
    if (!path || prefersReducedMotion()) return;

    const length = path.getTotalLength();
    gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
    gsap.set(areaRef.current, { opacity: 0 });

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      gsap.to(path, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.out' });
      gsap.to(areaRef.current, { opacity: 1, duration: 1, delay: 0.3 });
      observer.disconnect();
    }, { threshold: 0.4 });
    observer.observe(path);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path ref={areaRef} d={area} fill="url(#salesFill)" />
        <path ref={pathRef} d={line} fill="none" stroke="var(--color-brand-500)" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="mt-1.5 flex justify-between text-[9px] font-medium text-ink-400">
        {CHART_DAYS.map((d, i) => <span key={i}>{d}</span>)}
      </div>
    </div>
  );
};

/* ── Payment method breakdown — plain horizontal bars, no chart library. ─── */
const PAYMENT_SPLIT = [
  { label: 'UPI', pct: 46, color: 'bg-brand-500' },
  { label: 'Cash', pct: 28, color: 'bg-cyan-500' },
  { label: 'Card', pct: 18, color: 'bg-violet-500' },
  { label: 'Credit', pct: 8, color: 'bg-amber-500' }
];

export const PaymentSummary = ({ className = '' }) => (
  <div className={`space-y-2 ${className}`}>
    {PAYMENT_SPLIT.map((p) => (
      <div key={p.label} className="flex items-center gap-2 text-[10px]">
        <span className="w-9 shrink-0 font-medium text-ink-500">{p.label}</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <span className={`block h-full rounded-full ${p.color}`} style={{ width: `${p.pct}%` }} />
        </span>
        <span className="w-7 shrink-0 text-right font-semibold text-ink-700">{p.pct}%</span>
      </div>
    ))}
  </div>
);

/* ── Top products & recent transactions — plain rows, the fastest-to-scan
   shape for both, so neither needs its own visual language. ─────────────── */
const TOP_PRODUCTS = [
  { name: 'Filter Coffee', units: 214, revenue: '₹8,560' },
  { name: 'Masala Dosa', units: 96, revenue: '₹7,680' },
  { name: 'Samosa (2pc)', units: 180, revenue: '₹3,600' }
];

export const TopProducts = ({ className = '' }) => (
  <ul className={`divide-y divide-line ${className}`}>
    {TOP_PRODUCTS.map((p) => (
      <li key={p.name} className="flex items-center justify-between py-1.5 text-[11px]">
        <span className="font-medium text-ink-900">{p.name}</span>
        <span className="text-ink-400">{p.units} sold</span>
        <span className="font-semibold text-ink-900">{p.revenue}</span>
      </li>
    ))}
  </ul>
);

const RECENT_TRANSACTIONS = [
  { id: 'INV-1042', name: 'Walk-in', amount: '₹340', time: '2m ago' },
  { id: 'INV-1041', name: 'Priya Sharma', amount: '₹1,280', time: '14m ago' },
  { id: 'INV-1040', name: 'Walk-in', amount: '₹90', time: '22m ago' }
];

export const RecentTransactions = ({ className = '' }) => (
  <ul className={`divide-y divide-line ${className}`}>
    {RECENT_TRANSACTIONS.map((t) => (
      <li key={t.id} className="flex items-center justify-between py-1.5 text-[11px]">
        <span className="font-medium text-ink-900">{t.id}</span>
        <span className="text-ink-400">{t.name}</span>
        <span className="font-semibold text-ink-900">{t.amount}</span>
        <span className="text-ink-400">{t.time}</span>
      </li>
    ))}
  </ul>
);

export const LowStockChips = ({ className = '' }) => (
  <div className={`flex flex-wrap gap-1.5 ${className}`}>
    {['Milk — 3 left', 'Sugar — 5 left', 'Paper cups — 8 left'].map((s) => (
      <span key={s} className="rounded-full bg-warning/10 px-2.5 py-1 text-[10px] font-semibold text-warning">
        {s}
      </span>
    ))}
  </div>
);

export const AIPreviewCard = ({ className = '' }) => (
  <div className={`rounded-xl border border-line bg-gradient-to-br from-brand-50 to-surface p-3 ${className}`}>
    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-600">
      <span className="text-gradient">✦</span> Ask Flow AI
    </p>
    <p className="text-[11px] text-ink-500">"How much did I sell today?"</p>
    <p className="mt-1 text-[11px] font-medium text-ink-900">
      Today's sales are ₹48,250, up 12.4% from yesterday.
    </p>
  </div>
);

/* ══════════════════════════════════════════════════════════════════════════
   COMPOSED LAYOUTS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The hero visual — compact, three headline numbers, the chart, the AI
 * teaser. Everything a glance needs; nothing a glance would skip past.
 */
export const HeroMockup = ({ className = '' }) => {
  const scope = useRef(null);

  useGSAP(() => {
    staggerReveal(scope.current.querySelectorAll('[data-reveal]'), { each: 0.08, delay: 0.9 });
  }, { scope });

  return (
    <div ref={scope} className="glass overflow-hidden rounded-2xl">
      <MockTopbar />
      <div className="flex">
        <MockSidebar />
        <div className="flex-1 space-y-3 p-4">
          <div data-reveal className="grid grid-cols-3 gap-2">
            <StatTile label="Today's sales" value={48250} format={(n) => `₹${Math.round(n).toLocaleString('en-IN')}`} trend="+12.4%" />
            <StatTile label="Invoices" value={128} trend="+8" />
            <StatTile label="Outstanding" value={18450} format={(n) => `₹${Math.round(n).toLocaleString('en-IN')}`} tone="warning" trend="4 due" />
          </div>
          <div data-reveal className="rounded-xl border border-line bg-surface p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">This week</p>
            <SalesChart />
          </div>
          <div data-reveal><AIPreviewCard /></div>
        </div>
      </div>
    </div>
  );
};

/**
 * The dedicated "Product Dashboard Showcase" section — every panel the brief
 * asks for, scroll-revealed panel by panel rather than all together.
 */
export const DashboardShowcase = ({ className = '' }) => {
  const scope = useRef(null);

  useGSAP(() => {
    revealOnScroll(scope.current, () =>
      staggerReveal(scope.current.querySelectorAll('[data-reveal]'), { each: 0.08 })
    );
  }, { scope });

  return (
    <div ref={scope} className={`glass overflow-hidden rounded-2xl ${className}`}>
      <MockTopbar />
      <div className="flex">
        <MockSidebar />
        <div className="flex-1 p-5">
          <div data-reveal className="mb-4 flex items-baseline justify-between">
            <div>
              <p className="text-sm font-bold text-ink-900">Good morning, Abdul.</p>
              <p className="text-[11px] text-ink-400">Here's where Corner Café stands today.</p>
            </div>
          </div>

          <div data-reveal className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
            <StatTile label="Sales" value={48250} format={(n) => `₹${Math.round(n).toLocaleString('en-IN')}`} trend="+12%" />
            <StatTile label="Invoices" value={128} trend="+8" />
            <StatTile label="Payments" value={42800} format={(n) => `₹${Math.round(n).toLocaleString('en-IN')}`} trend="+9%" />
            <StatTile label="Outstanding" value={18450} format={(n) => `₹${Math.round(n).toLocaleString('en-IN')}`} tone="warning" trend="4 due" />
            <StatTile label="Inventory" value="₹6.8L" />
            <StatTile label="Low stock" value={12} tone="warning" trend="items" />
          </div>

          <div data-reveal className="mb-4 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Sales overview</p>
              <SalesChart />
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Payment summary</p>
              <PaymentSummary />
            </div>
          </div>

          <div data-reveal className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Top products</p>
              <TopProducts />
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Recent transactions</p>
              <RecentTransactions />
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-line bg-surface p-4">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Low stock</p>
                <LowStockChips />
              </div>
              <AIPreviewCard />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
