/*
 * Schemes: buy-X-get-Y free, quantity discounts and value discounts, with who qualifies (retailer types, named retailers,
 * territories) and when. The system decides what applies to an order; this is where the offers are made, switched off,
 * announced to retailers, and where you see what each has cost and what a principal-funded scheme lets you claim back.
 */
import { useMemo, useState } from 'react';
import { Megaphone, Pencil, Percent, Plus, Trash } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { SCHEME_KINDS, SCHEME_STATUS, dateText, money, qs, qty, useDebounced, useLoad } from '../../lib/distributor.js';
import { Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Textarea, Th, Thead, Tr, useDialog, useToast, PageLoader } from '../../components/ui.jsx';
import { Chips, NumberField, Pager, Panel, Segmented, StatusPill, Toggle, Toolbar, useAction } from '../wholesale/parts.jsx';
import { ProductPicker } from '../wholesale/parts.jsx';
import { CUSTOMER_TYPES } from '../../lib/wholesale.js';
import { RetailerPicker, useTerritories } from './parts.jsx';

const SCOPES = { ALL: 'The whole order', PRODUCT: 'One product', BRAND: 'A brand', CATEGORY: 'A category', PRINCIPAL: 'A principal’s products' };

const ScopeChooser = ({ scope, onScope, value, onValue, principals }) => {
  const brands = useLoad(scope === 'BRAND' ? '/distributor/brands' : null).data || [];
  const cats = useLoad(scope === 'CATEGORY' ? '/wholesale/categories' : null).data || [];
  return (
    <div className="space-y-3">
      <Field id="sc-scope" label="Applies to"><Select id="sc-scope" value={scope} onChange={(e) => { onScope(e.target.value); onValue(null); }}>{Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      {scope === 'PRODUCT' && (value ? <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-small"><span>{value.name}</span><button type="button" className="text-caption text-brand-600" onClick={() => onValue(null)}>Change</button></div> : <ProductPicker onPick={(p) => onValue({ id: p.product_id, name: p.name })} />)}
      {scope === 'BRAND' && <Select aria-label="Brand" value={value?.id ?? ''} onChange={(e) => onValue(e.target.value ? { id: Number(e.target.value) } : null)}><option value="">Choose a brand…</option>{brands.map((b) => <option key={b.brand_id} value={b.brand_id}>{b.name}</option>)}</Select>}
      {scope === 'CATEGORY' && <Select aria-label="Category" value={value?.id ?? ''} onChange={(e) => onValue(e.target.value ? { id: Number(e.target.value) } : null)}><option value="">Choose a category…</option>{cats.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</Select>}
      {scope === 'PRINCIPAL' && <Select aria-label="Principal" value={value?.id ?? ''} onChange={(e) => onValue(e.target.value ? { id: Number(e.target.value) } : null)}><option value="">Choose a principal…</option>{principals.map((p) => <option key={p.principal_id} value={p.principal_id}>{p.name}</option>)}</Select>}
    </div>
  );
};

const SchemeForm = ({ scheme, onClose, onSaved }) => {
  const editing = Boolean(scheme?.scheme_id);
  const full = useLoad(editing ? `/distributor/schemes/${scheme.scheme_id}` : null);
  const principals = useLoad('/distributor/principals?status=ALL&limit=200', { paged: true }).data || [];
  const { territories } = useTerritories();
  const s = editing ? full.data : null;
  const [f, setF] = useState(null);
  const [scope, setScope] = useState(null);
  const [scopeKind, setScopeKind] = useState('ALL');
  const [free, setFree] = useState(null);
  const [retailers, setRetailers] = useState(null);
  const [places, setPlaces] = useState(null);
  const [busy, run] = useAction();
  // load the stored scheme into the form once
  if (editing && s && !f) {
    setF({ name: s.name, kind: s.kind, funded_by: s.funded_by, principal_id: s.principal_id ?? '', buy_unit_name: s.buy_unit_name || '', buy_min_qty: s.buy_min_qty ?? '', min_value: s.min_value ?? '', free_qty: s.free_qty ?? '', free_unit_name: s.free_unit_name || '', repeat: s.repeat, max_free_qty: s.max_free_qty ?? '', discount_pct: s.discount_pct ?? '', discount: s.discount ?? '', customer_types: s.customer_types || [], starts_on: s.starts_on ? String(s.starts_on).slice(0, 10) : '', ends_on: s.ends_on ? String(s.ends_on).slice(0, 10) : '', is_active: s.is_active, stackable: s.stackable, priority: s.priority, notes: s.notes || '', value_mode: s.discount != null ? 'AMOUNT' : 'PERCENT' });
    setScopeKind(s.buy_scope); setScope(s.buy_scope === 'ALL' ? null : { id: s.buy_product_id ?? s.buy_brand_id ?? s.buy_category_id ?? s.buy_principal_id, name: s.buy_scope_name });
    if (s.free_product_id) setFree({ id: s.free_product_id, name: s.free_product });
    setRetailers((s.customers || []).map((c) => ({ customer_id: c.customer_id, name: c.name }))); setPlaces((s.territories || []).map((t) => t.territory_id));
  }
  const form = f || (!editing ? { name: '', kind: 'BUY_X_GET_Y', funded_by: 'DISTRIBUTOR', principal_id: '', buy_unit_name: '', buy_min_qty: '', min_value: '', free_qty: '', free_unit_name: '', repeat: true, max_free_qty: '', discount_pct: '', discount: '', customer_types: [], starts_on: '', ends_on: '', is_active: true, stackable: false, priority: 0, notes: '', value_mode: 'AMOUNT' } : null);
  const buyProductId = scopeKind === 'PRODUCT' ? scope?.id : null;
  const product = useLoad(buyProductId ? `/wholesale/products/${buyProductId}` : null).data;
  const freeProduct = useLoad(free?.id ? `/wholesale/products/${free.id}` : null).data;
  if (!form) return <Modal title="Scheme" onClose={onClose}><PageLoader compact /></Modal>;
  const set = (k) => (e) => setF({ ...form, [k]: e?.target ? e.target.value : e });
  const setAll = (patch) => setF({ ...form, ...patch });
  const chosenRetailers = retailers ?? []; const chosenPlaces = places ?? [];
  const unitOptions = (p) => [p?.unit, ...(p?.units || []).map((u) => u.unit_name)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  const save = async () => {
    const n = (v) => (v === '' || v == null ? null : Number(v));
    const body = { name: form.name, kind: form.kind, funded_by: form.funded_by, principal_id: form.principal_id === '' ? null : Number(form.principal_id), buy_scope: scopeKind, buy_scope_id: scopeKind === 'ALL' ? null : scope?.id,
      buy_unit_name: form.buy_unit_name || null, buy_min_qty: n(form.buy_min_qty), min_value: form.kind === 'VALUE_DISCOUNT' ? n(form.min_value) : null,
      free_product_id: free?.id ?? null, free_qty: n(form.free_qty), free_unit_name: form.free_unit_name || null, repeat: form.repeat, max_free_qty: n(form.max_free_qty),
      discount_pct: form.kind === 'QTY_DISCOUNT' || (form.kind === 'VALUE_DISCOUNT' && form.value_mode === 'PERCENT') ? n(form.discount_pct) : null, discount: form.kind === 'VALUE_DISCOUNT' && form.value_mode === 'AMOUNT' ? n(form.discount) : null,
      customer_types: form.customer_types, customer_ids: chosenRetailers.map((c) => c.customer_id), territory_ids: chosenPlaces, starts_on: form.starts_on || null, ends_on: form.ends_on || null, is_active: form.is_active, stackable: form.stackable, priority: Number(form.priority) || 0, notes: form.notes || null };
    const r = await run(() => api(editing ? `/distributor/schemes/${scheme.scheme_id}` : '/distributor/schemes', { method: editing ? 'PUT' : 'POST', body }), editing ? 'Scheme saved' : 'Scheme created');
    if (r) onSaved(r);
  };
  const toggleType = (t) => setAll({ customer_types: form.customer_types.includes(t) ? form.customer_types.filter((x) => x !== t) : [...form.customer_types, t] });
  return (
    <Modal title={editing ? `Edit ${scheme.name}` : 'New scheme'} onClose={onClose} wide>
      <div className="space-y-5">
        <Field id="sch-name" label="Scheme name"><Input id="sch-name" value={form.name} onChange={set('name')} autoFocus maxLength={120} placeholder="Buy 10 cartons, get 1 free" /></Field>
        <Segmented label="Type" value={form.kind} onChange={(v) => setAll({ kind: v })} options={Object.entries(SCHEME_KINDS).map(([value, label]) => ({ value, label }))} />

        {form.kind !== 'VALUE_DISCOUNT' && <ScopeChooser scope={scopeKind} onScope={setScopeKind} value={scope} onValue={setScope} principals={principals} />}
        {form.kind === 'VALUE_DISCOUNT' && <ScopeChooser scope={scopeKind} onScope={setScopeKind} value={scope} onValue={setScope} principals={principals} />}

        {form.kind !== 'VALUE_DISCOUNT' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField id="sch-buy" label="Buy at least" value={form.buy_min_qty} onChange={set('buy_min_qty')} hint={scopeKind === 'PRODUCT' ? undefined : 'Counted in the product’s own unit (pieces, kg…)'} />
            {scopeKind === 'PRODUCT' && <Field id="sch-bunit" label="in"><Select id="sch-bunit" value={form.buy_unit_name} onChange={set('buy_unit_name')}><option value="">{product?.unit || 'Base unit'}</option>{unitOptions(product).filter((u) => u !== product?.unit).map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>}
          </div>
        )}
        {form.kind === 'BUY_X_GET_Y' && (
          <div className="space-y-4 rounded-(--radius-card) border border-line p-4">
            <p className="text-small font-semibold">Free goods</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField id="sch-free" label="Free quantity" value={form.free_qty} onChange={set('free_qty')} />
              <Field id="sch-funit" label="Free unit"><Select id="sch-funit" value={form.free_unit_name} onChange={set('free_unit_name')}><option value="">Base unit</option>{unitOptions(freeProduct || (!free ? product : null)).map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
            </div>
            <div><span className="mb-1 block text-small font-medium">Free product</span>{free ? <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-small"><span>{free.name}</span><button type="button" className="text-caption text-brand-600" onClick={() => setFree(null)}>Same as the product bought</button></div> : <><ProductPicker onPick={(p) => setFree({ id: p.product_id, name: p.name })} placeholder="Search a different product to give free (optional)" /><p className="mt-1 text-caption text-ink-500">Leave empty to give the same product free{scopeKind !== 'PRODUCT' ? ' — then choose a free product, as this scheme is not for one product' : ''}.</p></>}</div>
            <div className="grid gap-4 sm:grid-cols-2"><Toggle id="sch-repeat" checked={form.repeat} onChange={(v) => setAll({ repeat: v })} label="Repeat for every multiple" hint="Buy 30 with a 10+1 scheme: 3 free; otherwise 1" /><NumberField id="sch-max" label="Most that can be given free" hint="Blank for no limit" value={form.max_free_qty} onChange={set('max_free_qty')} /></div>
          </div>
        )}
        {form.kind === 'QTY_DISCOUNT' && <NumberField id="sch-pct" label="Discount" suffix="%" value={form.discount_pct} onChange={set('discount_pct')} />}
        {form.kind === 'VALUE_DISCOUNT' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField id="sch-minv" label="When the order is at least" prefix="₹" value={form.min_value} onChange={set('min_value')} />
            <div><Segmented label="Discount as" value={form.value_mode} onChange={(v) => setAll({ value_mode: v })} options={[{ value: 'AMOUNT', label: '₹ off' }, { value: 'PERCENT', label: '% off' }]} size="sm" />
              <div className="mt-2">{form.value_mode === 'AMOUNT' ? <NumberField id="sch-disc" label="Discount" prefix="₹" value={form.discount} onChange={set('discount')} /> : <NumberField id="sch-dpct" label="Discount" suffix="%" value={form.discount_pct} onChange={set('discount_pct')} />}</div></div>
          </div>
        )}

        <fieldset className="space-y-4 rounded-(--radius-card) border border-line p-4">
          <legend className="px-1 text-small font-semibold">Who gets it, and when</legend>
          <div className="grid gap-4 sm:grid-cols-2"><Field id="sch-from" label="Starts"><Input id="sch-from" type="date" value={form.starts_on} onChange={set('starts_on')} /></Field><Field id="sch-to" label="Ends"><Input id="sch-to" type="date" value={form.ends_on} onChange={set('ends_on')} /></Field></div>
          <div><span className="mb-1.5 block text-small font-medium">Retailer types <span className="font-normal text-ink-500">(none ticked: all)</span></span><div className="flex flex-wrap gap-2">{Object.entries(CUSTOMER_TYPES).map(([k, v]) => <label key={k} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-small"><input type="checkbox" checked={form.customer_types.includes(k)} onChange={() => toggleType(k)} className="accent-(--color-brand-500)" />{v}</label>)}</div></div>
          <div><span className="mb-1.5 block text-small font-medium">Only these territories <span className="font-normal text-ink-500">(none: everywhere; a region includes the areas inside it)</span></span>
            <Select aria-label="Add a territory" value="" onChange={(e) => { const id = Number(e.target.value); if (id && !chosenPlaces.includes(id)) setPlaces([...chosenPlaces, id]); }}><option value="">Add a territory…</option>{territories.filter((t) => !chosenPlaces.includes(t.territory_id)).map((t) => <option key={t.territory_id} value={t.territory_id}>{t.path}</option>)}</Select>
            {chosenPlaces.length > 0 && <ul className="mt-2 flex flex-wrap gap-2">{chosenPlaces.map((id) => <li key={id}><button type="button" onClick={() => setPlaces(chosenPlaces.filter((x) => x !== id))} className="rounded-full bg-brand-50 px-2.5 py-1 text-caption text-brand-700">{territories.find((t) => t.territory_id === id)?.path || id} ✕</button></li>)}</ul>}</div>
          <div><span className="mb-1.5 block text-small font-medium">Only these retailers <span className="font-normal text-ink-500">(none: everyone who qualifies above)</span></span><RetailerPicker value={chosenRetailers} onChange={setRetailers} max={5000} id="sch-retailers" /></div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="sch-fund" label="Funded by"><Select id="sch-fund" value={form.funded_by} onChange={set('funded_by')}><option value="DISTRIBUTOR">You</option><option value="PRINCIPAL">A principal (you claim the cost back)</option></Select></Field>
          {(form.funded_by === 'PRINCIPAL' || form.principal_id !== '') && <Field id="sch-prin" label="Principal"><Select id="sch-prin" value={form.principal_id} onChange={set('principal_id')}><option value="">None</option>{principals.map((p) => <option key={p.principal_id} value={p.principal_id}>{p.name}</option>)}</Select></Field>}
          <NumberField id="sch-prio" label="Priority" step={1} min={-100} hint="When schemes compete, the higher priority wins even if it gives less" value={form.priority} onChange={set('priority')} />
          <div className="space-y-3"><Toggle id="sch-stack" checked={form.stackable} onChange={(v) => setAll({ stackable: v })} label="Can be combined with other schemes" /><Toggle id="sch-active" checked={form.is_active} onChange={(v) => setAll({ is_active: v })} label="Switched on" /></div>
        </div>
        <Field id="sch-notes" label="Notes"><Textarea id="sch-notes" rows={2} value={form.notes} onChange={set('notes')} maxLength={300} /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={form.name.trim().length < 2}>{editing ? 'Save scheme' : 'Create scheme'}</Button></div>
      </div>
    </Modal>
  );
};

const SchemeDetail = ({ id, onClose, onChanged, onEdit }) => {
  const { can } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const { data: s, reload } = useLoad(`/distributor/schemes/${id}/performance`);
  const full = useLoad(`/distributor/schemes/${id}`).data;
  const [busy, run] = useAction();
  const edit = can('schemes');
  const toggle = async () => { const r = await run(() => api(`/distributor/schemes/${id}`, { method: 'PUT', body: { is_active: !s.is_active } }), s.is_active ? 'Switched off' : 'Switched on'); if (r) { reload(); onChanged(); } };
  const announce = async () => { if (!await dialog.confirm({ title: 'Tell qualifying retailers?', body: 'A message goes out through your messaging channel to every retailer who qualifies. Those who opted out are skipped.', confirmLabel: 'Send' })) return; const r = await run(() => api(`/distributor/schemes/${id}/announce`, { method: 'POST', body: {} }), null); if (r) toast.success(`${r.sent} of ${r.qualifying} retailers were messaged${r.skipped ? `; ${r.skipped} skipped (messaging off, no number, or opted out)` : ''}.`); };
  const remove = async () => { if (await dialog.confirm({ title: `Delete ${s.name}?`, confirmLabel: 'Delete', danger: true })) { const r = await run(() => api(`/distributor/schemes/${id}`, { method: 'DELETE' }), 'Deleted'); if (r) { onChanged(); onClose(); } } };
  return (
    <Modal title={s ? s.name : 'Scheme'} onClose={onClose} wide>
      {!s ? <PageLoader compact /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><StatusPill map={SCHEME_STATUS} status={s.status} /><Badge>{SCHEME_KINDS[s.kind]}</Badge>{s.funded_by === 'PRINCIPAL' && <Badge tone="brand">Funded by {s.principal || 'principal'}</Badge>}{s.stackable && <Badge>Combines</Badge>}</div>
          <p className="text-body text-ink-900">{s.description}</p>
          <p className="text-small text-ink-500">{s.starts_on ? `From ${dateText(s.starts_on)}` : 'No start date'}{s.ends_on ? ` to ${dateText(s.ends_on)}${s.days_left != null && s.days_left >= 0 ? ` (${s.days_left} day${s.days_left === 1 ? '' : 's'} left)` : ''}` : ', no end date'}.
            {full && (full.customer_types?.length || full.customers?.length || full.territories?.length) ? ` Only for ${[full.customer_types?.length && full.customer_types.map((t) => t.toLowerCase()).join(', '), full.customers?.length && plural(full.customers.length, 'named retailer'), full.territories?.length && full.territories.map((t) => t.name).join(', ')].filter(Boolean).join('; ')}.` : ' For every retailer.'}</p>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {[['Orders', s.orders], ['Retailers', s.customers], ['Free units shipped', qty(s.free_base_shipped)], ['Discount given', money(s.discount_given)], ['Total cost', money(s.cost)]].map(([a, b]) => <div key={a}><dt className="text-caption text-ink-500">{a}</dt><dd className="text-body font-semibold tabular">{b}</dd></div>)}
          </dl>
          {s.funded_by === 'PRINCIPAL' && <p className="rounded-lg bg-brand-50 px-4 py-3 text-small text-brand-700">You can claim <strong>{money(s.claimable_from_principal)}</strong> from {s.principal || 'the principal'} for goods shipped and discounts given under this scheme. See <em>Principal settlement</em> in Reports.</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {edit && <Button variant="ghost" loading={busy} onClick={remove}><Trash aria-hidden="true" className="h-4 w-4" />Delete</Button>}
            {edit && <Button variant="secondary" loading={busy} onClick={toggle}>{s.is_active ? 'Switch off' : 'Switch on'}</Button>}
            {edit && s.status === 'ACTIVE' && <Button variant="secondary" loading={busy} onClick={announce}><Megaphone aria-hidden="true" className="h-4 w-4" />Tell retailers</Button>}
            {edit && <Button onClick={onEdit}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</Button>}
          </div>
        </div>
      )}
    </Modal>
  );
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const Schemes = () => {
  const { can } = useAuth();
  const [status, setStatus] = useState('ACTIVE');
  const [expiring, setExpiring] = useState(false);
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [stamp, setStamp] = useState(0);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null);
  const term = useDebounced(q.trim(), 250);
  const query = useMemo(() => qs({ status, expiring: expiring ? 1 : undefined, q: term, limit: 50, offset, k: stamp }), [status, expiring, term, offset, stamp]);
  const { data, meta, loading, error } = useLoad(`/distributor/schemes${query}`, { paged: true });
  return (
    <div>
      <PageHeader title="Schemes" lead="Free goods and discounts for retailers — who gets them, when, and what they cost." action={can('schemes') && <Button onClick={() => setForm({})}><Plus aria-hidden="true" className="h-4 w-4" />New scheme</Button>} />
      <Toolbar><div className="w-full sm:w-64"><Input type="search" placeholder="Scheme name" aria-label="Search schemes" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div>
        <Chips label="Status" value={expiring ? 'EXPIRING' : status} onChange={(v) => { setExpiring(v === 'EXPIRING'); if (v !== 'EXPIRING') setStatus(v); setOffset(0); }}
               options={[{ value: 'ACTIVE', label: 'Running' }, { value: 'EXPIRING', label: 'Ending this week' }, { value: 'UPCOMING', label: 'Starting soon' }, { value: 'EXPIRED', label: 'Ended' }, { value: 'INACTIVE', label: 'Switched off' }, { value: 'ALL', label: 'All' }]} /></Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={Percent} emptyLabel="No schemes here" emptyBody="Make an offer — buy 10 cartons, get 1 free; 5% off 100 units; ₹2,000 off an order above ₹50,000." emptyAction={can('schemes') && status === 'ACTIVE' && !term ? <Button onClick={() => setForm({})}>Create a scheme</Button> : undefined} />
      {data?.length > 0 && <><Table><Thead><Th>Scheme</Th><Th>Type</Th><Th>Funded by</Th><Th>Runs</Th><Th className="text-right">Orders</Th><Th className="text-right">Cost</Th><Th>Status</Th></Thead>
        <tbody>{data.map((s) => <Tr key={s.scheme_id} onClick={() => setOpen(s.scheme_id)}><Td><span className="font-medium text-brand-700">{s.name}</span><span className="block max-w-md truncate text-caption text-ink-500">{s.description}</span></Td><Td>{SCHEME_KINDS[s.kind]}</Td><Td>{s.funded_by === 'PRINCIPAL' ? (s.principal || 'Principal') : 'You'}</Td>
          <Td className="text-ink-700">{s.starts_on ? dateText(s.starts_on) : 'Always'}{s.ends_on ? ` – ${dateText(s.ends_on)}` : ''}{s.status === 'ACTIVE' && s.days_left != null && s.days_left <= 7 && <Badge tone="warning">{s.days_left} d left</Badge>}</Td><Td className="text-right tabular">{s.orders}</Td><Td className="text-right tabular">{money(s.cost)}</Td><Td><StatusPill map={SCHEME_STATUS} status={s.status} /></Td></Tr>)}</tbody></Table><Pager meta={meta} onPage={setOffset} /></>}
      {open && <SchemeDetail id={open} onClose={() => setOpen(null)} onChanged={() => setStamp((n) => n + 1)} onEdit={() => { setForm({ scheme_id: open, name: data?.find((x) => x.scheme_id === open)?.name }); setOpen(null); }} />}
      {form && <SchemeForm scheme={form.scheme_id ? form : null} onClose={() => setForm(null)} onSaved={(s) => { setForm(null); setStamp((n) => n + 1); setOpen(s.scheme_id); }} />}
    </div>
  );
};

export default Schemes;
