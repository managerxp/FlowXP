/*
 * One tenant, in full — everything an admin needs to answer a support
 * question without touching psql: who owns it, who else has access, what
 * it's built, what it's paid.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
import { formatCurrency } from '../lib/api.js';
import { Card, PageHeader, StatusBadge, Badge, Button, Alert, Field, Input, Select, Table, Thead, Th, Td, Tr, useToast, PageLoader } from '../components/ui.jsx';

const LINK_STATUS_TONE = { PENDING: 'neutral', PAID: 'success', EXPIRED: 'danger', CANCELLED: 'danger' };

// Mirrors backend/src/utils/validate.js's BUSINESS_TYPES — same duplication auth/AuthPages.jsx
// already accepts there, since the two lists must be changed together either way.
const BUSINESS_TYPES = [
  ['RESTAURANT', 'Restaurant'], ['CAFE', 'Café'], ['CLOUD_KITCHEN', 'Cloud kitchen'], ['RETAIL', 'Retail'],
  ['SUPERMARKET', 'Supermarket'], ['PHARMACY', 'Pharmacy'], ['SALON', 'Salon'],
  ['SERVICES', 'Services'], ['ELECTRONICS', 'Electronics'], ['CLOTHING', 'Clothing'],
  ['GAMING_CAFE', 'Gaming café'], ['RACING', 'Racing'], ['WHOLESALE', 'Wholesale'],
  ['DISTRIBUTOR', 'Distributor'], ['OTHER', 'Other']
];
const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED'];

/*
 * A manual override, separate from the Cashfree payment flow (which only
 * ever moves a business to ACTIVE on a real payment): comping an account,
 * honouring a deal agreed before Cashfree was wired up, or fixing a business
 * that signed up as the wrong type. plan_code here IS the real, enforced
 * plan — see modules/planFeatures.js — unlike the payment-link form's own
 * plan_code field below, which is only ever a display label.
 */
const PlanAndType = ({ business, businessId, onSaved }) => {
  const toast = useToast();
  const [plans, setPlans] = useState(null);
  const [planCode, setPlanCode] = useState(business.plan_code);
  const [subscriptionStatus, setSubscriptionStatus] = useState(business.subscription_status_raw);
  const [businessType, setBusinessType] = useState(business.business_type);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { adminApi('/plans').then(setPlans).catch((err) => setError(err.message)); }, []);

  const dirty = planCode !== business.plan_code || businessType !== business.business_type
    || subscriptionStatus !== business.subscription_status_raw;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await adminApi(`/businesses/${businessId}/plan`, {
        method: 'PATCH',
        body: { plan_code: planCode, subscription_status: subscriptionStatus, business_type: businessType }
      });
      toast.success('Saved');
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="lg:col-span-3">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Plan &amp; business type</h2>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field id="bt-plan" label="Plan">
          <Select id="bt-plan" value={planCode} onChange={(e) => setPlanCode(e.target.value)} disabled={!plans}>
            {(plans || [{ plan_code: planCode, name: planCode }]).map((p) => (
              <option key={p.plan_code} value={p.plan_code}>{p.name}</option>
            ))}
          </Select>
        </Field>
        <Field id="bt-status" label="Subscription status">
          <Select id="bt-status" value={subscriptionStatus} onChange={(e) => setSubscriptionStatus(e.target.value)}>
            {SUBSCRIPTION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field id="bt-type" label="Business type">
          <Select id="bt-type" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
            {BUSINESS_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button className="w-full" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-400">
        Which features this plan and business type actually include is set on the <Link to="/superadmin/features" className="text-brand-600 hover:underline">Features</Link> page.
      </p>
    </Card>
  );
};

/*
 * There is no fixed public price (Option B, 2026-09-28): the admin types a
 * price for this one business and Cashfree hands back a hosted checkout page
 * — FlowXP never touches a card number. plan_code here is a label only ("what
 * does this look like on their subscription page"), not an enforced feature
 * gate; see modules/subscription.js.
 */
