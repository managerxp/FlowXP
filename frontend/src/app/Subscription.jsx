/*
 * /app/settings/subscription
 *
 * Reads the real state — status, trial window, plan, limits. There is no
 * fixed self-serve price to "Upgrade" into (Option B, 2026-09-28): a super
 * admin sets a price for this business and sends a Cashfree hosted payment
 * link, which shows up here as pending_payment until it's paid.
 */
import { useEffect, useState } from 'react';
import { api, formatMoney, formatCurrency } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, Card } from '../components/ui.jsx';

const STATUS_LABEL = {
  TRIAL: 'Free trial',
  ACTIVE: 'Active',
  EXPIRED: 'Trial ended',
  CANCELLED: 'Cancelled',
  SUSPENDED: 'Suspended'
};

const Row = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4 py-3">
    <dt className="text-sm text-ink-500">{label}</dt>
    <dd className="text-sm font-medium text-ink-900">{children}</dd>
  </div>
);

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const Subscription = () => {
  const { business } = useAuth();
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api('/businesses/current/subscription'), api('/plans')])
      .then(([subscription, planList]) => { setData(subscription); setPlans(planList); })
      .catch((caught) => setError(caught.message));
  }, [business?.business_id]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-ink-400">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-h3 font-semibold text-ink-900">Subscription</h1>

      <Card>
        <dl className="divide-y divide-line">
          <Row label="Status">
            <span className={data.status === 'EXPIRED' ? 'text-warning' : 'text-ink-900'}>
              {STATUS_LABEL[data.status] ?? data.status}
            </span>
          </Row>
          <Row label="Plan">{data.plan?.name ?? data.plan_code}</Row>
          {data.status === 'TRIAL' && (
            <>
              <Row label="Trial ends">{formatDate(data.trial_ends_at)}</Row>
              <Row label="Days remaining">{data.trial_days_remaining}</Row>
            </>
          )}
          {data.billing_cycle && <Row label="Billing cycle">{data.billing_cycle.toLowerCase()}</Row>}
          {data.next_billing_date && <Row label="Next billing date">{formatDate(data.next_billing_date)}</Row>}
        </dl>

        {data.status === 'EXPIRED' && !data.pending_payment && (
          <p className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-sm text-ink-700">
            Your trial has ended. Everything you created is still here and still readable —
            paying turns billing back on.
          </p>
        )}

        {data.pending_payment && (
          <div className="mt-5 rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-4">
            <p className="text-sm font-semibold text-ink-900">
              {formatCurrency(data.pending_payment.amount)}
              <span className="ml-1 font-normal text-ink-500">/ {data.pending_payment.billing_cycle.toLowerCase()}</span>
            </p>
            <p className="mt-1 text-sm text-ink-500">A payment link was sent for your account. Pay on Cashfree's secure page — we never see your card or UPI details.</p>
            <Button className="mt-3" onClick={() => window.open(data.pending_payment.payment_link_url, '_blank', 'noopener')}>
              Pay {formatCurrency(data.pending_payment.amount)} now
            </Button>
          </div>
        )}
      </Card>

      <div>
        <h2 className="mb-4 text-sm font-semibold text-ink-900">Plans</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <Card key={plan.plan_code}>
              <h3 className="text-sm font-bold uppercase tracking-wider text-brand-600">{plan.name}</h3>
              <p className="mt-1.5 text-sm text-ink-500">{plan.description}</p>
              <p className="mt-4 text-xl font-bold text-ink-900">
                {Number(plan.price_monthly_paise)
                  ? <>{formatMoney(plan.price_monthly_paise)}<span className="text-sm font-normal text-ink-400">/month</span></>
                  : 'Pricing on request'}
              </p>
              {/* There's no self-serve checkout for a fixed price — see the
                  note at the top of this file. */}
              <Button
                variant="secondary"
                size="sm"
                className="mt-5 w-full"
                disabled
                title="Contact us for a price — we'll send a secure payment link"
              >
                Upgrade
              </Button>
            </Card>
          ))}
        </div>

        <p className="mt-5 text-xs text-ink-400">
          Pricing is agreed with our team, not self-serve. Contact flowxp.manager@gmail.com
          and we'll send a secure payment link for your plan.
        </p>
      </div>
    </div>
  );
};

export default Subscription;
