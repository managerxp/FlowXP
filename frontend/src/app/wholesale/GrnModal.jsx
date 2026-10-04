/*
 * Goods receipt (GRN): what arrived against a purchase order — or without one (a direct purchase) — what was damaged,
 * what is accepted into stock, at what cost, with batch, expiry and serial numbers where the product needs them.
 * Accepted goods go on the shelf now; damaged goods are held aside; customers waiting on a back-order are given
 * the new stock straight away. Payable is for what was accepted.
 */
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PAYMENT_METHODS, money, qty, todayIn, useLoad } from '../../lib/wholesale.js';
import { Alert, Button, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui.jsx';
import { NumberField, ProductPicker, SupplierPicker, Toggle, WarehouseSelect } from './parts.jsx';
import { useIdempotencyKey } from '../../lib/idempotency.js';

let seq = 0;

const GrnModal = ({ poId = null, onClose, onDone }) => {
  const toast = useToast();
  const key = useIdempotencyKey();
  const po = useLoad(poId ? `/wholesale/purchase-orders/${poId}` : null);
  const [supplier, setSupplier] = useState(null);
  const [warehouse, setWarehouse] = useState('');
  const [lines, setLines] = useState([]);
  const [f, setF] = useState({ supplier_invoice_no: '', supplier_invoice_date: '', grn_date: todayIn(), notes: '', allow_excess: false, close_po: false, pay: '', method: 'BANK_TRANSFER', reference: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  // lines from the order: everything still outstanding, to be edited down
  useEffect(() => {
    if (!po.data) return;
    setLines(po.data.items.filter((i) => i.outstanding > 0).map((i) => ({ key: `l${++seq}`, po_item_id: i.item_id, product_id: i.product_id, name: i.description, unit_name: i.unit_name, factor: i.unit_factor, base_unit: i.base_unit, outstanding: i.outstanding,
      received: String(i.outstanding), damaged: '', unit_cost: String(i.unit_cost), batch_no: '', mfg_date: '', expiry_date: '', serials: '', batch_tracking: i.batch_tracking, expiry_tracking: i.expiry_tracking, serial_tracking: i.serial_tracking })));
  }, [po.data]);

  const addProduct = (p) => {
    const unit = p.purchase_unit || p.unit;
    const u = unit === p.unit ? { factor: 1 } : (p.units || []).find((x) => x.unit_name === unit) || { factor: 1 };
    setLines((ls) => [...ls, { key: `l${++seq}`, product_id: p.product_id, name: p.name, unit_name: unit, factor: u.factor, base_unit: p.unit, units: [{ unit_name: p.unit, factor: 1 }, ...(p.units || [])], received: '1', damaged: '', unit_cost: String(Math.round((p.purchase_price || 0) * u.factor * 100) / 100), batch_no: '', mfg_date: '', expiry_date: '', serials: '', batch_tracking: p.batch_tracking, expiry_tracking: p.expiry_tracking, serial_tracking: p.serial_tracking }]);
  };
  const patch = (key, p) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const accepted = (l) => Math.max(0, Math.round(((Number(l.received) || 0) - (Number(l.damaged) || 0)) * 1000) / 1000);
  const total = useMemo(() => lines.reduce((s, l) => s + accepted(l) * (Number(l.unit_cost) || 0), 0), [lines]);
  const direct = !poId;

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const body = {
        ...(poId ? { po_id: poId } : { supplier_id: supplier?.supplier_id, branch_id: warehouse ? Number(warehouse) : undefined }),
        grn_date: f.grn_date || undefined, supplier_invoice_no: f.supplier_invoice_no || undefined, supplier_invoice_date: f.supplier_invoice_date || undefined, notes: f.notes || undefined, allow_excess: f.allow_excess, close_po: f.close_po,
        ...(Number(f.pay) > 0 ? { payment: { amount: Number(f.pay), method: f.method, reference_number: f.reference || undefined } } : {}),
        items: lines.filter((l) => Number(l.received) > 0).map((l) => ({
          po_item_id: l.po_item_id, product_id: l.product_id, unit_name: l.po_item_id ? undefined : l.unit_name, received: Number(l.received), damaged: Number(l.damaged) || 0, unit_cost: l.unit_cost === '' ? undefined : Number(l.unit_cost),
          batch_no: l.batch_no || undefined, mfg_date: l.mfg_date || undefined, expiry_date: l.expiry_date || undefined, serials: l.serials ? l.serials.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : undefined
        }))
      };
      const r = await api('/wholesale/grns', { method: 'POST', body, idempotencyKey: key.get() });
      key.settle(null);
      toast.success(`${r.grn_number} posted${r.back_orders_filled?.length ? ` · ${r.back_orders_filled.length} waiting order${r.back_orders_filled.length === 1 ? '' : 's'} filled` : ''}`);
      onDone(r);
    } catch (e) { key.settle(e); setError(e.message); } finally { setBusy(false); }
  };

  const ready = lines.some((l) => Number(l.received) > 0) && (poId || supplier);

  return (
    <Modal title={poId ? `Receive goods · ${po.data?.po_number || ''}` : 'Receive goods without an order'} onClose={onClose} wide>
      <div className="space-y-4">
        <Alert>{error || po.error}</Alert>
        {direct && <div className="grid gap-4 sm:grid-cols-2"><Field id="g-sup" label="Supplier"><SupplierPicker value={supplier} onChange={setSupplier} id="g-sup" /></Field><WarehouseSelect value={warehouse} onChange={setWarehouse} label="Receive into" id="g-wh" /></div>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="g-inv" label="Supplier invoice number"><Input id="g-inv" value={f.supplier_invoice_no} onChange={set('supplier_invoice_no')} maxLength={40} /></Field>
          <Field id="g-invd" label="Supplier invoice date"><Input id="g-invd" type="date" value={f.supplier_invoice_date} max={todayIn()} onChange={set('supplier_invoice_date')} /></Field>
          <Field id="g-date" label="Received on"><Input id="g-date" type="date" value={f.grn_date} max={todayIn()} onChange={set('grn_date')} /></Field>
        </div>
        {direct && <ProductPicker onPick={addProduct} placeholder="Scan or search a product to add" />}
        {lines.length === 0 ? <p className="py-6 text-center text-small text-ink-400">{po.loading ? 'Loading…' : poId ? 'Everything on this order has already been received.' : 'Add the products that arrived.'}</p> : (
          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.key} className="rounded-(--radius-card) border border-line p-4">
                <div className="mb-3 flex items-start justify-between gap-3"><div><p className="font-medium text-ink-900">{l.name}</p><p className="text-caption text-ink-500">{l.unit_name}{l.factor !== 1 ? ` = ${l.factor} ${l.base_unit}` : ''}{l.outstanding != null ? ` · ${qty(l.outstanding)} still due` : ''}</p></div>
                  {direct && <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><X className="h-4 w-4" /></button>}</div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <NumberField id={`r-${l.key}`} label="Received" suffix={l.unit_name} min={0} value={l.received} onChange={(v) => patch(l.key, { received: v })} />
                  <NumberField id={`d-${l.key}`} label="Damaged" suffix={l.unit_name} min={0} value={l.damaged} onChange={(v) => patch(l.key, { damaged: v })} />
                  <div className="self-end pb-2.5 text-small"><span className="text-caption text-ink-500">Accepted</span><br /><strong className="tabular">{qty(accepted(l))} {l.unit_name}</strong>{l.factor !== 1 && <span className="text-caption text-ink-500"> = {qty(accepted(l) * l.factor)} {l.base_unit}</span>}</div>
                  <NumberField id={`c-${l.key}`} label="Cost per unit" prefix="₹" value={l.unit_cost} onChange={(v) => patch(l.key, { unit_cost: v })} />
                </div>
                {(l.batch_tracking || l.expiry_tracking) && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Field id={`b-${l.key}`} label="Batch number"><Input id={`b-${l.key}`} value={l.batch_no} onChange={(e) => patch(l.key, { batch_no: e.target.value })} maxLength={40} /></Field>
                    <Field id={`m-${l.key}`} label="Manufactured"><Input id={`m-${l.key}`} type="date" value={l.mfg_date} onChange={(e) => patch(l.key, { mfg_date: e.target.value })} /></Field>
                    {l.expiry_tracking && <Field id={`e-${l.key}`} label="Expiry date"><Input id={`e-${l.key}`} type="date" min={todayIn()} value={l.expiry_date} onChange={(e) => patch(l.key, { expiry_date: e.target.value })} /></Field>}
                  </div>
                )}
                {l.serial_tracking && <div className="mt-3"><Field id={`s-${l.key}`} label="Serial numbers" hint="One per line, one for each unit accepted"><Textarea id={`s-${l.key}`} rows={2} value={l.serials} onChange={(e) => patch(l.key, { serials: e.target.value })} /></Field></div>}
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField id="g-pay" label="Pay the supplier now" prefix="₹" hint="Optional" value={f.pay} onChange={set('pay')} />
          {Number(f.pay) > 0 && <><Field id="g-method" label="Method"><Select id="g-method" value={f.method} onChange={set('method')}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field id="g-ref" label="Reference"><Input id="g-ref" value={f.reference} onChange={set('reference')} /></Field></>}
        </div>
        {poId && <div className="space-y-2"><Toggle id="g-excess" checked={f.allow_excess} onChange={(v) => setF((x) => ({ ...x, allow_excess: v }))} label="Accept more than ordered" hint="Otherwise a line cannot go above what is still due" /><Toggle id="g-close" checked={f.close_po} onChange={(v) => setF((x) => ({ ...x, close_po: v }))} label="This is the last delivery" hint="Close the order even if some lines are short" /></div>}
        <Field id="g-notes" label="Notes"><Input id="g-notes" value={f.notes} onChange={set('notes')} maxLength={300} /></Field>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><p className="text-small text-ink-500">Accepted value before GST: <strong className="tabular text-ink-900">{money(Math.round(total * 100) / 100)}</strong></p>
          <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!ready}>Post goods receipt</Button></div></div>
      </div>
    </Modal>
  );
};

export default GrnModal;
