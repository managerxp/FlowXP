/*
 * The pharmacy product master: identity and GST, the pharmacy-specific behaviour (type, batch/expiry/serial
 * tracking, prescription requirement, warranty, schedule) and stock rules. One `products` row plus one
 * `pharmacy_item_details` row — see backend/src/controllers/pharmacyCatalog.controller.js.
 */
import { useMemo, useState } from 'react';
import { Pill as PillIcon, Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PRODUCT_TYPES, money, qs, qty, useDebounced, useLoad } from '../../lib/pharmacy.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Textarea, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Chips, NumberField, Pager, Segmented, Toggle, Toolbar } from './parts.jsx';

const blank = {
  name: '', sku: '', barcode: '', unit: 'pcs', category_id: '', description: '', hsn_sac: '', tax_rate: '12',
  purchase_price: '', selling_price: '', reorder_level: '', status: 'ACTIVE', track_inventory: true,
  product_type: 'MEDICINE', manufacturer: '', mrp: '', batch_tracking: true, expiry_tracking: true, serial_tracking: false,
  prescription_required: false, fefo_required: true, warranty_applicable: false, warranty_months: '', service_trackable: false,
  schedule_class: '', salt_composition: '', strength: '', dosage_form: ''
};

const fromProduct = (p) => ({ ...blank, ...Object.fromEntries(Object.keys(blank).map((k) => [k, p[k] ?? blank[k]])),
  tax_rate: String(p.tax_rate ?? ''), category_id: p.category_id ?? '', warranty_months: p.warranty_months ?? '' });

