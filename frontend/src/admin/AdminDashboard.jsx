/*
 * The overview: what has been collected (this month, this year, all time, with the change on the one before), how the last twelve months went, and who
 * needs a nudge (a payment link nobody has paid, a trial about to end). Staff whose role cannot see revenue get the customer side only.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
import { formatCurrency } from '../lib/api.js';
import LaunchChecks from './LaunchChecks.jsx';
import { useAdminAuth } from './AdminAuthContext.jsx';
import { PageHeader, Card, SkeletonCards, Alert } from '../components/ui.jsx';

/* ₹1.2L, ₹3.4Cr, ₹850: short enough for an axis */
const compact = (n) => {
  const v = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (v >= 1e7) return `${sign}₹${+(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${sign}₹${+(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${sign}₹${+(v / 1e3).toFixed(1)}K`;
  return `${sign}₹${Math.round(v)}`;
};

/* a round top for the axis: 1, 2, 2.5, 5 or 10 times a power of ten, split into four steps */
const niceMax = (max) => {
  if (max <= 0) return 4;
  const step = max / 4;
  const mag = 10 ** Math.floor(Math.log10(step));
  const f = step / mag;
  const nice = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  return nice * 4;
};

/* the last twelve months, oldest first, with the months nobody paid in as zero so the bars keep their place */
const lastTwelve = (rows) => {
  const byMonth = new Map(rows.map((m) => [m.month, m.amount]));
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return {
      key,
      label: d.toLocaleDateString([], { month: 'long', year: 'numeric' }),
      axis: d.toLocaleDateString([], { month: 'short' }),
      year: d.getFullYear(),
      value: byMonth.get(key) || 0,
      current: i === 11
    };
  });
};

const W = 720;
const H = 260;
const PAD = { l: 52, r: 12, t: 14, b: 30 };

const RevenueChart = ({ points }) => {
  const [hover, setHover] = useState(null);
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const slot = innerW / points.length;
  const barW = Math.min(34, slot * 0.62);
  const y = (v) => PAD.t + innerH - (v / max) * innerH;
  const total = points.reduce((s, p) => s + p.value, 0);
  const shown = hover != null ? points[hover] : null;

  if (!total) return <p className="py-10 text-center text-small text-ink-500">No payments collected in the last 12 months yet.</p>;

  return (
    <div>
      <p className="tabular mb-1 h-5 text-small text-ink-700" aria-live="polite">
        {shown ? <><span className="font-semibold text-ink-900">{shown.label}</span> · {formatCurrency(shown.value)}</> : <span className="text-ink-500">Hover a bar for the month's total</span>}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Money collected each month, last 12 months. ${formatCurrency(total)} in all.`} onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (max / 4) * i;
          return (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth="1" strokeDasharray={i === 0 ? undefined : '3 4'} />
              <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-500)">{compact(v)}</text>
            </g>
          );
        })}
        {points.map((p, i) => {
          const x = PAD.l + slot * i + (slot - barW) / 2;
          const top = y(p.value);
          const h = Math.max(p.value ? 3 : 0, PAD.t + innerH - top);
          const on = hover === i;
          return (
            <g key={p.key} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${p.label}: ${formatCurrency(p.value)}`} className="outline-none">
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={innerH} fill="transparent" />
              <rect x={x} y={PAD.t + innerH - h} width={barW} height={h} rx="5" ry="5"
                    fill={on || p.current ? 'var(--color-brand-500)' : 'var(--color-brand-200)'} style={{ transition: 'fill 120ms' }} />
              {p.value > 0 && (on || p.current) && <text x={x + barW / 2} y={PAD.t + innerH - h - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--color-ink-900)">{compact(p.value)}</text>}
              <text x={PAD.l + slot * i + slot / 2} y={H - 10} textAnchor="middle" fontSize="11" fill={p.current ? 'var(--color-ink-900)' : 'var(--color-ink-500)'} fontWeight={p.current ? 600 : 400}>{p.axis}</text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only"><caption>Money collected by month</caption><tbody>{points.map((p) => <tr key={p.key}><th>{p.label}</th><td>{formatCurrency(p.value)}</td></tr>)}</tbody></table>
    </div>
  );
};

/* a figure, with how it compares to the one before: ▲ 12% or ▼ 8% */
const Change = ({ now, before, unit }) => {
  if (!before) return <span className="text-caption text-ink-500">{now ? `Nothing in the ${unit} before` : `Nothing yet this ${unit}`}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const up = pct >= 0;
  return (
    <span className={`text-caption font-medium ${up ? 'text-success' : 'text-danger'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}% <span className="font-normal text-ink-500">vs last {unit} ({compact(before)})</span>
    </span>
  );
};

const Money = ({ label, value, children, strong }) => (
  <div className={`flex min-w-0 flex-col rounded-(--radius-card) border p-5 ${strong ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-surface'}`}>
    <span className={`text-caption font-medium ${strong ? 'text-brand-100' : 'text-ink-500'}`}>{label}</span>
    <span className="tabular mt-2 text-[28px] font-semibold leading-none tracking-tight">{value}</span>
    <span className={`mt-3 ${strong ? '[&_*]:!text-white/85' : ''}`}>{children}</span>
  </div>
);

const Count = ({ label, value, tone = 'text-ink-900', to }) => {
  const body = (<><span className={`tabular block text-title font-semibold ${tone}`}>{value}</span><span className="block text-caption text-ink-500">{label}</span></>);
  return to ? <Link to={to} className="block rounded-lg px-3 py-2 hover:bg-surface-2">{body}</Link> : <div className="px-3 py-2">{body}</div>;
};

const daysLeft = (iso) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));

