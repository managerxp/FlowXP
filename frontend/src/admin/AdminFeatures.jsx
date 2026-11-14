/*
 * Which features each kind of business has, on each plan.
 *
 * Two switches decide it, combined on the server (backend/src/modules/planFeatures.js):
 *   - the PLAN's switch: did they pay for this (applies to every kind of business on that plan);
 *   - the BUSINESS TYPE's switch for that plan: does this feature belong to a Salon on Growth.
 * A feature is on only when both allow it. This screen shows the result per kind of business, so a restaurant
 * lists restaurant tools, a salon lists salon tools, and so on, and never changes one kind of business when
 * you meant another. A cell the plan has switched off is locked and says so; change it under "By plan".
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Lock, X } from 'lucide-react';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Card, Alert, Field, Input, Select, Button, useToast } from '../components/ui.jsx';
import { BUSINESS_TYPE_LABEL, BUSINESS_TYPES } from './businessTypes.js';

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

const FeatureName = ({ f }) => (
  <>
    <p className="font-medium text-ink-900">{f.label}</p>
    <p className="text-xs text-ink-400">{f.description}</p>
  </>
);

const Head = ({ plans, children, last }) => (
  <thead>
    <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-400">
      <th className="py-3 pl-5 pr-4">{children}</th>
      {plans.map((p) => <th key={p.plan_code} className="w-28 border-l border-line px-3 py-3 text-center">{p.name}</th>)}
      {last && <th className="w-28 border-l border-line px-3 py-3 text-center">{last}</th>}
    </tr>
  </thead>
);

/* ── By business type ───────────────────────────────────────────────────── */
const ByType = ({ features, plans, types, setTypes, goPlan }) => {
  const toast = useToast();
  const [type, setType] = useState('RESTAURANT');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(null);

  const rows = useMemo(() => Object.fromEntries(types.filter((t) => t.business_type === type).map((t) => [t.plan_code, t])), [types, type]);
  const industryOff = rows[plans[0]?.plan_code]?.industry_off || [];
  const flagOf = (plan, key) => rows[plan.plan_code]?.feature_flags?.[key];
  const planOff = (plan, key) => plan.feature_flags?.[key] === false;
  const isOn = (plan, key) => !planOff(plan, key) && flagOf(plan, key) !== false;

  const q = search.trim().toLowerCase();
  const matches = (f) => !q || `${f.label} ${f.description}`.toLowerCase().includes(q);
  // a tool belongs to this kind of business unless its industry default is off and nobody has switched it on here
  const belongs = (f) => !industryOff.includes(f.key) || plans.some((p) => flagOf(p, f.key) === true);
  const mine = features.filter((f) => belongs(f) && matches(f));
  const others = features.filter((f) => !belongs(f) && matches(f));

  const groupsOf = (list) => {
    const out = [];
    for (const f of list) {
      let g = out.find((x) => x.key === f.group);
      if (!g) { g = { key: f.group, label: f.group_label, items: [] }; out.push(g); }
      g.items.push(f);
    }
    return out;
  };

  const write = async (plan, key, value) => {
    const updated = await adminApi(`/business-type-features/${type}/${plan.plan_code}`, { method: 'PATCH', body: { feature_flags: { [key]: value } } });
    const base = Object.fromEntries(industryOff.map((k) => [k, false]));
    setTypes((all) => all.map((t) => (t.business_type === type && t.plan_code === plan.plan_code ? { ...t, feature_flags: { ...base, ...updated.feature_flags } } : t)));
  };

  const toggle = async (plan, f) => {
    setBusy(`${plan.plan_code}:${f.key}`);
    try { await write(plan, f.key, !isOn(plan, f.key)); } catch (err) { toast.error(err.message); } finally { setBusy(null); }
  };

  const allPlans = async (f, value) => {
    setBusy(`all:${f.key}`);
    try { for (const p of plans) if (!planOff(p, f.key) && isOn(p, f.key) !== value) await write(p, f.key, value); } catch (err) { toast.error(err.message); } finally { setBusy(null); }
  };

  const Table = ({ list }) => (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <Head plans={plans} last="All plans">Feature</Head>
        {groupsOf(list).map((g) => (
          <tbody key={g.key}>
            <tr className="bg-surface-2/60"><td colSpan={plans.length + 2} className="py-2 pl-5 text-xs font-semibold uppercase tracking-wide text-ink-500">{g.label}</td></tr>
            {g.items.map((f) => {
              const unlocked = plans.filter((p) => !planOff(p, f.key));
              const everyOn = unlocked.length > 0 && unlocked.every((p) => isOn(p, f.key));
              return (
                <tr key={f.key} className="border-b border-line last:border-0">
                  <td className="py-3 pl-5 pr-4"><FeatureName f={f} /></td>
                  {plans.map((p) => (
                    <td key={p.plan_code} className="border-l border-line px-3 py-3 text-center">
                      {planOff(p, f.key) ? (
                        <button type="button" onClick={goPlan} title={`${p.name} does not include this for any business. Change it under By plan.`} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-xs text-ink-500 hover:text-ink-900">
                          <Lock aria-hidden="true" className="h-3 w-3" />Not in plan
                        </button>
                      ) : (
                        <div className="flex justify-center"><Toggle on={isOn(p, f.key)} busy={busy === `${p.plan_code}:${f.key}`} onClick={() => toggle(p, f)} label={`${f.label} for ${BUSINESS_TYPE_LABEL[type]} on ${p.name}`} /></div>
                      )}
                    </td>
                  ))}
                  <td className="border-l border-line px-3 py-3 text-center">
                    {unlocked.length > 0 && <Button size="sm" variant="ghost" disabled={busy === `all:${f.key}`} onClick={() => allPlans(f, !everyOn)}>{everyOn ? 'All off' : 'All on'}</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </Card>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <Field id="business-type-picker" label="Kind of business">
            <Select id="business-type-picker" value={type} onChange={(e) => setType(e.target.value)}>
              {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{BUSINESS_TYPE_LABEL[t] || t}</option>)}
            </Select>
          </Field>
        </div>
        <div className="w-full max-w-xs">
          <Field id="feature-search" label="Find a feature"><Input id="feature-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to filter" /></Field>
        </div>
      </div>
      <p className="mb-3 text-sm text-ink-500">
        These are the tools that belong to a <b>{BUSINESS_TYPE_LABEL[type]}</b>. A switch here changes only {BUSINESS_TYPE_LABEL[type]} businesses on that plan, and takes effect straight away.
      </p>
      {mine.length ? <Table list={mine} /> : <p className="text-sm text-ink-500">Nothing matches.</p>}
      {others.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-sm font-semibold text-ink-700">Tools made for other kinds of business ({others.length})</summary>
          <p className="my-2 text-sm text-ink-500">Off for {BUSINESS_TYPE_LABEL[type]} by default. Turn one on only if this kind of business really needs it.</p>
          <Table list={others} />
        </details>
      )}
    </>
  );
};

/* ── By plan ────────────────────────────────────────────────────────────── */
const ByPlan = ({ features, plans, setPlans }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(null);

  const toggle = async (plan, f) => {
    const on = plan.feature_flags?.[f.key] !== false;
    if (on && !window.confirm(`Turn off "${f.label}" on ${plan.name}? Every kind of business on ${plan.name} loses it.`)) return;
    setBusy(`${plan.plan_code}:${f.key}`);
    try {
      const updated = await adminApi(`/plans/${plan.plan_code}`, { method: 'PATCH', body: { feature_flags: { [f.key]: !on } } });
      setPlans((rows) => rows.map((p) => (p.plan_code === plan.plan_code ? { ...p, feature_flags: updated.feature_flags } : p)));
    } catch (err) { toast.error(err.message); } finally { setBusy(null); }
  };

  const groups = [];
  for (const f of features) {
    let g = groups.find((x) => x.key === f.group);
    if (!g) { g = { key: f.group, label: f.group_label, items: [] }; groups.push(g); }
    g.items.push(f);
  }

  return (
    <>
      <p className="mb-3 text-sm text-ink-500">What each plan includes. A switch here applies to <b>every kind of business</b> on that plan. To change one kind of business only, use By business type.</p>
      <div className="space-y-4">
        {groups.map((g, i) => (
          <details key={g.key} open={i === 0}>
            <summary className="mb-2 cursor-pointer text-sm font-semibold text-ink-800">{g.label} <span className="font-normal text-ink-400">({g.items.length})</span></summary>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <Head plans={plans}>Feature</Head>
                <tbody>
                  {g.items.map((f) => (
                    <tr key={f.key} className="border-b border-line last:border-0">
                      <td className="py-3 pl-5 pr-4"><FeatureName f={f} /></td>
                      {plans.map((p) => (
                        <td key={p.plan_code} className="border-l border-line px-3 py-3 text-center">
                          <div className="flex justify-center"><Toggle on={p.feature_flags?.[f.key] !== false} busy={busy === `${p.plan_code}:${f.key}`} onClick={() => toggle(p, f)} label={`${f.label} on ${p.name}`} /></div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </details>
        ))}
      </div>
    </>
  );
};

const TABS = [{ id: 'type', label: 'By business type' }, { id: 'plan', label: 'By plan' }];

const AdminFeatures = () => {
  const [tab, setTab] = useState('type');
  const [plans, setPlans] = useState(null);
  const [types, setTypes] = useState(null);
  const [features, setFeatures] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([adminApi('/plans'), adminApi('/business-type-features'), adminApi('/plan-features')])
      .then(([p, t, f]) => { setPlans(p.filter((x) => x.is_public)); setTypes(t); setFeatures(f); })
      .catch((err) => setError(err.message));
  }, []);

  const ready = plans && types && features;

  return (
    <div>
      <PageHeader
        title="Features"
        lead="What each kind of business can use, on each plan. A switch takes effect straight away, no restart needed."
      />
      {error && <Alert>{error}</Alert>}

      <div className="mb-4 inline-flex rounded-lg border border-line bg-surface p-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-(--duration-fast) ${tab === t.id ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {ready && tab === 'type' && <ByType features={features} plans={plans} types={types} setTypes={setTypes} goPlan={() => setTab('plan')} />}
      {ready && tab === 'plan' && <ByPlan features={features} plans={plans} setPlans={setPlans} />}
    </div>
  );
};

export default AdminFeatures;
