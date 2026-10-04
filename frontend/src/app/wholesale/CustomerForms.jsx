/*
 * Customer forms: the full B2B profile (type, GSTIN / PAN, billing and shipping address, credit limit, terms, salesperson,
 * price list, standing discount, opening balance) and a two-field quick add for use in the middle of taking an order.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { CUSTOMER_TYPES } from '../../lib/wholesale.js';
import { Alert, Button, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { TerritorySelect } from '../distributor/parts.jsx';
import { NumberField, Segmented } from './parts.jsx';

const blank = { name: '', customer_type: 'RETAILER', contact_person: '', phone: '', email: '', gstin: '', pan: '', billing_address: '', city: '', state: '', pincode: '', shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: '',
  credit_limit: '', payment_terms_days: '', salesperson_id: '', territory_id: '', price_list_id: '', default_discount_pct: '', opening_balance: '', credit_policy: '', notes: '' };

const fromCustomer = (c) => ({ ...blank, ...Object.fromEntries(Object.keys(blank).map((k) => [k, c[k] ?? ''])), billing_address: c.billing_address ?? c.address ?? '', credit_limit: c.credit_limit || '', default_discount_pct: c.default_discount_pct || '', opening_balance: c.opening_balance || '' });

export const CustomerForm = ({ customer, onClose, onSaved }) => {
  const toast = useToast();
  const { business } = useAuth();
  const editing = Boolean(customer?.customer_id);
  const [f, setF] = useState(() => (customer ? fromCustomer(customer) : blank));
  const [tab, setTab] = useState('details');
  const [people, setPeople] = useState([]);
  const [lists, setLists] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sameShip, setSameShip] = useState(!customer?.shipping_address);
  useEffect(() => {
    api('/wholesale/salespeople').then(setPeople).catch(() => {});
    api('/wholesale/price-lists').then((l) => setLists(l.filter((x) => x.kind === 'STANDARD' && x.is_active))).catch(() => {});
  }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    const num = (v) => (v === '' ? null : Number(v));
    const body = {
      name: f.name, customer_type: f.customer_type, contact_person: f.contact_person || null, phone: f.phone || null, email: f.email || null, gstin: f.gstin || null, pan: f.pan || null,
      address: f.billing_address || null, billing_address: f.billing_address || null, city: f.city || null, state: f.state || null, pincode: f.pincode || null,
      shipping_address: sameShip ? null : (f.shipping_address || null), shipping_city: sameShip ? null : (f.shipping_city || null), shipping_state: sameShip ? null : (f.shipping_state || null), shipping_pincode: sameShip ? null : (f.shipping_pincode || null),
      credit_limit: num(f.credit_limit) ?? 0, payment_terms_days: num(f.payment_terms_days), salesperson_id: num(f.salesperson_id), ...(business?.distributor_enabled ? { territory_id: num(f.territory_id) } : {}), price_list_id: num(f.price_list_id), default_discount_pct: num(f.default_discount_pct) ?? 0,
      opening_balance: num(f.opening_balance) ?? 0, credit_policy: f.credit_policy || null, notes: f.notes || null
    };
    try {
      const saved = await api(editing ? `/wholesale/customers/${customer.customer_id}` : '/wholesale/customers', { method: editing ? 'PUT' : 'POST', body });
      toast.success(editing ? 'Customer updated' : `${saved.name} added`);
      onSaved(saved);
    } catch (err) { setError(err.message); setTab('details'); } finally { setBusy(false); }
  };

  return (
    <Modal title={editing ? 'Edit customer' : 'Add a customer'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <Alert>{error}</Alert>
        <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: 'details', label: 'Details' }, { value: 'address', label: 'Addresses' }, { value: 'credit', label: 'Credit & pricing' }]} />
        {tab === 'details' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field id="cf-name" label="Business name"><Input id="cf-name" value={f.name} onChange={set('name')} required autoFocus maxLength={160} /></Field></div>
            <Field id="cf-type" label="Customer type"><Select id="cf-type" value={f.customer_type} onChange={set('customer_type')}>{Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field id="cf-contact" label="Contact person"><Input id="cf-contact" value={f.contact_person} onChange={set('contact_person')} /></Field>
            <Field id="cf-phone" label="Mobile"><Input id="cf-phone" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
            <Field id="cf-email" label="Email"><Input id="cf-email" type="email" value={f.email} onChange={set('email')} /></Field>
            <Field id="cf-gstin" label="GSTIN" hint="15 characters"><Input id="cf-gstin" value={f.gstin} onChange={(e) => setF((x) => ({ ...x, gstin: e.target.value.toUpperCase() }))} maxLength={15} /></Field>
            <Field id="cf-pan" label="PAN"><Input id="cf-pan" value={f.pan} onChange={(e) => setF((x) => ({ ...x, pan: e.target.value.toUpperCase() }))} maxLength={10} /></Field>
            <div className="sm:col-span-2"><Field id="cf-notes" label="Internal notes"><Textarea id="cf-notes" rows={2} value={f.notes} onChange={set('notes')} /></Field></div>
          </div>
        )}
        {tab === 'address' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field id="cf-bill" label="Billing address"><Textarea id="cf-bill" rows={2} value={f.billing_address} onChange={set('billing_address')} /></Field></div>
            <Field id="cf-city" label="City"><Input id="cf-city" value={f.city} onChange={set('city')} /></Field>
            <Field id="cf-state" label="State" hint="Decides CGST + SGST or IGST on invoices"><Input id="cf-state" value={f.state} onChange={set('state')} /></Field>
            <Field id="cf-pin" label="Pincode"><Input id="cf-pin" inputMode="numeric" value={f.pincode} onChange={set('pincode')} maxLength={6} /></Field>
            <label className="flex items-center gap-2 self-end pb-2.5 text-small text-ink-700 sm:col-span-2"><input type="checkbox" checked={sameShip} onChange={(e) => setSameShip(e.target.checked)} className="h-4 w-4 accent-(--color-brand-500)" />Ship to the billing address</label>
            {!sameShip && <>
              <div className="sm:col-span-2"><Field id="cf-ship" label="Shipping address"><Textarea id="cf-ship" rows={2} value={f.shipping_address} onChange={set('shipping_address')} /></Field></div>
              <Field id="cf-scity" label="Shipping city"><Input id="cf-scity" value={f.shipping_city} onChange={set('shipping_city')} /></Field>
              <Field id="cf-sstate" label="Shipping state"><Input id="cf-sstate" value={f.shipping_state} onChange={set('shipping_state')} /></Field>
              <Field id="cf-spin" label="Shipping pincode"><Input id="cf-spin" inputMode="numeric" value={f.shipping_pincode} onChange={set('shipping_pincode')} maxLength={6} /></Field>
            </>}
          </div>
        )}
        {tab === 'credit' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField id="cf-limit" label="Credit limit" prefix="₹" hint="0 means no limit" value={f.credit_limit} onChange={set('credit_limit')} />
            <NumberField id="cf-terms" label="Payment terms" suffix="days" step={1} hint="Blank uses your default" value={f.payment_terms_days} onChange={set('payment_terms_days')} />
            <Field id="cf-policy" label="When over the limit" hint="Blank follows your wholesale settings"><Select id="cf-policy" value={f.credit_policy} onChange={set('credit_policy')}><option value="">Business default</option><option value="OFF">Allow</option><option value="WARN">Warn</option><option value="BLOCK">Block</option></Select></Field>
            <Field id="cf-sp" label="Salesperson"><Select id="cf-sp" value={f.salesperson_id} onChange={set('salesperson_id')}><option value="">None</option>{people.map((p) => <option key={p.salesperson_id} value={p.salesperson_id}>{p.name}</option>)}</Select></Field>
            {business?.distributor_enabled && <TerritorySelect id="cf-terr" value={f.territory_id} onChange={(v) => setF((x) => ({ ...x, territory_id: v }))} hint="Drives territory pricing, targets and beats" levels={['AREA', 'TERRITORY']} />}
            <Field id="cf-pl" label="Price list" hint="Blank uses the list for their type"><Select id="cf-pl" value={f.price_list_id} onChange={set('price_list_id')}><option value="">Default</option>{lists.map((l) => <option key={l.list_id} value={l.list_id}>{l.name}</option>)}</Select></Field>
            <NumberField id="cf-disc" label="Standing discount" suffix="%" hint="Off list prices, not off negotiated prices" value={f.default_discount_pct} onChange={set('default_discount_pct')} />
            <NumberField id="cf-open" label="Opening balance" prefix="₹" hint="What they owed when you started (negative if you owe them)" min={-100000000} value={f.opening_balance} onChange={set('opening_balance')} />
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{editing ? 'Save changes' : 'Add customer'}</Button></div>
      </form>
    </Modal>
  );
};

/** Two fields, for adding a customer in the middle of taking an order. */
export const QuickCustomerModal = ({ onClose, onSaved }) => {
  const toast = useToast();
  const [f, setF] = useState({ name: '', phone: '', gstin: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const made = await api('/wholesale/customers', { method: 'POST', body: { name: f.name, phone: f.phone || null, gstin: f.gstin || null, customer_type: 'RETAILER' } }); toast.success(`${made.name} added`); onSaved(made); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a customer" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="qc-name" label="Business name"><Input id="qc-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></Field>
        <Field id="qc-phone" label="Mobile"><Input id="qc-phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field id="qc-gst" label="GSTIN" hint="Optional"><Input id="qc-gst" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} /></Field>
        <p className="text-caption text-ink-500">You can add addresses, credit and prices later from the customer’s page.</p>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Add customer</Button></div>
      </form>
    </Modal>
  );
};
