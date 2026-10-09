/*
 * The dashboard: the day at a glance (design.md §26–27), drawn so it reads without reading much: every figure has
 * an icon, a coloured change against yesterday and a sparkline of the last week; the fortnight is one area chart;
 * today against a usual day is one gauge; how people paid is a donut; when it was busy is a row of bars.
 *
 * It answers, in order: how is today going, is that a good day for us, what needs me, how and when did people buy,
 * what is selling, and what was just billed. Figures come from /api/dashboard; today's payment mix and hours from
 * /api/reports/sales for today. Both details are only for people who may see reports, so a cashier sees today's
 * figures and the to-do list. A business with no bills yet sees its setup checklist first.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeftRight, BadgeCheck, Boxes, CalendarClock, PackageX, Tag, ChevronRight, ClipboardList, Clock, IndianRupee, Plus, ReceiptText, ShoppingBasket, Sparkles, Trophy, Wallet
} from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AnimatedNumber, Button, Card, DashboardHeader, Skeleton, StatusBadge } from '../components/ui.jsx';
import { AreaChart, Donut, Gauge, HourBars } from '../components/charts.jsx';
import MetricCard from '../components/MetricCard.jsx';
import { RETAIL_TYPES } from '../lib/business.js';
import { useSwr } from '../lib/useSwr.js';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const longDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const weekday = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const time = (ts) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const compact = (n) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const rupeesShort = (n) => `₹${compact(n)}`;

/* ── Today's figures ─────────────────────────────────────────────────────── */

/* The four figures every business opens on. `trend` (14 days, reports permission) feeds the sparklines. */
export const TodayFigures = ({ m, trend }) => {
  const avg = m.today_invoice_count ? m.today_sales / m.today_invoice_count : 0;
  const avgBefore = m.yesterday_invoice_count ? m.yesterday_sales / m.yesterday_invoice_count : 0;
  const week = trend ? trend.slice(-7) : null;
  return (
    <section aria-label="Today" className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:gap-4 lg:grid-cols-4">
      <MetricCard icon={IndianRupee} label="Today's sales" value={<AnimatedNumber value={m.today_sales} format={formatCurrency} />}
                  now={m.today_sales} before={m.yesterday_sales} spark={week?.map((d) => d.total)} />
      <MetricCard icon={ReceiptText} tone="violet" label="Bills today" value={<AnimatedNumber value={m.today_invoice_count} />}
                  now={m.today_invoice_count} before={m.yesterday_invoice_count} spark={week?.map((d) => d.invoice_count)} />
      <MetricCard icon={ShoppingBasket} tone="teal" label="Average bill" value={<AnimatedNumber value={avg} format={formatCurrency} />}
                  now={avg} before={avgBefore} spark={week?.map((d) => (d.invoice_count ? d.total / d.invoice_count : 0))} />
      <MetricCard icon={Wallet} tone={m.outstanding > 0 ? 'warning' : 'success'} label="To collect" to="/app/billing/invoices"
                  value={<AnimatedNumber value={m.outstanding} format={formatCurrency} />}
                  note={m.outstanding > 0 ? 'Unpaid and part-paid bills' : 'Every bill is paid'} />
    </section>
  );
};

/* ── Retail: the shelf, and what offers and returns did today ───────────────────────────────────────────── */

const ShelfTile = ({ to, icon: Icon, label, value, note, tone = 'text-ink-900', bg = 'bg-surface-2 text-ink-500' }) => (
  <Link to={to} className="lift flex flex-col gap-1 rounded-(--radius-card) border border-line bg-surface p-4 hover:border-brand-500">
    <span className="flex items-center gap-2 text-small text-ink-500"><span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}><Icon className="h-4 w-4" /></span>{label}</span>
    <span className={`tabular text-h3 font-semibold ${tone}`}>{value}</span>
    <span className="text-caption text-ink-500">{note}</span>
  </Link>
);

