/*
 * Services: what the salon sells by the hour — price, GST, how long it takes, who can do it, how much staff earn
 * on it, and which consumables it uses up (shampoo, colour, wax…). Consumables are ordinary stock items: when a
 * service is billed their stock comes down by the recipe (or by what the stylist says they actually used).
 *
 * Retail products and consumables themselves are added under Products / Inventory / Purchases as usual; the tabs
 * here only show them with the salon's own fields (brand, maximum stock, commission, points).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, FlaskConical, Pencil, Plus, RotateCcw, Scissors, Tags, Trash2 } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { qs, useDebounced, useLoad } from '../../lib/salon.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Textarea, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Chips, NumberField, Pager, SelectField, Tabs, Toggle, useAction } from './parts.jsx';

const money = (n) => formatCurrency(n);
const GENDERS = { ANY: 'Anyone', FEMALE: 'Women', MALE: 'Men', KIDS: 'Kids' };

/* ── categories ───────────────────────────────────────────────────────────── */

const CategoriesModal = ({ onClose, onChanged }) => {
  const dialog = useDialog();
  const toast = useToast();
  const { data, reload, loading, error } = useLoad('/salon/categories?scope=SERVICE');
  const [name, setName] = useState('');
  const [busy, run] = useAction();
  const add = async (e) => { e.preventDefault(); const out = await run(() => api('/salon/categories', { method: 'POST', body: { name, scope: 'SERVICE' } }), 'Category added'); if (out) { setName(''); reload(); onChanged(); } };
  const rename = async (c) => {
    const next = await dialog.prompt({ title: 'Rename category', label: 'Name', defaultValue: c.name, confirmLabel: 'Rename' });
    if (!next || next === c.name) return;
    try { await api(`/salon/categories/${c.category_id}`, { method: 'PUT', body: { name: next } }); reload(); onChanged(); } catch (e) { toast.error(e.message); }
  };
  const remove = async (c) => {
    if (!(await dialog.confirm({ title: `Delete ${c.name}?`, body: 'Only an empty category can be deleted.', confirmLabel: 'Delete', danger: true }))) return;
    try { await api(`/salon/categories/${c.category_id}`, { method: 'DELETE' }); reload(); onChanged(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal title="Service categories" onClose={onClose}>
      <form onSubmit={add} className="mb-4 flex gap-2"><div className="flex-1"><Input aria-label="New category" placeholder="e.g. Hair, Skin, Nails" value={name} onChange={(e) => setName(e.target.value)} required /></div><Button type="submit" loading={busy}>Add</Button></form>
      <ListState loading={loading} error={error} empty={!loading && data?.length === 0} emptyLabel="No categories yet." />
      <ul className="divide-y divide-line rounded-(--radius-card) border border-line">
        {(data || []).map((c) => (
          <li key={c.category_id} className="flex items-center gap-2 px-3.5 py-2.5 text-small">
            <span className="flex-1 font-medium text-ink-900">{c.name}</span><span className="text-caption text-ink-500">{c.items} service{c.items === 1 ? '' : 's'}</span>
            <button type="button" aria-label={`Rename ${c.name}`} onClick={() => rename(c)} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-ink-900"><Pencil className="h-4 w-4" /></button>
            <button type="button" aria-label={`Delete ${c.name}`} onClick={() => remove(c)} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
    </Modal>
  );
};

/* ── add / edit a service ─────────────────────────────────────────────────── */

const ServiceForm = ({ id, categories, onSaved, onClose }) => {
  const detail = useLoad(id ? `/salon/services/${id}` : null);
  const settings = useLoad('/salon/settings');
  const consumables = useLoad('/salon/products?type=CONSUMABLE&limit=200', { paged: true });
  const team = useLoad('/salon/staff?limit=200', { paged: true });
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, run] = useAction();

  useEffect(() => {
    if (form) return;
    if (id && !detail.data) return;
    if (!id && !settings.data) return;
    const d = detail.data;
    setForm(d ? {
      name: d.name, category_id: d.category_id || '', price: String(d.price), tax_rate: String(d.tax_rate), hsn_sac: d.hsn_sac || '', duration_min: String(d.duration_min), gender: d.gender || 'ANY', description: d.description || '',
      points_earnable: d.points_earnable, points_redeemable: d.points_redeemable, commission_type: d.commission_type || '', commission_value: d.commission_value == null ? '' : String(d.commission_value),
      consumables: d.consumable_items.map((c) => ({ ingredient_id: c.ingredient_id, quantity: String(c.quantity), wastage_pct: String(c.wastage_pct), is_variable: c.is_variable })), staff_ids: d.staff.map((s) => s.staff_id)
    } : {
      name: '', category_id: '', price: '', tax_rate: String(settings.data.settings.default_service_tax_rate), hsn_sac: settings.data.settings.default_service_sac || '', duration_min: '30', gender: 'ANY', description: '',
      points_earnable: true, points_redeemable: true, commission_type: '', commission_value: '', consumables: [], staff_ids: []
    });
  }, [id, detail.data, settings.data, form]);

  if (!form) return <Modal title={id ? 'Edit service' : 'New service'} onClose={onClose}><ListState loading={detail.loading || settings.loading} error={detail.error || settings.error} /></Modal>;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const stock = consumables.data || [];
  const unitOf = (cid) => stock.find((s) => s.product_id === cid)?.unit || '';
  const cost = form.consumables.reduce((s, c) => { const p = stock.find((x) => x.product_id === c.ingredient_id); return s + (p ? p.cost_price * (Number(c.quantity) || 0) * (1 + (Number(c.wastage_pct) || 0) / 100) : 0); }, 0);
  const price = Number(form.price) || 0;

  const submit = async (e) => {
    e.preventDefault(); setError('');
    const body = {
      name: form.name, category_id: form.category_id ? Number(form.category_id) : null, price: Number(form.price), tax_rate: Number(form.tax_rate), hsn_sac: form.hsn_sac || null,
      duration_min: Number(form.duration_min), gender: form.gender, description: form.description || null, points_earnable: form.points_earnable, points_redeemable: form.points_redeemable,
      commission_type: form.commission_type || null, commission_value: form.commission_type ? Number(form.commission_value) : null,
      consumables: form.consumables.filter((c) => c.ingredient_id).map((c) => ({ ingredient_id: Number(c.ingredient_id), quantity: Number(c.quantity), wastage_pct: Number(c.wastage_pct) || 0, is_variable: c.is_variable })),
      staff_ids: form.staff_ids
    };
    const saved = await run(() => api(id ? `/salon/services/${id}` : '/salon/services', { method: id ? 'PUT' : 'POST', body }).catch((c) => { setError(c.message); throw c; }), id ? 'Service saved' : 'Service added');
    if (saved) onSaved(saved);
  };

  return (
    <Modal title={id ? `Edit ${detail.data?.name}` : 'New service'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-6">
        <Alert>{error}</Alert>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <Field id="sv-name" label="Name"><Input id="sv-name" value={form.name} onChange={(e) => set('name')(e.target.value)} required autoFocus /></Field>
          <SelectField id="sv-cat" label="Category" value={form.category_id} onChange={set('category_id')}><option value="">No category</option>{categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</SelectField>
          <NumberField id="sv-price" label="Price" prefix="₹" value={form.price} onChange={set('price')} required hint={settings.data?.settings.tax_inclusive ? 'Your prices include GST' : 'GST is added on top'} />
          <NumberField id="sv-duration" label="Takes" suffix="min" min={5} step={5} value={form.duration_min} onChange={set('duration_min')} required />
          <NumberField id="sv-tax" label="GST rate" suffix="%" value={form.tax_rate} onChange={set('tax_rate')} hint="Starts from the rate in Salon settings" />
          <Field id="sv-sac" label="SAC code"><Input id="sv-sac" value={form.hsn_sac} onChange={(e) => set('hsn_sac')(e.target.value)} /></Field>
          <SelectField id="sv-gender" label="For" value={form.gender} onChange={set('gender')}>{Object.entries(GENDERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
        </fieldset>
        <Field id="sv-desc" label="Description"><Textarea id="sv-desc" rows={2} value={form.description} onChange={(e) => set('description')(e.target.value)} /></Field>

        <fieldset>
          <legend className="mb-2 text-small font-semibold text-ink-900">Who can do it</legend>
          <p className="mb-2 text-caption text-ink-500">Leave empty and anyone bookable can. Pick people to limit it to them.</p>
          <div className="flex flex-wrap gap-1.5">
            {(team.data || []).map((s) => { const on = form.staff_ids.includes(s.staff_id); return <button key={s.staff_id} type="button" aria-pressed={on} onClick={() => set('staff_ids')(on ? form.staff_ids.filter((x) => x !== s.staff_id) : [...form.staff_ids, s.staff_id])} className={`rounded-full border px-3 py-1 text-caption font-medium ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-700 hover:border-line-strong'}`}>{s.name}</button>; })}
            {team.data?.length === 0 && <span className="text-caption text-ink-500">No team members yet.</span>}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-small font-semibold text-ink-900">Consumables used</legend>
          <p className="mb-3 text-caption text-ink-500">Stock comes off automatically each time this service is billed. Mark an item “varies” when the amount is different every time (hair colour) — the stylist can then enter what they actually used at the till.</p>
          <ul className="space-y-2">
            {form.consumables.map((c, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_6rem_5rem_auto_auto] items-center gap-2">
                <Select aria-label="Consumable" value={c.ingredient_id} onChange={(e) => set('consumables')(form.consumables.map((x, j) => (j === i ? { ...x, ingredient_id: Number(e.target.value) } : x)))} className="!py-1.5">
                  <option value="">Choose…</option>{stock.map((s) => <option key={s.product_id} value={s.product_id}>{s.name}</option>)}
                </Select>
                <div className="relative"><Input aria-label="Quantity used" type="number" min="0" step="any" value={c.quantity} onChange={(e) => set('consumables')(form.consumables.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className="!py-1.5 !pr-9" /><span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-caption text-ink-400">{unitOf(c.ingredient_id)}</span></div>
                <div className="relative"><Input aria-label="Wastage percent" type="number" min="0" max="99" step="any" value={c.wastage_pct} onChange={(e) => set('consumables')(form.consumables.map((x, j) => (j === i ? { ...x, wastage_pct: e.target.value } : x)))} className="!py-1.5 !pr-6" /><span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-caption text-ink-400">%</span></div>
                <label className="flex items-center gap-1 text-caption text-ink-500"><input type="checkbox" checked={c.is_variable} onChange={(e) => set('consumables')(form.consumables.map((x, j) => (j === i ? { ...x, is_variable: e.target.checked } : x)))} className="h-4 w-4 accent-(--color-brand-500)" />varies</label>
                <button type="button" aria-label="Remove consumable" onClick={() => set('consumables')(form.consumables.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-400 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => set('consumables')([...form.consumables, { ingredient_id: '', quantity: '', wastage_pct: '0', is_variable: false }])}><Plus aria-hidden="true" className="h-4 w-4" />Add a consumable</Button>
            {form.consumables.length > 0 && <span className="text-caption text-ink-500">Material cost about {money(cost)}{price > 0 && ` · ${Math.round(((price - cost) / price) * 100)}% margin before GST`}</span>}
          </div>
          {stock.length === 0 && <p className="mt-2 text-caption text-warning">No consumables in stock yet. Add them under <Link to="/app/products" className="underline">Products</Link> as ingredients.</p>}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-small font-semibold text-ink-900">Commission and points</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField id="sv-ctype" label="Commission" value={form.commission_type} onChange={set('commission_type')} hint="Empty uses each person’s own rate"><option value="">Use the person’s rate</option><option value="PERCENT">Percent of the price</option><option value="FIXED">Fixed ₹ per service</option></SelectField>
            {form.commission_type && <NumberField id="sv-cval" label={form.commission_type === 'PERCENT' ? 'Percent' : 'Amount'} prefix={form.commission_type === 'FIXED' ? '₹' : undefined} suffix={form.commission_type === 'PERCENT' ? '%' : undefined} value={form.commission_value} onChange={set('commission_value')} required />}
          </div>
          <Toggle id="sv-earn" checked={form.points_earnable} onChange={set('points_earnable')} label="Earns loyalty points" />
          <Toggle id="sv-redeem" checked={form.points_redeemable} onChange={set('points_redeemable')} label="Can be paid for with points" />
        </fieldset>

        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{id ? 'Save changes' : 'Add service'}</Button></div>
      </form>
    </Modal>
  );
};

/* ── retail products and consumables (salon fields only) ──────────────────── */

const ProductDetails = ({ product, onSaved, onClose }) => {
  const [form, setForm] = useState({ brand: product.brand || '', max_stock: product.max_stock ?? '', points_earnable: product.points_earnable, points_redeemable: product.points_redeemable, commission_type: product.commission_type || '', commission_value: product.commission_value ?? '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const retail = product.kind === 'DISH';
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const body = { brand: form.brand || null, max_stock: form.max_stock === '' ? null : Number(form.max_stock), ...(retail ? { points_earnable: form.points_earnable, points_redeemable: form.points_redeemable, commission_type: form.commission_type || null, commission_value: form.commission_type ? Number(form.commission_value) : null } : {}) };
    const out = await run(() => api(`/salon/products/${product.product_id}/details`, { method: 'PUT', body }).catch((c) => { setError(c.message); throw c; }), 'Saved');
    if (out) onSaved();
  };
  return (
    <Modal title={product.name} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pd-brand" label="Brand"><Input id="pd-brand" value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} /></Field>
          <NumberField id="pd-max" label="Most to keep in stock" suffix={product.unit} value={form.max_stock} onChange={(v) => setForm((f) => ({ ...f, max_stock: v }))} hint="Used for reorder suggestions" />
        </div>
        {retail && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField id="pd-ctype" label="Commission for selling it" value={form.commission_type} onChange={(v) => setForm((f) => ({ ...f, commission_type: v }))} hint="Empty uses the person’s product rate"><option value="">Use the person’s rate</option><option value="PERCENT">Percent</option><option value="FIXED">Fixed ₹ per unit</option></SelectField>
              {form.commission_type && <NumberField id="pd-cval" label="Value" value={form.commission_value} onChange={(v) => setForm((f) => ({ ...f, commission_value: v }))} required />}
            </div>
            <Toggle id="pd-earn" checked={form.points_earnable} onChange={(v) => setForm((f) => ({ ...f, points_earnable: v }))} label="Earns loyalty points" />
            <Toggle id="pd-redeem" checked={form.points_redeemable} onChange={(v) => setForm((f) => ({ ...f, points_redeemable: v }))} label="Can be paid for with points" />
          </>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
      </form>
    </Modal>
  );
};

const StockTab = ({ type }) => {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 300);
  const [offset, setOffset] = useState(0);
  const [low, setLow] = useState(false);
  const [editing, setEditing] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { setOffset(0); }, [term, low]);
  const list = useLoad(`/salon/products${qs({ type, q: term, low_stock: low ? 1 : '', limit: 25, offset, t: tick })}`, { paged: true });
  const rows = list.data || [];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-full max-w-xs"><Input type="search" aria-label="Search" placeholder="Search by name, SKU or barcode" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Chips label="Filter" value={low ? 'low' : 'all'} onChange={(v) => setLow(v === 'low')} options={[{ value: 'all', label: 'All' }, { value: 'low', label: 'Low on stock' }]} />
        <Button to="/app/products" variant="secondary" size="sm" className="ml-auto">Add or edit items in Products</Button>
      </div>
      <ListState loading={list.loading && rows.length === 0} error={list.error} empty={!list.loading && rows.length === 0} emptyLabel={type === 'PRODUCT' ? 'No retail products yet.' : 'No consumables yet.'} emptyBody="Add them under Products, then come back here for the salon details." />
      {rows.length > 0 && (
        <>
          <Table>
            <Thead><Th>Item</Th><Th>Brand</Th><Th className="text-right">Price</Th><Th className="text-right">In stock</Th><Th className="text-right">Reorder at</Th><Th className="text-right">Keep up to</Th><Th><span className="sr-only">Actions</span></Th></Thead>
            <tbody>
              {rows.map((p) => (
                <Tr key={p.product_id}>
                  <Td><span className="font-medium">{p.name}</span>{p.sku && <span className="block text-caption text-ink-500">{p.sku}</span>}</Td>
                  <Td>{p.brand || <span className="text-ink-400">—</span>}</Td>
                  <Td className="text-right tabular">{type === 'PRODUCT' ? money(p.selling_price) : `${money(p.cost_price)}/${p.unit}`}</Td>
                  <Td className="text-right tabular">{p.stock} {p.unit} {p.low && <Badge tone="danger">Low</Badge>}</Td>
                  <Td className="text-right tabular">{p.min_stock}</Td>
                  <Td className="text-right tabular">{p.max_stock ?? '—'}</Td>
                  <Td className="text-right"><button type="button" onClick={() => setEditing(p)} className="text-caption font-semibold text-brand-600">Salon details</button></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager meta={list.meta} onPage={setOffset} />
        </>
      )}
      {editing && <ProductDetails product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTick((t) => t + 1); }} />}
    </div>
  );
};

/* ── the page ─────────────────────────────────────────────────────────────── */

const SalonServices = () => {
  const dialog = useDialog();
  const toast = useToast();
  const [tab, setTab] = useState('services');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState(null);    // null | 'new' | service id
  const [cats, setCats] = useState(false);
  const [tick, setTick] = useState(0);
  const categories = useLoad(`/salon/categories?scope=SERVICE&t=${tick}`);
  const list = useLoad(`/salon/services${qs({ status: archived ? 'ARCHIVED' : 'ACTIVE', category_id: category, limit: 200, t: tick })}`, { paged: true });
  const all = list.data || [];
  const rows = useMemo(() => all.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())), [all, q]);
  const refresh = () => setTick((t) => t + 1);

  const toggleArchive = async (s) => {
    if (!archived && !(await dialog.confirm({ title: `Archive ${s.name}?`, body: 'It disappears from the till and the calendar. Past bills keep it. You can restore it any time.', confirmLabel: 'Archive' }))) return;
    try { await api(`/salon/services/${s.service_id}/${archived ? 'restore' : 'archive'}`, { method: 'POST' }); toast.success(archived ? 'Restored' : 'Archived'); refresh(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <PageHeader title="Services" lead="What you sell by the hour, and the products and consumables behind it."
                  action={tab === 'services' && <><Button variant="secondary" onClick={() => setCats(true)}><Tags aria-hidden="true" className="h-4 w-4" />Categories</Button><Button onClick={() => setEditing('new')}><Plus aria-hidden="true" className="h-4 w-4" />New service</Button></>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'services', label: 'Services' }, { key: 'products', label: 'Retail products' }, { key: 'consumables', label: 'Consumables' }]} />

      {tab === 'services' && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="w-full max-w-xs"><Input type="search" aria-label="Search services" placeholder="Search services" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Chips label="Status" value={archived ? 'archived' : 'active'} onChange={(v) => setArchived(v === 'archived')} options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />
          </div>
          {(categories.data || []).length > 0 && <div className="mb-4"><Chips label="Category" value={category} onChange={setCategory} options={[{ value: '', label: 'All' }, ...categories.data.map((c) => ({ value: String(c.category_id), label: c.name, count: c.items }))]} /></div>}
          <ListState loading={list.loading && all.length === 0} error={list.error} empty={!list.loading && rows.length === 0} emptyIcon={Scissors}
                     emptyLabel={q ? 'No service matches.' : archived ? 'Nothing archived.' : 'No services yet.'} emptyBody={q ? 'Try another word.' : archived ? 'Archived services appear here.' : 'Add your first service to start booking and billing.'}
                     emptyAction={!q && !archived && <Button onClick={() => setEditing('new')}>Add a service</Button>} />
          {rows.length > 0 && (
            <Table>
              <Thead><Th>Service</Th><Th>Category</Th><Th className="text-right">Price</Th><Th className="text-right">GST</Th><Th className="text-right">Time</Th><Th>Materials</Th><Th className="text-right">Margin</Th><Th><span className="sr-only">Actions</span></Th></Thead>
              <tbody>
                {rows.map((s) => (
                  <Tr key={s.service_id} onClick={() => setEditing(s.service_id)}>
                    <Td><span className="font-medium">{s.name}</span>{s.gender !== 'ANY' && <span className="block text-caption text-ink-500">{GENDERS[s.gender]}</span>}</Td>
                    <Td>{s.category_name || <span className="text-ink-400">—</span>}</Td>
                    <Td className="text-right tabular">{money(s.price)}</Td>
                    <Td className="text-right tabular">{s.tax_rate}%</Td>
                    <Td className="text-right tabular">{s.duration_min} min</Td>
                    <Td>{s.consumables > 0 ? <span className="flex items-center gap-1 text-ink-700"><FlaskConical aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />{s.consumables}</span> : <span className="text-ink-400">—</span>}</Td>
                    <Td className="text-right tabular">{s.margin_pct != null && s.consumables > 0 ? `${s.margin_pct}%` : <span className="text-ink-400">—</span>}</Td>
                    <Td className="text-right" ><button type="button" aria-label={`${archived ? 'Restore' : 'Archive'} ${s.name}`} onClick={(e) => { e.stopPropagation(); toggleArchive(s); }} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-ink-900">{archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</button></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
      {tab === 'products' && <StockTab type="PRODUCT" />}
      {tab === 'consumables' && <StockTab type="CONSUMABLE" />}

      {editing && <ServiceForm id={editing === 'new' ? null : editing} categories={categories.data || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {cats && <CategoriesModal onClose={() => setCats(false)} onChanged={refresh} />}
    </div>
  );
};

export default SalonServices;
