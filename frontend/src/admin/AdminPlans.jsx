/*
 * Plan pricing, editable — every price seeds at ₹0 (see the plans INSERT in
 * backend/config/database.js: "a wrong price on the public pricing page is
 * worse than a blank one"). This is where a real number replaces that zero,
 * as a database UPDATE rather than a deploy.
 */
import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Card, Field, Input, Button, Alert, Badge, useToast } from '../components/ui.jsx';

const PlanCard = ({ plan, onSave }) => {
  const toast = useToast();
  const [monthly, setMonthly] = useState(plan.price_monthly);
  const [yearly, setYearly] = useState(plan.price_yearly);
  const [saving, setSaving] = useState(false);

  const dirty = Number(monthly) !== plan.price_monthly || Number(yearly) !== plan.price_yearly;

  const save = async () => {
    setSaving(true);
    try {
      await onSave(plan.plan_code, { price_monthly: Number(monthly), price_yearly: Number(yearly) });
      toast.success(`${plan.name} price saved`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-ink-900">{plan.name}</h3>
          <p className="text-xs text-ink-400">{plan.plan_code}</p>
        </div>
        <Badge tone={plan.is_active ? 'success' : 'neutral'}>{plan.is_active ? 'Active' : 'Inactive'}</Badge>
      </div>
      <p className="mb-4 text-sm text-ink-500">{plan.description}</p>

      <div className="grid grid-cols-2 gap-3">
        <Field id={`${plan.plan_code}-m`} label="Monthly (₹)">
          <Input
            id={`${plan.plan_code}-m`}
            type="number"
            min="0"
            step="1"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
          />
        </Field>
        <Field id={`${plan.plan_code}-y`} label="Yearly (₹)">
          <Input
            id={`${plan.plan_code}-y`}
            type="number"
            min="0"
            step="1"
            value={yearly}
            onChange={(e) => setYearly(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save price'}
        </Button>
      </div>
    </Card>
  );
};

const AdminPlans = () => {
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi('/plans').then(setPlans).catch((err) => setError(err.message));
  }, []);

  const onSave = async (code, body) => {
    const updated = await adminApi(`/plans/${code}`, { method: 'PATCH', body });
    setPlans((rows) => rows.map((p) => (p.plan_code === code
      ? { ...p, ...updated, price_monthly: body.price_monthly, price_yearly: body.price_yearly }
      : p)));
  };

  return (
    <div>
      <PageHeader title="Plans" lead="Pricing that ships without a deploy — an UPDATE, not a code change." />
      {error && <Alert>{error}</Alert>}
      {plans && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => <PlanCard key={plan.plan_code} plan={plan} onSave={onSave} />)}
        </div>
      )}
    </div>
  );
};

export default AdminPlans;
