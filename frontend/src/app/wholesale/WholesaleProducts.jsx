/*
 * Products and pricing: the product master (units, tiers, MOQ, tracking), categories, price lists (by customer type,
 * quantity breaks, promotions with dates), and bulk price changes. Import a catalogue from CSV, export it, change
 * many products at once, and print barcode labels.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Barcode, Download, Package, Pencil, Plus, Trash, Upload } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { DIST_IMPORTS, fetchAll, money, qs, qty, saveCsv, useDebounced, useLoad, dateText, CUSTOMER_TYPES } from '../../lib/wholesale.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Chips, CsvImportModal, NumberField, Pager, Panel, ProductPicker, Segmented, StatusPill, Tabs, Toggle, Toolbar, useAction } from './parts.jsx';
import ProductForm from './ProductForm.jsx';
import PriceListImport from '../distributor/PriceListImport.jsx';
import { useT, T } from '../../i18n/useT.js';

/* ── bulk price change: preview first, then apply ─────────────────────────────────────────────── */
const BulkPrice = ({ onClose, onDone }) => {
  const tr = useT();
  const cats = useLoad('/wholesale/categories');
  const [f, setF] = useState({ field: 'wholesale', mode: 'PERCENT', value: '', category_id: '' });
  const [preview, setPreview] = useState(null);
  const [busy, run] = useAction();
  const body = (apply) => ({ field: f.field, mode: f.mode, value: Number(f.value), category_id: f.category_id ? Number(f.category_id) : undefined, apply });
  const check = async () => { const r = await run(() => api('/wholesale/products/bulk-price', { method: 'POST', body: body(false) })); if (r) setPreview(r); };
  const apply = async () => { const r = await run(() => api('/wholesale/products/bulk-price', { method: 'POST', body: body(true) }), 'Prices updated'); if (r) onDone(); };
  const change = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setPreview(null); };
  return (
    <Modal title={tr('Change prices in bulk')} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="bp-field" label={tr('Which price')}><Select id="bp-field" value={f.field} onChange={change('field')}><option value="wholesale">{tr('Wholesale price')}</option><option value="distributor">{tr('Distributor price')}</option><option value="retailer">{tr('Retailer price')}</option><option value="mrp">{tr('MRP')}</option><option value="purchase">{tr('Purchase price')}</option></Select></Field>
          <Field id="bp-cat" label={tr('Which products')}><Select id="bp-cat" value={f.category_id} onChange={change('category_id')}><option value="">{tr('Every active product')}</option>{(cats.data || []).map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</Select></Field>
          <Field id="bp-mode" label={tr('How')}><Select id="bp-mode" value={f.mode} onChange={change('mode')}><option value="PERCENT">{tr('Raise or lower by a percentage')}</option><option value="AMOUNT">{tr('Add or take off an amount')}</option><option value="SET">{tr('Set to one price')}</option></Select></Field>
          <NumberField id="bp-val" label={f.mode === 'PERCENT' ? tr('Percentage (negative lowers)') : f.mode === 'AMOUNT' ? tr('Amount (negative lowers)') : tr('New price')} prefix={f.mode !== 'PERCENT' ? '₹' : undefined} suffix={f.mode === 'PERCENT' ? '%' : undefined} min={-100000000} value={f.value} onChange={(v) => { setF((x) => ({ ...x, value: v })); setPreview(null); }} />
        </div>
        {preview && (
          <div className="rounded-(--radius-card) border border-line">
            <p className="border-b border-line bg-surface-2 px-4 py-2 text-small font-medium">{preview.count} product{preview.count === 1 ? '' : 's'} will change{preview.count > preview.sample.length ? ` (first ${preview.sample.length} shown)` : ''}</p>
            <ul className="max-h-56 divide-y divide-line overflow-y-auto text-small">{preview.sample.map((x) => <li key={x.product_id} className="flex justify-between gap-3 px-4 py-1.5"><span className="truncate">{x.name}</span><span className="tabular shrink-0 text-ink-500">{x.from != null ? money(x.from) : '—'} → <strong className="text-ink-900">{money(x.to)}</strong></span></li>)}</ul>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button>
          {!preview ? <Button onClick={check} loading={busy} disabled={f.value === ''}>{tr('Preview changes')}</Button> : <Button onClick={apply} loading={busy} disabled={preview.count === 0}>{tr('Apply to {{count}}', { count: preview.count })}</Button>}</div>
      </div>
    </Modal>
  );
};

/* ── bulk edit of selected products ───────────────────────────────────────────────────────────── */
const BulkEdit = ({ ids, onClose, onDone }) => {
  const tr = useT();
  const cats = useLoad('/wholesale/categories');
  const [action, setAction] = useState('SET_CATEGORY');
  const [value, setValue] = useState('');
  const [busy, run] = useAction();
  const go = async () => { const r = await run(() => api('/wholesale/products/bulk', { method: 'POST', body: { ids, action, value: value === '' ? undefined : Number(value) } })); if (r) onDone(r.updated); };
  return (
    <Modal title={`Change ${ids.length} product${ids.length === 1 ? '' : 's'}`} onClose={onClose}>
      <div className="space-y-4">
        <Field id="be-act" label={tr('What to change')}><Select id="be-act" value={action} onChange={(e) => { setAction(e.target.value); setValue(''); }}><option value="SET_CATEGORY">{tr('Move to a category')}</option><option value="SET_TAX">{tr('Set the GST rate')}</option><option value="SET_MOQ">{tr('Set the minimum order quantity')}</option><option value="SET_REORDER">{tr('Set the reorder level')}</option><option value="ARCHIVE">{tr('Archive')}</option><option value="RESTORE">{tr('Restore')}</option></Select></Field>
        {action === 'SET_CATEGORY' && <Field id="be-v" label={tr('Category')}><Select id="be-v" value={value} onChange={(e) => setValue(e.target.value)}><option value="">{tr('Choose…')}</option>{(cats.data || []).map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</Select></Field>}
        {['SET_TAX', 'SET_MOQ', 'SET_REORDER'].includes(action) && <NumberField id="be-v" label={tr('Value')} suffix={action === 'SET_TAX' ? '%' : undefined} value={value} onChange={setValue} />}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={go} loading={busy} variant={action === 'ARCHIVE' ? 'danger' : 'primary'} disabled={['SET_CATEGORY', 'SET_TAX', 'SET_MOQ', 'SET_REORDER'].includes(action) && value === ''}>{tr('Apply')}</Button></div>
      </div>
    </Modal>
  );
};

/* ── the product list ─────────────────────────────────────────────────────────────────────────── */
const ProductsTab = () => {
  const tr = useT();
  const { can, business } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [view, setView] = useState('');
  const [offset, setOffset] = useState(0);
  const [form, setForm] = useState(null);       // null | {} (new) | product
  const [importing, setImporting] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [bulkPrice, setBulkPrice] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const [stamp, setStamp] = useState(0);
  const term = useDebounced(q.trim(), 250);
  const cats = useLoad('/wholesale/categories');
  const query = useMemo(() => qs({ q: term, category_id: category, status: view === 'archived' ? 'ARCHIVED' : undefined, low_stock: view === 'low' ? 1 : undefined, tracked: ['batch', 'expiry', 'serial'].includes(view) ? view : undefined, limit: 50, offset, k: stamp }), [term, category, view, offset, stamp]);
  const { data, meta, loading, error } = useLoad(`/wholesale/products${query}`, { paged: true });
  const canEdit = can('products');
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const openForm = async (p) => { try { setForm(await api(`/wholesale/products/${p.product_id}`)); } catch (e) { toast.error(e.message); } };
  const exportCsv = async () => {
    try {
      const rows = await fetchAll(`/wholesale/products${qs({ q: term, category_id: category })}`);
      saveCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`, [{ key: 'name', label: T('Name') }, { key: 'sku', label: T('SKU') }, { key: 'barcode', label: T('Barcode') }, { key: 'unit', label: T('Unit') }, { key: 'category', label: T('Category') }, { key: 'hsn_sac', label: T('HSN') }, { key: 'tax_rate', label: T('Tax Rate') },
        { key: 'purchase_price', label: T('Purchase Price') }, { key: 'wholesale_price', label: T('Wholesale Price') }, { key: 'distributor_price', label: T('Distributor Price') }, { key: 'retailer_price', label: T('Retailer Price') }, { key: 'mrp', label: T('MRP') }, { key: 'moq', label: T('MOQ') }, { key: 'reorder_level', label: T('Reorder Level') }, { key: 'max_stock', label: T('Max Stock') }, { key: 'on_hand', label: T('On hand') }], rows);
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        {can('export') && <Button variant="secondary" onClick={exportCsv}><Download aria-hidden="true" className="h-4 w-4" />{tr('Export')}</Button>}
        {canEdit && business?.distributor_enabled && <><Button variant="secondary" onClick={() => setImporting('price-list')}><Upload aria-hidden="true" className="h-4 w-4" />{tr('Prices')}</Button><Button variant="secondary" onClick={() => setImporting('stock')}><Upload aria-hidden="true" className="h-4 w-4" />{tr('Stock')}</Button></>}
        {canEdit && <Button variant="secondary" onClick={() => setImporting(true)}><Upload aria-hidden="true" className="h-4 w-4" />{tr('Import')}</Button>}
        {can('pricing') && <Button variant="secondary" onClick={() => setBulkPrice(true)}>{tr('Change prices')}</Button>}
        {canEdit && <Button onClick={() => setForm({})}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add product')}</Button>}
      </div>
      <Toolbar>
        <div className="w-full sm:w-72"><Input type="search" placeholder={tr('Name, SKU, barcode or brand')} aria-label={tr('Search products')} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div>
        <div className="w-48"><Select aria-label={tr('Category')} value={category} onChange={(e) => { setCategory(e.target.value); setOffset(0); }}><option value="">{tr('All categories')}</option>{(cats.data || []).map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</Select></div>
      </Toolbar>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Chips label={tr('View')} value={view} onChange={(v) => { setView(v); setOffset(0); setPicked(new Set()); }} options={[{ value: '', label: T('Active') }, { value: 'low', label: T('Low stock') }, { value: 'batch', label: T('Batch tracked') }, { value: 'expiry', label: T('Expiry tracked') }, { value: 'serial', label: T('Serial tracked') }, { value: 'archived', label: T('Archived') }]} />
        {picked.size > 0 && <span className="flex items-center gap-2 text-small"><span className="text-ink-500">{tr('{{picked_size}} selected', { picked_size: picked.size })}</span>{canEdit && <Button size="sm" variant="secondary" onClick={() => setBulk(true)}>{tr('Change…')}</Button>}<Button size="sm" variant="secondary" onClick={() => navigate(`/app/wholesale/labels?ids=${[...picked].join(',')}`)}><Barcode aria-hidden="true" className="h-4 w-4" />{tr('Labels')}</Button><Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>{tr('Clear')}</Button></span>}
      </div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={Package} emptyLabel={tr('No products here')} emptyBody={term || category || view ? 'Nothing matches those filters.' : 'Add your first product, or import your catalogue from a CSV file.'} emptyAction={canEdit && !term && !view ? <Button onClick={() => setForm({})}>{tr('Add product')}</Button> : undefined} />
      {data?.length > 0 && (
        <>
          <Table>
            <Thead><Th className="w-8"><span className="sr-only">{tr('Select')}</span></Th><Th>{tr('Product')}</Th><Th>{tr('Category')}</Th><Th>{tr('Units')}</Th><Th className="text-right">{tr('MRP')}</Th><Th className="text-right">{tr('Wholesale')}</Th><Th className="text-right">{tr('GST')}</Th><Th className="text-right">{tr('MOQ')}</Th><Th className="text-right">{tr('Available')}</Th></Thead>
            <tbody>
              {data.map((p) => (
                <Tr key={p.product_id} onClick={() => (canEdit ? openForm(p) : navigate(`/app/wholesale/inventory?q=${encodeURIComponent(p.name)}`))}>
                  <Td><input type="checkbox" aria-label={tr('Select {{p_name}}', { p_name: p.name })} checked={picked.has(p.product_id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(p.product_id)} className="h-4 w-4 accent-(--color-brand-500)" /></Td>
                  <Td><span className="font-medium">{p.name}</span><span className="block text-caption text-ink-500">{[p.sku, p.manufacturer || p.brand].filter(Boolean).join(' · ')}</span>
                    <span className="mt-0.5 flex gap-1">{p.batch_tracking && <Badge tone="neutral">{tr('batch')}</Badge>}{p.expiry_tracking && <Badge tone="warning">{tr('expiry')}</Badge>}{p.serial_tracking && <Badge tone="neutral">{tr('serial')}</Badge>}{p.status === 'ARCHIVED' && <Badge tone="warning">{tr('archived')}</Badge>}</span></Td>
                  <Td className="text-ink-500">{[p.category, p.subcategory].filter(Boolean).join(' › ') || '—'}</Td>
                  <Td className="text-ink-500">{p.unit}{p.units?.length ? ` · ${p.units.map((u) => `${u.unit_name} ${u.factor}`).join(', ')}` : ''}</Td>
                  <Td className="text-right tabular">{p.mrp != null ? money(p.mrp) : '—'}</Td><Td className="text-right tabular font-medium">{p.wholesale_price != null ? money(p.wholesale_price) : '—'}</Td><Td className="text-right tabular">{p.tax_rate}%</Td><Td className="text-right tabular">{qty(p.moq)}</Td>
                  <Td className={`text-right tabular ${p.low ? 'font-semibold text-warning' : ''}`}>{p.available != null ? qty(p.available) : '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager meta={meta} onPage={setOffset} />
        </>
      )}
      {form && <ProductForm product={form.product_id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((n) => n + 1); }} />}
      {importing === 'price-list' && <PriceListImport onClose={() => setImporting(false)} onDone={() => { setImporting(false); setStamp((n) => n + 1); }} />}
      {importing === 'stock' && <CsvImportModal kind="stock" title={tr(DIST_IMPORTS.stock.title)} endpoint="/distributor/import/stock" template={DIST_IMPORTS.stock} allowUpdate={false} initialMode="add" modes={[{ value: 'add', label: T('Add this to the shelf (opening stock, new goods)') }, { value: 'set', label: T('Set the shelf to exactly this (stock take)') }]} onClose={() => setImporting(false)} onDone={() => { setImporting(false); setStamp((n) => n + 1); }} />}
      {importing === true && <CsvImportModal kind="products" title={tr('Import products')} onClose={() => setImporting(false)} onDone={() => { setImporting(false); setStamp((n) => n + 1); }} />}
      {bulk && <BulkEdit ids={[...picked]} onClose={() => setBulk(false)} onDone={(n) => { setBulk(false); setPicked(new Set()); setStamp((x) => x + 1); toast.success(`${n} product${n === 1 ? '' : 's'} updated`); }} />}
      {bulkPrice && <BulkPrice onClose={() => setBulkPrice(false)} onDone={() => { setBulkPrice(false); setStamp((n) => n + 1); }} />}
    </div>
  );
};

/* ── price lists ──────────────────────────────────────────────────────────────────────────────── */

const ListForm = ({ list, onClose, onSaved }) => {
  const tr = useT();
  const [f, setF] = useState({ name: list?.name || '', kind: list?.kind || 'STANDARD', customer_type: list?.customer_type || '', starts_on: list?.starts_on ? String(list.starts_on).slice(0, 10) : '', ends_on: list?.ends_on ? String(list.ends_on).slice(0, 10) : '', is_active: list?.is_active ?? true, notes: list?.notes || '', make_default: Boolean(list?.is_default) });
  const [busy, run] = useAction();
  const save = async () => {
    const body = { name: f.name, kind: f.kind, customer_type: f.kind === 'STANDARD' && f.customer_type ? f.customer_type : null, starts_on: f.starts_on || null, ends_on: f.ends_on || null, is_active: f.is_active, notes: f.notes || null, ...(list ? { make_default: f.make_default && f.kind === 'STANDARD' } : {}) };
    const r = await run(() => api(list ? `/wholesale/price-lists/${list.list_id}` : '/wholesale/price-lists', { method: list ? 'PUT' : 'POST', body }), 'Price list saved');
    if (r) onSaved(r);
  };
  return (
    <Modal title={list ? tr('Edit price list') : tr('New price list')} onClose={onClose}>
      <div className="space-y-4">
        <Field id="pl-name" label={tr('Name')}><Input id="pl-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus maxLength={80} /></Field>
        <Segmented label={tr('Kind')} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'STANDARD', label: T('Price list') }, { value: 'PROMOTION', label: T('Promotion') }]} />
        <p className="text-caption text-ink-500">{f.kind === 'STANDARD' ? tr('Assign it to customers, or to every customer of one type. Its rules replace the tier price.') : tr('A promotion applies to everyone while it runs, and only if it beats the customer’s normal price.')}</p>
        {f.kind === 'STANDARD' && <Field id="pl-type" label={tr('Applies to every')} hint={tr('Optional: customers of this type who have no list of their own')}><Select id="pl-type" value={f.customer_type} onChange={(e) => setF({ ...f, customer_type: e.target.value })}><option value="">{tr('Only customers I assign it to')}</option>{Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>}
        <div className="grid gap-4 sm:grid-cols-2"><Field id="pl-from" label={tr('Starts')}><Input id="pl-from" type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} /></Field><Field id="pl-to" label={tr('Ends')}><Input id="pl-to" type="date" min={f.starts_on} value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} /></Field></div>
        <Toggle id="pl-active" checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label={tr('Active')} />
        {list && f.kind === 'STANDARD' && <Toggle id="pl-default" checked={f.make_default} onChange={(v) => setF({ ...f, make_default: v })} label={tr('Use for customers with no list')} hint={tr('The business default')} />}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={save} loading={busy} disabled={f.name.trim().length < 2}>{tr('Save')}</Button></div>
      </div>
    </Modal>
  );
};

const RuleForm = ({ listId, onClose, onSaved }) => {
  const tr = useT();
  const cats = useLoad('/wholesale/categories');
  const [scope, setScope] = useState('PRODUCT');
  const [product, setProduct] = useState(null);
  const [f, setF] = useState({ category_id: '', unit_name: '', min_qty: '1', kind: 'PRICE', value: '' });
  const [busy, run] = useAction();
  const save = async () => {
    const item = { ...(scope === 'PRODUCT' ? { product_id: product.product_id } : { category_id: Number(f.category_id) }), unit_name: scope === 'PRODUCT' ? f.unit_name || undefined : undefined, min_qty: Number(f.min_qty) || 1, ...(f.kind === 'PRICE' ? { price: Number(f.value) } : { discount_pct: Number(f.value) }) };
    const r = await run(() => api(`/wholesale/price-lists/${listId}/items`, { method: 'PUT', body: { items: [item] } }), 'Rule saved');
    if (r) onSaved();
  };
  return (
    <Modal title={tr('Add a rule')} onClose={onClose}>
      <div className="space-y-4">
        <Segmented label={tr('Applies to')} value={scope} onChange={setScope} options={[{ value: 'PRODUCT', label: T('One product') }, { value: 'CATEGORY', label: T('A whole category') }]} />
        {scope === 'PRODUCT' ? (product ? <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-small"><span className="font-medium">{product.name}</span><button type="button" className="text-brand-600" onClick={() => setProduct(null)}>{tr('Change')}</button></div> : <ProductPicker onPick={setProduct} autoFocus />)
          : <Field id="rf-cat" label={tr('Category')}><Select id="rf-cat" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}><option value="">{tr('Choose…')}</option>{(cats.data || []).map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</Select></Field>}
        <div className="grid gap-4 sm:grid-cols-2">
          {scope === 'PRODUCT' && product && <Field id="rf-unit" label={tr('Unit')}><Select id="rf-unit" value={f.unit_name} onChange={(e) => setF({ ...f, unit_name: e.target.value })}><option value="">{tr('{{unit}} (base)', { unit: product.unit })}</option>{(product.units || []).map((u) => <option key={u.unit_name} value={u.unit_name}>{u.unit_name}</option>)}</Select></Field>}
          <NumberField id="rf-min" label={tr('From quantity')} hint={tr('Quantity break')} min={0.001} value={f.min_qty} onChange={(v) => setF({ ...f, min_qty: v })} />
        </div>
        <Segmented label={tr('Kind')} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'PRICE', label: T('Fixed price') }, { value: 'DISCOUNT', label: T('% off the tier price') }]} />
        <NumberField id="rf-val" label={f.kind === 'PRICE' ? tr('Price per unit') : tr('Discount')} prefix={f.kind === 'PRICE' ? '₹' : undefined} suffix={f.kind === 'DISCOUNT' ? '%' : undefined} value={f.value} onChange={(v) => setF({ ...f, value: v })} />
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={save} loading={busy} disabled={(scope === 'PRODUCT' ? !product : !f.category_id) || f.value === ''}>{tr('Save rule')}</Button></div>
      </div>
    </Modal>
  );
};

const ListRules = ({ list, onClose, onChanged }) => {
  const tr = useT();
  const toast = useToast();
  const dialog = useDialog();
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const [adding, setAdding] = useState(false);
  const [stamp, setStamp] = useState(0);
  const { data, meta, loading, error } = useLoad(`/wholesale/price-lists/${list.list_id}/items${qs({ q: term, limit: 100, offset, k: stamp })}`, { paged: true });
  const remove = async (r) => { if (!(await dialog.confirm({ title: tr('Remove this rule?'), confirmLabel: tr('Remove'), danger: true }))) return; try { await api(`/wholesale/price-lists/${list.list_id}/items/${r.item_id}`, { method: 'DELETE' }); setStamp((n) => n + 1); onChanged(); } catch (e) { toast.error(e.message); } };
  return (
    <Modal title={list.name} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="w-full sm:w-64"><Input type="search" placeholder={tr('Find a rule')} aria-label={tr('Find a rule')} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div><Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add a rule')}</Button></div>
        <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel={tr('No rules yet')} emptyBody="Add rules to set prices or discounts for products or categories." />
        {data?.length > 0 && <><Table><Thead><Th>{tr('Product / category')}</Th><Th>{tr('Unit')}</Th><Th className="text-right">{tr('From qty')}</Th><Th className="text-right">{tr('Price')}</Th><Th><span className="sr-only">{tr('Remove')}</span></Th></Thead>
          <tbody>{data.map((r) => <Tr key={r.item_id}><Td className="font-medium">{r.product || r.category}{!r.product && <Badge tone="neutral">{tr('category')}</Badge>}</Td><Td>{r.unit_name || 'base'}</Td><Td className="text-right tabular">{r.min_qty}</Td><Td className="text-right tabular font-medium">{r.price != null ? money(r.price) : `${r.discount_pct}% off`}</Td><Td className="text-right"><button type="button" aria-label={tr('Remove rule')} onClick={() => remove(r)} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><Trash className="h-4 w-4" /></button></Td></Tr>)}</tbody></Table><Pager meta={meta} onPage={setOffset} /></>}
      </div>
      {adding && <RuleForm listId={list.list_id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setStamp((n) => n + 1); onChanged(); }} />}
    </Modal>
  );
};

const PriceLists = () => {
  const tr = useT();
  const { can } = useAuth();
  const { data, loading, error, reload } = useLoad('/wholesale/price-lists');
  const [editing, setEditing] = useState(null);   // null | {} | list
  const [opened, setOpened] = useState(null);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-small text-ink-500">{tr('Prices work in this order: a price agreed with the customer, then their price list (or the one for their type, or your default), then a running promotion if it is lower, then the tier price on the product.')}</p>{can('pricing') && <Button onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />{tr('New price list')}</Button>}</div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel={tr('No price lists yet')} emptyBody="Create one to give a group of customers their own prices, or to run a promotion." />
      {data?.length > 0 && <Table><Thead><Th>{tr('Name')}</Th><Th>{tr('Kind')}</Th><Th>{tr('Applies to')}</Th><Th>{tr('Runs')}</Th><Th className="text-right">{tr('Rules')}</Th><Th className="text-right">{tr('Customers')}</Th><Th><span className="sr-only">{tr('Edit')}</span></Th></Thead>
        <tbody>{data.map((l) => <Tr key={l.list_id} onClick={() => setOpened(l)}><Td className="font-medium">{l.name}{l.is_default && <span className="ml-2"><Badge tone="brand">{tr('default')}</Badge></span>}{!l.is_active && <span className="ml-2"><Badge tone="neutral">{tr('inactive')}</Badge></span>}</Td><Td>{l.kind === 'PROMOTION' ? <Badge tone="warning">{tr('Promotion')}</Badge> : tr('Price list')}</Td>
          <Td className="text-ink-500">{l.kind === 'STANDARD' ? (l.customer_type ? `All ${CUSTOMER_TYPES[l.customer_type]}s` : tr('Assigned customers')) : tr('Everyone')}</Td><Td className="text-caption text-ink-500">{l.starts_on || l.ends_on ? `${l.starts_on ? dateText(l.starts_on) : 'now'} → ${l.ends_on ? dateText(l.ends_on) : 'open'}` : tr('Always')}</Td>
          <Td className="text-right tabular">{l.items}</Td><Td className="text-right tabular">{l.customers}</Td><Td className="text-right">{can('pricing') && <button type="button" aria-label={tr('Edit {{l_name}}', { l_name: l.name })} onClick={(e) => { e.stopPropagation(); setEditing(l); }} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-ink-900"><Pencil className="h-4 w-4" /></button>}</Td></Tr>)}</tbody></Table>}
      {editing && <ListForm list={editing.list_id ? editing : null} onClose={() => setEditing(null)} onSaved={(l) => { setEditing(null); reload(); if (!editing.list_id) setOpened(l); }} />}
      {opened && <ListRules list={opened} onClose={() => setOpened(null)} onChanged={reload} />}
    </div>
  );
};

/* ── categories ───────────────────────────────────────────────────────────────────────────────── */

const Categories = () => {
  const tr = useT();
  const { can } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad('/wholesale/categories');
  const add = async (parent) => {
    const name = await dialog.prompt({ title: parent ? `New subcategory of ${parent.name}` : 'New category', label: tr('Name'), confirmLabel: tr('Add') });
    if (!name) return;
    try { await api('/wholesale/categories', { method: 'POST', body: { name, parent_id: parent?.category_id } }); reload(); } catch (e) { toast.error(e.message); }
  };
  const rename = async (c) => {
    const name = await dialog.prompt({ title: tr('Rename category'), label: tr('Name'), defaultValue: c.name, confirmLabel: tr('Save') });
    if (!name) return;
    try { await api(`/wholesale/categories/${c.category_id}`, { method: 'PUT', body: { name } }); reload(); } catch (e) { toast.error(e.message); }
  };
  const top = (data || []).filter((c) => !c.parent_id);
  return (
    <div>
      <div className="mb-4 flex justify-end">{can('products') && <Button onClick={() => add(null)}><Plus aria-hidden="true" className="h-4 w-4" />{tr('New category')}</Button>}</div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel={tr('No categories yet')} emptyBody="Group your products into categories and subcategories." />
      {top.length > 0 && <ul className="space-y-3">{top.map((c) => {
        const subs = data.filter((s) => s.parent_id === c.category_id);
        return <li key={c.category_id} className="rounded-(--radius-card) border border-line bg-surface"><div className="flex items-center justify-between gap-3 px-4 py-3"><span className="font-medium text-ink-900">{c.name}<span className="ml-2 text-caption text-ink-500">{c.products} product{c.products === 1 ? '' : 's'}</span></span>
          {can('products') && <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => add(c)}>{tr('Add subcategory')}</Button><Button size="sm" variant="ghost" onClick={() => rename(c)}>{tr('Rename')}</Button></span>}</div>
          {subs.length > 0 && <ul className="divide-y divide-line border-t border-line">{subs.map((s) => <li key={s.category_id} className="flex items-center justify-between px-4 py-2 pl-8 text-small"><span>{s.name}<span className="ml-2 text-caption text-ink-500">{s.products}</span></span>{can('products') && <Button size="sm" variant="ghost" onClick={() => rename(s)}>{tr('Rename')}</Button>}</li>)}</ul>}</li>;
      })}</ul>}
    </div>
  );
};

const WholesaleProducts = () => {
  const tr = useT();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'products';
  const tabs = [{ key: 'products', label: T('Products') }, { key: 'categories', label: T('Categories') }, ...(can('pricing') || can('sales_orders') ? [{ key: 'lists', label: T('Price lists & promotions') }] : [])];
  return (
    <div>
      <PageHeader title={tr('Products & pricing')} lead={tr('Your catalogue with units of measure, price tiers, price lists and promotions.')} />
      <Tabs tabs={tabs} value={tab} onChange={(k) => setParams(k === 'products' ? {} : { tab: k }, { replace: true })} />
      {tab === 'products' && <ProductsTab />}
      {tab === 'categories' && <Categories />}
      {tab === 'lists' && <PriceLists />}
    </div>
  );
};

export default WholesaleProducts;