const AdminDashboard = () => {
  const { admin } = useAdminAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { adminApi('/stats').then(setStats).catch((err) => setError(err.message)); }, []);

  const money = Boolean(stats?.revenue_periods);
  const points = useMemo(() => lastTwelve(stats?.revenue_by_month || []), [stats]);
  const owner = admin?.permissions?.includes('owner');
  const p = stats?.revenue_periods;
  const b = stats?.businesses;

  return (
    <div>
      <PageHeader title="Overview" lead={money ? 'What FlowXP has collected, and who needs a nudge.' : 'Every FlowXP business at a glance.'} />
      {owner && <LaunchChecks />}
      {error && <Alert>{error}</Alert>}

      {!stats ? <SkeletonCards count={4} /> : (
        <div className="space-y-6">
          {money && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Money label="Collected this month" value={formatCurrency(p.this_month)} strong><Change now={p.this_month} before={p.last_month} unit="month" /></Money>
              <Money label="Collected this year" value={formatCurrency(p.this_year)}><Change now={p.this_year} before={p.last_year} unit="year" /></Money>
              <Money label="Monthly recurring (MRR)" value={formatCurrency(stats.mrr)}><span className="text-caption text-ink-500">From {b.paying} paying business{b.paying === 1 ? '' : 'es'}</span></Money>
              <Money label="Collected, all time" value={formatCurrency(stats.revenue_collected)}><span className="text-caption text-ink-500">{stats.payments_collected} payment{stats.payments_collected === 1 ? '' : 's'}</span></Money>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {money && (
              <Card className="lg:col-span-2">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-title font-semibold text-ink-900">Money collected</h2>
                  <span className="text-caption text-ink-500">Last 12 months · plans, add-ons and invoices, online or by hand</span>
                </div>
                <RevenueChart points={points} />
              </Card>
            )}

            <div className={`space-y-6 ${money ? '' : 'lg:col-span-3 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0'}`}>
              <Card>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-title font-semibold text-ink-900">Waiting for payment</h2>
                  {stats.pending_payments.count > 0 && money && <span className="tabular text-small font-medium text-ink-900">{formatCurrency(stats.pending_payments.total_amount)}</span>}
                </div>
                {stats.pending_payments.list.length ? (
                  <ul className="divide-y divide-line text-small">
                    {stats.pending_payments.list.map((x) => (
                      <li key={x.order_id}>
                        <Link to={`/superadmin/businesses/${x.business_id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-700">
                          <span className="min-w-0 truncate text-ink-900">{x.business_name}</span>
                          <span className="tabular shrink-0 text-ink-500">{formatCurrency(x.amount)} · {new Date(x.created_at).toLocaleDateString()}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-small text-ink-500">Nothing outstanding.</p>}
                {stats.pending_payments.count > 0 && <p className="mt-3 text-caption text-ink-500">Paid in cash or by UPI? Open the business and choose Mark paid on its link.</p>}
              </Card>

              <Card>
                <h2 className="mb-3 text-title font-semibold text-ink-900">Trials ending soon</h2>
                {stats.trials_ending_soon_list.length ? (
                  <ul className="divide-y divide-line text-small">
                    {stats.trials_ending_soon_list.map((t) => (
                      <li key={t.business_id}>
                        <Link to={`/superadmin/businesses/${t.business_id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-700">
                          <span className="min-w-0 truncate text-ink-900">{t.name}</span>
                          <span className="shrink-0 font-medium text-warning">{daysLeft(t.trial_ends_at)} day{daysLeft(t.trial_ends_at) === 1 ? '' : 's'} left</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-small text-ink-500">None in the next 2 days.</p>}
              </Card>
            </div>
          </div>

          <Card className="!p-3">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-8">
              <Count label="Businesses" value={b.total} to="/superadmin/businesses" />
              <Count label="Active" value={b.active} tone="text-success" />
              <Count label="Paying" value={b.paying} tone="text-success" />
              <Count label="On trial" value={b.on_trial} />
              <Count label="Trial expired" value={b.expired} tone={b.expired ? 'text-warning' : 'text-ink-900'} />
              <Count label="Suspended" value={b.suspended} tone={b.suspended ? 'text-danger' : 'text-ink-900'} />
              <Count label="Registered users" value={stats.users_total} />
              <Count label="Invoices issued" value={stats.invoices_total} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
