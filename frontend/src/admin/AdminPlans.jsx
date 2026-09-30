/*
 * Plan pricing, editable — every price seeds at ₹0 (see the plans INSERT in
 * backend/config/database.js: "a wrong price on the public pricing page is
 * worse than a blank one"). This is where a real number replaces that zero,
 * as a database UPDATE rather than a deploy.
 */
import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Card, Field, Input, Button, Alert, Badge, useToast } from '../components/ui.jsx';

/*
 * A price/feature change cuts a new plan version under the hood (see
 * backend's admin.controller.js updatePlan) — a business already pinned to
 * the old one keeps it, so this Save button was always "safe" to click; this
 * is just visibility into that history, not a new action.
 */
const PriceHistory = ({ planCode, refreshKey }) => {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState(null);

  // Re-fetch on every open rather than caching: a Save just above cuts a new version, and this
  // must never show a stale "v1 is still live" once that save has actually gone through.
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) { setVersions(null); adminApi(`/plans/${planCode}/versions`).then(setVersions).catch(() => setVersions([])); }
  };

  // If a save happens while this is already open, drop the stale list so it re-fetches next open
  // rather than keep showing a version that's no longer live.
  useEffect(() => { setVersions(null); setOpen(false); }, [refreshKey]);

  return (
    <div className="mt-3">
      <button type="button" onClick={toggle} className="text-xs font-medium text-brand-600 hover:underline">
        {open ? 'Hide price history' : 'Price history'}
      </button>
      {open && (
        <ul className="mt-2 space-y-1 text-xs text-ink-500">
          {versions == null && <li>Loading…</li>}
          {versions?.map((v) => (
            <li key={v.plan_version_id} className="flex items-center justify-between gap-2">
              <span>v{v.version_number}: ₹{v.price_monthly}/mo, ₹{v.price_yearly}/yr</span>
              <span className="text-ink-400">
                {new Date(v.effective_from).toLocaleDateString()}
                {v.effective_to ? ` – ${new Date(v.effective_to).toLocaleDateString()}` : ' – now'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

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
      <PriceHistory planCode={plan.plan_code} refreshKey={`${plan.price_monthly_paise}:${plan.price_yearly_paise}`} />
    </Card>
  );
};

const AdminPlans = () => {
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState('');
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    adminApi('/plans').then(setPlans).catch((err) => setError(err.message));
  }, []);

  const onSave = async (code, body) => {
    const updated = await adminApi(`/plans/${code}`, { method: 'PATCH', body });
    setPlans((rows) => rows.map((p) => (p.plan_code === code
      ? { ...p, ...updated, price_monthly: body.price_monthly, price_yearly: body.price_yearly }
      : p)));
  };

  // The 3-plan ladder (Starter/Growth/Enterprise) — same `is_public` flag the pricing page reads,
  // so this always matches what a customer actually sees. Trial and a retired plan (Business) are
  // real rows still worth editing occasionally (a grandfathered account, Trial's own limits), so a
  // toggle keeps them reachable instead of the admin losing access to them entirely.
  const visible = (plans || []).filter((p) => showHidden || p.is_public);
  const hiddenCount = (plans || []).filter((p) => !p.is_public).length;

  return (
    <div>
      <PageHeader title="Plans" lead="Pricing that ships without a deploy — an UPDATE, not a code change." />
      {error && <Alert>{error}</Alert>}
      {plans && hiddenCount > 0 && (
        <label className="mb-4 flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          Show hidden plans too ({hiddenCount}: Trial and anything retired)
        </label>
      )}
      {plans && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((plan) => <PlanCard key={plan.plan_code} plan={plan} onSave={onSave} />)}
        </div>
      )}
    </div>
  );
};

export default AdminPlans;
