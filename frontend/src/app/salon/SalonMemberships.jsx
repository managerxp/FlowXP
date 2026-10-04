/*
 * Memberships & offers: the things a salon sells once and honours many times.
 *   Plans      what a membership costs, how long it lasts and what it gives (a discount, free services, extra points)
 *   Members    who holds one, until when, how much they have used; cancel with a reason
 *   Packages   bundles of services sold at a price, and what clients have left of them
 *   Gift cards issued at the till; look one up, top it up, cancel it
 *   Offers     discounts with rules (first visit, birthday, code, dates, outlets, limits)
 * Selling any of these happens at the till; this screen sets them up and looks after what has been sold. A member
 * keeps the terms they bought even if a plan is changed later.
 */
import { useEffect, useState } from 'react';
import { Crown, Gift, PackagePlus, Percent, Plus, Search, Tag, Trash2 } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { longDate, qs, useDebounced, useLoad } from '../../lib/salon.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Textarea, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Chips, NumberField, Pager, SelectField, Tabs, Toggle, useAction } from './parts.jsx';

const money = (n) => formatCurrency(n);
const day = (d) => (d ? longDate(String(d).slice(0, 10)) : '—');

const useServices = () => { const l = useLoad('/salon/services?limit=200', { paged: true }); return l.data || []; };

/* ── plans ────────────────────────────────────────────────────────────────── */

