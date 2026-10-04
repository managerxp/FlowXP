/*
 * A product that is not in the system yet, made from the till in a few seconds: name, category, price, MRP and GST.
 * The scanned barcode attaches itself and FlowXP makes the SKU. On save the product goes straight onto the bill.
 *
 * This is the same product service as the catalogue form (POST /api/products/quick), so the rules are the same: the
 * selling price may not exceed the MRP, and a barcode already on another product is refused with that product's name.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { Alert, Button, Field, Input, Modal, Select } from './ui.jsx';

const UNITS = ['pc', 'kg', 'g', 'litre', 'ml', 'pack', 'box', 'dozen'];

const QuickProductModal = ({ barcode, categories, onCreated, onCancel, onUseExisting }) => {
  const idem = useIdempotencyKey();
  const [form, setForm] = useState({ name: '', category_id: '', selling_price: '', mrp: '', tax_rate: '5', unit: 'pc', opening_stock: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clash, setClash] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setClash(null);
    try {
      const product = await api('/products/quick', {
        method: 'POST', idempotencyKey: idem.get(),
        body: { ...form, category_id: form.category_id || undefined, mrp: form.mrp || undefined, opening_stock: form.opening_stock === '' ? undefined : form.opening_stock, barcode: barcode || undefined }
      });
      idem.settle();
      onCreated(product);
    } catch (caught) {
      idem.settle(caught);
      if (caught.code === 'BARCODE_IN_USE') setClash(caught.data); else setError(caught.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Add a product" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        {clash && (
          <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-small">
            <p>This barcode is already assigned to <strong className="font-semibold">{clash.name}</strong>.</p>
            <Button type="button" size="sm" className="mt-2" onClick={() => onUseExisting(clash)}>Use {clash.name}</Button>
          </div>
        )}
        {barcode && <p className="tabular rounded-lg bg-surface-2 px-3 py-2 text-small text-ink-700">Barcode <span className="font-semibold text-ink-900">{barcode}</span> will be attached. FlowXP makes the SKU.</p>}
        <Field id="qp-name" label="Name"><Input id="qp-name" value={form.name} onChange={set('name')} required autoFocus maxLength={160} /></Field>
        <Field id="qp-cat" label="Category">
          <Select id="qp-cat" value={form.category_id} onChange={set('category_id')}>
            <option value="">No category</option>
            {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="qp-price" label="Selling price (₹)" hint="Before GST"><Input id="qp-price" type="number" inputMode="decimal" min="0" step="0.01" value={form.selling_price} onChange={set('selling_price')} required /></Field>
          <Field id="qp-mrp" label="MRP (₹)" hint="Printed price, optional"><Input id="qp-mrp" type="number" inputMode="decimal" min="0" step="0.01" value={form.mrp} onChange={set('mrp')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="qp-gst" label="GST"><Select id="qp-gst" value={form.tax_rate} onChange={set('tax_rate')}>{[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</Select></Field>
          <Field id="qp-unit" label="Sold in"><Select id="qp-unit" value={form.unit} onChange={set('unit')}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
        </div>
        <Field id="qp-stock" label="On the shelf now (optional)" hint="Leave blank to start counting stock later. It can be sold either way."><Input id="qp-stock" type="number" inputMode="decimal" min="0" step="0.001" value={form.opening_stock} onChange={set('opening_stock')} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create and add to bill'}</Button>
        </div>
      </form>
    </Modal>
  );
};

export default QuickProductModal;
