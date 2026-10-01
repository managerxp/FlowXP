/*
 * The dashboard: the day at a glance (design.md §26–27).
 *
 * It answers, in order: how is today going (four figures, each against
 * yesterday), how have the last two weeks gone (one chart), what needs me
 * (a short list with links), and what is selling and what was just billed.
 * Everything comes from /api/dashboard; the sales detail is only returned to
 * people who may see reports, so a cashier sees today and the to-do list.
 * A business with no bills yet sees its setup checklist first.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Boxes, ChevronRight, ClipboardList, Plus, Sparkles, Wallet } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AnimatedNumber, Button, Card, Skeleton, StatCard, StatusBadge } from '../components/ui.jsx';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const longDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const time = (ts) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const compact = (n) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/* "↑ 12.4% on yesterday", in words as well as colour. */
const Change = ({ now, before, money = true }) => {
  if (!before && !now) return <span className="text-ink-500">Nothing yet today</span>;
  if (!before) return <span className="text-ink-500">No sales yesterday</span>;
  const pct = ((now - before) / before) * 100;
  if (Math.abs(pct) < 0.5) return <span className="text-ink-500">Same as yesterday</span>;
  const up = pct > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <>
      <span className={`flex items-center gap-1 font-medium ${up ? 'text-success' : 'text-danger'}`}>
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        {up ? 'Up' : 'Down'} {Math.abs(pct).toFixed(1)}%<span className="hidden sm:inline">&nbsp;on yesterday</span>
      </span>
      <span className="tabular block text-caption text-ink-500">Yesterday: {money ? formatCurrency(before) : before}</span>
    </>
  );
};

const Kpi = ({ children, ...props }) => (
  <StatCard size="lg" {...props}>{children && <div className="mt-2.5 text-small">{children}</div>}</StatCard>
);

/*
 * Fourteen days of sales as bars (one series, the brand blue, validated
 * against the surface). Bars are rounded at the top only and sit on the
 * baseline; hovering or focusing one shows its day, total and bill count.
 * A visually hidden table carries the same numbers for screen readers.
 */