const ProductForm = ({ product, onClose, onSaved }) => {
  const toast = useToast();
  const dialog = useDialog();
  const editing = Boolean(product?.product_id);
  const [f, setF] = useState(() => (product ? fromProduct(product) : blank));
  const [tab, setTab] = useState('basics');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cats = useLoad('/pharmacy/categories');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const addCategory = async () => {
    const name = await dialog.prompt({ title: 'New category', label: 'Category name', confirmLabel: 'Add category' });
    if (!name?.trim()) return;
    try { const c = await api('/pharmacy/categories', { method: 'POST', body: { name: name.trim() } }); cats.reload(); setF((x) => ({ ...x, category_id: c.category_id })); }
    catch (e) { toast.error(e.message); }
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    const n = (v) => (v === '' || v == null ? null : Number(v));
    const body = {
      name: f.name, sku: f.sku || null, barcode: f.barcode || null, unit: f.unit, category_id: n(f.category_id), description: f.description || null,
      hsn_sac: f.hsn_sac || null, tax_rate: Number(f.tax_rate) || 0, purchase_price: n(f.purchase_price) ?? 0, selling_price: n(f.selling_price) ?? 0,
      reorder_level: n(f.reorder_level) ?? 0, status: f.status, track_inventory: f.track_inventory,
      product_type: f.product_type, manufacturer: f.manufacturer || null, mrp: n(f.mrp),
      batch_tracking: f.batch_tracking, expiry_tracking: f.expiry_tracking, serial_tracking: f.serial_tracking,
      prescription_required: f.prescription_required, fefo_required: f.fefo_required, warranty_applicable: f.warranty_applicable,
      warranty_months: f.warranty_applicable ? n(f.warranty_months) : null, service_trackable: f.service_trackable,
      schedule_class: f.schedule_class || null, salt_composition: f.salt_composition || null, strength: f.strength || null, dosage_form: f.dosage_form || null
    };
    try {
      const saved = await api(editing ? `/pharmacy/products/${product.product_id}` : '/pharmacy/products', { method: editing ? 'PUT' : 'POST', body });
      toast.success(editing ? 'Product updated' : `${saved.name} added`); onSaved(saved);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={editing ? 'Edit product' : 'Add a product'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <Alert>{error}</Alert>
        <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: 'basics', label: 'Basics' }, { value: 'pharmacy', label: 'Pharmacy details' }, { value: 'stock', label: 'Pricing & stock' }]} />
        {tab === 'basics' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field id="pf-name" label="Product name"><Input id="pf-name" value={f.name} onChange={set('name')} required autoFocus maxLength={160} /></Field></div>
            <Field id="pf-sku" label="SKU"><Input id="pf-sku" value={f.sku} onChange={set('sku')} maxLength={64} /></Field>
            <Field id="pf-barcode" label="Barcode"><Input id="pf-barcode" value={f.barcode} onChange={set('barcode')} maxLength={64} /></Field>
            <Field id="pf-cat" label="Category"><div className="flex gap-2"><Select id="pf-cat" value={f.category_id} onChange={set('category_id')}><option value="">None</option>{(cats.data || []).map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</Select><Button type="button" variant="secondary" onClick={addCategory} aria-label="Add a category"><Plus className="h-4 w-4" /></Button></div></Field>
            <Field id="pf-unit" label="Unit"><Input id="pf-unit" value={f.unit} onChange={set('unit')} required maxLength={24} /></Field>
            <Field id="pf-hsn" label="HSN/SAC code"><Input id="pf-hsn" value={f.hsn_sac} onChange={set('hsn_sac')} maxLength={16} /></Field>
            <NumberField id="pf-tax" label="GST rate" suffix="%" value={f.tax_rate} onChange={set('tax_rate')} />
            <div className="sm:col-span-2"><Field id="pf-desc" label="Description"><Textarea id="pf-desc" rows={2} value={f.description} onChange={set('description')} maxLength={1000} /></Field></div>
          </div>
        )}
        {tab === 'pharmacy' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pf-type" label="Product type"><Select id="pf-type" value={f.product_type} onChange={set('product_type')}>{Object.entries(PRODUCT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field id="pf-mfr" label="Manufacturer"><Input id="pf-mfr" value={f.manufacturer} onChange={set('manufacturer')} maxLength={120} /></Field>
            <Field id="pf-strength" label="Strength" hint="500mg, 10ml..."><Input id="pf-strength" value={f.strength} onChange={set('strength')} maxLength={40} /></Field>
            <Field id="pf-dosage" label="Dosage form" hint="Tablet, syrup, injection..."><Input id="pf-dosage" value={f.dosage_form} onChange={set('dosage_form')} maxLength={40} /></Field>
            <Field id="pf-schedule" label="Schedule" hint="H, H1, X..."><Input id="pf-schedule" value={f.schedule_class} onChange={set('schedule_class')} maxLength={8} /></Field>
            <div className="sm:col-span-2"><Field id="pf-salt" label="Salt composition"><Input id="pf-salt" value={f.salt_composition} onChange={set('salt_composition')} maxLength={300} /></Field></div>
            <div className="sm:col-span-2 space-y-3 border-t border-line pt-4">
              <Toggle id="pf-batch" checked={f.batch_tracking} onChange={(v) => setF((x) => ({ ...x, batch_tracking: v }))} label="Batch tracked" hint="Stock is received and sold against batch numbers" />
              <Toggle id="pf-expiry" checked={f.expiry_tracking} onChange={(v) => setF((x) => ({ ...x, expiry_tracking: v, batch_tracking: v || x.batch_tracking }))} label="Expiry tracked" hint="Every batch needs an expiry date" />
              <Toggle id="pf-fefo" checked={f.fefo_required} onChange={(v) => setF((x) => ({ ...x, fefo_required: v }))} label="First-expiry-first-out" hint="Selling picks the soonest-expiring batch automatically" />
              <Toggle id="pf-serial" checked={f.serial_tracking} onChange={(v) => setF((x) => ({ ...x, serial_tracking: v }))} label="Serial tracked" hint="One serial number per unit (devices, equipment)" />
              <Toggle id="pf-rx" checked={f.prescription_required} onChange={(v) => setF((x) => ({ ...x, prescription_required: v }))} label="Prescription required" />
              <Toggle id="pf-warranty" checked={f.warranty_applicable} onChange={(v) => setF((x) => ({ ...x, warranty_applicable: v }))} label="Carries a warranty" />
              {f.warranty_applicable && <NumberField id="pf-warranty-m" label="Warranty length" suffix="months" min={1} step={1} value={f.warranty_months} onChange={set('warranty_months')} />}
              <Toggle id="pf-service" checked={f.service_trackable} onChange={(v) => setF((x) => ({ ...x, service_trackable: v }))} label="Service history tracked" />
            </div>
          </div>
        )}
        {tab === 'stock' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField id="pf-mrp" label="MRP" prefix="₹" value={f.mrp} onChange={set('mrp')} />
            <NumberField id="pf-sell" label="Selling price" prefix="₹" required value={f.selling_price} onChange={set('selling_price')} />
            <NumberField id="pf-cost" label="Purchase price" prefix="₹" value={f.purchase_price} onChange={set('purchase_price')} />
            <NumberField id="pf-reorder" label="Reorder level" value={f.reorder_level} onChange={set('reorder_level')} />
            <Field id="pf-status" label="Status"><Select id="pf-status" value={f.status} onChange={set('status')}><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></Select></Field>
            <Toggle id="pf-track" checked={f.track_inventory} onChange={(v) => setF((x) => ({ ...x, track_inventory: v }))} label="Track stock for this product" />
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{editing ? 'Save changes' : 'Add product'}</Button></div>
      </form>
    </Modal>
  );
};

