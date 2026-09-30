/*
 * The catalogue billing works from. The list on the left (tabs by type,
 * category chips, search, sort), the chosen product on the right (?p=ID): its
 * photo, price and GST, what one costs you and the margin, its recipe or combo
 * parts, options, stock and outlet prices, with the editors for each.
 *
 * Cost and margin come from GET /products (recipe cost at the viewer's outlet,
 * else the purchase price); nothing is estimated here. Categories are created
 * from the product form: nobody visits FlowXP to manage categories.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, ChefHat, Layers, Plus, Search, Sparkles, Package } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { RESTAURANT_TYPES } from '../lib/business.js';
import MenuImportModal from '../components/MenuImportModal.jsx';
import FoodMark, { FOOD_TYPES } from '../components/FoodMark.jsx';
import { Alert, Button, Field, Input, Modal, Select, Textarea, useToast, useDialog, EmptyState } from '../components/ui.jsx';

const KIND_LABELS = { DISH: 'Sold item', INGREDIENT: 'Ingredient', PACKAGING: 'Packaging' };
const UNITS = ['pc', 'plate', 'kg', 'g', 'litre', 'ml', 'box', 'pack', 'dozen', 'hour', 'service'];
const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const LOW_MARGIN = 30;   // below this a dish's margin is shown as a warning, as in the recipe editor

const emptyForm = {
  name: '', kind: 'DISH', lead_time_days: '1', modifier_group_ids: [], category_id: '', sku: '', barcode: '', unit: 'pc',
  selling_price: '', purchase_price: '', tax_rate: '0', hsn_sac: '', description: '', food_type: '',
  track_inventory: true, opening_stock: '0', min_stock: '0'
};

/* A photo is uploaded the moment it is picked, against a product that already exists (POST /products/:id/image). */
const ImageUploader = ({ product, onUploaded, large = false }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError('');
    try {
      const body = new FormData();
      body.append('image', file);
      onUploaded(await api(`/products/${product.product_id}/image`, { method: 'POST', body }));
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); e.target.value = ''; }
  };
  return (
    <div>
      <label className={`group relative block cursor-pointer overflow-hidden rounded-(--radius-card) border border-line bg-surface-2 ${large ? 'h-40 w-full' : 'h-16 w-16'}`}>
        {product.image_url
          ? <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
          : <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-caption text-ink-500"><Camera aria-hidden="true" className="h-5 w-5" />{large && 'Add a photo'}</span>}
        <span className={`absolute inset-x-0 bottom-0 bg-ink-900/60 px-2 py-1 text-center text-caption font-medium text-white ${product.image_url ? 'opacity-0 group-hover:opacity-100' : 'hidden'}`}>{busy ? 'Uploading…' : 'Change photo'}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} disabled={busy} aria-label={product.image_url ? 'Change photo' : 'Add a photo'} />
      </label>
      {busy && !product.image_url && <p className="mt-1 text-caption text-ink-500">Uploading…</p>}
      {error && <p className="mt-1 text-caption text-danger">{error}</p>}
    </div>
  );
};

/* ── Add / edit ───────────────────────────────────────────────────────── */

