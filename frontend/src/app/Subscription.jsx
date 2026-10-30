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
import { Button, Card, PageLoader } from '../components/ui.jsx';

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
  const [cycle, setCycle] = useState('MONTHLY');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const upgrade = async (planCode) => {
    setBusy(planCode); setNotice('');
    try {
      const r = await api('/businesses/current/subscription/checkout', { method: 'POST', body: { plan_code: planCode, billing_cycle: cycle } });
      window.location.assign(r.payment_link_url);
    } catch (caught) { setNotice(caught.message); } finally { setBusy(''); }
  };

  useEffect(() => {
    Promise.all([api('/businesses/current/subscription'), api('/plans')])
      .then(([subscription, planList]) => { setData(subscription); setPlans(planList); })
      .catch((caught) => setError(caught.message));
  }, [business?.business_id]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <PageLoader compact />;

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
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-900">Plans</h2>
          <div className="inline-flex rounded-lg border border-line p-0.5 text-xs">
            {['MONTHLY', 'YEARLY'].map((c) => (
              <button key={c} type="button" onClick={() => setCycle(c)}
                className={`rounded-md px-3 py-1 font-medium ${cycle === c ? 'bg-brand-600 text-white' : 'text-ink-500'}`}>
                {c === 'MONTHLY' ? 'Monthly' : 'Yearly'}
              </button>
            ))}
          </div>
        </div>
        {notice && <p className="mb-3 text-sm text-danger">{notice}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => {
            const paise = Number(cycle === 'YEARLY' ? plan.price_yearly_paise : plan.price_monthly_paise);
            const current = data.status === 'ACTIVE' && plan.plan_code === data.plan_code;
            return (
              <Card key={plan.plan_code}>
                <h3 className="text-sm font-bold uppercase tracking-wider text-brand-600">
                  {plan.name}{current && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-600">Your plan</span>}
                </h3>
                <p className="mt-1.5 text-sm text-ink-500">{plan.description}</p>
                <p className="mt-4 text-xl font-bold text-ink-900">
                  {paise
                    ? <>{formatMoney(paise)}<span className="text-sm font-normal text-ink-400">/{cycle === 'YEARLY' ? 'year' : 'month'}</span></>
                    : 'Pricing on request'}
                </p>
                {paise ? (
                  <Button size="sm" className="mt-5 w-full" disabled={current || busy === plan.plan_code} onClick={() => upgrade(plan.plan_code)}>
                    {current ? 'Current plan' : busy === plan.plan_code ? 'Opening payment…' : data.status === 'ACTIVE' ? 'Switch to this plan' : 'Upgrade'}
                  </Button>
                ) : (
                  <a className="mt-5 block w-full rounded-lg border border-line px-3 py-1.5 text-center text-sm font-medium text-ink-700"
                     href={`mailto:flowxp.manager@gmail.com?subject=${encodeURIComponent(`FlowXP ${plan.name} plan`)}`}>
                    Ask for a price
                  </a>
                )}
              </Card>
            );
          })}
        </div>

        <p className="mt-5 text-xs text-ink-400">
          You pay on Cashfree's secure page; we never see your card or UPI details. The plan switches on as soon as the payment goes through.
          Questions: flowxp.manager@gmail.com.
        </p>
      </div>
    </div>
  );
};

export default Subscription;
