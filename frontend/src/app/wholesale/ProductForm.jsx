/*
 * The wholesale product master: identity and tax, units of measure (base unit plus box / carton, with conversion and
 * barcodes), the price tiers (MRP, distributor, wholesale, retailer), minimum order quantity, reorder and maximum stock,
 * and whether batch, expiry or serial numbers are tracked. Stock is always kept in the base unit.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, qty, useLoad } from '../../lib/wholesale.js';
import { Alert, Button, Field, Input, Modal, Select, Textarea, useDialog, useToast } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { NumberField, Segmented, Toggle } from './parts.jsx';

const blank = { name: '', sku: '', barcode: '', unit: 'pcs', category_id: '', subcategory_id: '', manufacturer: '', hsn_sac: '', tax_rate: '18', description: '', purchase_price: '', mrp: '', distributor_price: '', wholesale_price: '', retailer_price: '',
  moq: '1', reorder_level: '', max_stock: '', principal_id: '', brand_id: '', pack_size: '', principal_price: '', batch_tracking: false, expiry_tracking: false, serial_tracking: false, sale_unit: '', purchase_unit: '', units: [] };

const fromProduct = (p) => ({ ...blank, ...Object.fromEntries(Object.keys(blank).map((k) => [k, p[k] ?? blank[k]])), tax_rate: String(p.tax_rate ?? ''), purchase_price: p.purchase_price ?? '', mrp: p.mrp ?? '', distributor_price: p.distributor_price ?? '', wholesale_price: p.wholesale_price ?? '', retailer_price: p.retailer_price ?? '',
  moq: String(p.moq ?? 1), reorder_level: p.reorder_level || '', max_stock: p.max_stock ?? '', category_id: p.category_id ?? '', subcategory_id: p.subcategory_id ?? '', units: (p.units || []).map((u) => ({ unit_name: u.unit_name, factor: String(u.factor), barcode: u.barcode || '' })) });

const ProductForm = ({ product, onClose, onSaved }) => {
  const toast = useToast();
  const dialog = useDialog();
  const { business } = useAuth();
  const dist = Boolean(business?.distributor_enabled);
  const principals = useLoad(dist ? '/distributor/principals?status=ALL&limit=200' : null, { paged: true }).data || [];
  const brandsAll = useLoad(dist ? '/distributor/brands' : null).data || [];
  const editing = Boolean(product?.product_id);
  const [f, setF] = useState(() => (product ? fromProduct(product) : blank));
  const [tab, setTab] = useState('basics');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cats = useLoad('/wholesale/categories');
  const stock = useLoad(editing ? `/wholesale/inventory/product/${product.product_id}` : null);
  const brands = brandsAll.filter((b) => !f.principal_id || !b.principal_id || String(b.principal_id) === String(f.principal_id));
  const top = useMemo(() => (cats.data || []).filter((c) => !c.parent_id), [cats.data]);
  const subs = useMemo(() => (cats.data || []).filter((c) => c.parent_id && String(c.parent_id) === String(f.category_id)), [cats.data, f.category_id]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  useEffect(() => { if (f.expiry_tracking && !f.batch_tracking) setF((x) => ({ ...x, batch_tracking: true })); }, [f.expiry_tracking, f.batch_tracking]);

  const addUnit = () => setF((x) => ({ ...x, units: [...x.units, { unit_name: '', factor: '', barcode: '' }] }));
  const setUnit = (i, k, v) => setF((x) => ({ ...x, units: x.units.map((u, j) => (j === i ? { ...u, [k]: v } : u)) }));
  const addCategory = async () => {
    const name = await dialog.prompt({ title: 'New category', label: 'Category name', confirmLabel: 'Add category' });
    if (!name?.trim()) return;
    try { const c = await api('/wholesale/categories', { method: 'POST', body: { name: name.trim() } }); cats.reload(); setF((x) => ({ ...x, category_id: c.category_id, subcategory_id: '' })); } catch (e) { toast.error(e.message); }
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    const n = (v) => (v === '' || v == null ? null : Number(v));
    const body = {
      name: f.name, sku: f.sku || null, barcode: f.barcode || null, unit: f.unit, category_id: n(f.category_id), subcategory_id: n(f.subcategory_id), manufacturer: f.manufacturer || null, hsn_sac: f.hsn_sac || null, tax_rate: Number(f.tax_rate) || 0, description: f.description || null,
      purchase_price: n(f.purchase_price) ?? 0, mrp: n(f.mrp), distributor_price: n(f.distributor_price), wholesale_price: n(f.wholesale_price), retailer_price: n(f.retailer_price),
      moq: Number(f.moq) || 1, reorder_level: n(f.reorder_level) ?? 0, max_stock: n(f.max_stock), batch_tracking: f.batch_tracking, expiry_tracking: f.expiry_tracking, serial_tracking: f.serial_tracking,
      ...(dist ? { principal_id: n(f.principal_id), brand_id: n(f.brand_id), pack_size: f.pack_size || null, principal_price: n(f.principal_price) } : {}), sale_unit: f.sale_unit || null, purchase_unit: f.purchase_unit || null, units: f.units.filter((u) => u.unit_name.trim()).map((u) => ({ unit_name: u.unit_name.trim(), factor: Number(u.factor), barcode: u.barcode || null }))
    };
    try {
      const saved = await api(editing ? `/wholesale/products/${product.product_id}` : '/wholesale/products', { method: editing ? 'PUT' : 'POST', body });
      toast.success(editing ? 'Product updated' : `${saved.name} added`); onSaved(saved);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const unitOptions = [f.unit, ...f.units.map((u) => u.unit_name).filter(Boolean)];
  const margin = Number(f.wholesale_price) > 0 && Number(f.purchase_price) > 0 ? Math.round(((Number(f.wholesale_price) - Number(f.purchase_price)) / Number(f.wholesale_price)) * 1000) / 10 : null;

  return (
    <Modal title={editing ? 'Edit product' : 'Add a product'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <Alert>{error}</Alert>
        <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: 'basics', label: 'Basics' }, { value: 'units', label: 'Units' }, { value: 'prices', label: 'Prices' }, { value: 'stock', label: 'Stock rules' }]} />
        {tab === 'basics' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field id="pf-name" label="Product name"><Input id="pf-name" value={f.name} onChange={set('name')} required autoFocus maxLength={160} /></Field></div>
            <Field id="pf-sku" label="SKU"><Input id="pf-sku" value={f.sku} onChange={set('sku')} maxLength={64} /></Field>
            <Field id="pf-barcode" label="Barcode" hint="Of the base unit (a piece)"><Input id="pf-barcode" value={f.barcode} onChange={set('barcode')} maxLength={64} /></Field>
            <Field id="pf-cat" label="Category"><div className="flex gap-2"><Select id="pf-cat" value={f.category_id} onChange={(e) => setF((x) => ({ ...x, category_id: e.target.value, subcategory_id: '' }))}><option value="">None</option>{top.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</Select><Button type="button" variant="secondary" onClick={addCategory} aria-label="Add a category"><Plus className="h-4 w-4" /></Button></div></Field>
            <Field id="pf-sub" label="Subcategory"><Select id="pf-sub" value={f.subcategory_id} onChange={set('subcategory_id')} disabled={!subs.length}><option value="">None</option>{subs.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</Select></Field>
            <Field id="pf-mfr" label="Manufacturer / brand"><Input id="pf-mfr" value={f.manufacturer} onChange={set('manufacturer')} maxLength={120} /></Field>
            {dist && <>
              <Field id="pf-prin" label="Principal" hint="The company whose product this is"><Select id="pf-prin" value={f.principal_id} onChange={set('principal_id')}><option value="">None</option>{principals.map((x) => <option key={x.principal_id} value={x.principal_id}>{x.name}</option>)}</Select></Field>
              <Field id="pf-brand" label="Brand"><Select id="pf-brand" value={f.brand_id} onChange={set('brand_id')}><option value="">None</option>{brands.map((b) => <option key={b.brand_id} value={b.brand_id}>{b.name}</option>)}</Select></Field>
              <Field id="pf-pack" label="Pack size" hint="For example 12 x 200 g"><Input id="pf-pack" value={f.pack_size} onChange={set('pack_size')} maxLength={40} /></Field>
              <NumberField id="pf-pprice" label="Price from principal" prefix="₹" hint="What the principal charges you per unit" value={f.principal_price} onChange={set('principal_price')} />
            </>}
            <Field id="pf-hsn" label="HSN code"><Input id="pf-hsn" value={f.hsn_sac} onChange={set('hsn_sac')} maxLength={16} /></Field>
            <NumberField id="pf-tax" label="GST rate" suffix="%" value={f.tax_rate} onChange={set('tax_rate')} />
            <div className="sm:col-span-2"><Field id="pf-desc" label="Description"><Textarea id="pf-desc" rows={2} value={f.description} onChange={set('description')} maxLength={1000} /></Field></div>
          </div>
        )}
        {tab === 'units' && (
          <div className="space-y-4">
            <Field id="pf-unit" label="Base unit" hint="The smallest unit you count stock in: pcs, kg, litre. Every other unit is a multiple of this."><div className="max-w-48"><Input id="pf-unit" value={f.unit} onChange={set('unit')} required maxLength={24} disabled={editing && Boolean(stock.data?.warehouses?.some((w) => w.quantity > 0))} /></div></Field>
            <div>
              <p className="mb-2 text-sm font-medium text-ink-700">Larger units</p>
              <p className="mb-3 text-caption text-ink-500">Example: base unit pcs, then box = 12, carton = 288 (a carton is 24 boxes of 12). Orders can use any of them; stock and invoices convert exactly.</p>
              <div className="space-y-2">
                {f.units.map((u, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-end gap-2">
                    <Field id={`u-n-${i}`} label={i === 0 ? 'Name' : ''}><Input id={`u-n-${i}`} aria-label="Unit name" placeholder="carton" value={u.unit_name} onChange={(e) => setUnit(i, 'unit_name', e.target.value)} maxLength={24} /></Field>
                    <Field id={`u-f-${i}`} label={i === 0 ? `Number of ${f.unit || 'base units'}` : ''}><Input id={`u-f-${i}`} aria-label={`Number of ${f.unit}`} type="number" min="0" step="any" placeholder="288" value={u.factor} onChange={(e) => setUnit(i, 'factor', e.target.value)} /></Field>
                    <Field id={`u-b-${i}`} label={i === 0 ? 'Barcode on this pack' : ''}><Input id={`u-b-${i}`} aria-label="Barcode" value={u.barcode} onChange={(e) => setUnit(i, 'barcode', e.target.value)} maxLength={64} /></Field>
                    <button type="button" onClick={() => setF((x) => ({ ...x, units: x.units.filter((_, j) => j !== i) }))} aria-label="Remove unit" className="mb-1 rounded-lg p-2 text-ink-400 hover:bg-surface-2 hover:text-danger"><X className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
              {f.units.length < 8 && <Button type="button" variant="secondary" size="sm" onClick={addUnit} className="mt-3"><Plus aria-hidden="true" className="h-4 w-4" />Add a unit</Button>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="pf-su" label="Usually sold in"><Select id="pf-su" value={f.sale_unit} onChange={set('sale_unit')}><option value="">Base unit</option>{unitOptions.slice(1).map((u) => <option key={u}>{u}</option>)}</Select></Field>
              <Field id="pf-pu" label="Usually bought in"><Select id="pf-pu" value={f.purchase_unit} onChange={set('purchase_unit')}><option value="">Base unit</option>{unitOptions.slice(1).map((u) => <option key={u}>{u}</option>)}</Select></Field>
            </div>
          </div>
        )}
        {tab === 'prices' && (
          <div className="space-y-4">
            <p className="text-small text-ink-500">All prices are per <strong>{f.unit || 'base unit'}</strong>, before GST. Which one a customer gets depends on their type (distributor, retailer, other), their price list, and any special price you agree with them.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField id="pf-cost" label="Purchase price" prefix="₹" value={f.purchase_price} onChange={set('purchase_price')} hint="Updated automatically from goods receipts" />
              <NumberField id="pf-mrp" label="MRP" prefix="₹" value={f.mrp} onChange={set('mrp')} />
              <NumberField id="pf-wp" label="Wholesale price" prefix="₹" value={f.wholesale_price} onChange={set('wholesale_price')} hint="The standard price" />
              <NumberField id="pf-dp" label="Distributor price" prefix="₹" value={f.distributor_price} onChange={set('distributor_price')} />
              <NumberField id="pf-rp" label="Retailer price" prefix="₹" value={f.retailer_price} onChange={set('retailer_price')} />
              {margin != null && <div className="self-end pb-2 text-small text-ink-500">Margin at wholesale price: <strong className={margin < 0 ? 'text-danger' : 'text-ink-900'}>{margin}%</strong></div>}
            </div>
            {f.units.filter((u) => Number(u.factor) > 0 && Number(f.wholesale_price) > 0).length > 0 && <p className="rounded-lg bg-surface-2 px-3 py-2 text-caption text-ink-500">At the wholesale price: {f.units.filter((u) => Number(u.factor) > 0).map((u) => `${u.unit_name || 'unit'} = ${money(Number(f.wholesale_price) * Number(u.factor))}`).join(' · ')}</p>}
          </div>
        )}
        {tab === 'stock' && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField id="pf-moq" label="Minimum order quantity" suffix={f.unit} hint="Orders below this are refused unless a manager allows it" min={0.001} value={f.moq} onChange={set('moq')} />
              <NumberField id="pf-reorder" label="Reorder level" suffix={f.unit} hint="Alerts when available stock falls to this" value={f.reorder_level} onChange={set('reorder_level')} />
              <NumberField id="pf-max" label="Maximum stock" suffix={f.unit} hint="Flags overstock" value={f.max_stock} onChange={set('max_stock')} />
            </div>
            <div className="space-y-3 rounded-(--radius-card) border border-line p-4">
              <Toggle id="pf-batch" checked={f.batch_tracking} onChange={(v) => setF((x) => ({ ...x, batch_tracking: v, expiry_tracking: v ? x.expiry_tracking : false }))} label="Track batches" hint="Goods are received and sold by batch number" />
              <Toggle id="pf-exp" checked={f.expiry_tracking} onChange={(v) => setF((x) => ({ ...x, expiry_tracking: v }))} label="Track expiry dates" hint="Soonest expiry is picked first; expired stock is never sold" />
              <Toggle id="pf-serial" checked={f.serial_tracking} onChange={(v) => setF((x) => ({ ...x, serial_tracking: v }))} label="Track serial numbers" hint="Each unit has its own serial number" />
            </div>
            {editing && stock.data && (
              <div><p className="mb-2 text-sm font-medium text-ink-700">Stock now</p>
                <ul className="divide-y divide-line rounded-(--radius-card) border border-line text-small">{stock.data.warehouses.map((w) => <li key={w.branch_id} className="flex items-center justify-between px-4 py-2"><span>{w.warehouse}{w.bin && <span className="ml-2 text-caption text-ink-500">bin {w.bin}</span>}</span><span className="tabular">{qty(w.quantity)} on hand · {qty(w.reserved)} reserved · <strong>{qty(w.available)}</strong> available</span></li>)}</ul></div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{editing ? 'Save changes' : 'Add product'}</Button></div>
      </form>
    </Modal>
  );
};

export default ProductForm;
