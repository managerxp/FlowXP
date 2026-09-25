/*
 * Loyalty and coupons, set by the owner.
 *
 * Loyalty: "every Nth visit, this item is free". A customer is a mobile number;
 * each day they are billed counts as one visit. Coupons: codes with a rule,
 * a validity window and usage limits.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { Alert, Badge, Button, Card, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useToast } from '../components/ui.jsx';

const Program = () => {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [dishes, setDishes] = useState([]);
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [program, products, summary] = await Promise.all([api('/loyalty/program'), api('/products?kind=DISH'), api('/loyalty/summary')]);
      setForm({ is_enabled: program.is_enabled, visits_required: String(program.visits_required), reward_product_id: program.reward_product_id ? String(program.reward_product_id) : '', reward_quantity: String(program.reward_quantity), min_bill: program.min_bill ? String(program.min_bill) : '' });
      setDishes(products); setStats(summary);
    } catch (caught) { setError(caught.status === 403 ? 'Loyalty is set up by owners and admins.' : caught.message); }
  };
  useEffect(() => { load(); }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const reward = dishes.find((d) => String(d.product_id) === form?.reward_product_id);

  const save = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/loyalty/program', { method: 'PUT', body: {
        is_enabled: form.is_enabled, visits_required: Number(form.visits_required), reward_product_id: form.reward_product_id ? Number(form.reward_product_id) : null,
        reward_quantity: Number(form.reward_quantity) || 1, min_bill: form.min_bill ? Number(form.min_bill) : 0
      } });
      toast.success('Loyalty program saved');
      load();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  if (!form) return error ? <Alert>{error}</Alert> : <p className="py-10 text-center text-sm text-ink-400">Loading…</p>;
  const n = Number(form.visits_required) || 7;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <form onSubmit={save} className="glass space-y-4 rounded-[--radius-card] p-5">
        <Alert>{error}</Alert>
        <label className="flex items-center gap-2 text-sm font-medium text-ink-900">
          <input type="checkbox" checked={form.is_enabled} onChange={set('is_enabled')} className="h-4 w-4 accent-[var(--color-brand-500)]" /> Loyalty program is on
        </label>
        <div className="grid grid-cols-2 gap-4">
          <Field id="l-visits" label="Free on visit number" hint={`${n - 1} visits earn stamps, visit ${n} is free.`}>
            <Input id="l-visits" type="number" min="2" max="50" value={form.visits_required} onChange={set('visits_required')} required />
          </Field>
          <Field id="l-qty" label="How many free"><Input id="l-qty" type="number" min="1" max="10" value={form.reward_quantity} onChange={set('reward_quantity')} required /></Field>
        </div>
        <Field id="l-item" label="Free item" hint="Applied automatically when it is on the bill of the visit that earns it.">
          <Select id="l-item" value={form.reward_product_id} onChange={set('reward_product_id')}>
            <option value="">Choose from your menu…</option>
            {dishes.map((d) => <option key={d.product_id} value={d.product_id}>{d.name} ({formatCurrency(d.shared_price ?? d.selling_price)})</option>)}
          </Select>
        </Field>
        <Field id="l-min" label="Minimum bill for a visit to count (₹)" hint="Leave blank to count every bill.">
          <Input id="l-min" type="number" min="0" step="1" value={form.min_bill} onChange={set('min_bill')} />
        </Field>
        <div className="rounded-lg bg-surface-2 p-3 text-sm text-ink-600">
          {reward ? <>Customers get <strong>{Number(form.reward_quantity) > 1 ? `${form.reward_quantity} × ` : ''}{reward.name}</strong> free on <strong>visit number {n}</strong>, then the card starts again. A customer is identified by their mobile number; several bills on one day count as one visit, at any outlet.</> : 'Pick the item that will be free.'}
        </div>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </form>

      <div className="space-y-6">
        {stats && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[['Members', stats.members, 'have at least one visit'], ['Visits, 30 days', stats.visits_30d, 'stamps given'], ['Rewards given', stats.rewards_redeemed, `${stats.rewards_redeemed_30d} in 30 days · worth ${formatCurrency(stats.rewards_value)}`], ['Coupons, 30 days', stats.coupon_uses_30d, `${formatCurrency(stats.coupon_discount_30d)} off`]].map(([label, value, sub]) => (
              <Card key={label}><p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</p><p className="mt-1 text-xl font-bold text-ink-900">{value}</p><p className="text-xs text-ink-400">{sub}</p></Card>
            ))}
          </div>
        )}
        {stats?.regulars.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink-900">Most frequent customers</h2>
            <Table>
              <Thead><Th>Customer</Th><Th className="text-right">Visits</Th><Th>Card</Th></Thead>
              <tbody>
                {stats.regulars.map((r) => (
                  <Tr key={r.customer_id}>
                    <Td className="font-medium">{r.name} <span className="text-xs text-ink-400">{r.phone}</span></Td>
                    <Td className="text-right">{r.visits}</Td>
                    <Td>{r.reward_ready ? <Badge tone="success">Free item due</Badge> : r.stamps != null ? <span className="text-ink-500">{r.stamps} of {n - 1}</span> : '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
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
      <PageHeader title="Loyalty & coupons" lead="Reward regulars with a free item, and hand out offer codes." />
      <div className="mb-6 flex gap-2" role="tablist">
        {[['program', 'Visit card'], ['coupons', 'Coupons']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${tab === id ? 'bg-brand-50 text-brand-600' : 'text-ink-600 hover:bg-surface-2'}`}>{label}</button>
        ))}
      </div>
      {tab === 'program' ? <Program /> : <Coupons />}
    </div>
  );
};

export default LoyaltyPage;
