/*
 * The catalogue: search, add, edit, archive. Categories are managed inline
 * from the product form rather than on a page of their own — nobody visits
 * FlowXP to manage categories, they visit it to add a product and invent a
 * category on the way.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { RESTAURANT_TYPES } from '../lib/business.js';
import MenuImportModal from '../components/MenuImportModal.jsx';
import {
  Alert, Badge, Button, Card, Field, Input, ListState, Modal, SkeletonRows,
  PageHeader, Select, StatusBadge, Table, Td, Textarea, Th, Thead, Tr, useToast
} from '../components/ui.jsx';

const KIND_LABELS = { DISH: 'Dish / menu item', INGREDIENT: 'Ingredient', PACKAGING: 'Packaging' };

const emptyForm = {
  name: '', kind: 'DISH', lead_time_days: '1', modifier_group_ids: [], category_id: '', sku: '', barcode: '', unit: 'pc',
  selling_price: '', purchase_price: '', tax_rate: '0', hsn_sac: '', description: '',
  track_inventory: true, opening_stock: '0', min_stock: '0'
};

/* A menu item's photo — uploaded straight away against an existing product,
   not staged until the form saves. Simpler than holding a File in form state
   and uploading it only on submit, and it means the thumbnail updates the
   moment a photo is picked rather than after the whole form is saved. Only
   available once the product exists (POST /products/:id/image needs an id),
   so a brand-new product gets a photo on its second visit to this form. */
const ImageUploader = ({ productId, imageUrl, onUploaded }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('image', file);
      const updated = await api(`/products/${productId}/image`, { method: 'POST', body });
      onUploaded(updated);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  return (
    <div className="flex items-center gap-3">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-line-strong text-xs text-ink-400">No photo</div>
      )}
      <label className="cursor-pointer">
        <span className="inline-flex items-center rounded-full border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink-700 hover:bg-surface-2">
          {busy ? 'Uploading…' : imageUrl ? 'Change photo' : 'Add photo'}
        </span>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick} disabled={busy} />
      </label>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
};

