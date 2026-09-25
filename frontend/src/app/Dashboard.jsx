/*
 * The dashboard.
 *
 * Today's sales, top products and the charts the brief asks for arrive with
 * billing — there are no invoices in the database yet, so there is nothing
 * true to plot. The API says so explicitly (metrics_available), and this
 * screen shows the setup checklist in that space rather than a row of ₹0
 * tiles that would read as "you sold nothing today".
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, Card, Skeleton, SkeletonCards } from '../components/ui.jsx';

const Tile = ({ label, value, hint }) => (
  <Card>
    <p className="text-xs font-medium uppercase tracking-wider text-ink-400">{label}</p>
    <p className="mt-2 text-2xl font-bold tracking-tight text-ink-900">{value}</p>
    {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
  </Card>
);

const ChecklistItem = ({ item }) => (
  <li className="flex items-center gap-3 py-3">
    <span
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
        item.done ? 'bg-success text-white' : 'border border-line-strong text-ink-400'
      }`}
    >
      {item.done ? '✓' : ''}
    </span>
    <span className={`flex-1 text-sm ${item.done ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
      {item.label}
      {item.optional && <span className="ml-2 text-xs text-ink-400">optional</span>}
    </span>
    {!item.done && (
      <Link to={item.href} className="text-xs font-semibold text-brand-600">Do it</Link>
    )}
  </li>
);

const Dashboard = () => {
  const { business } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  /* Refetches when the selected business changes — without businessId in the
     deps, switching business would leave the previous one's figures on screen. */
  useEffect(() => {
    let cancelled = false;
    api('/dashboard')
      .then((result) => { if (!cancelled) setData(result); })
      .catch((caught) => { if (!cancelled) setError(caught.message); });
    return () => { cancelled = true; };
  }, [business?.business_id]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) {
    return (
      <div className="mx-auto max-w-5xl space-y-7">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="glass space-y-4 rounded-[--radius-card] p-6">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-1.5 w-full" />
          <div className="space-y-3 pt-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
          </div>
        </div>
        <SkeletonCards count={4} />
      </div>
    );
  }

  const { setup, counts, subscription, metrics_available: metricsAvailable } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          {setup.complete ? `Welcome back, ${business.name}` : 'Let’s get you billing'}
        </h1>
        <p className="mt-1.5 text-sm text-ink-500">
          {setup.complete
            ? 'Everything is set up. Sales figures appear here once billing goes live.'
            : `${setup.done_count} of ${setup.total_count} steps done — about five minutes to your first invoice.`}
        </p>
      </div>

      {!setup.complete && (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-ink-900">Setup</h2>
            <span className="text-xs text-ink-400">{setup.done_count}/{setup.total_count}</span>
          </div>

          {/* A plain div, not <progress>: styling <progress> consistently
              across browsers is more CSS than the bar is worth. */}
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="bg-gradient-brand h-full rounded-full transition-[width]"
              style={{ width: `${(setup.done_count / setup.total_count) * 100}%` }}
            />
          </div>

          <ul className="mt-3 divide-y divide-line">
            {setup.checklist.map((item) => <ChecklistItem key={item.key} item={item} />)}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Products" value={counts.products} />
        <Tile label="Customers" value={counts.customers} />
        <Tile label="Invoices" value={counts.invoices} />
        <Tile
          label="Plan"
          value={subscription.status === 'TRIAL' ? 'Free trial' : subscription.plan_code}
          hint={
            subscription.status === 'TRIAL'
              ? `${subscription.trial_days_remaining} days left`
              : subscription.status.toLowerCase()
          }
        />
      </div>

      {/* Honest about what is not here yet, rather than an empty chart that
          looks like a bad trading day. */}
      {!metricsAvailable && (
        <Card className="text-center">
          <h2 className="text-sm font-semibold text-ink-900">Sales figures</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
            Today’s sales, payments, outstanding and your top products appear here as soon
            as you raise your first invoice.
          </p>
          <Button to="/app/billing" className="mt-5" size="sm">Go to billing</Button>
        </Card>
      )}

      <Card className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Ask Flow AI</h2>
          <p className="mt-1 text-sm text-ink-500">
            “How much did I sell today?” · “Who owes me money?” · “What should I reorder?”
          </p>
        </div>
        <Button to="/app/ai" size="sm">Ask Flow AI</Button>
      </Card>
    </div>
  );
};

export default Dashboard;
