/*
 * The overview: the numbers a platform operator checks first — how many
 * tenants, how many are paying, how much has actually been collected.
 */
import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { formatCurrency } from '../lib/api.js';
import { PageHeader, SkeletonCards, Alert } from '../components/ui.jsx';

const Stat = ({ label, value, tone = 'text-ink-900' }) => (
  <div className="glass rounded-[--radius-card] p-5">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">{label}</p>
    <p className={`mt-2 text-2xl font-bold tracking-tight ${tone}`}>{value}</p>
  </div>
);

const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi('/stats').then(setStats).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <PageHeader title="Overview" lead="Every FlowXP tenant, at a glance." />

      {error && <Alert>{error}</Alert>}

      {!stats ? (
        <SkeletonCards count={8} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total businesses" value={stats.businesses.total} />
          <Stat label="Active" value={stats.businesses.active} tone="text-success" />
          <Stat label="Suspended" value={stats.businesses.suspended} tone="text-danger" />
          <Stat label="On trial" value={stats.businesses.on_trial} />
          <Stat label="Paying" value={stats.businesses.paying} tone="text-success" />
          <Stat label="Trial expired" value={stats.businesses.expired} tone="text-warning" />
          <Stat label="Trials ending in 2 days" value={stats.businesses.trials_ending_soon} tone="text-warning" />
          <Stat label="Registered users" value={stats.users_total} />
          <Stat label="Invoices issued" value={stats.invoices_total} />
          <Stat label="Revenue collected" value={formatCurrency(stats.revenue_collected)} tone="text-brand-600" />
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