const ProductForm = ({ initial, categories, groups, isRestaurant, onSaved, onClose, onCreateCategory }) => {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial.product_id ? initial : null); // tracks the persisted row, for the image uploader
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const isEdit = Boolean(initial.product_id);

  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    const created = await onCreateCategory(newCategory.trim());
    setForm((f) => ({ ...f, category_id: String(created.category_id) }));
    setNewCategory('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = {
        name: form.name, category_id: form.category_id || null, sku: form.sku || null,
        barcode: form.barcode || null, unit: form.unit, selling_price: form.selling_price,
        purchase_price: form.purchase_price || 0, tax_rate: form.tax_rate, hsn_sac: form.hsn_sac || null,
        description: form.description || null,
        track_inventory: form.track_inventory, min_stock: form.min_stock,
        ...(isRestaurant ? { kind: form.kind, lead_time_days: Number(form.lead_time_days) || 0 } : {})
      };
      const result = isEdit
        ? await api(`/products/${initial.product_id}`, { method: 'PATCH', body })
        : await api('/products', { method: 'POST', body: { ...body, opening_stock: form.opening_stock } });
      if (isRestaurant && form.kind === 'DISH') {
        const before = (initial.modifier_group_ids || []).join(',');
        const after = [...form.modifier_group_ids].sort((a, b) => a - b).join(',');
        if (before !== after) await api(`/products/${result.product_id}/modifier-groups`, { method: 'PUT', body: { group_ids: form.modifier_group_ids } });
      }
      setSaved(result);
      onSaved();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit product' : 'Add product'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>

        <Field id="name" label="Product name">
          <Input id="name" value={form.name} onChange={set('name')} required autoFocus />
        </Field>

        {isRestaurant && (
          <Field id="kind" label="Type" hint={form.kind === 'INGREDIENT' ? 'Bought and stocked, used in recipes — never sold on its own.' : form.kind === 'PACKAGING' ? 'Boxes, bags and cups — track stock like an ingredient.' : 'Something you sell.'}>
            <Select id="kind" value={form.kind} onChange={set('kind')}>
              {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
        )}

        <Field id="photo" label="Photo" hint={!saved ? 'Save the product first, then come back here to add a photo.' : "Shown on the customer's QR ordering menu."}>
          {saved ? (
            <ImageUploader
              productId={saved.product_id}
              imageUrl={saved.image_url}
              onUploaded={(updated) => setSaved(updated)}
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-line-strong text-xs text-ink-400">No photo</div>
          )}
        </Field>

        <Field id="description" label="Description" hint="Shown to customers on the QR ordering menu — what's in it, how it's made.">
          <Textarea id="description" value={form.description} onChange={set('description')} rows={2} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="category_id" label="Category">
            <div className="flex gap-2">
              <Select id="category_id" value={form.category_id} onChange={set('category_id')} className="flex-1">
                <option value="">Uncategorised</option>
                {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
              </Select>
            </div>
            <div className="mt-2 flex gap-2">
              <Input placeholder="New category…" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }} />
              <Button type="button" variant="secondary" size="sm" onClick={addCategory}>Add</Button>
            </div>
          </Field>

          <Field id="unit" label="Unit">
            <Select id="unit" value={form.unit} onChange={set('unit')}>
              {['pc', 'kg', 'g', 'litre', 'ml', 'box', 'pack', 'dozen', 'hour', 'service'].map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="selling_price" label="Selling price (₹)">
            <Input id="selling_price" type="number" min="0" step="0.01" value={form.selling_price} onChange={set('selling_price')} required />
          </Field>
          <Field id="purchase_price" label="Purchase price (₹)" hint="Optional">
            <Input id="purchase_price" type="number" min="0" step="0.01" value={form.purchase_price} onChange={set('purchase_price')} />
          </Field>
          <Field id="tax_rate" label="GST rate (%)">
            <Select id="tax_rate" value={form.tax_rate} onChange={set('tax_rate')}>
              {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="sku" label="SKU" hint="Optional">
            <Input id="sku" value={form.sku} onChange={set('sku')} />
          </Field>
          <Field id="barcode" label="Barcode" hint="Optional">
            <Input id="barcode" value={form.barcode} onChange={set('barcode')} />
          </Field>
          <Field id="hsn_sac" label="HSN / SAC" hint="Optional">
            <Input id="hsn_sac" value={form.hsn_sac} onChange={set('hsn_sac')} />
          </Field>
        </div>

        {isRestaurant && form.kind === 'DISH' && groups.length > 0 && (
          <Field id="modifier_groups" label="Options offered" hint="Sizes and add-ons a customer can choose. Manage groups under Modifiers.">
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => {
                const on = form.modifier_group_ids.includes(g.group_id);
                return (
                  <button key={g.group_id} type="button" aria-pressed={on}
                    onClick={() => setForm((f) => ({ ...f, modifier_group_ids: on ? f.modifier_group_ids.filter((x) => x !== g.group_id) : [...f.modifier_group_ids, g.group_id] }))}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${on ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-line-strong bg-surface text-ink-700'}`}>
                    {g.name}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <label className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 p-3.5">
          <input type="checkbox" checked={form.track_inventory} onChange={set('track_inventory')}
                 className="mt-0.5 h-4 w-4 accent-[var(--color-brand-500)]" />
          <span>
            <span className="block text-sm font-medium text-ink-900">Track stock for this product</span>
            <span className="mt-0.5 block text-xs text-ink-500">
              Turn off for a service — a haircut or a table charge has nothing to run out of.
            </span>
          </span>
        </label>

        {form.track_inventory && (
          <div className="grid gap-4 sm:grid-cols-2">
            {!isEdit && (
              <Field id="opening_stock" label="Opening stock">
                <Input id="opening_stock" type="number" min="0" step="0.001" value={form.opening_stock} onChange={set('opening_stock')} />
              </Field>
            )}
            <Field id="min_stock" label="Low-stock alert at" hint="Flags the product when stock falls to or below this.">
              <Input id="min_stock" type="number" min="0" step="0.001" value={form.min_stock} onChange={set('min_stock')} />
            </Field>
            {isRestaurant && (
              <Field id="lead_time_days" label="Delivery time (days)" hint="How long your supplier takes. Used to work out when to reorder.">
                <Input id="lead_time_days" type="number" min="0" max="30" step="1" value={form.lead_time_days} onChange={set('lead_time_days')} />
              </Field>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add product'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* Per-outlet price and availability for a shared menu item. A blank price means "the shared price". */
const OutletPrices = ({ dish, onClose }) => {
  const [rows, setRows] = useState(null);
  const [shared, setShared] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/products/${dish.product_id}/outlets`)
      .then((d) => { setShared(d.shared_price); setRows(d.outlets.map((o) => ({ ...o, price: o.price == null ? '' : String(o.price), original: o }))); })
      .catch((e) => setError(e.message));
  }, [dish.product_id]);

  const save = async () => {
    setError(''); setBusy(true);
    try {
      for (const r of rows) {
        const before = r.original;
        const priceBefore = before.price == null ? '' : String(before.price);
        if (r.price === priceBefore && r.is_available === before.is_available) continue;
        await api(`/products/${dish.product_id}/outlets`, { method: 'PUT', body: { branch_id: r.branch_id, price: r.price === '' ? null : Number(r.price), is_available: r.is_available } });
      }
      onClose();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const update = (id, patch) => setRows((rs) => rs.map((r) => (r.branch_id === id ? { ...r, ...patch } : r)));

  return (
    <Modal title={`Outlet prices — ${dish.name}`} onClose={onClose} wide>
      <Alert>{error}</Alert>
      {!rows ? <p className="text-sm text-ink-400">Loading…</p> : (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">Shared price: <strong className="text-ink-900">{formatCurrency(shared)}</strong>. Leave an outlet's price blank to use it.</p>
          {rows.map((r) => (
            <div key={r.branch_id} className="grid items-center gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_9rem_auto]">
              <span className="font-medium text-ink-900">{r.name}</span>
              <Input type="number" min="0" step="0.01" placeholder={String(shared)} value={r.price} onChange={(e) => update(r.branch_id, { price: e.target.value })} aria-label={`Price at ${r.name}`} />
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input type="checkbox" checked={r.is_available} onChange={(e) => update(r.branch_id, { is_available: e.target.checked })} className="h-4 w-4 accent-[var(--color-brand-500)]" /> Sold here
              </label>
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

/* A dish's recipe: what one portion consumes, so a sale can take ingredient
   stock out and the dish can show its real cost and margin. Cost here is
   computed from ingredients' purchase prices as you type; the server
   recomputes it authoritatively on save. */
const RecipeEditor = ({ dish, onClose }) => {
  const toast = useToast();
  const [ingredients, setIngredients] = useState(null);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api('/products?kind=INGREDIENT'), api(`/products/${dish.product_id}/recipe`)])
      .then(([catalogue, recipe]) => {
        setIngredients(catalogue);
        setRows(recipe.ingredients.map((i) => ({ ingredient_id: String(i.ingredient_id), quantity: String(i.quantity), wastage_pct: String(i.wastage_pct) })));
      })
      .catch((e) => setError(e.message));
  }, [dish.product_id]);

  const price = (id) => ingredients?.find((p) => String(p.product_id) === String(id))?.purchase_price || 0;
  const cost = (rows || []).reduce((sum, r) => sum + (Number(r.quantity) || 0) * (1 + (Number(r.wastage_pct) || 0) / 100) * price(r.ingredient_id), 0);
  const margin = dish.selling_price > 0 ? ((dish.selling_price - cost) / dish.selling_price) * 100 : null;
  const setRow = (i, field, value) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api(`/products/${dish.product_id}/recipe`, {
        method: 'PUT',
        body: { ingredients: rows.filter((r) => r.ingredient_id).map((r) => ({ ingredient_id: Number(r.ingredient_id), quantity: Number(r.quantity), wastage_pct: Number(r.wastage_pct) || 0 })) }
      });
      toast.success('Recipe saved');
      onClose();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Recipe — ${dish.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        {!rows && !error && <p className="text-sm text-ink-400">Loading…</p>}
        {ingredients?.length === 0 && (
          <p className="rounded-lg bg-surface-2 p-3 text-sm text-ink-600">No ingredients yet. Add products with the type <strong>Ingredient</strong> (with their purchase price per unit), then build the recipe here.</p>
        )}
        {rows && ingredients?.length > 0 && (
          <>
            <p className="text-xs text-ink-500">Quantities are for <strong>one portion</strong>, in each ingredient's own unit.</p>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_6rem_6rem_5rem_auto]">
                  <Select aria-label="Ingredient" value={r.ingredient_id} onChange={(e) => setRow(i, 'ingredient_id', e.target.value)}>
                    <option value="">Choose ingredient…</option>
                    {ingredients.map((p) => <option key={p.product_id} value={p.product_id}>{p.name} ({p.unit})</option>)}
                  </Select>
                  <Input aria-label="Quantity" type="number" min="0" step="0.001" placeholder="Qty" value={r.quantity} onChange={(e) => setRow(i, 'quantity', e.target.value)} />
                  <Input aria-label="Wastage percent" type="number" min="0" max="99" step="0.5" placeholder="Waste %" value={r.wastage_pct} onChange={(e) => setRow(i, 'wastage_pct', e.target.value)} />
                  <span className="self-center text-right text-xs text-ink-500">{formatCurrency((Number(r.quantity) || 0) * (1 + (Number(r.wastage_pct) || 0) / 100) * price(r.ingredient_id))}</span>
                  <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-xs font-semibold text-ink-400 hover:text-danger">Remove</button>
                </div>
              ))}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, { ingredient_id: '', quantity: '', wastage_pct: '0' }])}>Add ingredient</Button>
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-sm text-ink-700">
            Cost per portion <strong className="text-ink-900">{formatCurrency(cost)}</strong>
            {margin != null && <> · margin <strong className={margin < 30 ? 'text-warning' : 'text-success'}>{margin.toFixed(1)}%</strong> on {formatCurrency(dish.selling_price)}</>}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="button" disabled={busy || !rows} onClick={save}>{busy ? 'Saving…' : 'Save recipe'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

const ProductsPage = () => {
  const [products, setProducts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);   // null closed, {} for new, row for edit
  const [recipeFor, setRecipeFor] = useState(null);
  const [groups, setGroups] = useState([]);
  const [kindFilter, setKindFilter] = useState('');
  const [pricesFor, setPricesFor] = useState(null);
  const [importing, setImporting] = useState(false);
  const { business, outlets } = useAuth();
  const isRestaurant = RESTAURANT_TYPES.includes(business?.business_type);

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (categoryFilter) params.set('category_id', categoryFilter);
      if (kindFilter) params.set('kind', kindFilter);
      const [productList, categoryList, groupList] = await Promise.all([
        api(`/products?${params}`), api('/categories'), isRestaurant ? api('/modifier-groups') : Promise.resolve([])
      ]);
      setProducts(productList);
      setCategories(categoryList);
      setGroups(groupList);
    } catch (caught) {
      setError(caught.message);
    }
  };

  useEffect(() => { load(); }, [search, categoryFilter, kindFilter, isRestaurant]);

  const createCategory = async (name) => {
    const created = await api('/categories', { method: 'POST', body: { name } });
    setCategories((c) => [...c, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  };

  const archive = async (product) => {
    if (!confirm(`Archive ${product.name}? It will no longer appear in billing.`)) return;
    await api(`/products/${product.product_id}/archive`, { method: 'POST' });
    load();
  };

  return (
    <div>
      <PageHeader
        title="Products"
        lead="The catalogue billing works from."
        action={<div className="flex gap-2">{isRestaurant && <Button variant="secondary" onClick={() => setImporting(true)}>Import menu from photo</Button>}<Button onClick={() => setEditing({})}>Add product</Button></div>}
      />

      {isRestaurant && products?.length === 0 && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink-900">Have a printed menu? Don’t type it in.</p>
            <p className="mt-1 text-sm text-ink-500">Take a photo of each page. FlowXP reads the dishes and prices, you check them, and your menu is ready.</p>
          </div>
          <Button onClick={() => setImporting(true)}>Add menu from a photo</Button>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <Input placeholder="Search by name, SKU or barcode…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="max-w-48">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
        </Select>
        {isRestaurant && (
          <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="max-w-48" aria-label="Type">
            <option value="">All types</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        )}
      </div>

      <ListState
        loading={!products && !error} error={error} empty={products?.length === 0}
        emptyLabel="No products yet — add your first one."
        skeleton={<SkeletonRows rows={5} columns={5} />}
      />

      {products?.length > 0 && (
        <Table>
          <Thead>
            <Th>Name</Th><Th>Category</Th><Th className="text-right">Price</Th>
            <Th className="text-right">Stock</Th><Th>Status</Th><Th></Th>
          </Thead>
          <tbody>
            {products.map((p) => (
              <Tr key={p.product_id}>
                <Td>
                  <div className="flex items-center gap-2.5">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="h-9 w-9 rounded-md object-cover" />
                    ) : (
                      <div className="h-9 w-9 shrink-0 rounded-md bg-surface-3" />
                    )}
                    <div>
                      <span className="font-medium">{p.name}</span>
                      {p.sku && <span className="ml-2 text-xs text-ink-400">{p.sku}</span>}
                      {isRestaurant && p.kind !== 'DISH' && <span className="ml-2 text-xs text-ink-400">{KIND_LABELS[p.kind]}</span>}
                    </div>
                  </div>
                </Td>
                <Td className="text-ink-500">{p.category_name || '—'}</Td>
                <Td className="text-right">{formatCurrency(p.selling_price)}{p.price_overridden && <span className="ml-1 text-xs text-brand-600" title="This outlet charges its own price">outlet price</span>}</Td>
                <Td className="text-right">
                  {p.track_inventory ? (
                    <span className={p.low_stock ? 'font-semibold text-warning' : ''}>
                      {p.current_stock} {p.unit}
                    </span>
                  ) : <span className="text-ink-400">—</span>}
                </Td>
                <Td>
                  {p.is_available === false ? <Badge tone="neutral">Off at this outlet</Badge> : p.low_stock ? <Badge tone="warning">Low stock</Badge> : <StatusBadge status={p.status} />}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-3">
                    {outlets.length > 1 && p.kind === 'DISH' && <button onClick={() => setPricesFor(p)} className="text-xs font-semibold text-brand-600">Outlet prices</button>}
                    {isRestaurant && p.kind === 'DISH' && <button onClick={() => setRecipeFor(p)} className="text-xs font-semibold text-brand-600">Recipe</button>}
                    <button onClick={() => setEditing(p)} className="text-xs font-semibold text-brand-600">Edit</button>
                    {p.status === 'ACTIVE' && (
                      <button onClick={() => archive(p)} className="text-xs font-semibold text-ink-400 hover:text-danger">Archive</button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && (
        <ProductForm
          initial={editing.product_id ? {
            ...editing, category_id: editing.category_id ? String(editing.category_id) : '',
            selling_price: String(editing.shared_price ?? editing.selling_price), purchase_price: String(editing.purchase_price),
            tax_rate: String(editing.tax_rate), min_stock: String(editing.min_stock), lead_time_days: String(editing.lead_time_days ?? 1)
          } : emptyForm}
          categories={categories}
          groups={groups}
          isRestaurant={isRestaurant}
          onCreateCategory={createCategory}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {importing && <MenuImportModal onClose={() => setImporting(false)} onDone={load} />}
      {pricesFor && <OutletPrices dish={pricesFor} onClose={() => { setPricesFor(null); load(); }} />}
      {recipeFor && <RecipeEditor dish={recipeFor} onClose={() => { setRecipeFor(null); load(); }} />}
    </div>
  );
};

export default ProductsPage;