const ProductForm = ({ initial, categories, groups, brands, isRestaurant, onSaved, onClose, onCreateCategory, onCreateBrand }) => {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newBrand, setNewBrand] = useState('');
  const [addingBrand, setAddingBrand] = useState(false);
  const isEdit = Boolean(initial.product_id);
  const sold = !isRestaurant || form.kind === 'DISH';
  const set = (field) => (e) => { const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setForm((f) => ({ ...f, [field]: value })); };

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    try {
      const created = await onCreateCategory(newCategory.trim());
      setForm((f) => ({ ...f, category_id: String(created.category_id) }));
      setNewCategory(''); setAddingCategory(false);
    } catch (caught) { setError(caught.message); }
  };
  const addBrand = async () => {
    if (!newBrand.trim()) return;
    try {
      const created = await onCreateBrand(newBrand.trim());
      setForm((f) => ({ ...f, brand_id: String(created.brand_id) }));
      setNewBrand(''); setAddingBrand(false);
    } catch (caught) { setError(caught.message); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const body = {
        name: form.name, category_id: form.category_id || null, sku: form.sku || null,
        barcode: form.barcode || null, unit: form.unit, selling_price: sold ? form.selling_price : (form.selling_price || 0),
        purchase_price: form.purchase_price || 0, tax_rate: form.tax_rate, hsn_sac: form.hsn_sac || null,
        description: form.description || null, food_type: sold ? (form.food_type || null) : null,
        track_inventory: form.track_inventory, min_stock: form.min_stock,
        ...(brands ? { brand_id: form.brand_id || null } : {}),
        ...(isRestaurant ? { kind: form.kind, lead_time_days: Number(form.lead_time_days) || 0 } : {})
      };
      const result = isEdit
        ? await api(`/products/${initial.product_id}`, { method: 'PATCH', body })
        : await api('/products', { method: 'POST', body: { ...body, opening_stock: form.opening_stock } });
      if (isRestaurant && form.kind === 'DISH') {
        const before = [...(initial.modifier_group_ids || [])].sort((a, b) => a - b).join(',');
        const after = [...form.modifier_group_ids].sort((a, b) => a - b).join(',');
        if (before !== after) await api(`/products/${result.product_id}/modifier-groups`, { method: 'PUT', body: { group_ids: form.modifier_group_ids } });
      }
      onSaved(result, !isEdit);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const legend = 'text-caption font-semibold uppercase tracking-[0.12em] text-ink-500';
  const withGst = Number(form.selling_price || 0) * (1 + Number(form.tax_rate || 0) / 100);
  return (
    <Modal title={isEdit ? `Edit ${initial.name}` : 'Add a product'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-6">
        <Alert>{error}</Alert>
        <fieldset className="space-y-4">
          <legend className={legend}>What it is</legend>
          <div className={`grid gap-4 ${isRestaurant ? 'sm:grid-cols-[2fr_1fr]' : ''}`}>
            <Field id="name" label="Name"><Input id="name" value={form.name} onChange={set('name')} required autoFocus /></Field>
            {isRestaurant && (
              <Field id="kind" label="Type">
                <Select id="kind" value={form.kind} onChange={set('kind')}>
                  <option value="DISH">Something I sell</option>
                  <option value="INGREDIENT">An ingredient</option>
                  <option value="PACKAGING">Packaging</option>
                </Select>
              </Field>
            )}
          </div>
          {isRestaurant && form.kind !== 'DISH' && <p className="-mt-2 text-caption text-ink-500">{form.kind === 'INGREDIENT' ? 'Bought and stocked, used up by recipes, never sold on its own.' : 'Boxes, bags and cups: stocked like an ingredient.'}</p>}
          <Field id="category_id" label="Category">
            {addingCategory ? (
              <div className="flex gap-2">
                <Input aria-label="New category name" placeholder="e.g. Starters" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} autoFocus
                       onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } if (e.key === 'Escape') setAddingCategory(false); }} />
                <Button type="button" variant="secondary" onClick={addCategory}>Add</Button>
                <Button type="button" variant="ghost" onClick={() => setAddingCategory(false)}>Cancel</Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select id="category_id" value={form.category_id} onChange={set('category_id')} className="flex-1">
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
                </Select>
                <Button type="button" variant="secondary" onClick={() => setAddingCategory(true)}>New</Button>
              </div>
            )}
          </Field>
          {brands && (
            <Field id="brand_id" label="Brand">
              {addingBrand ? (
                <div className="flex gap-2">
                  <Input aria-label="New brand name" placeholder="e.g. Biryani Co." value={newBrand} onChange={(e) => setNewBrand(e.target.value)} autoFocus
                         onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBrand(); } if (e.key === 'Escape') setAddingBrand(false); }} />
                  <Button type="button" variant="secondary" onClick={addBrand}>Add</Button>
                  <Button type="button" variant="ghost" onClick={() => setAddingBrand(false)}>Cancel</Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Select id="brand_id" value={form.brand_id || ''} onChange={set('brand_id')} className="flex-1">
                    <option value="">No specific brand</option>
                    {brands.map((b) => <option key={b.brand_id} value={b.brand_id}>{b.name}</option>)}
                  </Select>
                  <Button type="button" variant="secondary" onClick={() => setAddingBrand(true)}>New</Button>
                </div>
              )}
            </Field>
          )}
          {sold && isRestaurant && (
            <div>
              <p className="text-small font-medium text-ink-700">Veg or non-veg</p>
              <div role="radiogroup" aria-label="Veg or non-veg" className="mt-2 flex flex-wrap gap-1.5">
                {FOOD_TYPES.map(([v, label]) => (
                  <button key={v || 'none'} type="button" role="radio" aria-checked={(form.food_type || '') === v} onClick={() => setForm((x) => ({ ...x, food_type: v }))}
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-small ${(form.food_type || '') === v ? 'border-brand-500 bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-500' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>
                    <FoodMark type={v} />{label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-caption text-ink-500">Shown as the green / red mark on the QR menu.</p>
            </div>
          )}
          {sold && <Field id="description" label="Description (optional)" hint="Shown on the QR menu customers order from."><Textarea id="description" value={form.description || ''} onChange={set('description')} rows={2} /></Field>}
        </fieldset>

        <fieldset className="space-y-4">
          <legend className={legend}>Price and GST</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            {sold && <Field id="selling_price" label="Selling price (₹)" hint="Before GST"><Input id="selling_price" type="number" min="0" step="0.01" value={form.selling_price} onChange={set('selling_price')} required /></Field>}
            <Field id="purchase_price" label={sold ? 'Cost price (₹)' : 'What you pay (₹)'} hint={sold && isRestaurant ? 'For dishes with a recipe, the recipe sets the cost' : `Per ${form.unit}, used for stock value`}>
              <Input id="purchase_price" type="number" min="0" step="0.01" value={form.purchase_price} onChange={set('purchase_price')} />
            </Field>
            <Field id="tax_rate" label="GST">
              <Select id="tax_rate" value={form.tax_rate} onChange={set('tax_rate')}>{[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</Select>
            </Field>
          </div>
          {sold && Number(form.selling_price) > 0 && Number(form.tax_rate) > 0 && <p className="tabular -mt-2 text-caption text-ink-500">{formatCurrency(Number(form.selling_price))} + {form.tax_rate}% GST = {formatCurrency(withGst)} on the bill.</p>}
          <div className="grid gap-4 sm:grid-cols-4">
            <Field id="unit" label="Sold / counted in"><Select id="unit" value={form.unit} onChange={set('unit')}>{[...new Set([...UNITS, form.unit])].map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
            <Field id="hsn_sac" label="HSN / SAC"><Input id="hsn_sac" value={form.hsn_sac || ''} onChange={set('hsn_sac')} /></Field>
            <Field id="sku" label="SKU"><Input id="sku" value={form.sku || ''} onChange={set('sku')} /></Field>
            <Field id="barcode" label="Barcode"><Input id="barcode" value={form.barcode || ''} onChange={set('barcode')} /></Field>
          </div>
        </fieldset>

        {isRestaurant && form.kind === 'DISH' && groups.length > 0 && (
          <fieldset>
            <legend className={legend}>Options offered</legend>
            <p className="mt-1 text-caption text-ink-500">Sizes and add-ons the customer picks. <Link to="/app/modifiers" className="font-medium text-brand-700">Manage options</Link></p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {groups.map((g) => {
                const on = form.modifier_group_ids.includes(g.group_id);
                return (
                  <button key={g.group_id} type="button" aria-pressed={on}
                          onClick={() => setForm((f) => ({ ...f, modifier_group_ids: on ? f.modifier_group_ids.filter((x) => x !== g.group_id) : [...f.modifier_group_ids, g.group_id] }))}
                          className={`rounded-lg border px-2.5 py-1.5 text-small ${on ? 'border-brand-500 bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-500' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>{g.name}</button>
                );
              })}
            </div>
          </fieldset>
        )}

        <fieldset className="space-y-3">
          <legend className={legend}>Stock</legend>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={form.track_inventory} onChange={set('track_inventory')} className="mt-1 h-4 w-4 accent-[var(--color-brand-500)]" />
            <span><span className="block text-small font-medium text-ink-900">Count stock for this</span><span className="block text-caption text-ink-500">Leave off for services, or dishes made to order from ingredients (their recipe uses the ingredients' stock).</span></span>
          </label>
          {form.track_inventory && (
            <div className="grid gap-4 sm:grid-cols-3">
              {!isEdit && <Field id="opening_stock" label={`In stock now (${form.unit})`}><Input id="opening_stock" type="number" min="0" step="0.001" value={form.opening_stock} onChange={set('opening_stock')} /></Field>}
              <Field id="min_stock" label="Warn me below"><Input id="min_stock" type="number" min="0" step="0.001" value={form.min_stock} onChange={set('min_stock')} /></Field>
              {isRestaurant && <Field id="lead_time_days" label="Days to deliver" hint="For the stock forecast"><Input id="lead_time_days" type="number" min="0" max="30" step="1" value={form.lead_time_days} onChange={set('lead_time_days')} /></Field>}
            </div>
          )}
        </fieldset>

        <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
          <p className="text-caption text-ink-500">{isEdit ? '' : 'Add a photo once it is saved.'}</p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add product'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

/* ── Editors (outlet prices, recipe, combo) ───────────────────────────── */

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
    <Modal title={`${dish.name} at each outlet`} onClose={onClose} wide>
      <Alert>{error}</Alert>
      {!rows ? <div className="h-32 animate-pulse rounded-lg bg-surface-3" /> : (
        <div className="space-y-3">
          <p className="text-small text-ink-500">Shared price <strong className="tabular text-ink-900">{formatCurrency(shared)}</strong>. Leave an outlet blank to charge that.</p>
          {rows.map((r) => (
            <div key={r.branch_id} className="grid items-center gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_9rem_auto]">
              <span className="font-medium text-ink-900">{r.name}</span>
              <Input type="number" min="0" step="0.01" placeholder={String(shared)} value={r.price} onChange={(e) => update(r.branch_id, { price: e.target.value })} aria-label={`Price at ${r.name}`} />
              <label className="flex items-center gap-2 text-small text-ink-700">
                <input type="checkbox" checked={r.is_available} onChange={(e) => update(r.branch_id, { is_available: e.target.checked })} className="h-4 w-4 accent-[var(--color-brand-500)]" /> Sold here
              </label>
            </div>
          ))}
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

/* A dish's recipe: what one portion consumes, so a sale takes ingredient stock
   out and the dish shows its real cost. Cost here follows the ingredients'
   purchase prices as you type; the server recomputes it on save. */
const RecipeEditor = ({ dish, onClose }) => {
  const dialog = useDialog();
  const toast = useToast();
  const { outlets } = useAuth();
  const [scope, setScope] = useState('default');          // 'default' or an outlet id
  const [ownRecipe, setOwnRecipe] = useState(false);       // the chosen outlet has its own recipe (not just the default)
  const [ingredients, setIngredients] = useState(null);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    Promise.all([api('/products?kind=INGREDIENT'), api(`/products/${dish.product_id}/recipe${scope === 'default' ? '' : `?branch_id=${scope}`}`)])
      .then(([catalogue, recipe]) => {
        setIngredients(catalogue); setOwnRecipe(Boolean(recipe.outlet_specific));
        setRows(recipe.ingredients.map((i) => ({ ingredient_id: String(i.ingredient_id), quantity: String(i.quantity), wastage_pct: String(i.wastage_pct) })));
      })
      .catch((e) => setError(e.message));
  }, [dish.product_id, scope]);

  const price = (id) => ingredients?.find((p) => String(p.product_id) === String(id))?.purchase_price || 0;
  const cost = (rows || []).reduce((sum, r) => sum + (Number(r.quantity) || 0) * (1 + (Number(r.wastage_pct) || 0) / 100) * price(r.ingredient_id), 0);
  const margin = dish.selling_price > 0 ? ((dish.selling_price - cost) / dish.selling_price) * 100 : null;
  const setRow = (i, field, value) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api(`/products/${dish.product_id}/recipe`, {
        method: 'PUT',
        body: { branch_id: scope === 'default' ? null : Number(scope), ingredients: rows.filter((r) => r.ingredient_id).map((r) => ({ ingredient_id: Number(r.ingredient_id), quantity: Number(r.quantity), wastage_pct: Number(r.wastage_pct) || 0 })) }
      });
      toast.success('Recipe saved');
      onClose();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  const removeOutletRecipe = async () => {
    if (!(await dialog.confirm({ title: "Remove this outlet's recipe?", body: 'It will use the default recipe again.', confirmLabel: 'Remove', danger: true }))) return;
    setBusy(true); setError('');
    try { await api(`/products/${dish.product_id}/recipe?branch_id=${scope}`, { method: 'DELETE' }); toast.success('Back to the default recipe'); onClose(); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Recipe for ${dish.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        {outlets.length > 1 && (
          <Field id="recipe-scope" label="Recipe for" hint={scope === 'default' ? 'Used by every outlet that has no recipe of its own.' : ownRecipe ? 'This outlet has its own recipe.' : 'This outlet uses the default recipe. Saving here gives it one of its own.'}>
            <Select id="recipe-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="default">All outlets (default)</option>
              {outlets.map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name} only</option>)}
            </Select>
          </Field>
        )}
        {!rows && !error && <div className="h-32 animate-pulse rounded-lg bg-surface-3" />}
        {ingredients?.length === 0 && <p className="rounded-lg bg-surface-2 p-3 text-small text-ink-700">No ingredients yet. Add products of the type <strong>Ingredient</strong> (with what you pay per unit), then build the recipe here.</p>}
        {rows && ingredients?.length > 0 && (
          <>
            <p className="text-caption text-ink-500">Quantities are for <strong>one portion</strong>, in each ingredient's own unit. Waste % covers peeling, trimming and spills.</p>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_6rem_6rem_5rem_auto]">
                  <Select aria-label="Ingredient" value={r.ingredient_id} onChange={(e) => setRow(i, 'ingredient_id', e.target.value)}>
                    <option value="">Choose ingredient…</option>
                    {ingredients.map((p) => <option key={p.product_id} value={p.product_id}>{p.name} ({p.unit})</option>)}
                  </Select>
                  <Input aria-label="Quantity" type="number" min="0" step="0.001" placeholder="Qty" value={r.quantity} onChange={(e) => setRow(i, 'quantity', e.target.value)} />
                  <Input aria-label="Wastage percent" type="number" min="0" max="99" step="0.5" placeholder="Waste %" value={r.wastage_pct} onChange={(e) => setRow(i, 'wastage_pct', e.target.value)} />
                  <span className="tabular self-center text-right text-caption text-ink-500">{formatCurrency((Number(r.quantity) || 0) * (1 + (Number(r.wastage_pct) || 0) / 100) * price(r.ingredient_id))}</span>
                  <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-caption font-medium text-ink-500 hover:text-danger">Remove</button>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows((rs) => [...rs, { ingredient_id: '', quantity: '', wastage_pct: '0' }])}><Plus aria-hidden="true" className="h-4 w-4" />Add ingredient</Button>
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="tabular text-small text-ink-700">
            Costs <strong className="text-ink-900">{formatCurrency(cost)}</strong> a portion
            {margin != null && <> · margin <strong className={margin < LOW_MARGIN ? 'text-warning' : 'text-success'}>{margin.toFixed(1)}%</strong> of {formatCurrency(dish.selling_price)}</>}
          </p>
          <div className="flex gap-2">
            {scope !== 'default' && ownRecipe && <Button type="button" variant="ghost" disabled={busy} onClick={removeOutletRecipe}>Use the default</Button>}
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="button" disabled={busy || !rows} onClick={save}>{busy ? 'Saving…' : 'Save recipe'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

/* A combo is a menu item made of other items: one price and one tax rate on the bill, but selling it
   uses up its parts' stock and recipes, so cost and stock stay honest. */
const ComboEditor = ({ dish, onClose }) => {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api('/products?kind=DISH'), api(`/products/${dish.product_id}/combo`)])
      .then(([dishes, combo]) => {
        setItems(dishes.filter((p) => p.product_id !== dish.product_id && !p.is_combo));
        setRows(combo.components.length ? combo.components.map((c) => ({ product_id: String(c.product_id), quantity: String(c.quantity) })) : [{ product_id: '', quantity: '1' }, { product_id: '', quantity: '1' }]);
      })
      .catch((e) => setError(e.message));
  }, [dish.product_id]);

  const price = (id) => items?.find((p) => String(p.product_id) === String(id))?.selling_price || 0;
  const separate = (rows || []).reduce((sum, r) => sum + (Number(r.quantity) || 0) * price(r.product_id), 0);
  const saving = separate - dish.selling_price;
  const setRow = (i, field, value) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api(`/products/${dish.product_id}/combo`, { method: 'PUT', body: { components: rows.filter((r) => r.product_id).map((r) => ({ product_id: Number(r.product_id), quantity: Number(r.quantity) || 1 })) } });
      toast.success('Combo saved');
      onClose();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await api(`/products/${dish.product_id}/combo`, { method: 'DELETE' }); toast.success('Back to a single item'); onClose(); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`${dish.name} as a combo`} onClose={onClose} wide>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        {!rows && !error && <div className="h-32 animate-pulse rounded-lg bg-surface-3" />}
        {rows && (
          <>
            <p className="text-caption text-ink-500">Choose what is in it. It sells at its own price ({formatCurrency(dish.selling_price)}); each part's stock and recipe is used up when it sells, and the kitchen sees what is inside.</p>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_6rem_6rem_auto]">
                  <Select aria-label="Item" value={r.product_id} onChange={(e) => setRow(i, 'product_id', e.target.value)}>
                    <option value="">Choose item…</option>
                    {items?.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
                  </Select>
                  <Input aria-label="Quantity" type="number" min="0" step="0.5" value={r.quantity} onChange={(e) => setRow(i, 'quantity', e.target.value)} />
                  <span className="tabular self-center text-right text-caption text-ink-500">{formatCurrency((Number(r.quantity) || 0) * price(r.product_id))}</span>
                  <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-caption font-medium text-ink-500 hover:text-danger">Remove</button>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows((rs) => [...rs, { product_id: '', quantity: '1' }])}><Plus aria-hidden="true" className="h-4 w-4" />Add item</Button>
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="tabular text-small text-ink-700">
            Bought separately <strong className="text-ink-900">{formatCurrency(separate)}</strong>
            {separate > 0 && <> · customer saves <strong className={saving > 0 ? 'text-success' : 'text-warning'}>{formatCurrency(Math.max(saving, 0))}</strong>{saving <= 0 && ' (the combo costs more than the parts)'}</>}
          </p>
          <div className="flex gap-2">
            {dish.is_combo && <Button type="button" variant="ghost" disabled={busy} onClick={remove}>Not a combo</Button>}
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="button" disabled={busy || !rows} onClick={save}>{busy ? 'Saving…' : 'Save combo'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

/* ── One product ──────────────────────────────────────────────────────── */

const Detail = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-2 text-small"><dt className="text-ink-500">{label}</dt><dd className="text-right text-ink-900">{children}</dd></div>
);

const ProductPanel = ({ product: p, refreshKey, groups, isRestaurant, multiOutlet, outletId, onEdit, onAction, onArchive, onRestore, onPhoto, onBack }) => {
  const [recipe, setRecipe] = useState(null);
  const [combo, setCombo] = useState(null);
  const dish = p.kind === 'DISH';
  useEffect(() => {
    setRecipe(null); setCombo(null);
    if (!dish || !isRestaurant) return;
    // the recipe this outlet uses (its own, or the default), the same one the list is costed from
    const at = multiOutlet && outletId && outletId !== 'all' ? `?branch_id=${outletId}` : '';
    api(`/products/${p.product_id}/recipe${at}`).then(setRecipe).catch(() => setRecipe(null));
    if (p.is_combo) api(`/products/${p.product_id}/combo`).then(setCombo).catch(() => setCombo(null));
  }, [p.product_id, p.is_combo, refreshKey, outletId]); // eslint-disable-line react-hooks/exhaustive-deps

  const withGst = p.selling_price * (1 + p.tax_rate / 100);
  const optionNames = groups.filter((g) => p.modifier_group_ids.includes(g.group_id)).map((g) => g.name);
  const archived = p.status !== 'ACTIVE';
  const lowMargin = p.margin_pct != null && p.margin_pct < LOW_MARGIN;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-4 sm:p-6">
        <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-900 xl:hidden"><ArrowLeft className="h-4 w-4" />All products</button>
        {dish && !archived && <div className="mb-4"><ImageUploader product={p} onUploaded={onPhoto} large /></div>}
        <p className="text-caption font-medium text-ink-500">{[isRestaurant && KIND_LABELS[p.kind], p.category_name].filter(Boolean).join(' · ') || 'No category'}</p>
        <h2 className="mt-0.5 flex items-center gap-2 text-title font-semibold text-ink-900"><FoodMark type={p.food_type} size={16} />{p.name}</h2>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {archived && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-caption font-semibold text-ink-500">Archived</span>}
          {p.is_combo && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-caption font-semibold text-brand-700">Combo</span>}
          {p.is_available === false && <span className="rounded bg-warning/10 px-1.5 py-0.5 text-caption font-semibold text-warning">Not sold at this outlet</span>}
          {p.low_stock && <span className="rounded bg-warning/10 px-1.5 py-0.5 text-caption font-semibold text-warning">Low stock</span>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {archived ? <Button size="sm" onClick={onRestore}>Bring back</Button> : <>
            <Button size="sm" onClick={onEdit}>Edit details</Button>
            {dish && isRestaurant && <Button size="sm" variant="secondary" onClick={() => onAction('recipe')}><ChefHat aria-hidden="true" className="h-4 w-4" />Recipe</Button>}
            {dish && isRestaurant && <Button size="sm" variant="secondary" onClick={() => onAction('combo')}><Layers aria-hidden="true" className="h-4 w-4" />{p.is_combo ? 'Combo parts' : 'Make a combo'}</Button>}
            {dish && multiOutlet && <Button size="sm" variant="secondary" onClick={() => onAction('outlets')}>Outlet prices</Button>}
          </>}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        {dish && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-(--radius-card) border border-line bg-surface p-3.5">
              <p className="text-caption text-ink-500">Price{p.price_overridden ? ' at this outlet' : ''}</p>
              <p className="tabular mt-1 text-title font-semibold text-ink-900">{formatCurrency(p.selling_price)}</p>
              <p className="tabular mt-0.5 text-caption text-ink-500">{p.tax_rate > 0 ? `${formatCurrency(withGst)} with ${p.tax_rate}% GST` : 'no GST'}{p.price_overridden && ` · shared ${formatCurrency(p.shared_price)}`}</p>
            </div>
            <div className="rounded-(--radius-card) border border-line bg-surface p-3.5">
              <p className="text-caption text-ink-500">Costs you</p>
              {p.cost_source ? <>
                <p className="tabular mt-1 text-title font-semibold text-ink-900">{formatCurrency(p.unit_cost)}</p>
                <p className="tabular mt-0.5 text-caption"><span className={`font-semibold ${lowMargin ? 'text-warning' : 'text-success'}`}>{p.margin_pct}% margin</span> <span className="text-ink-500">· {p.cost_source === 'recipe' ? 'from the recipe' : 'what you pay'}</span></p>
              </> : <>
                <p className="mt-1 text-title font-semibold text-ink-400">Not known</p>
                <p className="mt-0.5 text-caption text-ink-500">{isRestaurant ? 'Add a recipe or a cost price' : 'Add a cost price'} to see the margin</p>
              </>}
            </div>
          </div>
        )}
        {lowMargin && <p className="-mt-3 rounded-lg bg-warning/10 px-3 py-2 text-small text-ink-700">Under {LOW_MARGIN}% is thin: {formatCurrency(p.selling_price - p.unit_cost)} is left of each sale before rent, staff and bills.</p>}

        {recipe?.ingredients.length > 0 && (
          <section aria-label="Recipe">
            <div className="mb-2 flex items-baseline justify-between"><h3 className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">One portion uses</h3><button type="button" onClick={() => onAction('recipe')} className="text-caption font-medium text-brand-700">Edit</button></div>
            <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface text-small">
              {recipe.ingredients.map((i) => (
                <li key={i.ingredient_id} className="flex justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0"><span className="block truncate text-ink-900">{i.name}</span><span className="tabular block text-caption text-ink-500">{qty(i.quantity)} {i.unit}{i.wastage_pct > 0 && ` + ${i.wastage_pct}% waste`}</span></span>
                  <span className="tabular shrink-0 text-ink-700">{formatCurrency(i.cost)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {dish && isRestaurant && !archived && !p.cost_source && recipe && recipe.ingredients.length === 0 && !p.is_combo && (
          <button type="button" onClick={() => onAction('recipe')} className="flex w-full items-start gap-3 rounded-(--radius-card) border border-dashed border-line-strong p-4 text-left hover:border-ink-400">
            <ChefHat aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-ink-500" />
            <span><span className="block text-small font-medium text-ink-900">Add its recipe</span><span className="block text-caption text-ink-500">Then each sale takes its ingredients out of stock, and you see what one really costs.</span></span>
          </button>
        )}

        {combo?.components.length > 0 && (
          <section aria-label="Combo parts">
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">In this combo</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface text-small">
              {combo.components.map((c) => <li key={c.product_id} className="flex justify-between px-4 py-2.5"><span className="text-ink-900">{qty(c.quantity)} × {c.name}</span><span className="tabular text-ink-500">{formatCurrency(c.price * c.quantity)}</span></li>)}
            </ul>
          </section>
        )}

        <section aria-label="Details">
          <dl className="divide-y divide-line rounded-(--radius-card) border border-line bg-surface px-4">
            {!dish && <Detail label="What you pay">{formatCurrency(p.purchase_price)} a {p.unit}</Detail>}
            {p.track_inventory && (
              <Detail label="In stock">
                <Link to={`/app/inventory?item=${p.product_id}`} className={`font-medium hover:text-brand-700 ${p.low_stock ? 'text-warning' : ''}`}>{qty(p.current_stock)} {p.unit}</Link>
                {p.min_stock > 0 && <span className="text-ink-500"> · warns below {qty(p.min_stock)}</span>}
              </Detail>
            )}
            {!p.track_inventory && <Detail label="Stock">Not counted</Detail>}
            {dish && isRestaurant && <Detail label="Options">{optionNames.length ? optionNames.join(', ') : <span className="text-ink-500">None</span>}</Detail>}
            <Detail label="GST">{p.tax_rate}%{p.hsn_sac && <span className="text-ink-500"> · HSN {p.hsn_sac}</span>}</Detail>
            <Detail label={dish ? 'Sold in' : 'Counted in'}>{p.unit}</Detail>
            {(p.sku || p.barcode) && <Detail label="Codes">{[p.sku && `SKU ${p.sku}`, p.barcode && `barcode ${p.barcode}`].filter(Boolean).join(' · ')}</Detail>}
          </dl>
        </section>

        {p.description && <section aria-label="Description"><h3 className="mb-1 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">On the QR menu</h3><p className="text-small text-ink-700">{p.description}</p></section>}

        {!archived && <button type="button" onClick={onArchive} className="text-small font-medium text-ink-500 hover:text-danger">Archive {p.name}</button>}
      </div>
    </div>
  );
};

/* ── The screen ───────────────────────────────────────────────────────── */

const SORTS = {
  name: ['Name A–Z', (a, b) => a.name.localeCompare(b.name)],
  price: ['Price, high first', (a, b) => b.selling_price - a.selling_price],
  margin: ['Lowest margin', (a, b) => (a.margin_pct ?? 999) - (b.margin_pct ?? 999)]
};

const ProductRow = ({ p, active, isRestaurant, onOpen }) => {
  const dish = p.kind === 'DISH';
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={active ? 'true' : undefined}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-(--duration-fast) ${active ? 'bg-brand-50' : 'hover:bg-surface-2'}`}>
        {p.image_url ? <img src={p.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-lg bg-surface-3" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5">
            <FoodMark type={p.food_type} size={12} />
            <span className={`truncate text-small font-semibold ${p.status === 'ACTIVE' ? 'text-ink-900' : 'text-ink-500'}`}>{p.name}</span>
            {p.is_combo && <span className="rounded bg-brand-50 px-1 text-caption font-semibold text-brand-700">Combo</span>}
            {p.is_available === false && <span className="rounded bg-warning/10 px-1 text-caption font-semibold text-warning">Off here</span>}
          </span>
          <span className="block truncate text-caption text-ink-500">
            {[p.category_name || 'No category', p.sku, p.track_inventory && <span key="s" className={p.low_stock ? 'font-medium text-warning' : ''}>{qty(p.current_stock)} {p.unit} left</span>].filter(Boolean).reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block text-small font-semibold text-ink-900">{dish ? formatCurrency(p.selling_price) : `${formatCurrency(p.purchase_price)}/${p.unit}`}</span>
          {dish && (p.margin_pct != null
            ? <span className={`tabular block text-caption font-medium ${p.margin_pct < LOW_MARGIN ? 'text-warning' : 'text-ink-500'}`}>{p.margin_pct}% margin</span>
            : isRestaurant && <span className="block text-caption text-ink-400">cost not known</span>)}
        </span>
      </button>
    </li>
  );
};

const ProductsPage = () => {
  const dialog = useDialog();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('p') ? Number(params.get('p')) : null;
  const { business, outlets, outletId, hasFeature } = useAuth();
  const isRestaurant = RESTAURANT_TYPES.includes(business?.business_type);
  const multiOutlet = outlets.length > 1;
  const multiBrand = hasFeature('multi_brand');
  const [products, setProducts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState(null);
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(isRestaurant ? 'DISH' : 'all');
  const [category, setCategory] = useState(null);
  const [noCost, setNoCost] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [editing, setEditing] = useState(null);   // {} = new, a product = edit
  const [action, setAction] = useState(null);     // recipe | combo | outlets | import
  const [refreshKey, setRefreshKey] = useState(0);

  // ponytail: loads the whole catalogue (active and archived) and filters here; page it on the server for very large shops
  const load = async () => {
    try {
      const [list, cats, grps, brs] = await Promise.all([
        api('/products?status=all'), api('/categories'), isRestaurant ? api('/modifier-groups') : Promise.resolve([]),
        multiBrand ? api('/brands?status=all') : Promise.resolve(null)
      ]);
      setProducts(list); setCategories(cats); setGroups(grps); setBrands(brs); setError('');
    } catch (caught) { setError(caught.message); }
  };
  useEffect(() => { load(); }, [outletId, isRestaurant, multiBrand]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { setRefreshKey((k) => k + 1); load(); };
  const open = (id) => setParams(id ? { p: String(id) } : {});

  const all = products || [];
  const active = all.filter((p) => p.status === 'ACTIVE');
  const tabs = isRestaurant
    ? [['DISH', 'Menu', active.filter((p) => p.kind === 'DISH').length], ['INGREDIENT', 'Ingredients', active.filter((p) => p.kind === 'INGREDIENT').length], ['PACKAGING', 'Packaging', active.filter((p) => p.kind === 'PACKAGING').length], ['archived', 'Archived', all.length - active.length]]
    : [['all', 'All', active.length], ['archived', 'Archived', all.length - active.length]];
  const inTab = tab === 'archived' ? all.filter((p) => p.status !== 'ACTIVE') : active.filter((p) => tab === 'all' || p.kind === tab);
  const cats = useMemo(() => {
    const map = new Map();
    for (const p of inTab) { const k = p.category_name || 'No category'; map.set(k, (map.get(k) || 0) + 1); }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [inTab]);
  const q = search.trim().toLowerCase();
  const shown = inTab
    .filter((p) => (!category || (p.category_name || 'No category') === category) && (!noCost || (p.kind === 'DISH' && !p.cost_source))
      && (!q || p.name.toLowerCase().includes(q) || String(p.sku || '').toLowerCase().includes(q) || String(p.barcode || '') === q))
    .sort(SORTS[sort][1]);
  const selected = all.find((p) => p.product_id === selectedId);
  const dishes = active.filter((p) => p.kind === 'DISH');
  const missingCost = dishes.filter((p) => !p.cost_source).length;
  const thin = dishes.filter((p) => p.margin_pct != null && p.margin_pct < LOW_MARGIN).length;

  const createCategory = async (name) => {
    const created = await api('/categories', { method: 'POST', body: { name } });
    setCategories((c) => [...c, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  };
  const createBrand = async (name) => {
    const created = await api('/brands', { method: 'POST', body: { name } });
    setBrands((b) => [...(b || []), created].sort((a, c) => a.name.localeCompare(c.name)));
    return created;
  };
  const archive = async (p) => {
    if (!(await dialog.confirm({ title: `Archive ${p.name}?`, body: 'It stops showing on billing and the QR menu. Its past sales stay, and you can bring it back.', confirmLabel: 'Archive' }))) return;
    try { await api(`/products/${p.product_id}/archive`, { method: 'POST' }); toast.success(`${p.name} archived`); changed(); }
    catch (caught) { setError(caught.message); }
  };
  const restore = async (p) => {
    try { await api(`/products/${p.product_id}`, { method: 'PATCH', body: { status: 'ACTIVE' } }); toast.success(`${p.name} is back`); changed(); }
    catch (caught) { setError(caught.message); }
  };
  const formInitial = (p) => ({
    ...p, food_type: p.food_type || '', category_id: p.category_id ? String(p.category_id) : '', brand_id: p.brand_id ? String(p.brand_id) : '', selling_price: String(p.shared_price ?? p.selling_price), purchase_price: String(p.purchase_price),
    tax_rate: String(p.tax_rate), min_stock: String(p.min_stock), lead_time_days: String(p.lead_time_days ?? 1), sku: p.sku || '', barcode: p.barcode || '', hsn_sac: p.hsn_sac || '', description: p.description || ''
  });

  return (
    <div className="-m-4 grid grid-cols-1 sm:-m-6 lg:-m-8 xl:h-[calc(100vh-3.5rem)] xl:grid-cols-[minmax(0,1fr)_440px]">
      <section aria-label="Product list" className={`min-w-0 p-4 sm:p-6 lg:p-8 xl:block xl:overflow-y-auto ${selectedId ? 'hidden' : 'block'}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-h3 font-semibold text-ink-900">{isRestaurant ? 'Menu and products' : 'Products'}</h1>
            <p className="tabular mt-1 text-small text-ink-500">
              {products ? <>{active.length} active{isRestaurant && ` · ${dishes.length} on the menu`}{thin > 0 && <> · <span className="font-medium text-warning">{thin} with a thin margin</span></>}</> : 'What you sell and what you stock.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isRestaurant && <Button variant="secondary" onClick={() => setAction('import')}><Sparkles aria-hidden="true" className="h-4 w-4" />Menu from a photo</Button>}
            <Button onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />Add product</Button>
          </div>
        </div>

        <div role="tablist" aria-label="Type" className="mt-5 flex gap-1 overflow-x-auto border-b border-line">
          {tabs.map(([k, label, n]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setCategory(null); setNoCost(false); }}
                    className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-small font-medium ${tab === k ? 'border-brand-500 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>
              {label} <span className={`tabular ml-0.5 ${tab === k ? 'text-brand-700' : 'text-ink-400'}`}>{n}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <span className="sr-only">Search products</span>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, SKU or barcode" className="!pl-9" />
          </label>
          <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} className="!w-auto">
            {Object.entries(SORTS).filter(([k]) => k !== 'margin' || tab === 'DISH' || tab === 'all').map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </Select>
        </div>
        {cats.length > 1 && (
          <div role="group" aria-label="Category" className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            <button type="button" onClick={() => setCategory(null)} aria-pressed={!category} className={`shrink-0 rounded-lg border px-3 py-1.5 text-small font-medium ${!category ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>All <span className={`tabular ml-1 ${!category ? 'text-white/70' : 'text-ink-400'}`}>{inTab.length}</span></button>
            {cats.map(([name, n]) => (
              <button key={name} type="button" onClick={() => setCategory(category === name ? null : name)} aria-pressed={category === name}
                      className={`shrink-0 rounded-lg border px-3 py-1.5 text-small font-medium ${category === name ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>
                {name} <span className={`tabular ml-1 ${category === name ? 'text-white/70' : 'text-ink-400'}`}>{n}</span>
              </button>
            ))}
          </div>
        )}
        {isRestaurant && tab === 'DISH' && missingCost > 0 && (
          <button type="button" onClick={() => setNoCost((v) => !v)} aria-pressed={noCost}
                  className={`mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-small ${noCost ? 'bg-brand-50 text-brand-700' : 'bg-surface-2 text-ink-700 hover:bg-surface-3'}`}>
            <ChefHat aria-hidden="true" className="h-4 w-4 shrink-0" />
            {noCost ? 'Showing only items whose cost is not known. Tap to show all.' : `${missingCost} menu item${missingCost === 1 ? ' has' : 's have'} no recipe or cost, so ${missingCost === 1 ? 'its' : 'their'} margin is not known. Show ${missingCost === 1 ? 'it' : 'them'}.`}
          </button>
        )}

        <div className="mt-4">
          <Alert>{error}</Alert>
          {!products && !error && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-3" />)}</div>}
          {products && active.length === 0 && tab !== 'archived' && (
            <div className="rounded-(--radius-card) border border-dashed border-line-strong p-10 text-center">
              <p className="text-body font-medium text-ink-900">{isRestaurant ? 'Your menu is empty' : 'No products yet'}</p>
              <p className="mt-1 text-small text-ink-500">{isRestaurant ? 'Have a printed menu? Take a photo of each page: FlowXP reads the dishes and prices, you check them.' : 'Add what you sell, with its price and GST.'}</p>
              <div className="mt-4 flex justify-center gap-2">
                {isRestaurant && <Button onClick={() => setAction('import')}>Menu from a photo</Button>}
                <Button variant={isRestaurant ? 'secondary' : 'primary'} onClick={() => setEditing({})}>Add one by hand</Button>
              </div>
            </div>
          )}
          {products && inTab.length > 0 && shown.length === 0 && <p className="rounded-(--radius-card) border border-dashed border-line-strong p-8 text-center text-small text-ink-500">Nothing matches.</p>}
          {products && tab === 'archived' && inTab.length === 0 && <p className="rounded-(--radius-card) border border-dashed border-line-strong p-8 text-center text-small text-ink-500">Nothing archived.</p>}
          {shown.length > 0 && (
            <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
              {shown.map((p) => <ProductRow key={p.product_id} p={p} active={p.product_id === selectedId} isRestaurant={isRestaurant} onOpen={() => open(p.product_id)} />)}
            </ul>
          )}
        </div>
      </section>

      <section aria-label="Selected product" className={`min-h-0 min-w-0 flex-col border-line bg-surface xl:flex xl:border-l ${selectedId ? 'flex min-h-[calc(100vh-3.5rem)] xl:min-h-0' : 'hidden'}`}>
        {selected ? (
          <ProductPanel key={selected.product_id} product={selected} refreshKey={refreshKey} groups={groups} isRestaurant={isRestaurant} multiOutlet={multiOutlet} outletId={outletId}
                        onEdit={() => setEditing(selected)} onAction={setAction} onArchive={() => archive(selected)} onRestore={() => restore(selected)}
                        onPhoto={() => { toast.success('Photo saved'); load(); }} onBack={() => open(null)} />
        ) : selectedId && products ? (
          <div className="p-8 text-center text-small text-ink-500">That product isn't here. <button type="button" onClick={() => open(null)} className="font-medium text-brand-700">Back to all</button></div>
        ) : (
          <EmptyState compact icon={Package} className="h-full justify-center" title="Pick a product" body="See its price, what it costs you, its recipe and stock." />
        )}
      </section>

      {editing && (
        <ProductForm initial={editing.product_id ? formInitial(editing) : { ...emptyForm, brand_id: '', kind: isRestaurant && ['INGREDIENT', 'PACKAGING'].includes(tab) ? tab : 'DISH' }}
                     categories={categories} groups={groups} brands={brands} isRestaurant={isRestaurant} onCreateCategory={createCategory} onCreateBrand={createBrand} onClose={() => setEditing(null)}
                     onSaved={(p, isNew) => { setEditing(null); toast.success(isNew ? `${p.name} added` : 'Saved'); changed(); if (isNew) open(p.product_id); }} />
      )}
      {action === 'import' && <MenuImportModal onClose={() => setAction(null)} onDone={changed} />}
      {action === 'outlets' && selected && <OutletPrices dish={selected} onClose={() => { setAction(null); changed(); }} />}
      {action === 'combo' && selected && <ComboEditor dish={selected} onClose={() => { setAction(null); changed(); }} />}
      {action === 'recipe' && selected && <RecipeEditor dish={selected} onClose={() => { setAction(null); changed(); }} />}
    </div>
  );
};

export default ProductsPage;
