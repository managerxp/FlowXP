/*
 * Two independent gates decide whether a business has a feature at all —
 * its plan ("did they pay for this") and its business type on that plan
 * ("does this apply to a Salon on Starter" — owner's request, 2026-09-29:
 * business-type gating is now its own switch per (type, plan) pair, not one
 * switch that applied to every plan), combined server-side by
 * backend/src/modules/planFeatures.js's effectiveFeatureFlags(). Neither is
 * the `features` marketing bullet list on Plans, which stays cosmetic.
 * Missing/unset = on, so a (type, plan) pair nobody has touched here keeps
 * working exactly as before.
 */
import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Card, Alert, Field, Select, useToast } from '../components/ui.jsx';
import { BUSINESS_TYPE_LABEL, BUSINESS_TYPES } from './businessTypes.js';

/*
 * A bigger, higher-contrast switch than the first pass — that one was
 * functionally correct (verified with getComputedStyle: 2px vs 22px
 * translate) but too small and too low-contrast against a white card to read
 * at a glance across several columns, which is what "not looking good" meant.
 * A ring on the off state and an icon in the knob both read without
 * hovering or squinting.
 */
const Toggle = ({ on, busy, onClick, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={busy}
    onClick={onClick}
    className={`relative h-7 w-[52px] shrink-0 rounded-full transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-50 ${
      on ? 'bg-success' : 'bg-surface-2 ring-1 ring-inset ring-line-strong'
    }`}
  >
    <span
      className={`absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md transition-transform duration-(--duration-fast) ${
        on ? 'translate-x-[26px]' : 'translate-x-0.5'
      }`}
    >
      {on ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" strokeWidth={3} />
          : <X aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" strokeWidth={3} />}
    </span>
  </button>
);

/* One grid, reused for the plan view and the business-type view: rows are
   features, columns are whatever `columns` names ({ id, label }), and the
   caller decides how a cell reads its own on/off state and where a toggle
   goes on the wire. */
const FeatureGrid = ({ features, columns, isOn, onToggle, busyCell }) => (
  <Card className="overflow-x-auto p-0">
    <table className="w-full min-w-[760px] border-collapse text-sm">
      <thead>
        <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-400">
          <th className="py-3 pl-5 pr-4">Feature</th>
          {columns.map((c) => (
            <th key={c.id} className="border-l border-line px-3 py-3 text-center">{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {features.map((f, i) => (
          <tr key={f.key} className={`border-b border-line last:border-0 ${i % 2 ? 'bg-surface-2/40' : ''}`}>
            <td className="py-3.5 pl-5 pr-4">
              <p className="font-medium text-ink-900">{f.label}</p>
              <p className="text-xs text-ink-400">{f.description}</p>
            </td>
            {columns.map((c) => (
              <td key={c.id} className="border-l border-line px-3 py-3.5 text-center">
                <div className="flex justify-center">
                  <Toggle
                    on={isOn(c, f)}
                    busy={busyCell === `${c.id}:${f.key}`}
                    onClick={() => onToggle(c, f)}
                    label={`${f.label} for ${c.label}`}
                  />
                </div>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </Card>
);

const TABS = [
  { id: 'plan', label: 'By plan' },
  { id: 'type', label: 'By business type' }
];

const AdminFeatures = () => {
  const toast = useToast();
  const [tab, setTab] = useState('plan');
  const [plans, setPlans] = useState(null);
  const [types, setTypes] = useState(null);
  const [selectedType, setSelectedType] = useState('RESTAURANT');
  const [features, setFeatures] = useState(null);
  const [error, setError] = useState('');
  const [busyCell, setBusyCell] = useState(null); // `${columnId}:${featureKey}` while saving

  useEffect(() => {
    Promise.all([adminApi('/plans'), adminApi('/business-type-features'), adminApi('/plan-features')])
      .then(([p, t, f]) => { setPlans(p); setTypes(t); setFeatures(f); })
      .catch((err) => setError(err.message));
  }, []);

  const togglePlan = async (column, feature) => {
    const cellId = `${column.id}:${feature.key}`;
    const current = column.feature_flags?.[feature.key] !== false;
    setBusyCell(cellId);
    try {
      const updated = await adminApi(`/plans/${column.id}`, { method: 'PATCH', body: { feature_flags: { [feature.key]: !current } } });
      setPlans((rows) => rows.map((p) => (p.plan_code === column.id ? { ...p, feature_flags: updated.feature_flags } : p)));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyCell(null);
    }
  };

  // column.id here is "TYPE:PLAN" (see the columns built below) — the two are split back
  // apart for the PATCH, since a toggle is specific to that one (business type, plan) pair.
  const toggleType = async (column, feature) => {
    const cellId = `${column.id}:${feature.key}`;
    const current = column.feature_flags?.[feature.key] !== false;
    setBusyCell(cellId);
    try {
      const updated = await adminApi(`/business-type-features/${column.type}/${column.plan_code}`, { method: 'PATCH', body: { feature_flags: { [feature.key]: !current } } });
      setTypes((rows) => rows.map((t) => (t.business_type === column.type && t.plan_code === column.plan_code ? { ...t, feature_flags: updated.feature_flags } : t)));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyCell(null);
    }
  };

  const ready = plans && types && features;

  return (
    <div>
      <PageHeader
        title="Features"
        lead="What's available to a business — by the plan it pays for, or by the kind of business it is. Turning one off blocks it right away, no restart needed."
      />
      {error && <Alert>{error}</Alert>}

      <div className="mb-4 inline-flex rounded-lg border border-line bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-(--duration-fast) ${
              tab === t.id ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {ready && tab === 'plan' && (
        <FeatureGrid
          features={features}
          // The 3-plan ladder only — Trial (everything's already on) and a retired plan add columns
          // nobody is actually on, matching what AdminPlans.jsx now shows by default.
          columns={plans.filter((p) => p.is_public).map((p) => ({ id: p.plan_code, label: p.name, feature_flags: p.feature_flags }))}
          isOn={(c, f) => c.feature_flags?.[f.key] !== false}
          onToggle={togglePlan}
          busyCell={busyCell}
        />
      )}

      {ready && tab === 'type' && (
        <>
          <div className="mb-4 max-w-xs">
            <Field id="business-type-picker" label="Business type">
              <Select id="business-type-picker" value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                {BUSINESS_TYPES.map((t) => (
                  <option key={t} value={t}>{BUSINESS_TYPE_LABEL[t] || t}</option>
                ))}
              </Select>
            </Field>
          </div>
          <FeatureGrid
            features={features}
            columns={types
              .filter((t) => t.business_type === selectedType)
              .map((t) => ({ id: `${t.business_type}:${t.plan_code}`, type: t.business_type, plan_code: t.plan_code, label: t.plan_name, feature_flags: t.feature_flags }))}
            isOn={(c, f) => c.feature_flags?.[f.key] !== false}
            onToggle={toggleType}
            busyCell={busyCell}
          />
        </>
      )}

      <p className="mt-4 text-xs text-ink-400">
        A feature needs to be on in both the plan and the business type on that plan to actually work — each independently gates it.
      </p>
    </div>
  );
};

export default AdminFeatures;
