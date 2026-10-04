/*
 * The overview: the numbers a platform operator checks first — how many
 * tenants, how many are paying, how much has actually been collected, and
 * who needs a nudge (a trial about to end, a payment link nobody's paid yet).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
import { formatCurrency } from '../lib/api.js';
import { PageHeader, Card, SkeletonCards, Alert, StatCard } from '../components/ui.jsx';

const Stat = (props) => <StatCard size="lg" {...props} />;

/* Same visual language as ReportsPage.jsx's Columns: one series, brand blue, the tallest labelled,
   a screen-reader table underneath. Kept local rather than shared across app/ and admin/ — a few
   lines, not worth a cross-folder import for. */
const MonthlyRevenue = ({ points }) => {
  const [hover, setHover] = useState(null);
  const max = Math.max(...points.map((p) => p.value), 0);
  if (!max) return <p className="py-6 text-center text-small text-ink-500">No subscription payments collected yet.</p>;
  const shown = hover != null ? points[hover] : points.reduce((a, b) => (b.value > a.value ? b : a));
  return (
    <div>
      <p className="tabular mb-2 h-5 text-small text-ink-700">
        <span className="font-semibold text-ink-900">{shown.label}</span> · {formatCurrency(shown.value)}
        {hover == null && <span className="text-ink-500"> (the most)</span>}
      </p>
      <div className="flex h-40 items-end gap-1.5" onMouseLeave={() => setHover(null)}>
        {points.map((p, i) => (
          <button key={p.key} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  aria-label={`${p.label}: ${formatCurrency(p.value)}`} className="group flex h-full min-w-0 flex-1 items-end focus:outline-none">
            <span className={`block w-full rounded-t-[3px] transition-colors duration-(--duration-fast) ${hover === i ? 'bg-brand-700' : 'bg-brand-500'} group-focus-visible:ring-2 group-focus-visible:ring-brand-700`}
                  style={{ height: `${p.value ? Math.max(2, (p.value / max) * 100) : 0}%` }} />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-caption text-ink-500"><span>{points[0].axis}</span><span>{points[points.length - 1].axis}</span></div>
      <table className="sr-only"><caption>Subscription revenue by month</caption><tbody>{points.map((p) => <tr key={p.key}><th>{p.label}</th><td>{formatCurrency(p.value)}</td></tr>)}</tbody></table>
    </div>
  );
};

const daysLeft = (iso) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));

const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi('/stats').then(setStats).catch((err) => setError(err.message));
  }, []);

  const months = (stats?.revenue_by_month || []).map((m) => ({
    key: m.month,
    label: new Date(`${m.month}-01`).toLocaleDateString([], { month: 'long', year: 'numeric' }),
    axis: new Date(`${m.month}-01`).toLocaleDateString([], { month: 'short' }),
    value: m.amount
  }));

  return (
    <div>
      <PageHeader title="Overview" lead="Every FlowXP tenant, at a glance." />

      {error && <Alert>{error}</Alert>}

      {!stats ? (
        <SkeletonCards count={8} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total businesses" value={stats.businesses.total} />
            <Stat label="Active" value={stats.businesses.active} tone="text-success" />
            <Stat label="On trial" value={stats.businesses.on_trial} />
            <Stat label="Paying" value={stats.businesses.paying} tone="text-success" />
            <Stat label="Trial expired" value={stats.businesses.expired} tone="text-warning" />
            <Stat label="Suspended" value={stats.businesses.suspended} tone="text-danger" />
            <Stat label="Registered users" value={stats.users_total} />
            <Stat label="Invoices issued" value={stats.invoices_total} />
            <Stat label="MRR" value={formatCurrency(stats.mrr)} tone="text-brand-600" />
            <Stat label="Revenue collected" value={formatCurrency(stats.revenue_collected)} tone="text-brand-600" />
            <Stat label="Trials ending in 2 days" value={stats.businesses.trials_ending_soon} tone="text-warning" />
            <Stat label="Payments awaiting" value={stats.pending_payments.count} tone={stats.pending_payments.count ? 'text-warning' : 'text-ink-900'} />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Subscription revenue, last 12 months</h2>
              <MonthlyRevenue points={months} />
              <p className="mt-3 text-xs text-ink-400">
                From Cashfree payment links actually paid — see <Link to="/superadmin/businesses" className="text-brand-600 hover:underline">Businesses</Link> to send one.
              </p>
            </Card>

            <div className="space-y-4">
              <Card>
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-400">Trials ending soon</h2>
                {stats.trials_ending_soon_list.length ? (
                  <ul className="space-y-2.5 text-sm">
                    {stats.trials_ending_soon_list.map((t) => (
                      <li key={t.business_id} className="flex items-center justify-between gap-3">
                        <Link to={`/superadmin/businesses/${t.business_id}`} className="min-w-0 truncate text-ink-900 hover:text-brand-700">{t.name}</Link>
                        <span className="shrink-0 text-warning">{daysLeft(t.trial_ends_at)} day{daysLeft(t.trial_ends_at) === 1 ? '' : 's'} left</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-ink-400">None in the next 2 days.</p>}
              </Card>

              <Card>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-ink-400">Payments awaiting</h2>
                  {stats.pending_payments.count > 0 && <span className="tabular text-sm font-medium text-ink-900">{formatCurrency(stats.pending_payments.total_amount)}</span>}
                </div>
                {stats.pending_payments.list.length ? (
                  <ul className="space-y-2.5 text-sm">
                    {stats.pending_payments.list.map((p) => (
                      <li key={p.order_id} className="flex items-center justify-between gap-3">
                        <Link to={`/superadmin/businesses/${p.business_id}`} className="min-w-0 truncate text-ink-900 hover:text-brand-700">{p.business_name}</Link>
                        <span className="tabular shrink-0 text-ink-500">{formatCurrency(p.amount)} · {new Date(p.created_at).toLocaleDateString()}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-ink-400">Nothing outstanding.</p>}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminDashboard;