const PlanForm = ({ plan, onSaved, onClose }) => {
  const services = useServices();
  const settings = useLoad('/salon/settings');
  const b = plan?.benefits || {};
  const [form, setForm] = useState(() => ({
    name: plan?.name || '', description: plan?.description || '', price: plan ? String(plan.price) : '', tax_rate: plan ? String(plan.tax_rate) : '', duration_days: plan ? String(plan.duration_days) : '365',
    discount_pct: b.discount_pct != null ? String(b.discount_pct) : '', products: (b.discount_applies_to || ['SERVICE']).includes('PRODUCT'), services: (b.discount_applies_to || ['SERVICE']).includes('SERVICE'),
    free_services: (b.free_services || []).map((f) => ({ service_id: f.service_id, qty: String(f.qty) })), points_multiplier: b.points_multiplier != null ? String(b.points_multiplier) : '1', priority_booking: Boolean(b.priority_booking),
    perks: (b.perks || []).join('\n'), is_active: plan ? plan.is_active : true
  }));
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => { if (!plan && settings.data && form.tax_rate === '') set('tax_rate')(String(settings.data.settings.default_service_tax_rate)); }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault(); setError('');
    const applies = [form.services && 'SERVICE', form.products && 'PRODUCT'].filter(Boolean);
    if (!applies.length && form.discount_pct) { setError('The discount must apply to services, products or both'); return; }
    const body = {
      name: form.name, description: form.description || null, price: Number(form.price), tax_rate: Number(form.tax_rate), duration_days: Number(form.duration_days), is_active: form.is_active,
      benefits: {
        discount_pct: form.discount_pct === '' ? 0 : Number(form.discount_pct), discount_applies_to: applies.length ? applies : ['SERVICE'],
        free_services: form.free_services.filter((f) => f.service_id).map((f) => ({ service_id: Number(f.service_id), qty: Number(f.qty) })),
        points_multiplier: Number(form.points_multiplier) || 1, priority_booking: form.priority_booking, perks: form.perks.split('\n').map((x) => x.trim()).filter(Boolean)
      }
    };
    const out = await run(() => api(plan ? `/salon/membership-plans/${plan.plan_id}` : '/salon/membership-plans', { method: plan ? 'PUT' : 'POST', body }).catch((c) => { setError(c.message); throw c; }), 'Plan saved');
    if (out) onSaved();
  };

  return (
    <Modal title={plan ? `Edit ${plan.name}` : 'New membership plan'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <Alert>{error}</Alert>
        {plan && <p className="rounded-(--radius-control) bg-surface-2 px-3 py-2 text-caption text-ink-500">Members already on this plan keep the terms they bought. Changes apply to new sales and renewals.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pl-name" label="Name"><Input id="pl-name" value={form.name} onChange={(e) => set('name')(e.target.value)} required autoFocus /></Field>
          <NumberField id="pl-days" label="Lasts" suffix="days" min={1} step={1} value={form.duration_days} onChange={set('duration_days')} required />
          <NumberField id="pl-price" label="Price" prefix="₹" value={form.price} onChange={set('price')} required />
          <NumberField id="pl-tax" label="GST rate" suffix="%" value={form.tax_rate} onChange={set('tax_rate')} />
        </div>
        <Field id="pl-desc" label="Description"><Input id="pl-desc" value={form.description} onChange={(e) => set('description')(e.target.value)} /></Field>
        <fieldset className="space-y-4 rounded-(--radius-card) border border-line p-4">
          <legend className="px-1 text-small font-semibold text-ink-900">What members get</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField id="pl-disc" label="Discount on every bill" suffix="%" value={form.discount_pct} onChange={set('discount_pct')} hint="Comes off before GST" />
            <div className="space-y-2 pt-6"><Toggle id="pl-ds" checked={form.services} onChange={set('services')} label="On services" /><Toggle id="pl-dp" checked={form.products} onChange={set('products')} label="On retail products" /></div>
            <NumberField id="pl-mult" label="Points multiplier" suffix="×" min={1} value={form.points_multiplier} onChange={set('points_multiplier')} hint="2 earns double points" />
            <div className="pt-6"><Toggle id="pl-prio" checked={form.priority_booking} onChange={set('priority_booking')} label="Priority booking" /></div>
          </div>
          <div>
            <p className="mb-2 text-small font-medium text-ink-700">Free services (for the whole term)</p>
            {form.free_services.map((f, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <Select aria-label="Free service" value={f.service_id} onChange={(e) => set('free_services')(form.free_services.map((x, j) => (j === i ? { ...x, service_id: Number(e.target.value) } : x)))} className="!py-1.5"><option value="">Choose…</option>{services.map((s) => <option key={s.service_id} value={s.service_id}>{s.name}</option>)}</Select>
                <div className="w-20"><Input aria-label="How many" type="number" min="1" step="1" value={f.qty} onChange={(e) => set('free_services')(form.free_services.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="!py-1.5" /></div>
                <button type="button" aria-label="Remove" onClick={() => set('free_services')(form.free_services.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-400 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={() => set('free_services')([...form.free_services, { service_id: '', qty: '1' }])}><Plus aria-hidden="true" className="h-4 w-4" />Add a free service</Button>
          </div>
          <Field id="pl-perks" label="Other perks" hint="One per line — shown to the team, not applied automatically."><Textarea id="pl-perks" rows={2} value={form.perks} onChange={(e) => set('perks')(e.target.value)} /></Field>
        </fieldset>
        <Toggle id="pl-active" checked={form.is_active} onChange={set('is_active')} label="Available to sell" />
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{plan ? 'Save plan' : 'Create plan'}</Button></div>
      </form>
    </Modal>
  );
};

const benefitLine = (b = {}) => [b.discount_pct ? `${b.discount_pct}% off` : null, b.free_services?.length ? `${b.free_services.reduce((s, f) => s + f.qty, 0)} free service${b.free_services.reduce((s, f) => s + f.qty, 0) === 1 ? '' : 's'}` : null, b.points_multiplier > 1 ? `${b.points_multiplier}× points` : null, b.priority_booking ? 'priority booking' : null].filter(Boolean).join(' · ') || 'No extra benefits';

const PlansTab = () => {
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(null);
  const list = useLoad(`/salon/membership-plans?t=${tick}`);
  const plans = list.data || [];
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />New plan</Button></div>
      <ListState loading={list.loading && plans.length === 0} error={list.error} empty={!list.loading && plans.length === 0} emptyIcon={Crown} emptyLabel="No membership plans yet." emptyBody="A plan gives regulars a discount, free services or extra points for a fee." emptyAction={<Button onClick={() => setEditing({})}>Create a plan</Button>} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <button key={p.plan_id} type="button" onClick={() => setEditing(p)} className={`rounded-(--radius-card) border bg-surface p-4 text-left transition-shadow hover:shadow-sm ${p.is_active ? 'border-line' : 'border-line opacity-60'}`}>
            <span className="flex items-start justify-between gap-2"><span className="text-body font-semibold text-ink-900">{p.name}</span>{!p.is_active && <Badge>Off</Badge>}</span>
            <span className="tabular mt-1 block text-title font-semibold text-ink-900">{money(p.price)}<span className="text-small font-normal text-ink-500"> · {p.duration_days} days</span></span>
            <span className="mt-2 block text-small text-ink-700">{benefitLine(p.benefits)}</span>
            <span className="mt-3 block text-caption text-ink-500">{p.active_members} active member{p.active_members === 1 ? '' : 's'}</span>
          </button>
        ))}
      </div>
      {editing && <PlanForm plan={editing.plan_id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTick((t) => t + 1); }} />}
    </div>
  );
};

/* ── members ──────────────────────────────────────────────────────────────── */

const MembersTab = () => {
  const dialog = useDialog();
  const toast = useToast();
  const { can } = useAuth();
  const [status, setStatus] = useState('ACTIVE');
  const [expiring, setExpiring] = useState('');
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 300);
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [usage, setUsage] = useState(null);
  useEffect(() => { setOffset(0); }, [status, expiring, term]);
  const list = useLoad(`/salon/memberships${qs({ status, expiring_in: expiring, q: term, limit: 25, offset, t: tick })}`, { paged: true });
  const rows = list.data || [];

  const cancel = async (m) => {
    const reason = await dialog.prompt({ title: `Cancel ${m.customer_name}’s membership?`, body: 'Their benefits stop straight away. Nothing is refunded automatically.', label: 'Reason', confirmLabel: 'Cancel membership', cancelLabel: 'Keep it', danger: true });
    if (!reason) return;
    try { await api(`/salon/memberships/${m.membership_id}/cancel`, { method: 'POST', body: { reason } }); toast.success('Membership cancelled'); setTick((t) => t + 1); } catch (e) { toast.error(e.message); }
  };
  const showUsage = async (m) => { try { setUsage({ m, ...(await api(`/salon/memberships/${m.membership_id}/usage`)) }); } catch (e) { toast.error(e.message); } };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" /><Input type="search" aria-label="Search members" placeholder="Name or mobile" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>
        <Chips label="Status" value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'EXPIRED', label: 'Expired' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
        <Chips label="Expiring" value={expiring} onChange={(v) => { setExpiring(v); if (v) setStatus('ACTIVE'); }} options={[{ value: '', label: 'Any time' }, { value: '7', label: 'Within 7 days' }, { value: '30', label: 'Within 30 days' }]} />
      </div>
      <ListState loading={list.loading && rows.length === 0} error={list.error} empty={!list.loading && rows.length === 0} emptyIcon={Crown} emptyLabel="No members found." emptyBody="Memberships are sold at the till." />
      {rows.length > 0 && (
        <>
          <Table>
            <Thead><Th>Member</Th><Th>Plan</Th><Th>Until</Th><Th>Used</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></Thead>
            <tbody>
              {rows.map((m) => (
                <Tr key={m.membership_id} onClick={() => showUsage(m)}>
                  <Td><span className="font-medium">{m.customer_name}</span>{m.phone && <span className="block text-caption text-ink-500">{m.phone}</span>}</Td>
                  <Td>{m.plan_name}<span className="block text-caption text-ink-500">{benefitLine(m.benefits)}</span></Td>
                  <Td className="whitespace-nowrap">{day(m.expiry_date)}{m.days_left != null && m.days_left <= 30 && <span className="block text-caption text-warning">{m.days_left} day{m.days_left === 1 ? '' : 's'} left</span>}</Td>
                  <Td className="text-caption text-ink-700">{m.free_services_used} free · {money(m.discount_given)} off</Td>
                  <Td><Badge tone={m.active ? 'success' : 'neutral'}>{m.active ? 'Active' : m.status === 'ACTIVE' ? 'Expired' : m.status.toLowerCase()}</Badge></Td>
                  <Td className="text-right">{m.status === 'ACTIVE' && can('refunds') && <button type="button" onClick={(e) => { e.stopPropagation(); cancel(m); }} className="text-caption font-semibold text-danger">Cancel</button>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager meta={list.meta} onPage={setOffset} />
        </>
      )}
      {usage && (
        <Modal title={`${usage.m.customer_name} · ${usage.plan_name}`} onClose={() => setUsage(null)}>
          {usage.usage.length === 0 ? <p className="text-small text-ink-500">Nothing used yet.</p> : (
            <ul className="divide-y divide-line rounded-(--radius-card) border border-line">
              {usage.usage.map((u) => <li key={u.usage_id} className={`flex items-center justify-between px-3.5 py-2.5 text-small ${u.voided_at ? 'text-ink-400 line-through' : ''}`}><span>{u.kind === 'FREE_SERVICE' ? `Free ${u.service || 'service'}` : 'Membership discount'}{u.invoice_number && <span className="text-ink-500"> · {u.invoice_number}</span>}</span><span className="tabular">{u.kind === 'DISCOUNT' ? money(u.discount) : `×${u.quantity}`}</span></li>)}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
};

/* ── packages ─────────────────────────────────────────────────────────────── */

const PackageForm = ({ pkg, onSaved, onClose }) => {
  const services = useServices();
  const settings = useLoad('/salon/settings');
  const [form, setForm] = useState(() => ({ name: pkg?.name || '', description: pkg?.description || '', price: pkg ? String(pkg.price) : '', tax_rate: pkg ? String(pkg.tax_rate) : '', validity_days: pkg ? String(pkg.validity_days) : '90', items: pkg ? pkg.items.map((i) => ({ service_id: i.service_id, quantity: String(i.quantity) })) : [{ service_id: '', quantity: '1' }], is_active: pkg ? pkg.is_active : true }));
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => { if (!pkg && settings.data && form.tax_rate === '') set('tax_rate')(String(settings.data.settings.default_service_tax_rate)); }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(services.map((s) => [s.service_id, s]));
  const value = form.items.reduce((s, i) => s + (byId.get(Number(i.service_id))?.price || 0) * (Number(i.quantity) || 0), 0);
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const body = { name: form.name, description: form.description || null, price: Number(form.price), tax_rate: Number(form.tax_rate), validity_days: Number(form.validity_days), is_active: form.is_active, items: form.items.filter((i) => i.service_id).map((i) => ({ service_id: Number(i.service_id), quantity: Number(i.quantity) })) };
    const out = await run(() => api(pkg ? `/salon/packages/${pkg.package_id}` : '/salon/packages', { method: pkg ? 'PUT' : 'POST', body }).catch((c) => { setError(c.message); throw c; }), 'Package saved');
    if (out) onSaved();
  };
  return (
    <Modal title={pkg ? `Edit ${pkg.name}` : 'New package'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pk-name" label="Name"><Input id="pk-name" value={form.name} onChange={(e) => set('name')(e.target.value)} required autoFocus /></Field>
          <NumberField id="pk-days" label="Valid for" suffix="days" min={1} step={1} value={form.validity_days} onChange={set('validity_days')} required />
          <NumberField id="pk-price" label="Price" prefix="₹" value={form.price} onChange={set('price')} required hint={value > 0 ? `Services at list price: ${money(value)}${Number(form.price) > 0 && value > Number(form.price) ? ` — client saves ${money(value - Number(form.price))}` : ''}` : undefined} />
          <NumberField id="pk-tax" label="GST rate" suffix="%" value={form.tax_rate} onChange={set('tax_rate')} />
        </div>
        <fieldset>
          <legend className="mb-2 text-small font-semibold text-ink-900">What is in it</legend>
          {form.items.map((it, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <Select aria-label="Service" value={it.service_id} onChange={(e) => set('items')(form.items.map((x, j) => (j === i ? { ...x, service_id: Number(e.target.value) } : x)))} className="!py-1.5"><option value="">Choose a service…</option>{services.map((s) => <option key={s.service_id} value={s.service_id}>{s.name} — {money(s.price)}</option>)}</Select>
              <div className="flex items-center gap-1.5 text-caption text-ink-500">×<div className="w-20"><Input aria-label="Visits" type="number" min="1" step="1" value={it.quantity} onChange={(e) => set('items')(form.items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className="!py-1.5" /></div></div>
              {form.items.length > 1 && <button type="button" aria-label="Remove" onClick={() => set('items')(form.items.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-400 hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => set('items')([...form.items, { service_id: '', quantity: '1' }])}><Plus aria-hidden="true" className="h-4 w-4" />Add a service</Button>
        </fieldset>
        <Toggle id="pk-active" checked={form.is_active} onChange={set('is_active')} label="Available to sell" />
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{pkg ? 'Save package' : 'Create package'}</Button></div>
      </form>
    </Modal>
  );
};

const AdjustPackage = ({ cp, onSaved, onClose }) => {
  const [form, setForm] = useState({ expiry_date: String(cp.expiry_date).slice(0, 10), reason: '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(`/salon/client-packages/${cp.cp_id}`, { method: 'PUT', body: { expiry_date: form.expiry_date, reason: form.reason } }).catch((c) => { setError(c.message); throw c; }), 'Package updated');
    if (out) onSaved();
  };
  return (
    <Modal title={`${cp.customer_name} · ${cp.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <ul className="text-small text-ink-700">{(cp.items || []).map((i) => <li key={i.service_id}>{i.name}: {i.remaining} of {i.total} left</li>)}</ul>
        <Field id="ap-exp" label="Valid until"><Input id="ap-exp" type="date" value={form.expiry_date} onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))} /></Field>
        <Field id="ap-why" label="Why" hint="Kept in the activity log."><Input id="ap-why" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} required /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
      </form>
    </Modal>
  );
};

const PackagesTab = () => {
  const { can } = useAuth();
  const [sub, setSub] = useState('catalogue');
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [status, setStatus] = useState('ACTIVE');
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [status]);
  const pkgs = useLoad(sub === 'catalogue' ? `/salon/packages?t=${tick}` : null);
  const held = useLoad(sub === 'held' ? `/salon/client-packages${qs({ status, limit: 25, offset, t: tick })}` : null, { paged: true });
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Chips label="Show" value={sub} onChange={setSub} options={[{ value: 'catalogue', label: 'Packages you sell' }, { value: 'held', label: 'Held by clients' }]} />
        {sub === 'catalogue' && <Button onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />New package</Button>}
        {sub === 'held' && <Chips label="Status" value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'EXPIRED', label: 'Expired' }, { value: 'CANCELLED', label: 'Cancelled' }]} />}
      </div>
      {sub === 'catalogue' && (
        <>
          <ListState loading={pkgs.loading && !pkgs.data} error={pkgs.error} empty={!pkgs.loading && pkgs.data?.length === 0} emptyIcon={PackagePlus} emptyLabel="No packages yet." emptyBody="Bundle services — say six haircuts — and sell them at a price." emptyAction={<Button onClick={() => setEditing({})}>Create a package</Button>} />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(pkgs.data || []).map((p) => (
              <button key={p.package_id} type="button" onClick={() => setEditing(p)} className={`rounded-(--radius-card) border border-line bg-surface p-4 text-left transition-shadow hover:shadow-sm ${p.is_active ? '' : 'opacity-60'}`}>
                <span className="flex items-start justify-between gap-2"><span className="text-body font-semibold text-ink-900">{p.name}</span>{!p.is_active && <Badge>Off</Badge>}</span>
                <span className="tabular mt-1 block text-title font-semibold text-ink-900">{money(p.price)}<span className="text-small font-normal text-ink-500"> · {p.validity_days} days</span></span>
                <span className="mt-2 block text-small text-ink-700">{p.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</span>
                {p.saving > 0 && <span className="mt-2 block text-caption font-medium text-success">Client saves {money(p.saving)}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {sub === 'held' && (
        <>
          <ListState loading={held.loading && !held.data} error={held.error} empty={!held.loading && held.data?.length === 0} emptyIcon={PackagePlus} emptyLabel="No packages here." />
          {(held.data || []).length > 0 && (
            <>
              <Table>
                <Thead><Th>Client</Th><Th>Package</Th><Th>Left</Th><Th>Until</Th><Th>Status</Th></Thead>
                <tbody>
                  {held.data.map((p) => (
                    <Tr key={p.cp_id} onClick={can('refunds') ? () => setAdjusting(p) : undefined}>
                      <Td className="font-medium">{p.customer_name}</Td><Td>{p.name}</Td>
                      <Td className="text-caption text-ink-700">{(p.items || []).map((i) => `${i.remaining}/${i.total} ${i.name}`).join(' · ')}</Td>
                      <Td className="whitespace-nowrap">{day(p.expiry_date)}</Td>
                      <Td><Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Active' : p.status === 'ACTIVE' ? 'Expired' : p.status.toLowerCase()}</Badge></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <Pager meta={held.meta} onPage={setOffset} />
            </>
          )}
        </>
      )}
      {editing && <PackageForm pkg={editing.package_id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTick((t) => t + 1); }} />}
      {adjusting && <AdjustPackage cp={adjusting} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); setTick((t) => t + 1); }} />}
    </div>
  );
};

/* ── gift cards ───────────────────────────────────────────────────────────── */

const IssueCard = ({ onSaved, onClose }) => {
  const [form, setForm] = useState({ amount: '', note: '', expires_on: '' });
  const [error, setError] = useState('');
  const [made, setMade] = useState(null);
  const [busy, run] = useAction();
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api('/salon/gift-cards', { method: 'POST', body: { amount: Number(form.amount), note: form.note, expires_on: form.expires_on || null } }).catch((c) => { setError(c.message); throw c; }));
    if (out) setMade(out);
  };
  if (made) return (
    <Modal title="Gift card issued" onClose={() => { onSaved(); }}>
      <div className="rounded-(--radius-card) border border-dashed border-brand-500 bg-brand-50 p-4 text-center"><p className="text-caption text-ink-500">{money(made.amount)}</p><p className="select-all font-mono text-title font-semibold tracking-widest text-brand-700">{made.code}</p></div>
      <div className="mt-4 flex justify-end"><Button onClick={onSaved}>Done</Button></div>
    </Modal>
  );
  return (
    <Modal title="Issue a complimentary gift card" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-caption text-ink-500">For gifts from you — no sale is recorded. Cards that clients buy are sold at the till.</p>
        <Alert>{error}</Alert>
        <NumberField id="gc-amt" label="Amount" prefix="₹" value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} required />
        <Field id="gc-why" label="Reason"><Input id="gc-why" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} required /></Field>
        <Field id="gc-exp" label="Expires on (optional)"><Input id="gc-exp" type="date" value={form.expires_on} onChange={(e) => setForm((f) => ({ ...f, expires_on: e.target.value }))} /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Issue card</Button></div>
      </form>
    </Modal>
  );
};

const CardDetail = ({ code, onChanged, onClose }) => {
  const dialog = useDialog();
  const toast = useToast();
  const { can } = useAuth();
  const { data: c, error, reload } = useLoad(`/salon/gift-cards/lookup?code=${encodeURIComponent(code)}`);
  const adjust = async () => {
    const amount = await dialog.prompt({ title: 'Add or take off balance', body: 'Use a minus to take off, like −200.', label: 'Amount (₹)', type: 'number', inputMode: 'decimal', confirmLabel: 'Next' });
    if (amount == null || Number(amount) === 0) return;
    const note = await dialog.prompt({ title: 'Why?', label: 'Reason', confirmLabel: 'Adjust' });
    if (!note) return;
    try { await api(`/salon/gift-cards/${c.card_id}/adjust`, { method: 'POST', body: { amount: Number(amount), note } }); toast.success('Balance adjusted'); reload(); onChanged(); } catch (e) { toast.error(e.message); }
  };
  const cancel = async () => {
    const reason = await dialog.prompt({ title: 'Cancel this gift card?', body: 'Its balance can no longer be spent.', label: 'Reason', confirmLabel: 'Cancel card', cancelLabel: 'Keep it', danger: true });
    if (!reason) return;
    try { await api(`/salon/gift-cards/${c.card_id}/cancel`, { method: 'POST', body: { reason } }); toast.success('Gift card cancelled'); reload(); onChanged(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal title="Gift card" onClose={onClose}>
      {error && <Alert>{error}</Alert>}
      {c && (
        <div className="space-y-4">
          <div className="rounded-(--radius-card) border border-dashed border-brand-500 bg-brand-50 p-4 text-center"><p className="select-all font-mono text-title font-semibold tracking-widest text-brand-700">{c.code}</p><p className="tabular text-body font-semibold text-ink-900">{money(c.balance)} <span className="text-small font-normal text-ink-500">of {money(c.initial)}</span></p><p className="text-caption text-ink-500">{c.status === 'CANCELLED' ? 'Cancelled' : c.expired ? 'Expired' : c.expires_on ? `Valid until ${day(c.expires_on)}` : 'Does not expire'}{c.customer_name && ` · ${c.customer_name}`}</p></div>
          <ul className="divide-y divide-line rounded-(--radius-card) border border-line">{c.history.map((h, i) => <li key={i} className="flex items-center justify-between px-3.5 py-2 text-small"><span className="capitalize text-ink-700">{String(h.kind).toLowerCase()}<span className="ml-2 text-caption text-ink-400">{new Date(h.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></span><span className="tabular">{h.amount > 0 ? '+' : ''}{money(h.amount)} <span className="text-ink-400">→ {money(h.balance_after)}</span></span></li>)}</ul>
          {can('refunds') && c.status === 'ACTIVE' && <div className="flex justify-end gap-2"><Button variant="secondary" onClick={adjust}>Adjust balance</Button><Button variant="ghost" className="text-danger" onClick={cancel}>Cancel card</Button></div>}
        </div>
      )}
    </Modal>
  );
};

const GiftCardsTab = () => {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 300);
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(null);
  const [issuing, setIssuing] = useState(false);
  useEffect(() => { setOffset(0); }, [status, term]);
  const list = useLoad(`/salon/gift-cards${qs({ status, q: term, limit: 25, offset, t: tick })}`, { paged: true });
  const rows = list.data || [];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" /><Input type="search" aria-label="Find a gift card" placeholder="Code or client" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>
        <Chips label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
        {can('refunds') && <Button variant="secondary" className="ml-auto" onClick={() => setIssuing(true)}><Gift aria-hidden="true" className="h-4 w-4" />Issue complimentary card</Button>}
      </div>
      <ListState loading={list.loading && rows.length === 0} error={list.error} empty={!list.loading && rows.length === 0} emptyIcon={Gift} emptyLabel="No gift cards yet." emptyBody="Sell one at the till under Billing → Gift card." />
      {rows.length > 0 && (
        <>
          <Table>
            <Thead><Th>Code</Th><Th className="text-right">Balance</Th><Th className="text-right">Value</Th><Th>Client</Th><Th>Expires</Th><Th>Status</Th></Thead>
            <tbody>
              {rows.map((g) => (
                <Tr key={g.card_id} onClick={() => setOpen(g.code)}>
                  <Td className="font-mono">{g.code}</Td><Td className="text-right tabular">{money(g.balance)}</Td><Td className="text-right tabular">{money(g.initial)}</Td>
                  <Td>{g.customer_name || <span className="text-ink-400">—</span>}</Td><Td className="whitespace-nowrap">{g.expires_on ? day(g.expires_on) : 'Never'}</Td>
                  <Td><Badge tone={g.usable ? 'success' : 'neutral'}>{g.status === 'CANCELLED' ? 'Cancelled' : g.expired ? 'Expired' : g.balance <= 0 ? 'Used up' : 'Active'}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager meta={list.meta} onPage={setOffset} />
        </>
      )}
      {open && <CardDetail code={open} onClose={() => setOpen(null)} onChanged={() => setTick((t) => t + 1)} />}
      {issuing && <IssueCard onClose={() => setIssuing(false)} onSaved={() => { setIssuing(false); setTick((t) => t + 1); }} />}
    </div>
  );
};

/* ── offers ───────────────────────────────────────────────────────────────── */

const OfferForm = ({ offer, onSaved, onClose }) => {
  const plans = useLoad('/salon/membership-plans');
  const { outlets } = useAuth();
  const c = offer?.conditions || {};
  const [form, setForm] = useState(() => ({
    name: offer?.name || '', description: offer?.description || '', code: offer?.code || '', discount_type: offer?.discount_type || 'PERCENT', value: offer ? String(offer.value) : '', max_discount: offer?.max_discount != null ? String(offer.max_discount) : '',
    applies_to: offer?.applies_to || 'ALL', starts_on: offer?.starts_on ? String(offer.starts_on).slice(0, 10) : '', ends_on: offer?.ends_on ? String(offer.ends_on).slice(0, 10) : '', usage_limit: offer?.usage_limit ? String(offer.usage_limit) : '', per_customer_limit: offer?.per_customer_limit ? String(offer.per_customer_limit) : '',
    auto_apply: Boolean(offer?.auto_apply), is_active: offer ? offer.is_active : true, first_visit: Boolean(c.first_visit), birthday: Boolean(c.birthday), anniversary: Boolean(c.anniversary), window_days: c.window_days != null ? String(c.window_days) : '7',
    min_bill: c.min_bill != null ? String(c.min_bill) : '', plan_ids: c.membership_plan_ids || [], branch_ids: offer?.branch_ids || []
  }));
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleIn = (k, id) => set(k)(form[k].includes(id) ? form[k].filter((x) => x !== id) : [...form[k], id]);
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const body = {
      name: form.name, description: form.description || null, code: form.code || null, discount_type: form.discount_type, value: Number(form.value), max_discount: form.max_discount === '' ? null : Number(form.max_discount), applies_to: form.applies_to,
      starts_on: form.starts_on || null, ends_on: form.ends_on || null, usage_limit: form.usage_limit ? Number(form.usage_limit) : null, per_customer_limit: form.per_customer_limit ? Number(form.per_customer_limit) : null,
      auto_apply: form.auto_apply, is_active: form.is_active, branch_ids: form.branch_ids,
      conditions: { first_visit: form.first_visit, birthday: form.birthday, anniversary: form.anniversary, ...(form.birthday || form.anniversary ? { window_days: Number(form.window_days) || 0 } : {}), membership_plan_ids: form.plan_ids, min_bill: form.min_bill === '' ? null : Number(form.min_bill) }
    };
    const out = await run(() => api(offer ? `/salon/offers/${offer.offer_id}` : '/salon/offers', { method: offer ? 'PUT' : 'POST', body }).catch((c2) => { setError(c2.message); throw c2; }), 'Offer saved');
    if (out) onSaved();
  };
  return (
    <Modal title={offer ? `Edit ${offer.name}` : 'New offer'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="of-name" label="Name"><Input id="of-name" value={form.name} onChange={(e) => set('name')(e.target.value)} required autoFocus /></Field>
          <Field id="of-code" label="Code (optional)" hint="Clients or staff type this at the till."><Input id="of-code" value={form.code} onChange={(e) => set('code')(e.target.value.toUpperCase())} className="uppercase" /></Field>
          <SelectField id="of-type" label="Discount" value={form.discount_type} onChange={set('discount_type')}><option value="PERCENT">Percent off</option><option value="FIXED">Fixed ₹ off</option></SelectField>
          <NumberField id="of-val" label={form.discount_type === 'PERCENT' ? 'Percent' : 'Amount'} prefix={form.discount_type === 'FIXED' ? '₹' : undefined} suffix={form.discount_type === 'PERCENT' ? '%' : undefined} value={form.value} onChange={set('value')} required />
          <SelectField id="of-applies" label="Applies to" value={form.applies_to} onChange={set('applies_to')}><option value="ALL">Services and products</option><option value="SERVICES">Services only</option><option value="PRODUCTS">Products only</option></SelectField>
          {form.discount_type === 'PERCENT' && <NumberField id="of-max" label="Most it can take off" prefix="₹" value={form.max_discount} onChange={set('max_discount')} hint="Optional cap" />}
        </div>
        <fieldset className="space-y-3 rounded-(--radius-card) border border-line p-4">
          <legend className="px-1 text-small font-semibold text-ink-900">Who and when</legend>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Toggle id="of-first" checked={form.first_visit} onChange={set('first_visit')} label="First visit only" />
            <Toggle id="of-bday" checked={form.birthday} onChange={set('birthday')} label="Around their birthday" />
            <Toggle id="of-anniv" checked={form.anniversary} onChange={set('anniversary')} label="Around their anniversary" />
            <Toggle id="of-auto" checked={form.auto_apply} onChange={set('auto_apply')} label="Apply automatically" hint="When the client qualifies, no code needed" />
          </div>
          {(form.birthday || form.anniversary) && <div className="sm:w-1/3"><NumberField id="of-win" label="Days either side" min={0} step={1} value={form.window_days} onChange={set('window_days')} /></div>}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="of-from" label="Starts"><Input id="of-from" type="date" value={form.starts_on} onChange={(e) => set('starts_on')(e.target.value)} /></Field>
            <Field id="of-to" label="Ends"><Input id="of-to" type="date" value={form.ends_on} onChange={(e) => set('ends_on')(e.target.value)} /></Field>
            <NumberField id="of-min" label="Minimum bill" prefix="₹" value={form.min_bill} onChange={set('min_bill')} />
            <NumberField id="of-lim" label="Total uses" min={1} step={1} value={form.usage_limit} onChange={set('usage_limit')} hint="Blank = no limit" />
            <NumberField id="of-plim" label="Uses per client" min={1} step={1} value={form.per_customer_limit} onChange={set('per_customer_limit')} />
          </div>
          {(plans.data || []).length > 0 && <div><p className="mb-1.5 text-small font-medium text-ink-700">Only for members of</p><div className="flex flex-wrap gap-1.5">{plans.data.map((p) => <button key={p.plan_id} type="button" aria-pressed={form.plan_ids.includes(p.plan_id)} onClick={() => toggleIn('plan_ids', p.plan_id)} className={`rounded-full border px-3 py-1 text-caption font-medium ${form.plan_ids.includes(p.plan_id) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-700'}`}>{p.name}</button>)}</div></div>}
          {outlets.length > 1 && <div><p className="mb-1.5 text-small font-medium text-ink-700">Only at <span className="font-normal text-ink-500">(none chosen = every outlet)</span></p><div className="flex flex-wrap gap-1.5">{outlets.map((o) => <button key={o.branch_id} type="button" aria-pressed={form.branch_ids.includes(o.branch_id)} onClick={() => toggleIn('branch_ids', o.branch_id)} className={`rounded-full border px-3 py-1 text-caption font-medium ${form.branch_ids.includes(o.branch_id) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-700'}`}>{o.name}</button>)}</div></div>}
        </fieldset>
        <Toggle id="of-active" checked={form.is_active} onChange={set('is_active')} label="Offer is on" />
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{offer ? 'Save offer' : 'Create offer'}</Button></div>
      </form>
    </Modal>
  );
};

const describeOffer = (o) => {
  const c = o.conditions || {};
  return [o.discount_type === 'PERCENT' ? `${o.value}% off` : `${money(o.value)} off`, o.applies_to === 'SERVICES' ? 'services' : o.applies_to === 'PRODUCTS' ? 'products' : null, c.first_visit && 'first visit', c.birthday && 'birthday', c.anniversary && 'anniversary', c.min_bill != null && `over ${money(c.min_bill)}`, o.ends_on && `until ${day(o.ends_on)}`].filter(Boolean).join(' · ');
};

const OffersTab = () => {
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(null);
  const list = useLoad(`/salon/offers?t=${tick}`);
  const rows = list.data || [];
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />New offer</Button></div>
      <ListState loading={list.loading && !list.data} error={list.error} empty={!list.loading && rows.length === 0} emptyIcon={Percent} emptyLabel="No offers yet." emptyBody="Offers give a discount to the right clients at the right time — a first-visit welcome, a birthday treat, a festival code." emptyAction={<Button onClick={() => setEditing({})}>Create an offer</Button>} />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>Offer</Th><Th>What it does</Th><Th>Code</Th><Th className="text-right">Used</Th><Th>Status</Th></Thead>
          <tbody>
            {rows.map((o) => (
              <Tr key={o.offer_id} onClick={() => setEditing(o)}>
                <Td className="font-medium">{o.name}{o.auto_apply && <span className="ml-2"><Badge tone="brand">Automatic</Badge></span>}</Td>
                <Td className="text-ink-700">{describeOffer(o)}</Td>
                <Td className="font-mono">{o.code || <span className="text-ink-400">—</span>}</Td>
                <Td className="text-right tabular">{o.redeemed ?? 0}{o.usage_limit ? ` / ${o.usage_limit}` : ''}</Td>
                <Td><Badge tone={o.is_active ? 'success' : 'neutral'}>{o.is_active ? 'On' : 'Off'}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <OfferForm offer={editing.offer_id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTick((t) => t + 1); }} />}
    </div>
  );
};

/* ── the page ─────────────────────────────────────────────────────────────── */

const SalonMemberships = () => {
  const { hasFeature } = useAuth();
  const all = [
    { key: 'plans', label: 'Membership plans', feature: 'salon_memberships', Body: PlansTab },
    { key: 'members', label: 'Members', feature: 'salon_memberships', Body: MembersTab },
    { key: 'packages', label: 'Packages', feature: 'salon_packages', Body: PackagesTab },
    { key: 'gift', label: 'Gift cards', feature: 'salon_gift_cards', Body: GiftCardsTab },
    { key: 'offers', label: 'Offers', Body: OffersTab }
  ].filter((t) => !t.feature || hasFeature(t.feature));
  const [tab, setTab] = useState(all[0]?.key);
  const Active = all.find((t) => t.key === tab)?.Body || OffersTab;
  return (
    <div>
      <PageHeader title="Memberships & offers" lead="Plans, packages, gift cards and discounts — set up here, sold at the till." />
      <Tabs value={tab} onChange={setTab} tabs={all.map((t) => ({ key: t.key, label: t.label }))} />
      <Active />
      {all.length < 5 && <p className="mt-6 flex items-center gap-2 text-caption text-ink-500"><Tag aria-hidden="true" className="h-3.5 w-3.5" />Some sections are part of a higher plan. See Settings → Subscription.</p>}
    </div>
  );
};

export default SalonMemberships;
