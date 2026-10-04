/*
 * Receive goods from a supplier — direct only, no purchase order anywhere in this flow (see
 * backend/src/controllers/pharmacyGrn.controller.js's header note). What arrives is split into accepted and
 * damaged, batch/expiry/serials captured where the product needs them, and posted straight to the shelf.
 */
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PAYMENT_METHODS, qty, todayIn } from '../../lib/pharmacy.js';
import { Alert, Button, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui.jsx';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { NumberField, ProductPicker, SupplierPicker } from './parts.jsx';

let seq = 0;

const PharmacyGrnModal = ({ onClose, onDone }) => {
  const toast = useToast();
  const key = useIdempotencyKey();
  const [supplier, setSupplier] = useState(null);
  const [lines, setLines] = useState([]);
  const [f, setF] = useState({ supplier_invoice_no: '', supplier_invoice_date: '', grn_date: todayIn(), notes: '', pay: '', method: 'CASH', reference: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const addProduct = (p) => {
    setLines((ls) => [...ls, {
      key: `l${++seq}`, product_id: p.product_id, name: p.name, unit: p.unit, received: '1', damaged: '',
      unit_cost: String(p.purchase_price || 0), batch_no: '', mfg_date: '', expiry_date: '', serials: '',
      batch_tracking: p.batch_tracking, expiry_tracking: p.expiry_tracking, serial_tracking: p.serial_tracking
    }]);
  };
  const patch = (key, p) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const accepted = (l) => Math.max(0, Math.round(((Number(l.received) || 0) - (Number(l.damaged) || 0)) * 1000) / 1000);
  const total = useMemo(() => lines.reduce((s, l) => s + accepted(l) * (Number(l.unit_cost) || 0), 0), [lines]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const body = {
        supplier_id: supplier?.supplier_id,
        grn_date: f.grn_date || undefined, supplier_invoice_no: f.supplier_invoice_no || undefined, supplier_invoice_date: f.supplier_invoice_date || undefined, notes: f.notes || undefined,
        ...(Number(f.pay) > 0 ? { payment: { amount: Number(f.pay), method: f.method, reference_number: f.reference || undefined } } : {}),
        items: lines.filter((l) => Number(l.received) > 0).map((l) => ({
          product_id: l.product_id, received: Number(l.received), damaged: Number(l.damaged) || 0, unit_cost: l.unit_cost === '' ? undefined : Number(l.unit_cost),
          batch_no: l.batch_no || undefined, mfg_date: l.mfg_date || undefined, expiry_date: l.expiry_date || undefined,
          serials: l.serials ? l.serials.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : undefined
        }))
      };
      const r = await api('/pharmacy/grn', { method: 'POST', body, idempotencyKey: key.get() });
      key.settle(null);
      toast.success(`${r.grn_number} posted`);
      onDone(r);
    } catch (e) { key.settle(e); setError(e.message); } finally { setBusy(false); }
  };

  const ready = supplier && lines.some((l) => Number(l.received) > 0);

  return (
    <Modal title="Receive goods" onClose={onClose} wide>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="g-sup" label="Supplier"><SupplierPicker value={supplier} onChange={setSupplier} id="g-sup" /></Field>
          <Field id="g-date" label="Received on"><Input id="g-date" type="date" value={f.grn_date} max={todayIn()} onChange={set('grn_date')} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="g-inv" label="Supplier invoice number"><Input id="g-inv" value={f.supplier_invoice_no} onChange={set('supplier_invoice_no')} maxLength={40} /></Field>
          <Field id="g-invd" label="Supplier invoice date"><Input id="g-invd" type="date" value={f.supplier_invoice_date} max={todayIn()} onChange={set('supplier_invoice_date')} /></Field>
        </div>
        <ProductPicker onPick={addProduct} placeholder="Scan or search a product to add" />
        {lines.length === 0 ? <p className="py-6 text-center text-small text-ink-400">Add the products that arrived.</p> : (
          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.key} className="rounded-(--radius-card) border border-line p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <p className="font-medium text-ink-900">{l.name}</p>
                  <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><X className="h-4 w-4" /></button>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <NumberField id={`r-${l.key}`} label="Received" suffix={l.unit} min={0} value={l.received} onChange={(v) => patch(l.key, { received: v })} />
                  <NumberField id={`d-${l.key}`} label="Damaged" suffix={l.unit} min={0} value={l.damaged} onChange={(v) => patch(l.key, { damaged: v })} />
                  <div className="self-end pb-2.5 text-small"><span className="text-caption text-ink-500">Accepted</span><br /><strong className="tabular">{qty(accepted(l))} {l.unit}</strong></div>
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
        <Field id="g-notes" label="Notes"><Input id="g-notes" value={f.notes} onChange={set('notes')} maxLength={300} /></Field>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-small text-ink-500">Accepted value before GST: <strong className="tabular text-ink-900">{Math.round(total * 100) / 100}</strong></p>
          <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!ready}>Post goods receipt</Button></div>
        </div>
      </div>
    </Modal>
  );
};

export default PharmacyGrnModal;