const PharmacyProducts = () => {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const term = useDebounced(q.trim(), 250);
  const query = useMemo(() => qs({ q: term, type: type || undefined, limit: 50, offset }), [term, type, offset]);
  const { data, meta, loading, error, reload } = useLoad(`/pharmacy/products${query}`, { paged: true });
  const canEdit = can('products');

  return (
    <div>
      <PageHeader title="Products" lead="Medicines, devices and everything else on your shelf."
                  action={canEdit && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />Add product</Button>} />
      <Toolbar>
        <div className="w-full sm:w-72"><Input type="search" placeholder="Name, SKU, barcode, manufacturer or salt" aria-label="Search products" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div>
        <Chips label="Type" value={type} onChange={(v) => { setType(v); setOffset(0); }} options={[{ value: '', label: 'All types' }, ...Object.entries(PRODUCT_TYPES).map(([k, v]) => ({ value: k, label: v }))]} />
      </Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={PillIcon} emptyLabel="No products yet"
                 emptyBody={term ? 'Nothing matches that search.' : 'Add what you stock and sell.'}
                 emptyAction={canEdit && !term ? <Button onClick={() => setAdding(true)}>Add product</Button> : undefined} />
      {data?.length > 0 && (
        <>
          <Table><Thead><Th>Product</Th><Th>Type</Th><Th className="text-right">Price</Th><Th className="text-right">Stock</Th><Th>Tracking</Th></Thead>
            <tbody>{data.map((p) => (
              <Tr key={p.product_id} onClick={() => setEditing(p)}>
                <Td><span className="font-medium">{p.name}</span><span className="block text-caption text-ink-500">{[p.sku, p.manufacturer, p.strength].filter(Boolean).join(' · ')}</span></Td>
                <Td className="text-ink-500">{PRODUCT_TYPES[p.product_type] || p.product_type}</Td>
                <Td className="text-right tabular">{money(p.selling_price)}</Td>
                <Td className={`text-right tabular ${p.low ? 'font-semibold text-warning' : ''}`}>{p.track_inventory ? `${qty(p.available)} ${p.unit}` : '—'}</Td>
                <Td><div className="flex flex-wrap gap-1">{p.batch_tracking && <Badge tone="brand">Batch</Badge>}{p.expiry_tracking && <Badge tone="brand">Expiry</Badge>}{p.prescription_required && <Badge tone="warning">Rx</Badge>}{p.status === 'ARCHIVED' && <Badge>Archived</Badge>}</div></Td>
              </Tr>
            ))}</tbody>
          </Table>
          <Pager meta={meta} onPage={setOffset} />
        </>
      )}
      {adding && <ProductForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      {editing && <ProductForm product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
};

export default PharmacyProducts;
