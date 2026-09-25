/*
 * Plans, read from the API rather than written here.
 *
 * The brief is explicit that final prices are not confirmed, so the seeded
 * rows carry zero. A zero renders as "Pricing on request", not as "₹0" — a
 * public page that advertises a free Enterprise plan is a worse problem than
 * a public page that has not announced a price yet.
 */
import { useEffect, useState } from 'react';
import { api, formatMoney } from '../lib/api.js';
import { Button, Card } from '../components/ui.jsx';

const Price = ({ plan, cycle }) => {
  const paise = cycle === 'YEARLY' ? plan.price_yearly_paise : plan.price_monthly_paise;

  if (!Number(paise)) {
    return <p className="text-lg font-semibold text-ink-700">Pricing on request</p>;
  }

  return (
    <p className="flex items-baseline gap-1.5">
      <span className="text-3xl font-extrabold tracking-tight text-ink-900">
        {formatMoney(paise)}
      </span>
      <span className="text-sm text-ink-400">/{cycle === 'YEARLY' ? 'year' : 'month'}</span>
    </p>
  );
};

const PricingTable = () => {
  const [plans, setPlans] = useState([]);
  const [cycle, setCycle] = useState('MONTHLY');
  const [state, setState] = useState('loading');

  useEffect(() => {
    api('/plans')
      .then((data) => { setPlans(data); setState('ready'); })
      .catch(() => setState('error'));
  }, []);

  if (state === 'loading') {
    return <p className="text-center text-sm text-ink-400">Loading plans…</p>;
  }

  if (state === 'error') {
    return (
      <div className="text-center">
        <p className="text-sm text-ink-500">
          We could not load pricing just now. The 7-day trial is free either way.
        </p>
        <Button to="/signup" className="mt-5">Start free trial</Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-10 flex justify-center">
        <div className="inline-flex rounded-full border border-line bg-surface-2 p-1">
          {['MONTHLY', 'YEARLY'].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCycle(option)}
              aria-pressed={cycle === option}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                cycle === option ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500'
              }`}
            >
              {option === 'MONTHLY' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan, index) => {
          /* The second plan is the recommended one. Highlighted by position
             rather than by a database flag until there is a reason to make it
             configurable. */
          const featured = index === 1;
          return (
            <Card
              key={plan.plan_code}
              data-price-card
              className={`transition-transform duration-300 hover:-translate-y-1 ${featured ? 'ring-2 ring-brand-500 relative' : ''}`}
            >
              {featured && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-brand-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                  Most popular
                </span>
              )}

              <h3 className="text-sm font-bold uppercase tracking-wider text-brand-600">
                {plan.name}
              </h3>
              <p className="mt-2 min-h-10 text-sm text-ink-500">{plan.description}</p>

              <div className="mt-5"><Price plan={plan} cycle={cycle} /></div>

              <ul className="mt-6 space-y-2.5">
                {(plan.features || []).map((feature) => (
                  <li key={feature} className="flex gap-2.5 text-sm text-ink-700">
                    <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                to="/signup"
                variant={featured ? 'primary' : 'secondary'}
                className="mt-7 w-full"
              >
                Start free trial
              </Button>
            </Card>
          );
        })}
      </div>

      <p className="mt-8 text-center text-xs text-ink-400">
        Every plan starts with the same 7-day free trial. No credit card required.
      </p>
    </>
  );
};

export default PricingTable;
