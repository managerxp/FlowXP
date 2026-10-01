/*
 * Take or change a sales order.
 *
 * The lines are priced by the server (customer price → price list → quantity break → promotion → tier) the moment
 * anything changes, so what is on screen is what will be saved: the price each line gets and where it came from, what is
 * in stock, what would be back-ordered, GST, and whether the customer's credit allows it. Only a person with pricing
 * permission can type a price or a discount over the rule.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TriangleAlert, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { money, priceSourceText, qty, todayIn, useDebounced } from '../../lib/wholesale.js';
import { Alert, Button, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea, useToast } from '../../components/ui.jsx';
import { CustomerPicker, NumberField, Panel, ProductPicker, WarehouseSelect } from './parts.jsx';
import { QuickCustomerModal } from './CustomerForms.jsx';

let seq = 0;
const newKey = () => `l${++seq}`;

/* A credit block the person may override (managers) or must stop at (everyone else). */
const CreditStop = ({ info, canOverride, onClose, onOverride }) => {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Credit limit reached" onClose={onClose}>
      <div className="space-y-4">
        <ul className="space-y-1 text-small text-ink-900">{info.reasons.map((r) => <li key={r} className="flex gap-2"><TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />{r}</li>)}</ul>
        {canOverride ? (
          <>
            <Field id="override-reason" label="Reason for allowing it" hint="Recorded with the order"><Input id="override-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
            <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Not now</Button><Button variant="danger" onClick={() => onOverride(reason)}>Confirm anyway</Button></div>
          </>
        ) : (
          <><p className="text-small text-ink-500">Ask a sales manager to confirm this order, or collect a payment from the customer first.</p><div className="flex justify-end border-t border-line pt-4"><Button variant="secondary" onClick={onClose}>OK</Button></div></>
        )}
      </div>
    </Modal>
  );
};