const PaymentLinks = ({ businessId }) => {
  const toast = useToast();
  const [links, setLinks] = useState(null);
  const [amount, setAmount] = useState('');
  const [cycle, setCycle] = useState('MONTHLY');
  const [planCode, setPlanCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => adminApi(`/businesses/${businessId}/payment-links`).then(setLinks).catch((err) => setError(err.message));
  useEffect(() => { load(); }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    setError('');
    setBusy(true);
    try {
      const link = await adminApi(`/businesses/${businessId}/payment-link`, {
        method: 'POST',
        body: { amount: Number(amount), billing_cycle: cycle, plan_code: planCode || undefined }
      });
      await navigator.clipboard?.writeText(link.payment_link_url).catch(() => {});
      toast.success('Link created and copied — send it to the owner');
      setAmount('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="lg:col-span-3">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Payment link</h2>
      <Alert>{error}</Alert>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field id="pl-amount" label="Price (₹)">
          <Input id="pl-amount" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1499" />
        </Field>
        <Field id="pl-cycle" label="Billing cycle">
          <Select id="pl-cycle" value={cycle} onChange={(e) => setCycle(e.target.value)}>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </Select>
        </Field>
        <Field id="pl-plan" label="Shown as (optional)">
          <Select id="pl-plan" value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
            <option value="">No change</option>
            <option value="STARTER">Starter</option>
            <option value="GROWTH">Growth</option>
            <option value="ENTERPRISE">Enterprise</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <Button className="w-full" disabled={busy || !amount} onClick={generate}>
            {busy ? 'Creating…' : 'Generate link'}
          </Button>
        </div>
      </div>

      {links?.length > 0 && (
        <div className="mt-5">
          <Table>
            <Thead>
              <Th>Created</Th>
              <Th>Price</Th>
              <Th>Cycle</Th>
              <Th>Status</Th>
              <Th>Link</Th>
            </Thead>
            <tbody>
              {links.map((l) => (
                <Tr key={l.order_id}>
                  <Td>{new Date(l.created_at).toLocaleDateString()}</Td>
                  <Td>{formatCurrency(l.amount)}</Td>
                  <Td>{l.billing_cycle.toLowerCase()}</Td>
                  <Td><Badge tone={LINK_STATUS_TONE[l.status] ?? 'neutral'}>{l.status}</Badge></Td>
                  <Td>
                    {l.payment_link_url ? (
                      <button type="button" className="text-brand-600 hover:underline"
                              onClick={() => { navigator.clipboard?.writeText(l.payment_link_url); toast.success('Copied'); }}>
                        Copy
                      </button>
                    ) : '—'}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
};

/*
 * A paid add-on (Reservations, Table QR, Loyalty, Zomato/Swiggy, Flow AI) —
 * its own price, its own Cashfree link, from the same flow as the main
 * subscription link above. Paying one sets the same feature override the
 * Feature overrides panel below can set by hand; this is that override with
 * a receipt behind it. Catalog prices are set on the Add-ons page.
 */
const BusinessAddons = ({ businessId, businessType }) => {
  const toast = useToast();
  const [catalog, setCatalog] = useState(null);
  const [links, setLinks] = useState(null);
  const [addonKey, setAddonKey] = useState('');
  const [cycle, setCycle] = useState('MONTHLY');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Only add-ons scoped to this business's own type (or scoped to none, i.e. every type) —
  // the same "Restaurant vs Salon" catalog split as the Add-ons page itself.
  const relevant = (catalog || []).filter((a) => !a.business_types || a.business_types.includes(businessType));

  const load = () => adminApi(`/businesses/${businessId}/addon-links`).then(setLinks).catch((err) => setError(err.message));
  useEffect(() => {
    adminApi('/addons').then((rows) => {
      setCatalog(rows);
      const first = rows.find((a) => !a.business_types || a.business_types.includes(businessType));
      setAddonKey(first?.addon_key || '');
    }).catch((err) => setError(err.message));
    load();
  }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = catalog?.find((a) => a.addon_key === addonKey);
  const catalogPrice = selected ? (cycle === 'YEARLY' ? selected.price_yearly : selected.price_monthly) : null;

  const generate = async () => {
    setError('');
    setBusy(true);
    try {
      const link = await adminApi(`/businesses/${businessId}/addon-link`, {
        method: 'POST',
        body: { addon_key: addonKey, billing_cycle: cycle, amount: amount ? Number(amount) : undefined }
      });
      await navigator.clipboard?.writeText(link.payment_link_url).catch(() => {});
      toast.success('Link created and copied — send it to the owner');
      setAmount('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const labelFor = (key) => catalog?.find((a) => a.addon_key === key)?.name || key;

  return (
    <Card className="lg:col-span-3">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Add-ons</h2>
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-4">
        <Field id="ad-key" label="Add-on">
          <Select id="ad-key" value={addonKey} onChange={(e) => setAddonKey(e.target.value)} disabled={!catalog}>
            {relevant.map((a) => <option key={a.addon_key} value={a.addon_key}>{a.name}</option>)}
          </Select>
        </Field>
        <Field id="ad-cycle" label="Billing cycle">
          <Select id="ad-cycle" value={cycle} onChange={(e) => setCycle(e.target.value)}>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </Select>
        </Field>
        <Field id="ad-amount" label={`Price (₹)${catalogPrice != null ? ` — catalog: ${catalogPrice}` : ''}`}>
          <Input id="ad-amount" type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={catalogPrice != null ? String(catalogPrice) : '0'} />
        </Field>
        <div className="flex items-end">
          <Button className="w-full" disabled={busy || !addonKey} onClick={generate}>{busy ? 'Creating…' : 'Generate link'}</Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-400">Leave price blank to use the catalog price above.</p>

      {links?.length > 0 && (
        <div className="mt-5">
          <Table>
            <Thead>
              <Th>Add-on</Th>
              <Th>Created</Th>
              <Th>Price</Th>
              <Th>Cycle</Th>
              <Th>Status</Th>
              <Th>Link</Th>
            </Thead>
            <tbody>
              {links.map((l) => (
                <Tr key={l.order_id}>
                  <Td>{labelFor(l.addon_key)}</Td>
                  <Td>{new Date(l.created_at).toLocaleDateString()}</Td>
                  <Td>{formatCurrency(l.amount)}</Td>
                  <Td>{l.billing_cycle.toLowerCase()}</Td>
                  <Td><Badge tone={LINK_STATUS_TONE[l.status] ?? 'neutral'}>{l.status}</Badge></Td>
                  <Td>
                    {l.payment_link_url ? (
                      <button type="button" className="text-brand-600 hover:underline"
                              onClick={() => { navigator.clipboard?.writeText(l.payment_link_url); toast.success('Copied'); }}>
                        Copy
                      </button>
                    ) : '—'}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
};

/*
 * "Business X stays on Basic but also gets Advanced Reports until 31 Dec" —
 * a per-business exception, independent of plan or business type. Wins over
 * both, in either direction (see modules/planFeatures.js's
 * effectiveFeatureFlags()): force a feature on even if the plan says no, or
 * force it off even if the plan says yes (e.g. for a single abusive account
 * without suspending the whole business).
 */
const FeatureOverrides = ({ businessId }) => {
  const toast = useToast();
  const [catalog, setCatalog] = useState(null);
  const [overrides, setOverrides] = useState(null);
  const [featureKey, setFeatureKey] = useState('');
  const [enabled, setEnabled] = useState('true');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => adminApi(`/businesses/${businessId}/overrides`).then(setOverrides).catch((err) => setError(err.message));
  useEffect(() => {
    adminApi('/plan-features').then((rows) => { setCatalog(rows); setFeatureKey(rows[0]?.key || ''); }).catch((err) => setError(err.message));
    load();
  }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      await adminApi(`/businesses/${businessId}/overrides`, {
        method: 'POST',
        body: { feature_key: featureKey, enabled: enabled === 'true', reason: reason || undefined, expires_at: expiresAt || undefined }
      });
      toast.success('Override saved');
      setReason(''); setExpiresAt('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (key) => {
    try {
      await adminApi(`/businesses/${businessId}/overrides/${key}`, { method: 'DELETE' });
      toast.success('Override removed');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const labelFor = (key) => catalog?.find((f) => f.key === key)?.label || key;

  return (
    <Card className="lg:col-span-3">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Feature overrides</h2>
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-5">
        <Field id="ov-feature" label="Feature">
          <Select id="ov-feature" value={featureKey} onChange={(e) => setFeatureKey(e.target.value)} disabled={!catalog}>
            {(catalog || []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </Select>
        </Field>
        <Field id="ov-enabled" label="Force">
          <Select id="ov-enabled" value={enabled} onChange={(e) => setEnabled(e.target.value)}>
            <option value="true">On</option>
            <option value="false">Off</option>
          </Select>
        </Field>
        <Field id="ov-reason" label="Reason (optional)">
          <Input id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Goodwill gesture" />
        </Field>
        <Field id="ov-expiry" label="Expires (optional)">
          <Input id="ov-expiry" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button className="w-full" disabled={busy || !featureKey} onClick={add}>{busy ? 'Saving…' : 'Add override'}</Button>
        </div>
      </div>

      {overrides?.length > 0 && (
        <div className="mt-5">
          <Table>
            <Thead>
              <Th>Feature</Th>
              <Th>Forced</Th>
              <Th>Reason</Th>
              <Th>Expires</Th>
              <Th>By</Th>
              <Th></Th>
            </Thead>
            <tbody>
              {overrides.map((o) => (
                <Tr key={o.feature_key}>
                  <Td>{labelFor(o.feature_key)}</Td>
                  <Td><Badge tone={o.enabled ? 'success' : 'danger'}>{o.enabled ? 'On' : 'Off'}</Badge></Td>
                  <Td>{o.reason || '—'}</Td>
                  <Td>{o.expires_at ? new Date(o.expires_at).toLocaleDateString() : 'Never'}</Td>
                  <Td>{o.created_by_name || '—'}</Td>
                  <Td><button type="button" className="text-danger hover:underline" onClick={() => remove(o.feature_key)}>Remove</button></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
};

/*
 * Reuses audit_log rather than a parallel events table — every subscription-
 * relevant admin action (plan changes, plan version cuts, feature overrides,
 * payment links, status changes, the Cashfree webhook's activation) already
 * writes there; this just reads it back for one business, chronologically.
 */
const HISTORY_LABEL = {
  'admin.business_plan_changed': 'Plan changed',
  'admin.business_status_changed': 'Status changed',
  'admin.plan_version_created': 'Plan price/features changed',
  'admin.feature_override_set': 'Feature override set',
  'admin.feature_override_removed': 'Feature override removed',
  'admin.payment_link_created': 'Payment link created',
  'subscription.payment_received': 'Payment received'
};

const History = ({ businessId }) => {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi(`/businesses/${businessId}/history`).then(setEvents).catch((err) => setError(err.message));
  }, [businessId]);

  return (
    <Card className="lg:col-span-3">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">History</h2>
      {error && <Alert>{error}</Alert>}
      {events?.length ? (
        <ul className="space-y-3">
          {events.map((e) => (
            <li key={e.audit_id} className="flex items-start justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-ink-900">{HISTORY_LABEL[e.action] || e.action}</p>
                {e.metadata && Object.keys(e.metadata).length > 0 && (
                  <p className="mt-0.5 text-xs text-ink-400">{Object.entries(e.metadata).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')}</p>
                )}
              </div>
              <div className="shrink-0 text-right text-xs text-ink-400">
                <p>{new Date(e.created_at).toLocaleString()}</p>
                {e.actor_name && <p>{e.actor_name}</p>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        events && <p className="text-sm text-ink-400">No subscription activity yet.</p>
      )}
    </Card>
  );
};

const DetailField = ({ label, value }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">{label}</p>
    {/* value == null, not falsy — 0 invoices is a real answer, not a missing one. */}
    <p className="mt-1 text-sm text-ink-900">{value == null || value === '' ? '—' : value}</p>
  </div>
);

const AdminBusinessDetail = () => {
  const { id } = useParams();
  const [business, setBusiness] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => adminApi(`/businesses/${id}`).then(setBusiness).catch((err) => setError(err.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = async (status) => {
    setBusy(true);
    try {
      await adminApi(`/businesses/${id}/status`, { method: 'PATCH', body: { status } });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Alert>{error}</Alert>;
  if (!business) return <PageLoader compact />;

  return (
    <div>
      <Link to="/superadmin/businesses" className="text-sm text-brand-600 hover:underline">← All businesses</Link>

      <PageHeader
        title={business.name}
        lead={business.business_type}
        action={
          <div className="flex gap-2">
            {business.status !== 'SUSPENDED' ? (
              <Button variant="secondary" disabled={busy} onClick={() => setStatus('SUSPENDED')}>Suspend</Button>
            ) : (
              <Button disabled={busy} onClick={() => setStatus('ACTIVE')}>Reactivate</Button>
            )}
            {business.status !== 'CLOSED' && (
              <Button variant="ghost" disabled={busy} onClick={() => setStatus('CLOSED')}>Close</Button>
            )}
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone={business.status === 'ACTIVE' ? 'success' : business.status === 'SUSPENDED' ? 'danger' : 'neutral'}>
          {business.status}
        </Badge>
        <StatusBadge status={business.subscription.status} />
        <Badge tone="brand">{business.subscription.plan_code}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Business details</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <DetailField label="Email" value={business.email} />
            <DetailField label="Phone" value={business.phone} />
            <DetailField label="Currency" value={business.currency} />
            <DetailField label="City" value={business.city} />
            <DetailField label="State" value={business.state} />
            <DetailField label="Country" value={business.country} />
            <DetailField label="GSTIN" value={business.gstin} />
            <DetailField label="GST enabled" value={business.gst_enabled ? 'Yes' : 'No'} />
            <DetailField label="Created" value={new Date(business.created_at).toLocaleDateString()} />
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Owner</h2>
          <DetailField label="Name" value={business.owner.name} />
          <div className="mt-3"><DetailField label="Email" value={business.owner.email} /></div>
          <div className="mt-3"><DetailField label="Phone" value={business.owner.phone} /></div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Activity</h2>
          <DetailField label="Invoices issued" value={business.counts.invoices} />
          <div className="mt-3"><DetailField label="Revenue collected" value={formatCurrency(business.revenue_collected)} /></div>
          <div className="mt-3"><DetailField label="Trial ends" value={business.subscription.trial_ends_at ? new Date(business.subscription.trial_ends_at).toLocaleString() : '—'} /></div>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Branches</h2>
          <ul className="space-y-1.5 text-sm text-ink-700">
            {business.branches.map((b) => (
              <li key={b.branch_id}>{b.name}{b.is_primary && <span className="ml-2 text-xs text-ink-400">(primary)</span>}</li>
            ))}
          </ul>
        </Card>

        <PlanAndType business={business} businessId={id} onSaved={load} />
        <FeatureOverrides businessId={id} />
        <PaymentLinks businessId={id} />
        <BusinessAddons businessId={id} businessType={business.business_type} />
        <History businessId={id} />
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-400">Team members</h2>
        <Table>
          <Thead>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th>Status</Th>
          </Thead>
          <tbody>
            {business.members.map((m) => (
              <Tr key={m.user_id}>
                <Td>{m.name}</Td>
                <Td>{m.email}</Td>
                <Td>{m.role}</Td>
                <Td>{m.status}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
};

export default AdminBusinessDetail;
