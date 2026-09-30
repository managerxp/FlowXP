/*
 * Loyalty and coupons, set by the owner.
 *
 * Loyalty: "every Nth visit, this item is free". A customer is a mobile number;
 * each day they are billed counts as one visit. Coupons: codes with a rule,
 * a validity window and usage limits.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gift } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api, formatCurrency } from '../lib/api.js';
import PointsTab from './PointsTab.jsx';
import { Alert, Badge, Button, Card, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useToast } from '../components/ui.jsx';

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th'}`;
const daysAgoText = (d) => {
  if (!d) return '';
  const n = Math.round((new Date(new Date().toDateString()) - new Date(`${d}T00:00`)) / 86400000);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
};

/* The card as customers see it on the QR menu and at the till: the program at a glance. */
const CardPreview = ({ business, n, reward, qty, on, minBill }) => (
  <div className={`relative overflow-hidden rounded-(--radius-panel) p-5 text-white shadow-md ${on ? 'bg-brand-500' : 'bg-ink-700'}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-caption font-semibold uppercase tracking-[0.14em] text-white/80">{business || 'Your'} visit card</p>
        <p className="mt-1 text-title font-semibold leading-snug">{reward ? `Every ${ordinal(n)} visit: ${qty > 1 ? `${qty} × ` : ''}${reward} free` : 'Choose the free item'}</p>
      </div>
      <Gift aria-hidden="true" className="h-8 w-8 shrink-0 text-white/90" />
    </div>
    <div className="mt-4 flex flex-wrap gap-1.5" aria-hidden="true">
      {Array.from({ length: Math.min(n - 1, 14) }, (_, i) => (
        <span key={i} className={`flex h-8 w-8 items-center justify-center rounded-full text-caption font-bold ${i < Math.min(3, n - 2) ? 'bg-white text-brand-700' : 'border border-white/50 text-white/80'}`}>{i < Math.min(3, n - 2) ? '✓' : i + 1}</span>
      ))}
      <span className="flex h-8 items-center gap-1 rounded-full border border-dashed border-white/70 px-3 text-caption font-bold"><Gift className="h-3.5 w-3.5" />FREE</span>
    </div>
    <p className="mt-3 text-caption text-white/80">{on ? `On${minBill > 0 ? ` · bills of ${formatCurrency(minBill)} or more earn a stamp` : ''} · shown on the QR menu and at the till` : 'Off: customers do not see it yet'}</p>
  </div>
);

const Insight = ({ label, value, note, tone }) => (
  <div className="rounded-(--radius-card) border border-line bg-surface p-4">
    <p className="text-caption text-ink-500">{label}</p>
    <p className={`tabular mt-1 text-title font-semibold ${tone || 'text-ink-900'}`}>{value}</p>
    {note && <p className="mt-0.5 text-caption text-ink-500">{note}</p>}
  </div>
);

const People = ({ title, note, list, count, empty, tone = 'text-ink-900' }) => (
  <section className="rounded-(--radius-card) border border-line bg-surface p-5">
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <h3 className="text-small font-semibold text-ink-900">{title} <span className={`tabular ml-1 ${tone}`}>{count}</span></h3>
    </div>
    <p className="mb-3 text-caption text-ink-500">{note}</p>
    {list.length === 0 ? <p className="text-small text-ink-500">{empty}</p> : (
      <ul className="divide-y divide-line">
        {list.map((m) => (
          <li key={m.customer_id} className="flex items-center justify-between gap-3 py-2 text-small">
            <Link to={`/app/customers?c=${m.customer_id}`} className="min-w-0 truncate font-medium text-ink-900 hover:text-brand-700">{m.name}</Link>
            <span className="shrink-0 text-caption text-ink-500">{m.visits} visit{m.visits === 1 ? '' : 's'} · last {daysAgoText(m.last_visit)}{m.phone && <> · <a href={`tel:${m.phone}`} className="font-medium text-brand-700">Call</a></>}</span>
          </li>
        ))}
      </ul>
    )}
    {count > list.length && <p className="mt-2 text-caption text-ink-500">and {count - list.length} more.</p>}
  </section>
);

const Program = () => {
  const toast = useToast();
  const { business } = useAuth();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [dishes, setDishes] = useState([]);
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [program, products, summary] = await Promise.all([api('/loyalty/program'), api('/products?kind=DISH'), api('/loyalty/summary')]);
      const f = { is_enabled: program.is_enabled, visits_required: String(program.visits_required), reward_product_id: program.reward_product_id ? String(program.reward_product_id) : '', reward_quantity: String(program.reward_quantity), min_bill: program.min_bill ? String(program.min_bill) : '' };
      setForm(f); setSaved(JSON.stringify(f)); setDishes(products); setStats(summary);
    } catch (caught) { setError(caught.status === 403 ? 'Loyalty is set up by owners and admins.' : caught.message); }
  };
  useEffect(() => { load(); }, []);

  const reward = dishes.find((d) => String(d.product_id) === form?.reward_product_id);
  const save = async (next = form) => {
    setError(''); setBusy(true);
    try {
      await api('/loyalty/program', { method: 'PUT', body: {
        is_enabled: next.is_enabled, visits_required: Number(next.visits_required), reward_product_id: next.reward_product_id ? Number(next.reward_product_id) : null,
        reward_quantity: Number(next.reward_quantity) || 1, min_bill: next.min_bill ? Number(next.min_bill) : 0
      } });
      toast.success(next.is_enabled ? 'Visit card saved and on' : 'Visit card saved, and off');
      load();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  if (!form) return error ? <Alert>{error}</Alert> : <div className="h-64 animate-pulse rounded-(--radius-card) bg-surface-3" />;
  const n = Math.max(2, Number(form.visits_required) || 7);
  const qty = Number(form.reward_quantity) || 1;
  const dirty = JSON.stringify(form) !== saved;
  const Chip = ({ active, onClick, children }) => (
    <button type="button" onClick={onClick} aria-pressed={active}
            className={`rounded-lg border px-3 py-1.5 text-small ${active ? 'border-brand-500 bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-500' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>{children}</button>
  );
  const Step = ({ n: num, title, children }) => (
    <div className="flex gap-3">
      <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-caption font-semibold text-white">{num}</span>
      <div className="min-w-0 flex-1"><p className="text-small font-semibold text-ink-900">{title}</p><div className="mt-2">{children}</div></div>
    </div>
  );
  const maxBucket = Math.max(1, ...(stats?.by_visits || []).map((b) => b.count));

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <CardPreview business={business?.name} n={n} reward={reward?.name} qty={qty} on={form.is_enabled} minBill={Number(form.min_bill) || 0} />
          <p className="px-1 text-caption text-ink-500">A customer is their mobile number. Every day they are billed counts as one visit, at any outlet. On the visit that earns it, the free item comes off the bill once it is on the order (the till offers to add it).</p>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-5 rounded-(--radius-card) border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-title font-semibold text-ink-900">Set it up</h2>
            <label className="flex cursor-pointer items-center gap-2 text-small font-medium text-ink-900">
              <span>{form.is_enabled ? 'On' : 'Off'}</span>
              <button type="button" role="switch" aria-checked={form.is_enabled} aria-label="Visit card on" onClick={() => setForm((f) => ({ ...f, is_enabled: !f.is_enabled }))}
                      className={`relative h-6 w-11 rounded-full transition-colors duration-(--duration-fast) ${form.is_enabled ? 'bg-brand-500' : 'bg-line-strong'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-(--duration-fast) ${form.is_enabled ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </label>
          </div>
          <Alert>{error}</Alert>
          <Step n="1" title="What is free?">
            <div className="flex gap-2">
              <Select aria-label="Free item" value={form.reward_product_id} onChange={(e) => setForm((f) => ({ ...f, reward_product_id: e.target.value }))} className="flex-1">
                <option value="">Choose from your menu…</option>
                {dishes.map((d) => <option key={d.product_id} value={d.product_id}>{d.name} ({formatCurrency(d.shared_price ?? d.selling_price)})</option>)}
              </Select>
              <Select aria-label="How many free" value={form.reward_quantity} onChange={(e) => setForm((f) => ({ ...f, reward_quantity: e.target.value }))} className="!w-20">
                {[1, 2, 3, 4].map((x) => <option key={x} value={x}>× {x}</option>)}
              </Select>
            </div>
            {reward && <p className="mt-1 text-caption text-ink-500">Worth {formatCurrency(qty * (reward.shared_price ?? reward.selling_price))} to the customer; it costs you {reward.unit_cost ? formatCurrency(qty * reward.unit_cost) : 'its ingredients'}.</p>}
          </Step>
          <Step n="2" title="On which visit?">
            <div className="flex flex-wrap items-center gap-1.5">
              {[5, 7, 10].map((x) => <Chip key={x} active={n === x} onClick={() => setForm((f) => ({ ...f, visits_required: String(x) }))}>{ordinal(x)} visit</Chip>)}
              <span className="flex items-center gap-1.5 text-small text-ink-500">or <Input aria-label="Visit number" type="number" min="2" max="50" value={form.visits_required} onChange={(e) => setForm((f) => ({ ...f, visits_required: e.target.value }))} className="!h-9 !w-20" /></span>
            </div>
          </Step>
          <Step n="3" title="Which bills earn a stamp?">
            <div className="flex flex-wrap items-center gap-1.5">
              {[['', 'Every bill'], ['100', '₹100 or more'], ['150', '₹150 or more'], ['300', '₹300 or more']].map(([v, label]) => <Chip key={v || 'all'} active={(form.min_bill || '') === v} onClick={() => setForm((f) => ({ ...f, min_bill: v }))}>{label}</Chip>)}
              <span className="flex items-center gap-1.5 text-small text-ink-500">or ₹<Input aria-label="Minimum bill" type="number" min="0" step="1" value={form.min_bill} onChange={(e) => setForm((f) => ({ ...f, min_bill: e.target.value }))} className="!h-9 !w-24" /></span>
            </div>
          </Step>
          <p className="rounded-lg bg-surface-2 p-3 text-small text-ink-700">
            {reward ? <>Customers get <strong>{qty > 1 ? `${qty} × ` : ''}{reward.name}</strong> free on their <strong>{ordinal(n)} visit</strong>, then the card starts again.{Number(form.min_bill) > 0 && <> Only bills of {formatCurrency(Number(form.min_bill))} or more earn a stamp.</>}</> : 'Pick the item that will be free.'}
          </p>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-caption text-ink-500">{dirty ? 'You have changes not saved yet.' : 'Saved.'}</p>
            <Button type="submit" disabled={busy || !dirty || (form.is_enabled && !form.reward_product_id)}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </div>

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Insight label="Members" value={stats.members} note={`${stats.new_30d} new in the last 30 days`} />
            <Insight label="Came back, 30 days" value={stats.active_30d} note={`${stats.visits_30d} visits stamped`} />
            <Insight label="Free items given" value={stats.rewards_redeemed} note={`${stats.rewards_redeemed_30d} in 30 days · worth ${formatCurrency(stats.rewards_value)}`} />
            <Insight label="Not back in 60 days" value={stats.lapsed_60d} tone={stats.lapsed_60d > 0 ? 'text-warning' : undefined} note={stats.lapsed_60d > 0 ? <Link to="/app/messaging" className="font-medium text-brand-700">Send them an offer</Link> : 'everyone is coming back'} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section className="rounded-(--radius-card) border border-line bg-surface p-5">
              <h3 className="text-small font-semibold text-ink-900">How often members come</h3>
              <p className="mb-4 text-caption text-ink-500">Visits on the card since they joined.</p>
              <ul className="space-y-3">
                {stats.by_visits.map((b) => (
                  <li key={b.label} className="text-small">
                    <span className="flex justify-between"><span className="text-ink-700">{b.label}</span><span className="tabular font-semibold text-ink-900">{b.count}<span className="ml-1.5 font-normal text-ink-500">{stats.members ? Math.round((b.count / stats.members) * 100) : 0}%</span></span></span>
                    <span aria-hidden="true" className="mt-1 block h-2 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${(b.count / maxBucket) * 100}%` }} /></span>
                  </li>
                ))}
              </ul>
              {stats.members > 0 && stats.by_visits[0].count / stats.members > 0.5 && <p className="mt-4 rounded-lg bg-surface-2 p-3 text-caption text-ink-700">Most members have come only once. A lower first reward (the {ordinal(Math.max(3, n - 2))} visit) or an offer to first-timers can bring them back.</p>}
            </section>
            <div className="space-y-4">
              <People title="Free item due now" count={stats.reward_due.count} tone="text-success" list={stats.reward_due.members} note="Their next bill gets the free item. A nice reason to call them in." empty="Nobody has a reward waiting." />
              <People title="One visit away" count={stats.one_visit_away.count} list={stats.one_visit_away.members} note="One more visit and the next one is free." empty="Nobody is one visit away right now." />
            </div>
          </div>

          {stats.regulars.length > 0 && (
            <section className="rounded-(--radius-card) border border-line bg-surface p-5">
              <h3 className="mb-3 text-small font-semibold text-ink-900">Your regulars</h3>
              <ul className="divide-y divide-line">
                {stats.regulars.map((r) => (
                  <li key={r.customer_id} className="flex items-center justify-between gap-3 py-2.5 text-small">
                    <Link to={`/app/customers?c=${r.customer_id}`} className="min-w-0 truncate font-medium text-ink-900 hover:text-brand-700">{r.name} <span className="font-normal text-ink-500">{r.phone}</span></Link>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="tabular text-ink-500">{r.visits} visits</span>
                      {r.reward_ready ? <span className="rounded bg-success/10 px-1.5 py-0.5 text-caption font-semibold text-success">Free item due</span>
                        : r.stamps != null && <span className="flex gap-0.5" aria-label={`${r.stamps} of ${n - 1} stamps`}>{Array.from({ length: Math.min(n - 1, 10) }, (_, i) => <span key={i} className={`h-2 w-2 rounded-full ${i < r.stamps ? 'bg-brand-500' : 'bg-surface-3'}`} />)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};

const EMPTY = { code: '', description: '', kind: 'PERCENT', value: '', min_bill: '', max_discount: '', valid_from: '', valid_to: '', max_uses: '', max_uses_per_customer: '', is_active: true };

const CouponForm = ({ coupon, onSaved, onClose }) => {
  const [form, setForm] = useState(coupon ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, coupon[k] == null ? (k === 'is_active' ? true : '') : coupon[k]])) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const body = { ...form, value: Number(form.value) };
      for (const k of ['min_bill', 'max_discount', 'max_uses', 'max_uses_per_customer']) body[k] = form[k] === '' ? null : Number(form[k]);
      for (const k of ['valid_from', 'valid_to']) body[k] = form[k] || null;
      await api(coupon ? `/coupons/${coupon.coupon_id}` : '/coupons', { method: coupon ? 'PUT' : 'POST', body });
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={coupon ? `Edit ${coupon.code}` : 'New coupon'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="c-code" label="Code" hint="What the customer says or types."><Input id="c-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="WELCOME10" required autoFocus /></Field>
          <Field id="c-kind" label="Type">
            <Select id="c-kind" value={form.kind} onChange={set('kind')}><option value="PERCENT">Percent off</option><option value="FLAT">Flat amount off</option></Select>
          </Field>
          <Field id="c-value" label={form.kind === 'PERCENT' ? 'Percent' : 'Amount (₹)'}><Input id="c-value" type="number" min="0.01" step="0.01" value={form.value} onChange={set('value')} required /></Field>
        </div>
        <Field id="c-desc" label="Note for staff" hint="Optional"><Input id="c-desc" value={form.description} onChange={set('description')} placeholder="First visit offer" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="c-min" label="Minimum bill (₹)"><Input id="c-min" type="number" min="0" value={form.min_bill} onChange={set('min_bill')} /></Field>
          {form.kind === 'PERCENT' && <Field id="c-max" label="Most it can take off (₹)"><Input id="c-max" type="number" min="1" value={form.max_discount} onChange={set('max_discount')} /></Field>}
          <Field id="c-from" label="Starts"><Input id="c-from" type="date" value={form.valid_from} onChange={set('valid_from')} /></Field>
          <Field id="c-to" label="Ends"><Input id="c-to" type="date" value={form.valid_to} onChange={set('valid_to')} /></Field>
          <Field id="c-uses" label="Total uses" hint="Blank = unlimited"><Input id="c-uses" type="number" min="1" value={form.max_uses} onChange={set('max_uses')} /></Field>
          <Field id="c-per" label="Uses per customer" hint="Needs the customer’s mobile at billing"><Input id="c-per" type="number" min="1" value={form.max_uses_per_customer} onChange={set('max_uses_per_customer')} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : coupon ? 'Save changes' : 'Create coupon'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const Coupons = () => {
  const [coupons, setCoupons] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const load = () => api('/coupons').then(setCoupons).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const toggle = async (c) => {
    try { await api(`/coupons/${c.coupon_id}`, { method: 'PUT', body: { is_active: !c.is_active } }); load(); }
    catch (caught) { setError(caught.message); }
  };
  const status = (c) => {
    const today = new Date().toISOString().slice(0, 10);
    if (!c.is_active) return <Badge tone="neutral">Off</Badge>;
    if (c.valid_to && c.valid_to < today) return <Badge tone="neutral">Expired</Badge>;
    if (c.valid_from && c.valid_from > today) return <Badge tone="warning">Scheduled</Badge>;
    if (c.max_uses != null && c.used >= c.max_uses) return <Badge tone="neutral">Used up</Badge>;
    return <Badge tone="success">Live</Badge>;
  };

  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing({})}>New coupon</Button></div>
      <Alert>{error}</Alert>
      <ListState loading={!coupons && !error} empty={coupons?.length === 0} emptyLabel="No coupons yet. Create one and give the code to a customer; the cashier enters it at billing." />
      {coupons?.length > 0 && (
        <Table>
          <Thead><Th>Code</Th><Th>Offer</Th><Th>Valid</Th><Th className="text-right">Used</Th><Th className="text-right">Given off</Th><Th>Status</Th><Th></Th></Thead>
          <tbody>
            {coupons.map((c) => (
              <Tr key={c.coupon_id}>
                <Td className="font-mono font-semibold">{c.code}{c.description && <span className="block font-sans text-xs font-normal text-ink-400">{c.description}</span>}</Td>
                <Td>{c.kind === 'PERCENT' ? `${c.value}% off` : `${formatCurrency(c.value)} off`}{c.max_discount != null && ` (max ${formatCurrency(c.max_discount)})`}{c.min_bill > 0 && <span className="block text-xs text-ink-400">on bills of {formatCurrency(c.min_bill)}+</span>}</Td>
                <Td className="text-ink-500">{c.valid_from || c.valid_to ? `${c.valid_from || '…'} → ${c.valid_to || '…'}` : 'Always'}</Td>
                <Td className="text-right">{c.used}{c.max_uses != null && ` / ${c.max_uses}`}</Td>
                <Td className="text-right">{formatCurrency(c.discount_given)}</Td>
                <Td>{status(c)}</Td>
                <Td className="space-x-3 text-right">
                  <button onClick={() => setEditing(c)} className="text-xs font-semibold text-brand-600">Edit</button>
                  <button onClick={() => toggle(c)} className="text-xs font-semibold text-ink-500 hover:text-ink-900">{c.is_active ? 'Turn off' : 'Turn on'}</button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <CouponForm coupon={editing.coupon_id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
};

const LoyaltyPage = () => {
  const [tab, setTab] = useState('program');
  return (
    <div>
      <PageHeader title="Loyalty & coupons" lead="Bring customers back: a free item on every few visits, points, and offer codes." />
      <div className="mb-6 flex gap-1 border-b border-line" role="tablist">
        {[['program', 'Visit card'], ['points', 'Points & tiers'], ['coupons', 'Coupons']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-small font-medium ${tab === id ? 'border-brand-500 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>{label}</button>
        ))}
      </div>
      {tab === 'program' ? <Program /> : tab === 'points' ? <PointsTab /> : <Coupons />}
    </div>
  );
};

export default LoyaltyPage;
