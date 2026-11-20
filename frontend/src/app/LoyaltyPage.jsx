/*
 * Loyalty and coupons, set by the owner.
 *
 * Loyalty cards (stamps and points, with their look, tiers, bill QR and results) are made under the first two tabs.
 * Coupons: codes with a rule, a validity window and usage limits.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api, formatCurrency } from '../lib/api.js';
import LoyaltyProgrammes from './LoyaltyProgrammes.jsx';
import LoyaltyInsights from './LoyaltyInsights.jsx';
import { Alert, Badge, Button, Card, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useToast } from '../components/ui.jsx';
import { useT, T } from '../i18n/useT.js';

const EMPTY = { code: '', description: '', kind: 'PERCENT', value: '', min_bill: '', max_discount: '', valid_from: '', valid_to: '', max_uses: '', max_uses_per_customer: '', is_active: true };

const CouponForm = ({ coupon, onSaved, onClose }) => {
  const tr = useT();
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
    <Modal title={coupon ? `Edit ${coupon.code}` : tr('New coupon')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="c-code" label={tr('Code')} hint={tr('What the customer says or types.')}><Input id="c-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="WELCOME10" required autoFocus /></Field>
          <Field id="c-kind" label={tr('Type')}>
            <Select id="c-kind" value={form.kind} onChange={set('kind')}><option value="PERCENT">{tr('Percent off')}</option><option value="FLAT">{tr('Flat amount off')}</option></Select>
          </Field>
          <Field id="c-value" label={form.kind === 'PERCENT' ? tr('Percent') : tr('Amount (₹)')}><Input id="c-value" type="number" min="0.01" step="0.01" value={form.value} onChange={set('value')} required /></Field>
        </div>
        <Field id="c-desc" label={tr('Note for staff')} hint={tr('Optional')}><Input id="c-desc" value={form.description} onChange={set('description')} placeholder={tr('First visit offer')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="c-min" label={tr('Minimum bill (₹)')}><Input id="c-min" type="number" min="0" value={form.min_bill} onChange={set('min_bill')} /></Field>
          {form.kind === 'PERCENT' && <Field id="c-max" label={tr('Most it can take off (₹)')}><Input id="c-max" type="number" min="1" value={form.max_discount} onChange={set('max_discount')} /></Field>}
          <Field id="c-from" label={tr('Starts')}><Input id="c-from" type="date" value={form.valid_from} onChange={set('valid_from')} /></Field>
          <Field id="c-to" label={tr('Ends')}><Input id="c-to" type="date" value={form.valid_to} onChange={set('valid_to')} /></Field>
          <Field id="c-uses" label={tr('Total uses')} hint="Blank = unlimited"><Input id="c-uses" type="number" min="1" value={form.max_uses} onChange={set('max_uses')} /></Field>
          <Field id="c-per" label={tr('Uses per customer')} hint={tr('Needs the customer’s mobile at billing')}><Input id="c-per" type="number" min="1" value={form.max_uses_per_customer} onChange={set('max_uses_per_customer')} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>{tr('Cancel')}</Button>
          <Button type="submit" disabled={busy}>{busy ? tr('Saving…') : coupon ? tr('Save changes') : tr('Create coupon')}</Button>
        </div>
      </form>
    </Modal>
  );
};

const Coupons = () => {
  const tr = useT();
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
    if (!c.is_active) return <Badge tone="neutral">{tr('Off')}</Badge>;
    if (c.valid_to && c.valid_to < today) return <Badge tone="neutral">{tr('Expired')}</Badge>;
    if (c.valid_from && c.valid_from > today) return <Badge tone="warning">{tr('Scheduled')}</Badge>;
    if (c.max_uses != null && c.used >= c.max_uses) return <Badge tone="neutral">{tr('Used up')}</Badge>;
    return <Badge tone="success">{tr('Live')}</Badge>;
  };

  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing({})}>{tr('New coupon')}</Button></div>
      <Alert>{error}</Alert>
      <ListState loading={!coupons && !error} empty={coupons?.length === 0} emptyLabel="No coupons yet. Create one and give the code to a customer; the cashier enters it at billing." />
      {coupons?.length > 0 && (
        <Table>
          <Thead><Th>{tr('Code')}</Th><Th>{tr('Offer')}</Th><Th>{tr('Valid')}</Th><Th className="text-right">{tr('Used')}</Th><Th className="text-right">{tr('Given off')}</Th><Th>{tr('Status')}</Th><Th></Th></Thead>
          <tbody>
            {coupons.map((c) => (
              <Tr key={c.coupon_id}>
                <Td className="font-mono font-semibold">{c.code}{c.description && <span className="block font-sans text-xs font-normal text-ink-400">{tr(c.description)}</span>}</Td>
                <Td>{c.kind === 'PERCENT' ? `${c.value}% off` : `${formatCurrency(c.value)} off`}{c.max_discount != null && ` (max ${formatCurrency(c.max_discount)})`}{c.min_bill > 0 && <span className="block text-xs text-ink-400">{tr('on bills of {{formatCurrency}}+', { formatCurrency: formatCurrency(c.min_bill) })}</span>}</Td>
                <Td className="text-ink-500">{c.valid_from || c.valid_to ? `${c.valid_from || '…'} → ${c.valid_to || '…'}` : tr('Always')}</Td>
                <Td className="text-right">{c.used}{c.max_uses != null && ` / ${c.max_uses}`}</Td>
                <Td className="text-right">{formatCurrency(c.discount_given)}</Td>
                <Td>{status(c)}</Td>
                <Td className="space-x-3 text-right">
                  <button onClick={() => setEditing(c)} className="text-xs font-semibold text-brand-600">{tr('Edit')}</button>
                  <button onClick={() => toggle(c)} className="text-xs font-semibold text-ink-500 hover:text-ink-900">{c.is_active ? tr('Turn off') : tr('Turn on')}</button>
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
  const tr = useT();
  const [tab, setTab] = useState('cards');
  const { business } = useAuth();
  return (
    <div>
      <PageHeader title={tr('Loyalty & coupons')} lead={tr('Bring customers back: stamp and points cards, and offer codes.')} />
      <div className="mb-6 flex gap-1 border-b border-line" role="tablist">
        {[['cards', T('Loyalty cards')], ['results', T('Card results')], ['coupons', T('Coupons')]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-small font-medium ${tab === id ? 'border-brand-500 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>{tr(label)}</button>
        ))}
      </div>
      {tab === 'cards' ? <LoyaltyProgrammes business={business?.name} businessType={business?.business_type} /> : tab === 'results' ? <LoyaltyInsights /> : <Coupons />}
    </div>
  );
};

export default LoyaltyPage;