const SalesChart = ({ trend }) => {
  const [hover, setHover] = useState(null);
  const max = Math.max(...trend.map((d) => d.total), 1);
  const total = trend.reduce((s, d) => s + d.total, 0);
  const shown = hover ?? trend.length - 1;
  const day = trend[shown];
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold text-ink-900">Sales, last 14 days</h2>
          <p className="tabular mt-1 text-small text-ink-500">{formatCurrency(total)} from {trend.reduce((s, d) => s + d.invoice_count, 0)} bills</p>
        </div>
        <div className="text-right" aria-live="polite">
          <p className="text-caption text-ink-500">{shown === trend.length - 1 ? 'Today' : shortDay(day.date)}</p>
          <p className="tabular text-title font-semibold text-ink-900">{formatCurrency(day.total)}</p>
          <p className="tabular text-caption text-ink-500">{day.invoice_count} bills</p>
        </div>
      </div>

      <div className="mt-6 flex h-44 items-end gap-[2px]" onMouseLeave={() => setHover(null)} aria-hidden="true">
        {trend.map((d, i) => (
          <div key={d.date} className="group flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <div
              className={`w-full rounded-t-[4px] bg-brand-500 transition-opacity duration-(--duration-fast) ${hover != null && hover !== i ? 'opacity-40' : ''}`}
              style={{ height: `${Math.max((d.total / max) * 100, d.total > 0 ? 2 : 0.5)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[2px] border-t border-line pt-2" aria-hidden="true">
        {trend.map((d, i) => (
          <span key={d.date} className={`flex-1 text-center text-[11px] ${i === trend.length - 1 ? 'font-semibold text-ink-900' : 'text-ink-400'}`}>
            {i === trend.length - 1 ? 'Today' : i % 3 === 1 ? shortDay(d.date) : ''}
          </span>
        ))}
      </div>
      <p className="mt-3 text-caption text-ink-500">Highest day: {formatCurrency(max)} · scale starts at ₹0</p>

      <table className="sr-only">
        <caption>Sales for each of the last 14 days</caption>
        <thead><tr><th>Day</th><th>Sales</th><th>Bills</th></tr></thead>
        <tbody>{trend.map((d) => <tr key={d.date}><td>{longDate(d.date)}</td><td>{formatCurrency(d.total)}</td><td>{d.invoice_count}</td></tr>)}</tbody>
      </table>
    </Card>
  );
};

/* The short to-do list: only rows that need doing, each a link to do it. */
const Attention = ({ m, restaurant, canReport }) => {
  const rows = [
    m.low_stock_count > 0 && { icon: Boxes, to: '/app/inventory', title: `${m.low_stock_count} item${m.low_stock_count === 1 ? '' : 's'} running low`, body: 'At or below the reorder level. Check stock or order more.' },
    m.outstanding > 0 && { icon: Wallet, to: canReport ? '/app/reports' : '/app/billing/invoices', title: `${formatCurrency(m.outstanding)} still to collect`, body: 'Bills that are unpaid or part paid.' },
    restaurant && m.open_orders > 0 && { icon: ClipboardList, to: '/app/orders', title: `${m.open_orders} open order${m.open_orders === 1 ? '' : 's'}`, body: 'Tables and takeaways not billed yet.' }
  ].filter(Boolean);
  return (
    <Card className="flex flex-col p-5 sm:p-6">
      <h2 className="text-body font-semibold text-ink-900">Needs your attention</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-small text-ink-500">Nothing needs you right now. Stock, dues and orders are all in order.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((r) => {
            const Icon = r.icon;
            return (
              <li key={r.title}>
                <Link to={r.to} className="group flex items-start gap-3 py-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning"><Icon aria-hidden="true" className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-small font-semibold text-ink-900">{r.title}</span>
                    <span className="block text-caption text-ink-500">{r.body}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="mt-2 h-4 w-4 text-ink-400 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Link to="/app/ai" className="mt-auto flex items-center gap-2 border-t border-line pt-4 text-small font-medium text-brand-600 hover:text-brand-700">
        <Sparkles aria-hidden="true" className="h-4 w-4" /> Ask Flow AI what else to look at
      </Link>
    </Card>
  );
};

const TopProducts = ({ items }) => {
  const top = Math.max(...items.map((p) => p.revenue), 1);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-body font-semibold text-ink-900">Best sellers this week</h2>
        <Link to="/app/reports" className="text-small font-medium text-brand-600 hover:text-brand-700">Reports</Link>
      </div>
      {items.length === 0 ? <p className="mt-3 text-small text-ink-500">No sales this week yet.</p> : (
        <ol className="mt-4 space-y-3.5">
          {items.map((p, i) => (
            <li key={p.product_id}>
              <div className="flex items-baseline justify-between gap-3 text-small">
                <span className="min-w-0 truncate text-ink-900"><span className="tabular mr-2 text-ink-400">{i + 1}</span>{p.name}</span>
                <span className="tabular shrink-0 font-medium text-ink-900">{formatCurrency(p.revenue)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(p.revenue / top) * 100}%` }} />
                </div>
                <span className="tabular w-14 shrink-0 text-right text-caption text-ink-500">{compact(p.quantity)} sold</span>
              </div>
            </li>
          ))}
        </ol>
      )}
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
      <ul className="mt-3 divide-y divide-line">
        {bills.map((b) => (
          <li key={b.invoice_id}>
            <Link to={`/app/billing/invoices/${b.invoice_id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2 sm:px-6">
              <span className="min-w-0 flex-1">
                <span className="block text-small font-medium text-ink-900">{b.invoice_number}</span>
                <span className="block truncate text-caption text-ink-500">{b.customer_name || 'Walk-in'} · {time(b.created_at)}</span>
              </span>
              <StatusBadge status={b.payment_status} />
              <span className="tabular w-24 text-right text-small font-semibold text-ink-900">{formatCurrency(b.total)}</span>
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
    <div className="space-y-2"><Skeleton className="h-8 w-72" /><Skeleton className="h-4 w-56" /></div>
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
    <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-72 lg:col-span-2" /><Skeleton className="h-72" /></div>
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

  if (error) return <p role="alert" className="text-small text-danger">Could not load the dashboard. {error}</p>;
  if (!data) return <Loading />;

  const { setup, metrics: m, sales } = data;
  const restaurant = ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'GAMING_CAFE', 'RACING'].includes(business.business_type);
  const avg = m.today_invoice_count ? m.today_sales / m.today_invoice_count : 0;
  const avgBefore = m.yesterday_invoice_count ? m.yesterday_sales / m.yesterday_invoice_count : 0;
  const firstName = String(user?.name || '').split(' ')[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h3 font-semibold text-ink-900">{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="mt-1 text-small text-ink-500">
            {business.name}{activeOutlet?.name ? ` · ${activeOutlet.name}` : ''} · {longDate(m.today)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sales && <Button to="/app/reports" variant="secondary">Reports</Button>}
          <Button to="/app/billing"><Plus aria-hidden="true" className="h-4 w-4" />New sale</Button>
        </div>
      </div>

      {!setup.complete && <div className="rise" style={{ '--i': 1 }}><Setup setup={setup} /></div>}

      <section aria-label="Today" className="rise grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" style={{ '--i': 1 }}>
        <Kpi label="Today's sales" value={<AnimatedNumber value={m.today_sales} format={formatCurrency} />}><Change now={m.today_sales} before={m.yesterday_sales} /></Kpi>
        <Kpi label="Bills today" value={<AnimatedNumber value={m.today_invoice_count} />}><Change now={m.today_invoice_count} before={m.yesterday_invoice_count} money={false} /></Kpi>
        <Kpi label="Average bill" value={<AnimatedNumber value={avg} format={formatCurrency} />}><Change now={avg} before={avgBefore} /></Kpi>
        <Kpi label="To collect" value={<AnimatedNumber value={m.outstanding} format={formatCurrency} />} to="/app/billing/invoices">
          <span className="text-ink-500">Unpaid and part-paid bills</span>
        </Kpi>
      </section>

      <div className="rise grid gap-4 lg:grid-cols-3" style={{ '--i': 2 }}>
        {sales ? <div className="lg:col-span-2"><SalesChart trend={sales.trend} /></div> : null}
        <div className={sales ? '' : 'lg:col-span-3'}><Attention m={m} restaurant={restaurant} canReport={Boolean(sales)} /></div>
      </div>

      {sales && (
        <div className="rise grid gap-4 lg:grid-cols-2" style={{ '--i': 3 }}>
          <TopProducts items={sales.top_products} />
          <RecentBills bills={sales.recent_invoices} />
        </div>
      )}
    </div>
  );
};

export default Dashboard;