export const RetailPanel = () => {
  const { business, outletId } = useAuth();
  const scope = `${business?.business_id}-${outletId}`;
  // the last figures show at once and are refreshed behind them (the server keeps them for 30 seconds too)
  const { data: stock } = useSwr('/retail/summary', scope);
  const { data: day } = useSwr('/retail/today', scope);
  if (!stock) return null;

  return (
    <section aria-label="Shelf and stock" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <ShelfTile to="/app/stock" icon={Boxes} label="Stock at cost" value={formatCurrency(stock.cost_value)} note={`${formatCurrency(stock.retail_value)} at shelf price`} bg="bg-brand-50 text-brand-600" />
        <ShelfTile to="/app/stock?status=out" icon={PackageX} label="Out of stock" value={stock.out} note={stock.out ? 'Customers will ask for these' : 'Nothing missing'} tone={stock.out ? 'text-danger' : 'text-success'} bg={stock.out ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'} />
        <ShelfTile to="/app/stock?status=low" icon={ClipboardList} label="Running low" value={stock.low} note={stock.low ? 'At or below the reorder level' : 'All above reorder level'} tone={stock.low ? 'text-warning' : 'text-success'} bg={stock.low ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'} />
        <ShelfTile to="/app/stock?status=expiring" icon={CalendarClock} label="Expiring in 30 days" value={stock.expiring} note="Sell or mark down first" tone={stock.expiring ? 'text-warning' : 'text-ink-900'} bg="bg-warning/10 text-warning" />
        <ShelfTile to="/app/stock?status=expired" icon={AlertTriangle} label="Expired on the shelf" value={stock.expired} note={stock.expired ? 'Write off and remove' : 'None'} tone={stock.expired ? 'text-danger' : 'text-success'} bg={stock.expired ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'} />
      </div>
      {day && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Link to="/app/offers" className="lift flex items-center gap-3 rounded-(--radius-card) border border-line bg-surface p-4 hover:border-brand-500">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 text-success"><Tag className="h-5 w-5" /></span>
            <span><span className="block text-small text-ink-500">Offers today</span><span className="tabular text-body font-semibold text-ink-900">{day.offers.saving > 0 ? `${formatCurrency(day.offers.saving)} off ${day.offers.lines} line${day.offers.lines === 1 ? '' : 's'}` : 'None applied yet'}</span></span>
          </Link>
          <Link to="/app/returns" className="lift flex items-center gap-3 rounded-(--radius-card) border border-line bg-surface p-4 hover:border-brand-500">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-3 text-ink-700"><ArrowLeftRight className="h-5 w-5" /></span>
            <span><span className="block text-small text-ink-500">Returns today</span><span className="tabular text-body font-semibold text-ink-900">{day.returns.count ? `${day.returns.count} for ${formatCurrency(day.returns.total)}` : 'None'}</span></span>
          </Link>
        </div>
      )}
    </section>
  );
};

/* ── The plan: what they are on, until when, and how many days are left ─── (owners only) */

const PLAN_STATE = {
  TRIAL: { label: 'Free trial', tone: 'bg-brand-50 text-brand-700' },
  ACTIVE: { label: 'Active', tone: 'bg-success/10 text-success' },
  EXPIRED: { label: 'Ended', tone: 'bg-warning/10 text-warning' },
  CANCELLED: { label: 'Cancelled', tone: 'bg-surface-3 text-ink-700' },
  SUSPENDED: { label: 'Suspended', tone: 'bg-danger/10 text-danger' }
};
const dayMs = 86400000;
const daysUntil = (value) => (value ? Math.ceil((new Date(value).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / dayMs) : null);
const dateOf = (value) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const PlanStrip = () => {
  const { business } = useAuth();
  const [sub, setSub] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api('/businesses/current/subscription').then((d) => { if (!cancelled) setSub(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [business?.business_id]);
  if (!sub) return null;

  const state = PLAN_STATE[sub.status] || { label: sub.status, tone: 'bg-surface-3 text-ink-700' };
  const trial = sub.status === 'TRIAL';
  const endsOn = trial ? sub.trial_ends_at : sub.next_billing_date;
  const left = trial ? (sub.trial_days_remaining ?? daysUntil(endsOn)) : daysUntil(endsOn);
  const length = trial ? 7 : sub.billing_cycle === 'YEARLY' ? 365 : 30;
  const pct = left == null ? 0 : Math.max(0, Math.min(100, Math.round((left / length) * 100)));
  const soon = left != null && left <= (trial ? 2 : 5);
  const ended = sub.status === 'EXPIRED' || (left != null && left < 0);
  const cycle = sub.billing_cycle ? sub.billing_cycle.toLowerCase() : null;

  return (
    <Card className={`flex flex-wrap items-center gap-x-8 gap-y-4 p-4 sm:px-6 ${ended ? 'border-warning/40' : ''}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><BadgeCheck className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-body font-semibold text-ink-900">
            {sub.plan?.name ?? sub.plan_code} plan
            <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${state.tone}`}>{state.label}</span>
          </p>
          <p className="text-small text-ink-500">
            {cycle ? `Billed ${cycle}` : trial ? 'No card on file' : 'Plan details'}
            {endsOn ? ` · ${trial ? 'trial ends' : 'next payment'} ${dateOf(endsOn)}` : ''}
          </p>
        </div>
      </div>

      <div className="min-w-48 flex-1">
        {left != null && !ended ? (
          <>
            <p className="flex items-baseline gap-1.5">
              <span className={`tabular text-h3 font-semibold ${soon ? 'text-warning' : 'text-ink-900'}`}>{left}</span>
              <span className="text-small text-ink-500">{left === 1 ? 'day' : 'days'} left{trial ? ' in your trial' : ' until renewal'}</span>
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" role="presentation">
              <div className={`h-full rounded-full ${soon ? 'bg-warning' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : ended ? (
          <p className="text-small font-medium text-warning">{trial || sub.status === 'EXPIRED' ? 'Your trial has ended. Your data is safe and readable.' : 'Your renewal date has passed.'}</p>
        ) : (
          <p className="text-small text-ink-500">{sub.status === 'ACTIVE' ? 'Renews automatically. No renewal date is set yet.' : 'No end date.'}</p>
        )}
      </div>

      <Button to="/app/settings/subscription" variant={ended || soon ? 'primary' : 'secondary'} size="sm">{ended || soon ? 'Renew or upgrade' : 'View plan'}</Button>
    </Card>
  );
};

/* ── The fortnight ───────────────────────────────────────────────────────── */

export const SalesChart = ({ trend }) => {
  const total = trend.reduce((s, d) => s + d.total, 0);
  const bills = trend.reduce((s, d) => s + d.invoice_count, 0);
  const last = trend.length - 1;
  const points = trend.map((d, i) => ({
    key: d.date, value: d.total, note: `${d.invoice_count} bill${d.invoice_count === 1 ? '' : 's'}`,
    label: i === last ? 'Today so far' : weekday(d.date),
    axis: i === last ? 'Today' : (last - i) % 3 === 0 ? shortDay(d.date) : ''
  }));
  return (
    <Card className="flex h-full flex-col p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold text-ink-900">Sales, last 14 days</h2>
          <p className="tabular mt-1 text-small text-ink-500">{formatCurrency(total)} from {bills} bills</p>
        </div>
        <span className="flex items-center gap-3 text-caption text-ink-500">
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-4 rounded bg-brand-500" />Sales</span>
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-4 border-t border-dashed border-ink-400" />Average</span>
        </span>
      </div>
      <div className="mt-8 flex flex-1 flex-col">
        <AreaChart points={points} format={formatCurrency} caption="Sales for each of the last 14 days" className="flex flex-1 flex-col" height="min-h-56 flex-1" partialLast />
      </div>
    </Card>
  );
};

/* Today against the average of the 13 days before it: one gauge and a sentence. */
export const TodayVsUsual = ({ m, trend }) => {
  const before = trend.slice(0, -1);
  const usual = before.length ? before.reduce((s, d) => s + d.total, 0) / before.length : 0;
  const ratio = usual > 0 ? m.today_sales / usual : 0;
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-body font-semibold text-ink-900">Today against a usual day</h2>
      {usual > 0 ? (
        <>
          <div className="mt-4">
            <Gauge value={m.today_sales} target={usual} label={`Today is ${Math.round(ratio * 100)}% of a usual day's sales`}>
              <span className="tabular block text-[28px] font-semibold leading-none text-ink-900">{Math.round(ratio * 100)}%</span>
              <span className="mt-1 block text-caption text-ink-500">of a usual day</span>
            </Gauge>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-center">
            <div><dt className="text-caption text-ink-500">Today</dt><dd className="tabular text-small font-semibold text-ink-900">{formatCurrency(m.today_sales)}</dd></div>
            <div><dt className="text-caption text-ink-500">Usual day</dt><dd className="tabular text-small font-semibold text-ink-900">{formatCurrency(usual)}</dd></div>
          </dl>
        </>
      ) : <p className="mt-3 text-small text-ink-500">After a few days of bills, today is compared with your usual day here.</p>}
    </Card>
  );
};

/* ── How and when people bought today ────────────────────────────────────── */

const METHOD = {
  CASH: ['Cash', 'var(--color-success)'], UPI: ['UPI', 'var(--color-brand-500)'], CARD: ['Card', '#6941c6'],
  BANK_TRANSFER: ['Bank', '#0e7c6b'], CHEQUE: ['Cheque', '#b54708'], CREDIT: ['Credit', 'var(--color-warning)'], OTHER: ['Other', 'var(--color-ink-400)']
};

/* GET /reports/sales for today only (who may see reports). */
export const useTodayReport = (today, enabled) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!enabled || !today) return undefined;
    let cancelled = false;
    api(`/reports/sales?from=${today}&to=${today}`).then((d) => { if (!cancelled) setData(d); }).catch(() => { if (!cancelled) setData(false); });
    return () => { cancelled = true; };
  }, [today, enabled]);
  return data;
};

export const PaymentMix = ({ report }) => {
  const rows = report?.by_payment_method || [];
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <Card className="h-full p-5 sm:p-6">
      <h2 className="text-body font-semibold text-ink-900">How customers paid today</h2>
      <div className="mt-5">
        {total > 0 ? (
          <Donut format={formatCurrency} centerValue={rupeesShort(total)} centerLabel="received" label="Money received today by payment method"
                 parts={rows.map((r) => ({ key: r.method, label: (METHOD[r.method] || [r.method])[0], value: r.amount, color: (METHOD[r.method] || METHOD.OTHER)[1] }))} />
        ) : <EmptyChart icon={Wallet} text="Payments appear here as the day's bills are paid." />}
      </div>
    </Card>
  );
};

export const BusyHours = ({ report }) => {
  const hours = (report?.by_hour || []).map((h) => ({ hour: h.hour, value: h.total, count: h.invoice_count }));
  return (
    <Card className="h-full p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-body font-semibold text-ink-900"><Clock aria-hidden="true" className="h-4 w-4 text-ink-400" />Busiest hours today</h2>
      <div className="mt-4">
        {hours.length ? <HourBars hours={hours} format={formatCurrency} caption="Sales by hour today" /> : <EmptyChart icon={Clock} text="The day's busy hours show here once bills come in." />}
      </div>
    </Card>
  );
};

const EmptyChart = ({ icon: Icon, text }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
    <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-ink-400"><Icon className="h-5 w-5" /></span>
    <p className="max-w-56 text-small text-ink-500">{text}</p>
  </div>
);

/* ── Best sellers ────────────────────────────────────────────────────────── */

/* gold, silver, bronze for the top three */
const MEDAL = ['bg-amber-100 text-amber-800', 'bg-surface-3 text-ink-700', 'bg-orange-100 text-orange-800'];

export const TopProducts = ({ items }) => {
  const top = Math.max(...items.map((p) => p.revenue), 1);
  return (
    <Card className="h-full p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-body font-semibold text-ink-900"><Trophy aria-hidden="true" className="h-4 w-4 text-ink-400" />Best sellers this week</h2>
        <Link to="/app/reports" className="text-small font-medium text-brand-600 hover:text-brand-700">Reports</Link>
      </div>
      {items.length === 0 ? <EmptyChart icon={Trophy} text="No sales this week yet." /> : (
        <ol className="mt-4 space-y-3.5">
          {items.map((p, i) => (
            <li key={p.product_id} className="flex items-center gap-3">
              <span aria-hidden="true" className={`tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-caption font-bold ${MEDAL[i] || 'bg-surface-2 text-ink-500'}`}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3 text-small">
                  <span className="min-w-0 truncate font-medium text-ink-900">{p.name}</span>
                  <span className="tabular shrink-0 font-semibold text-ink-900">{formatCurrency(p.revenue)}</span>
                </span>
                <span className="mt-1.5 flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(p.revenue / top) * 100}%` }} />
                  </span>
                  <span className="tabular w-14 shrink-0 text-right text-caption text-ink-500">{compact(p.quantity)} sold</span>
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
};

/* ── What needs me, and what was just billed ─────────────────────────────── */

const Attention = ({ m, restaurant, canReport }) => {
  const rows = [
    m.low_stock_count > 0 && { icon: Boxes, tone: 'bg-warning/10 text-warning', to: '/app/inventory', title: `${m.low_stock_count} item${m.low_stock_count === 1 ? '' : 's'} running low`, body: 'At or below the reorder level.' },
    m.outstanding > 0 && { icon: Wallet, tone: 'bg-danger/10 text-danger', to: canReport ? '/app/reports' : '/app/billing/invoices', title: `${formatCurrency(m.outstanding)} still to collect`, body: 'Bills that are unpaid or part paid.' },
    restaurant && m.open_orders > 0 && { icon: ClipboardList, tone: 'bg-brand-50 text-brand-600', to: '/app/orders', title: `${m.open_orders} open order${m.open_orders === 1 ? '' : 's'}`, body: 'Tables and takeaways not billed yet.' }
  ].filter(Boolean);
  return (
    <Card className="flex flex-col p-5 sm:p-6">
      <h2 className="text-body font-semibold text-ink-900">Needs your attention</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-small text-ink-500">Nothing needs you right now. Stock, dues and orders are all in order.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((r) => {
            const Icon = r.icon;
            return (
              <li key={r.title}>
                <Link to={r.to} className="group flex items-center gap-3 py-3">
                  <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${r.tone}`}><Icon className="h-[18px] w-[18px]" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-small font-semibold text-ink-900">{r.title}</span>
                    <span className="block text-caption text-ink-500">{r.body}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="h-4 w-4 text-ink-400 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Link to="/app/ai" className="mt-auto flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-small font-medium text-brand-700 transition-colors duration-(--duration-fast) hover:bg-brand-100">
        <Sparkles aria-hidden="true" className="h-4 w-4" /> Ask Flow AI what else to look at
      </Link>
    </Card>
  );
};

const RecentBills = ({ bills }) => (
  <section className="rounded-(--radius-card) border border-line bg-surface">
    <div className="flex items-center justify-between px-5 pt-5 sm:px-6 sm:pt-6">
      <h2 className="text-body font-semibold text-ink-900">Latest bills</h2>
      <Link to="/app/billing/invoices" className="text-small font-medium text-brand-600 hover:text-brand-700">All invoices</Link>
    </div>
    {bills.length === 0 ? <p className="px-5 pb-5 pt-3 text-small text-ink-500 sm:px-6">No bills yet.</p> : (
      <ul className="mt-3 grid grid-cols-1 divide-y divide-line lg:grid-cols-2 lg:divide-y-0">
        {bills.map((b) => (
          <li key={b.invoice_id} className="min-w-0 lg:border-t lg:border-line lg:odd:border-r">
            <Link to={`/app/billing/invoices/${b.invoice_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 sm:px-6">
              <span aria-hidden="true" className="hidden h-8 w-8 shrink-0 sm:flex items-center justify-center rounded-full bg-surface-2 text-ink-500"><ReceiptText className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-small font-medium text-ink-900">{b.invoice_number}</span>
                <span className="block truncate text-caption text-ink-500">{b.customer_name || 'Walk-in'} · {time(b.created_at)}</span>
              </span>
              <StatusBadge status={b.payment_status} />
              <span className="tabular shrink-0 text-right text-small font-semibold text-ink-900 sm:w-24">{formatCurrency(b.total)}</span>
            </Link>
          </li>
        ))}
      </ul>
    )}
  </section>
);

const Setup = ({ setup }) => (
  <Card className="p-5 sm:p-6">
    <div className="flex items-center justify-between gap-4">
      <div>
        <h2 className="text-body font-semibold text-ink-900">Get ready to bill</h2>
        <p className="mt-1 text-small text-ink-500">{setup.done_count} of {setup.total_count} steps done. About five minutes to your first bill.</p>
      </div>
      <span className="tabular text-small font-semibold text-ink-900">{Math.round((setup.done_count / setup.total_count) * 100)}%</span>
    </div>
    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-3">
      <div className="h-full rounded-full bg-brand-500 transition-[width] duration-(--duration-slow)" style={{ width: `${(setup.done_count / setup.total_count) * 100}%` }} />
    </div>
    <ul className="mt-3 divide-y divide-line">
      {setup.checklist.map((item) => (
        <li key={item.key} className="flex items-center gap-3 py-3">
          <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${item.done ? 'bg-success text-white' : 'border border-line-strong'}`}>{item.done ? '✓' : ''}</span>
          <span className={`flex-1 text-small ${item.done ? 'text-ink-500 line-through' : 'text-ink-900'}`}>
            {item.label}{item.optional && <span className="ml-2 text-caption text-ink-500">optional</span>}
            <span className="sr-only">{item.done ? ' (done)' : ' (to do)'}</span>
          </span>
          {!item.done && <Link to={item.href} className="text-small font-medium text-brand-600 hover:text-brand-700">Do it</Link>}
        </li>
      ))}
    </ul>
  </Card>
);

const Loading = () => (
  <div className="mx-auto max-w-6xl space-y-6">
    <Skeleton className="h-28" />
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36" />)}</div>
    <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-80 lg:col-span-2" /><Skeleton className="h-80" /></div>
  </div>
);

const Dashboard = () => {
  const { user, business, activeOutlet } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  /* Refetches when the business changes, so another business's figures never linger. */
  useEffect(() => {
    let cancelled = false;
    api('/dashboard')
      .then((result) => { if (!cancelled) setData(result); })
      .catch((caught) => { if (!cancelled) setError(caught.message); });
    return () => { cancelled = true; };
  }, [business?.business_id]);

  const today = useTodayReport(data?.metrics?.today, Boolean(data?.sales));

  if (error) return <p role="alert" className="text-small text-danger">Could not load the dashboard. {error}</p>;
  if (!data) return <Loading />;

  const { setup, metrics: m, sales } = data;
  const restaurant = ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'GAMING_CAFE', 'RACING'].includes(business.business_type);
  const firstName = String(user?.name || '').split(' ')[0];

  // Waiters and kitchen staff are sent no takings at all (the server leaves the figures out): a greeting and the way to their work.
  if (!m) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <DashboardHeader
          title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
          lead={`${business.name}${activeOutlet?.name ? ` · ${activeOutlet.name}` : ''}`}
          action={<>
            {restaurant && <Button to="/app/orders" variant="secondary">Orders</Button>}
            <Button to="/app/billing"><Plus aria-hidden="true" className="h-4 w-4" />New sale</Button>
          </>}
        />
        {!setup.complete && <Setup setup={setup} />}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:gap-5 [&>*:first-child]:mb-1">
      <DashboardHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        lead={`${business.name}${activeOutlet?.name ? ` · ${activeOutlet.name}` : ''} · ${longDate(m.today)}`}
        action={<>
          <Button to="/app/ai" variant="ghost" className="bg-surface/70 text-brand-700 ring-1 ring-brand-100 hover:bg-surface hover:text-brand-700"><Sparkles aria-hidden="true" className="h-4 w-4" />Ask Flow AI</Button>
          {sales && <Button to="/app/reports" variant="secondary">Reports</Button>}
          <Button to="/app/billing"><Plus aria-hidden="true" className="h-4 w-4" />New sale</Button>
        </>}
      />

      {business.role === 'OWNER' && <div className="rise" style={{ '--i': 1 }}><PlanStrip /></div>}

      {!setup.complete && <div className="rise" style={{ '--i': 1 }}><Setup setup={setup} /></div>}

      <div className="rise" style={{ '--i': 1 }}><TodayFigures m={m} trend={sales?.trend} /></div>

      {RETAIL_TYPES.includes(business.business_type) && <div className="rise" style={{ '--i': 2 }}><RetailPanel /></div>}

      <div className="rise grid gap-4 sm:gap-5 lg:grid-cols-3" style={{ '--i': 2 }}>
        {sales && <div className="lg:col-span-2"><SalesChart trend={sales.trend} /></div>}
        <div className={`flex flex-col gap-4 sm:gap-5 ${sales ? '' : 'lg:col-span-3'}`}>
          {sales && <TodayVsUsual m={m} trend={sales.trend} />}
          <Attention m={m} restaurant={restaurant} canReport={Boolean(sales)} />
        </div>
      </div>

      {sales && (
        <div className="rise grid gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3" style={{ '--i': 3 }}>
          <PaymentMix report={today || null} />
          <BusyHours report={today || null} />
          <div className="md:col-span-2 lg:col-span-1"><TopProducts items={sales.top_products} /></div>
        </div>
      )}

      {sales && <div className="rise" style={{ '--i': 4 }}><RecentBills bills={sales.recent_invoices} /></div>}
    </div>
  );
};

export default Dashboard;