const OrderEditor = () => {
  const { id } = useParams();
  const editing = Boolean(id);
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const privileged = can('pricing');
  const priceRef = useRef(null);
  const [search] = useSearchParams();

  const [customer, setCustomer] = useState(null);
  const [warehouse, setWarehouse] = useState('');
  const [lines, setLines] = useState([]);
  const [head, setHead] = useState({ order_date: todayIn(), expected_delivery: '', shipping_address: '', shipping_charge: '', shipping_tax_rate: '', discount: '', customer_po: '', notes: '', payment_terms_days: '', salesperson_id: '' });
  const [people, setPeople] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [loaded, setLoaded] = useState(!editing);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creditStop, setCreditStop] = useState(null);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [status, setStatus] = useState('DRAFT');

  useEffect(() => { api('/wholesale/salespeople').then(setPeople).catch(() => {}); }, []);

  // load an existing order
  useEffect(() => {
    if (!editing) return;
    api(`/wholesale/orders/${id}`).then((o) => {
      if (!['DRAFT', 'PENDING', 'CONFIRMED', 'PARTIALLY_FULFILLED', 'PACKED'].includes(o.status)) { setLoadError(`This order is ${o.status.toLowerCase().replace(/_/g, ' ')} and can no longer be edited.`); return; }
      setStatus(o.status);
      setCustomer({ customer_id: o.customer_id, name: o.customer, phone: o.customer_phone, gstin: o.customer_gstin });
      setWarehouse(String(o.branch_id));
      setHead({ order_date: String(o.order_date).slice(0, 10), expected_delivery: o.expected_delivery ? String(o.expected_delivery).slice(0, 10) : '', shipping_address: o.shipping_address || '', shipping_charge: o.shipping_charge || '', shipping_tax_rate: o.shipping_tax_rate || '', discount: o.discount || '', customer_po: o.customer_po || '', notes: o.notes || '', payment_terms_days: o.payment_terms_days ?? '', salesperson_id: o.salesperson_id ?? '' });
      setLines(o.items.map((i) => ({ key: newKey(), product_id: i.product_id, name: i.product, unit_name: i.unit_name, units: [{ unit_name: i.base_unit, factor: 1 }, { unit_name: i.unit_name, factor: i.unit_factor }], base_unit: i.base_unit, quantity: String(i.quantity), price: '', discount_pct: i.discount_pct ? String(i.discount_pct) : '', notes: i.notes || '' })));
      setLoaded(true);
    }).catch((e) => setLoadError(e.message));
  }, [id, editing]);

  // when a customer is chosen for a new order, take their terms, address and salesperson
  const chooseCustomer = useCallback(async (c) => {
    setCustomer(c);
    if (!c || editing) return;
    try {
      const full = await api(`/wholesale/customers/${c.customer_id}`);
      setHead((h) => ({ ...h, shipping_address: full.shipping_address || full.billing_address || full.address || '', payment_terms_days: full.payment_terms_days ?? '', salesperson_id: full.salesperson_id ?? '' }));
    } catch { /* the order can still be taken */ }
  }, [editing]);

  // opened from a customer's page: start with them chosen
  useEffect(() => {
    const pre = search.get('customer');
    if (editing || !pre) return;
    api(`/wholesale/customers/${pre}`).then((c) => chooseCustomer({ customer_id: c.customer_id, name: c.name, phone: c.phone, gstin: c.gstin, customer_type: c.customer_type })).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const body = useCallback((extra = {}) => ({
    customer_id: customer?.customer_id, branch_id: warehouse || undefined,
    lines: lines.map((l) => ({ product_id: l.product_id, unit_name: l.unit_name, quantity: Number(l.quantity) || 0, ...(l.price !== '' ? { price: Number(l.price) } : {}), ...(l.discount_pct !== '' ? { discount_pct: Number(l.discount_pct) } : {}), notes: l.notes || undefined })),
    order_date: head.order_date || undefined, expected_delivery: head.expected_delivery || undefined, shipping_address: head.shipping_address || null,
    shipping_charge: Number(head.shipping_charge) || 0, shipping_tax_rate: Number(head.shipping_tax_rate) || 0, discount: Number(head.discount) || 0,
    customer_po: head.customer_po || null, notes: head.notes || null, payment_terms_days: head.payment_terms_days === '' ? undefined : Number(head.payment_terms_days),
    salesperson_id: head.salesperson_id === '' ? null : Number(head.salesperson_id), ...extra
  }), [customer, warehouse, lines, head]);

  // price + totals + credit, from the server, whenever the order changes
  const sig = useDebounced(JSON.stringify(body()), 350);
  useEffect(() => {
    if (!customer || lines.length === 0 || lines.some((l) => !(Number(l.quantity) > 0)) || !loaded) { setPreview(null); setPreviewError(''); return undefined; }
    let live = true;
    api('/wholesale/orders/preview', { method: 'POST', body: { ...JSON.parse(sig), allow_below_moq: false } })
      .then((p) => { if (live) { setPreview(p); setPreviewError(''); } })
      .catch((e) => { if (live) { setPreview(null); setPreviewError(e.message); } });
    return () => { live = false; };
  }, [sig, customer, lines.length, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const addProduct = (p) => {
    const unit = p.matched_unit || p.sale_unit || p.unit;
    setLines((ls) => {
      const same = ls.findIndex((l) => l.product_id === p.product_id && l.unit_name === unit);
      if (same >= 0) return ls.map((l, i) => (i === same ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
      return [...ls, { key: newKey(), product_id: p.product_id, name: p.name, unit_name: unit, units: [{ unit_name: p.unit, factor: 1 }, ...(p.units || [])], base_unit: p.unit, quantity: String(Math.max(1, Number(p.moq) || 1)), price: '', discount_pct: '', notes: '' }];
    });
    setTimeout(() => document.getElementById(`qty-${p.product_id}`)?.focus(), 50);
  };
  const patch = (key, p) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const remove = (key) => setLines((ls) => ls.filter((l) => l.key !== key));
  const priced = (i) => preview?.lines?.[i];

  const save = async ({ submit = false, confirm = false, override } = {}) => {
    if (!customer) { setError('Choose a customer.'); return; }
    if (!lines.length) { setError('Add at least one product.'); return; }
    setBusy(true); setError('');
    try {
      const saved = editing
        ? await api(`/wholesale/orders/${id}`, { method: 'PUT', body: body() })
        : await api('/wholesale/orders', { method: 'POST', body: body({ submit: submit || confirm }) });
      let finalOrder = saved;
      if (confirm && ['DRAFT', 'PENDING'].includes(saved.status)) {
        try { finalOrder = await api(`/wholesale/orders/${saved.order_id}/confirm`, { method: 'POST', body: override ? { credit_override: true, reason: override } : {} }); }
        catch (e) {
          if (e.code === 'CREDIT_BLOCK') { setCreditStop({ reasons: e.data?.reasons || [e.message], orderId: saved.order_id }); toast.success(`Saved as ${saved.order_number}`); setBusy(false); return; }
          throw e;
        }
      } else if (submit && editing && saved.status === 'DRAFT') finalOrder = await api(`/wholesale/orders/${saved.order_id}/submit`, { method: 'POST' });
      toast.success(`${finalOrder.order_number} ${confirm ? 'confirmed' : submit ? 'submitted' : 'saved'}`);
      navigate(`/app/wholesale/orders/${finalOrder.order_id}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const overrideConfirm = async (reason) => {
    setBusy(true);
    try {
      const o = await api(`/wholesale/orders/${creditStop.orderId}/confirm`, { method: 'POST', body: { credit_override: true, reason } });
      toast.success(`${o.order_number} confirmed`); navigate(`/app/wholesale/orders/${o.order_id}`);
    } catch (e) { setError(e.message); setCreditStop(null); } finally { setBusy(false); }
  };

  if (loadError) return <div><PageHeader title="Edit order" /><Alert>{loadError}</Alert><Button to="/app/wholesale/orders" variant="secondary">Back to orders</Button></div>;
  if (!loaded) return <div className="space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;

  const credit = preview?.credit;
  const lockLines = editing && ['CONFIRMED', 'PARTIALLY_FULFILLED', 'PACKED'].includes(status);

  return (
    <div>
      <PageHeader title={editing ? 'Edit order' : 'New sales order'} lead={editing && lockLines ? 'Changing a confirmed order releases and re-reserves its stock.' : 'Add products, check the price and stock, then save or confirm.'} />
      <Alert>{error}</Alert>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Panel title="Customer">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2"><CustomerPicker value={customer} onChange={chooseCustomer} disabled={editing} onAdd={() => setAddingCustomer(true)} /></div>
              <WarehouseSelect value={warehouse} onChange={setWarehouse} label="Ship from" id="ord-wh" />
              <Field id="ord-date" label="Order date"><Input id="ord-date" type="date" value={head.order_date} onChange={(e) => setHead({ ...head, order_date: e.target.value })} /></Field>
              <Field id="ord-po" label="Customer PO number"><Input id="ord-po" value={head.customer_po} onChange={(e) => setHead({ ...head, customer_po: e.target.value })} maxLength={40} /></Field>
              <Field id="ord-exp" label="Expected delivery"><Input id="ord-exp" type="date" value={head.expected_delivery} onChange={(e) => setHead({ ...head, expected_delivery: e.target.value })} /></Field>
              <NumberField id="ord-terms" label="Payment terms" suffix="days" min={0} step={1} value={head.payment_terms_days} onChange={(v) => setHead({ ...head, payment_terms_days: v })} />
              <Field id="ord-sp" label="Salesperson"><Select id="ord-sp" value={head.salesperson_id} onChange={(e) => setHead({ ...head, salesperson_id: e.target.value })}><option value="">None</option>{people.map((p) => <option key={p.salesperson_id} value={p.salesperson_id}>{p.name}</option>)}</Select></Field>
              <div className="md:col-span-2"><Field id="ord-ship" label="Shipping address"><Textarea id="ord-ship" rows={2} value={head.shipping_address} onChange={(e) => setHead({ ...head, shipping_address: e.target.value })} maxLength={400} /></Field></div>
            </div>
          </Panel>

          <Panel title="Products" lead="Scan a barcode (a carton barcode picks the carton) or search by name">
            <ProductPicker onPick={addProduct} autoFocus={!editing} inputRef={priceRef} />
            {lines.length === 0 ? <p className="py-8 text-center text-small text-ink-400">No products yet.</p> : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-small">
                  <thead className="text-left text-caption font-semibold uppercase tracking-wide text-ink-500"><tr><th className="pb-2 pr-3">Product</th><th className="pb-2 pr-3">Unit</th><th className="pb-2 pr-3 text-right">Qty</th><th className="pb-2 pr-3 text-right">Price</th>{privileged && <th className="pb-2 pr-3 text-right">Disc %</th>}<th className="pb-2 pr-3 text-right">Amount</th><th className="pb-2"><span className="sr-only">Remove</span></th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {lines.map((l, i) => {
                      const p = priced(i);
                      return (
                        <tr key={l.key} className="align-top">
                          <td className="py-2 pr-3"><span className="block font-medium text-ink-900">{l.name}</span>
                            {p && <span className="block text-caption text-ink-500">{priceSourceText(p.price_source)}{p.available != null && <> · <span className={p.short > 0 ? 'font-medium text-warning' : ''}>{qty(p.available)} in stock{p.short > 0 ? `, ${qty(p.short)} short` : ''}</span></>}</span>}</td>
                          <td className="py-2 pr-3"><div className="w-28"><Select aria-label={`Unit for ${l.name}`} value={l.unit_name} onChange={(e) => patch(l.key, { unit_name: e.target.value })}>{l.units.map((u) => <option key={u.unit_name} value={u.unit_name}>{u.unit_name}{u.factor !== 1 ? ` (${u.factor} ${l.base_unit})` : ''}</option>)}</Select></div></td>
                          <td className="py-2 pr-3"><div className="ml-auto w-24"><Input id={`qty-${l.product_id}`} aria-label={`Quantity of ${l.name}`} type="number" inputMode="decimal" min="0" step="any" value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} className="text-right" /></div></td>
                          <td className="py-2 pr-3 text-right">{privileged
                            ? <div className="ml-auto w-28"><Input aria-label={`Price of ${l.name}`} type="number" inputMode="decimal" min="0" step="any" value={l.price} placeholder={p ? String(p.price) : ''} onChange={(e) => patch(l.key, { price: e.target.value })} className="text-right" /></div>
                            : <span className="tabular">{p ? money(p.price) : '—'}</span>}</td>
                          {privileged && <td className="py-2 pr-3"><div className="ml-auto w-20"><Input aria-label={`Discount on ${l.name}`} type="number" inputMode="decimal" min="0" max="100" step="any" value={l.discount_pct} onChange={(e) => patch(l.key, { discount_pct: e.target.value })} className="text-right" /></div></td>}
                          <td className="tabular py-2 pr-3 text-right font-medium">{p ? money(p.line_total) : '—'}</td>
                          <td className="py-2 text-right"><button type="button" onClick={() => remove(l.key)} aria-label={`Remove ${l.name}`} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><X className="h-4 w-4" /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {previewError && <p role="alert" className="mt-3 rounded-lg bg-danger/5 px-3 py-2 text-small text-danger">{previewError}</p>}
          </Panel>

          <Panel title="Charges and notes">
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField id="ord-ship-ch" label="Shipping charge" prefix="₹" value={head.shipping_charge} onChange={(v) => setHead({ ...head, shipping_charge: v })} />
              <NumberField id="ord-ship-tax" label="GST on shipping" suffix="%" value={head.shipping_tax_rate} onChange={(v) => setHead({ ...head, shipping_tax_rate: v })} />
              <NumberField id="ord-disc" label="Order discount" prefix="₹" hint="Taken off the total" value={head.discount} onChange={(v) => setHead({ ...head, discount: v })} />
              <div className="sm:col-span-3"><Field id="ord-notes" label="Notes"><Textarea id="ord-notes" rows={2} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} maxLength={1000} /></Field></div>
            </div>
          </Panel>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Panel title="Summary">
            {!preview ? <p className="text-small text-ink-500">{customer ? (lines.length ? 'Working out the total…' : 'Add products to see the total.') : 'Choose a customer to start.'}</p> : (
              <dl className="space-y-2 text-small">
                <div className="flex justify-between"><dt className="text-ink-500">Before GST</dt><dd className="tabular">{money(preview.subtotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">GST {preview.inter_state ? '(IGST)' : '(CGST + SGST)'}</dt><dd className="tabular">{money(preview.tax)}</dd></div>
                <div className="flex justify-between border-t border-line pt-2 text-body font-semibold"><dt>Order total</dt><dd className="tabular">{money(preview.total)}</dd></div>
              </dl>
            )}
            {preview?.lines.some((l) => l.short > 0) && <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-caption text-warning">Some lines are short of stock. They will be back-ordered and filled when goods arrive.</p>}
            {preview?.approval_needed && <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-caption text-warning">This order is over the approval limit. A sales manager has to confirm it.</p>}
          </Panel>
          {credit && (
            <Panel title="Customer credit">
              <dl className="space-y-1.5 text-small">
                <div className="flex justify-between"><dt className="text-ink-500">Limit</dt><dd className="tabular">{credit.limit ? money(credit.limit) : 'No limit'}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">Owes now</dt><dd className="tabular">{money(credit.outstanding)}</dd></div>
                {credit.available != null && <div className="flex justify-between"><dt className="text-ink-500">Available</dt><dd className={`tabular ${credit.available < 0 ? 'font-semibold text-danger' : ''}`}>{money(credit.available)}</dd></div>}
              </dl>
              {credit.reasons.length > 0 && <ul className="mt-3 space-y-1">{credit.reasons.map((r) => <li key={r} className={`flex gap-2 rounded-lg px-3 py-2 text-caption ${credit.level === 'BLOCK' ? 'bg-danger/5 text-danger' : 'bg-warning/10 text-warning'}`}><TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{r}</li>)}</ul>}
              {credit.level === 'BLOCK' && <p className="mt-2 text-caption text-ink-500">This order can be saved but not confirmed{can('sales_cancel') ? ' without a manager override.' : ' until payment arrives.'}</p>}
            </Panel>
          )}
          <div className="flex flex-col gap-2">
            {editing ? (
              <Button onClick={() => save({})} loading={busy}>Save changes</Button>
            ) : (
              <>
                <Button onClick={() => save({ confirm: true })} loading={busy} disabled={!preview || preview.approval_needed && !can('sales_cancel')}>Confirm order</Button>
                <Button variant="secondary" onClick={() => save({ submit: true })} loading={busy} disabled={!customer || !lines.length}>Submit for approval</Button>
                <Button variant="ghost" onClick={() => save({})} loading={busy} disabled={!customer || !lines.length}>Save as draft</Button>
              </>
            )}
            {editing && status === 'DRAFT' && <Button variant="secondary" onClick={() => save({ submit: true })} loading={busy}>Save and submit</Button>}
            <Button variant="ghost" onClick={() => navigate(editing ? `/app/wholesale/orders/${id}` : '/app/wholesale/orders')}>Cancel</Button>
          </div>
        </aside>
      </div>
      {creditStop && <CreditStop info={creditStop} canOverride={can('sales_cancel')} onClose={() => { setCreditStop(null); navigate(`/app/wholesale/orders/${creditStop.orderId}`); }} onOverride={overrideConfirm} />}
      {addingCustomer && <QuickCustomerModal onClose={() => setAddingCustomer(false)} onSaved={(c) => { setAddingCustomer(false); chooseCustomer({ customer_id: c.customer_id, name: c.name, phone: c.phone, gstin: c.gstin, customer_type: c.customer_type }); }} />}
    </div>
  );
};

export default OrderEditor;
