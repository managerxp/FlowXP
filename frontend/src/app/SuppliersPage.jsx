/*
 * Suppliers: who you buy from, what you owe them, and what they charge. The
 * list on the left, the chosen supplier on the right (?s=ID): money owed and
 * the orders behind it, orders on the way, their price list (edited in place)
 * and every order. Paying and receiving happen on the order, in Purchases.
 *
 * Money and order counts come from suppliers.controller.js, counted at the
 * outlet(s) the viewer may see.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Mail, MessageCircle, Phone, Plus, Search, Trash2 } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { localISO } from '../lib/dates.js';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '../components/ui.jsx';

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : null);
const daysSince = (d) => (d ? Math.round((new Date(`${localISO()}T00:00`) - new Date(`${String(d).slice(0, 10)}T00:00`)) / 86400000) : null);
const ago = (d) => { const n = daysSince(d); return n == null ? null : n === 0 ? 'today' : n === 1 ? 'yesterday' : n < 30 ? `${n} days ago` : n < 365 ? `${Math.round(n / 30)} mo ago` : `${Math.floor(n / 365)} yr ago`; };
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const mobile = (phone) => { const d = String(phone || '').replace(/\D/g, ''); return d.length === 10 ? `91${d}` : d.length === 12 && d.startsWith('91') ? d : null; };
const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

const FILTERS = [
  ['all', 'All', () => true],
  ['owed', 'You owe', (s) => s.payable_balance > 0],
  ['coming', 'On the way', (s) => s.open_orders > 0]
];
const SORTS = {
  owed: ['Owe most', (a, b) => b.payable_balance - a.payable_balance || a.name.localeCompare(b.name)],
  bought: ['Bought most', (a, b) => b.total_purchases - a.total_purchases],
  recent: ['Last order', (a, b) => String(b.last_po_date || '').localeCompare(String(a.last_po_date || ''))],
  name: ['Name A–Z', (a, b) => a.name.localeCompare(b.name)]
};
const PO_STATUS = { DRAFT: ['Draft', 'bg-surface-2 text-ink-700'], ORDERED: ['Ordered', 'bg-brand-50 text-brand-700'], PARTIAL: ['Part received', 'bg-warning/10 text-warning'], CANCELLED: ['Cancelled', 'bg-surface-2 text-ink-500'] };
const poChip = (po) => {
  if (PO_STATUS[po.status]) return PO_STATUS[po.status];
  return po.payment_status === 'PAID' ? ['Paid', 'bg-success/10 text-success'] : po.payment_status === 'PARTIAL' ? ['Part paid', 'bg-warning/10 text-warning'] : ['Unpaid', 'bg-warning/10 text-warning'];
};

const Initials = ({ name, size = 'md' }) => (
  <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700 ${size === 'lg' ? 'h-12 w-12 text-body' : 'h-9 w-9 text-caption'}`}>{initials(name)}</span>
);

/* ── Add / edit ───────────────────────────────────────────────────────── */

const emptyForm = { name: '', phone: '', email: '', address: '', gstin: '' };

const SupplierForm = ({ initial, onSaved, onClose }) => {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isEdit = Boolean(initial.supplier_id);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const body = { name: form.name, phone: form.phone || null, email: form.email || null, address: form.address || null, gstin: form.gstin || null };
      const saved = await api(isEdit ? `/suppliers/${initial.supplier_id}` : '/suppliers', { method: isEdit ? 'PATCH' : 'POST', body });
      onSaved(saved);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const legend = 'text-caption font-semibold uppercase tracking-[0.12em] text-ink-500';
  return (
    <Modal title={isEdit ? `Edit ${initial.name}` : 'Add a supplier'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-6">
        <Alert>{error}</Alert>
        <fieldset className="space-y-4">
          <legend className={legend}>Contact</legend>
          <Field id="s-name" label="Business name"><Input id="s-name" value={form.name} onChange={set('name')} required autoFocus /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="s-phone" label="Mobile" hint="Orders can be sent to it on WhatsApp"><Input id="s-phone" type="tel" inputMode="tel" value={form.phone || ''} onChange={set('phone')} /></Field>
            <Field id="s-email" label="Email (optional)" hint="Orders are emailed here when you send them"><Input id="s-email" type="email" value={form.email || ''} onChange={set('email')} /></Field>
          </div>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className={legend}>For GST</legend>
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Field id="s-gstin" label="GSTIN (optional)"><Input id="s-gstin" value={form.gstin || ''} onChange={set('gstin')} maxLength={15} className="uppercase" /></Field>
            <Field id="s-address" label="Address (optional)"><Input id="s-address" value={form.address || ''} onChange={set('address')} /></Field>
          </div>
        </fieldset>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add supplier'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* ── Price list, edited in place ──────────────────────────────────────── */

/* What this supplier charges for each product: fills the price on new orders
   and flags a delivery billed above it (see PurchaseOrderModal / receive). */
const PriceList = ({ supplier }) => {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [products, setProducts] = useState([]);
  const [adding, setAdding] = useState(false);
  const [locked, setLocked] = useState(false);   // editing a listed price: its product is fixed
  const [draft, setDraft] = useState({ product_id: '', price: '', min_qty: '', lead_time_days: '' });
  const [error, setError] = useState('');
  const load = () => api(`/suppliers/${supplier.supplier_id}/prices`).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { setRows(null); load(); }, [supplier.supplier_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (adding && !products.length) api('/products').then(setProducts).catch(() => {}); }, [adding]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (e) => {
    e.preventDefault(); setError('');
    try {
      await api(`/suppliers/${supplier.supplier_id}/prices`, { method: 'PUT', body: { prices: [{ product_id: Number(draft.product_id), price: Number(draft.price), min_qty: draft.min_qty === '' ? undefined : Number(draft.min_qty), lead_time_days: draft.lead_time_days === '' ? undefined : Number(draft.lead_time_days) }] } });
      toast.success('Price saved'); setDraft({ product_id: '', price: '', min_qty: '', lead_time_days: '' }); setAdding(false); load();
    } catch (caught) { setError(caught.message); }
  };
  const edit = (r) => { setDraft({ product_id: String(r.product_id), price: String(r.price), min_qty: String(r.min_qty ?? ''), lead_time_days: r.lead_time_days != null ? String(r.lead_time_days) : '' }); setLocked(true); setAdding(true); };
  const remove = async (r) => {
    if (!window.confirm(`Remove ${r.name} from ${supplier.name}'s price list?`)) return;
    try { await api(`/suppliers/${supplier.supplier_id}/prices/${r.product_id}`, { method: 'DELETE' }); load(); } catch (caught) { setError(caught.message); }
  };
  const listed = new Set((rows || []).map((r) => String(r.product_id)));
  const editingExisting = listed.has(draft.product_id);

  return (
    <section aria-label="Price list">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Price list {rows && <span className="tabular font-normal">· {rows.length}</span>}</h3>
        {!adding && <button type="button" onClick={() => { setLocked(false); setAdding(true); }} className="text-small font-medium text-brand-700 hover:underline">Add a price</button>}
      </div>
      <Alert>{error}</Alert>
      {!rows && !error && <div className="h-24 animate-pulse rounded-(--radius-card) bg-surface-3" />}
      {rows?.length === 0 && !adding && <p className="rounded-(--radius-card) border border-dashed border-line-strong p-5 text-center text-small text-ink-500">No agreed prices yet. Add them and new orders fill in by themselves, and a bill above the agreed price is flagged when the goods come in.</p>}
      {rows?.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
          {rows.map((r) => {
            const diff = r.last_paid && r.price ? r.last_paid - r.price : 0;
            return (
              <li key={r.product_id} className="flex items-center gap-3 px-4 py-2.5">
                <button type="button" onClick={() => edit(r)} className="min-w-0 flex-1 text-left" aria-label={`Edit ${r.name} price`}>
                  <span className="block truncate text-small font-medium text-ink-900">{r.name}</span>
                  <span className="tabular block text-caption text-ink-500">
                    {[r.min_qty > 1 && `min ${qty(r.min_qty)} ${r.unit || ''}`, r.lead_time_days != null && `${r.lead_time_days} day${r.lead_time_days === 1 ? '' : 's'} to deliver`, r.last_paid > 0 && `your cost now ${formatCurrency(r.last_paid)}`].filter(Boolean).join(' · ') || 'Tap to edit'}
                  </span>
                </button>
                <span className="tabular shrink-0 text-right">
                  <span className="block text-small font-semibold text-ink-900">{formatCurrency(r.price)}{r.unit && <span className="font-normal text-ink-500"> / {r.unit}</span>}</span>
                  {Math.abs(diff) >= 0.01 && <span className={`block text-caption ${diff > 0 ? 'text-success' : 'text-warning'}`}>{diff > 0 ? 'cheaper than your cost' : 'dearer than your cost'}</span>}
                </span>
                <button type="button" onClick={() => remove(r)} aria-label={`Remove ${r.name}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-400 hover:bg-surface-2 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <form onSubmit={save} className="mt-2 space-y-3 rounded-(--radius-card) border border-brand-500/40 bg-brand-50/40 p-3.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Field id="pl-p" label="Product">
                <Select id="pl-p" value={draft.product_id} onChange={(e) => setDraft((d) => ({ ...d, product_id: e.target.value }))} required disabled={locked}>
                  <option value="">Choose…</option>
                  {(products.length ? products : (rows || []).map((r) => ({ product_id: r.product_id, name: r.name }))).map((p) => <option key={p.product_id} value={p.product_id}>{p.name}{listed.has(String(p.product_id)) ? ' (listed)' : ''}</option>)}
                </Select>
              </Field>
            </div>
            <Field id="pl-price" label="Price before GST (₹)"><Input id="pl-price" type="number" min="0" step="0.01" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} required /></Field>
            <Field id="pl-min" label="Minimum order"><Input id="pl-min" type="number" min="0" step="0.001" value={draft.min_qty} onChange={(e) => setDraft((d) => ({ ...d, min_qty: e.target.value }))} placeholder="1" /></Field>
            <Field id="pl-lead" label="Days to deliver"><Input id="pl-lead" type="number" min="0" max="365" value={draft.lead_time_days} onChange={(e) => setDraft((d) => ({ ...d, lead_time_days: e.target.value }))} /></Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft({ product_id: '', price: '', min_qty: '', lead_time_days: '' }); }}>Cancel</Button>
            <Button type="submit" size="sm">{editingExisting ? 'Update price' : 'Save price'}</Button>
          </div>
        </form>
      )}
    </section>
  );
};

/* ── One supplier ─────────────────────────────────────────────────────── */

const Stat = ({ label, value, note, tone }) => (
  <div className="rounded-(--radius-card) border border-line bg-surface p-3.5">
    <p className="text-caption text-ink-500">{label}</p>
    <p className={`tabular mt-1 text-title font-semibold ${tone || 'text-ink-900'}`}>{value}</p>
    {note && <p className="mt-0.5 text-caption text-ink-500">{note}</p>}
  </div>
);

const OrderRow = ({ po }) => {
  const [label, cls] = poChip(po);
  const owed = ['RECEIVED', 'PARTIAL'].includes(po.status) && po.balance_due > 0;
  return (
    <li>
      <Link to={`/app/purchases?po=${po.po_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
        <span className="min-w-0 flex-1">
          <span className={`block text-small font-medium ${po.status === 'CANCELLED' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{po.po_number}</span>
          <span className="block text-caption text-ink-500">{po.status === 'ORDERED' && po.expected_date ? `Expected ${day(po.expected_date)}` : day(po.po_date)}</span>
        </span>
        <span className="tabular text-right">
          <span className={`block text-small font-semibold ${po.status === 'CANCELLED' ? 'text-ink-400' : 'text-ink-900'}`}>{formatCurrency(po.total)}</span>
          {owed && <span className="block text-caption font-medium text-warning">{formatCurrency(po.balance_due)} due</span>}
        </span>
        <span className={`w-24 shrink-0 rounded px-1.5 py-0.5 text-center text-caption font-semibold ${cls}`}>{label}</span>
      </Link>
    </li>
  );
};

const SupplierPanel = ({ supplier: s, onEdit, onBack }) => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    setOrders(null); setError(''); setShowAll(false);
    api(`/suppliers/${s.supplier_id}/purchases`).then(setOrders).catch((e) => setError(e.message));
  }, [s.supplier_id]);

  const unpaid = (orders || []).filter((o) => ['RECEIVED', 'PARTIAL'].includes(o.status) && o.balance_due > 0);
  const coming = (orders || []).filter((o) => ['DRAFT', 'ORDERED', 'PARTIAL'].includes(o.status));
  const wa = mobile(s.phone);
  const newOrder = () => navigate('/app/purchases', { state: { prefill: { supplier_id: s.supplier_id, items: [] } } });
  const shown = showAll ? orders : (orders || []).slice(0, 8);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-4 sm:p-6">
        <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-900 xl:hidden"><ArrowLeft className="h-4 w-4" />All suppliers</button>
        <div className="flex items-start gap-3">
          <Initials name={s.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title font-semibold text-ink-900">{s.name}</h2>
            <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-500">
              {s.phone && <a href={`tel:${s.phone.replace(/\s/g, '')}`} className="flex items-center gap-1.5 hover:text-brand-700"><Phone aria-hidden="true" className="h-3.5 w-3.5" />{s.phone}</a>}
              {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-brand-700"><MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />WhatsApp</a>}
              {s.email && <a href={`mailto:${s.email}`} className="flex min-w-0 items-center gap-1.5 hover:text-brand-700"><Mail aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{s.email}</span></a>}
              {!s.phone && !s.email && 'No contact details'}
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={newOrder}><Plus aria-hidden="true" className="h-4 w-4" />New order</Button>
          <Button size="sm" variant="secondary" onClick={onEdit}>Edit details</Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        <Alert>{error}</Alert>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="You owe" value={formatCurrency(s.payable_balance)} tone={s.payable_balance > 0 ? 'text-warning' : undefined} note={unpaid.length ? `on ${unpaid.length} order${unpaid.length === 1 ? '' : 's'}` : 'all settled'} />
          <Stat label="Bought from them" value={formatCurrency(s.total_purchases)} note={`${s.received_orders} order${s.received_orders === 1 ? '' : 's'} received`} />
          <Stat label="Last delivery" value={s.last_po_date ? ago(s.last_po_date).replace(/^./, (c) => c.toUpperCase()) : '—'} note={day(s.last_po_date) || 'nothing received yet'} />
          <Stat label="On the way" value={coming.length} note={coming.length ? 'orders not fully in' : 'nothing ordered'} />
        </div>

        {unpaid.length > 0 && (
          <section aria-label="To pay" className="rounded-(--radius-card) border border-warning/40 bg-warning/5">
            <div className="px-4 pt-3.5">
              <p className="text-small font-semibold text-ink-900">{formatCurrency(s.payable_balance)} to pay on {unpaid.length} order{unpaid.length === 1 ? '' : 's'}</p>
              <p className="mt-0.5 text-caption text-ink-500">Open an order to record a payment against it.</p>
            </div>
            <ul className="mt-2 divide-y divide-line/70 border-t border-line/70">{unpaid.map((o) => <OrderRow key={o.po_id} po={o} />)}</ul>
          </section>
        )}

        <PriceList supplier={s} />

        <section aria-label="Orders">
          <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Orders {orders && <span className="tabular font-normal">· {orders.length}{orders.length === 100 ? '+' : ''}</span>}</h3>
          {!orders && !error && <div className="h-32 animate-pulse rounded-(--radius-card) bg-surface-3" />}
          {orders?.length === 0 && <p className="rounded-(--radius-card) border border-dashed border-line-strong p-5 text-center text-small text-ink-500">No orders with {s.name} yet.</p>}
          {orders?.length > 0 && (
            <div className="overflow-hidden rounded-(--radius-card) border border-line bg-surface">
              <ul className="divide-y divide-line">{shown.map((o) => <OrderRow key={o.po_id} po={o} />)}</ul>
              {!showAll && orders.length > 8 && <button type="button" onClick={() => setShowAll(true)} className="w-full border-t border-line py-2.5 text-small font-medium text-brand-700 hover:bg-surface-2">Show all {orders.length}</button>}
            </div>
          )}
        </section>

        {(s.gstin || s.address) && (
          <section aria-label="GST details">
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">For GST</h3>
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-small">
              {s.gstin && <><dt className="text-ink-500">GSTIN</dt><dd className="font-medium text-ink-900">{s.gstin}</dd></>}
              {s.address && <><dt className="text-ink-500">Address</dt><dd className="text-ink-900">{s.address}</dd></>}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
};

/* ── The screen ───────────────────────────────────────────────────────── */

const SupplierRow = ({ s, active, onOpen }) => (
  <li>
    <button type="button" onClick={onOpen} aria-current={active ? 'true' : undefined}
            className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-(--duration-fast) ${active ? 'bg-brand-50' : 'hover:bg-surface-2'}`}>
      <Initials name={s.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-small font-semibold text-ink-900">{s.name}</span>
        <span className="block truncate text-caption text-ink-500">
          {[s.phone, s.received_orders ? `${s.received_orders} order${s.received_orders === 1 ? '' : 's'} · last ${ago(s.last_po_date)}` : 'No orders yet', s.open_orders > 0 && `${s.open_orders} on the way`].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="tabular block text-small font-semibold text-ink-900">{formatCurrency(s.total_purchases)}</span>
        {s.payable_balance > 0 && <span className="tabular block text-caption font-medium text-warning">owe {formatCurrency(s.payable_balance)}</span>}
      </span>
    </button>
  </li>
);

const SuppliersPage = () => {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('s') ? Number(params.get('s')) : null;
  const [suppliers, setSuppliers] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('owed');
  const [editing, setEditing] = useState(null);

  const load = () => api('/suppliers').then((rows) => { setSuppliers(rows); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const open = (id) => setParams(id ? { s: String(id) } : {});

  const q = search.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k, , fn]) => [k, (suppliers || []).filter(fn).length])), [suppliers]);
  const shown = useMemo(() => {
    const fn = FILTERS.find(([k]) => k === filter)[2];
    return (suppliers || []).filter((s) => fn(s) && (!q || s.name.toLowerCase().includes(q) || String(s.gstin || '').toLowerCase().includes(q)
      || (digits.length >= 3 && String(s.phone || '').replace(/\D/g, '').includes(digits)))).sort(SORTS[sort][1]);
  }, [suppliers, filter, sort, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = (suppliers || []).find((s) => s.supplier_id === selectedId);
  const owed = (suppliers || []).reduce((t, s) => t + s.payable_balance, 0);

  return (
    <div className="-m-4 grid grid-cols-1 sm:-m-6 lg:-m-8 xl:h-[calc(100vh-3.5rem)] xl:grid-cols-[minmax(0,1fr)_460px]">
      <section aria-label="Supplier list" className={`min-w-0 p-4 sm:p-6 lg:p-8 xl:block xl:overflow-y-auto ${selectedId ? 'hidden' : 'block'}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-h3 font-semibold text-ink-900">Suppliers</h1>
            <p className="tabular mt-1 text-small text-ink-500">
              {suppliers ? <>{suppliers.length} supplier{suppliers.length === 1 ? '' : 's'}{owed > 0 && <> · <span className="font-medium text-warning">you owe {formatCurrency(owed)} to {counts.owed}</span></>}</> : 'Who you buy from, and what you owe them.'}
            </p>
          </div>
          <Button onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />Add supplier</Button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <span className="sr-only">Search suppliers</span>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, mobile or GSTIN" className="!pl-9" />
          </label>
          <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} className="!w-auto">
            {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </Select>
        </div>
        <div role="group" aria-label="Show" className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
                    className={`shrink-0 rounded-lg border px-3 py-1.5 text-small font-medium ${filter === key ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>
              {label} <span className={`tabular ml-1 ${filter === key ? 'text-white/70' : 'text-ink-400'}`}>{counts[key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="mt-4">
          <Alert>{error}</Alert>
          {!suppliers && !error && <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-3" />)}</div>}
          {suppliers?.length === 0 && (
            <div className="rounded-(--radius-card) border border-dashed border-line-strong p-10 text-center">
              <p className="text-body font-medium text-ink-900">No suppliers yet</p>
              <p className="mt-1 text-small text-ink-500">Add the people you buy stock from, so orders can be sent to them and what you owe them is tracked.</p>
              <Button className="mt-4" onClick={() => setEditing({})}>Add the first supplier</Button>
            </div>
          )}
          {suppliers?.length > 0 && shown.length === 0 && <p className="rounded-(--radius-card) border border-dashed border-line-strong p-8 text-center text-small text-ink-500">{filter === 'owed' && !q ? 'You don’t owe any supplier anything.' : filter === 'coming' && !q ? 'Nothing is on its way.' : 'No suppliers match.'}</p>}
          {shown.length > 0 && (
            <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
              {shown.map((s) => <SupplierRow key={s.supplier_id} s={s} active={s.supplier_id === selectedId} onOpen={() => open(s.supplier_id)} />)}
            </ul>
          )}
        </div>
      </section>

      <section aria-label="Selected supplier" className={`min-h-0 min-w-0 flex-col border-line bg-surface xl:flex xl:border-l ${selectedId ? 'flex min-h-[calc(100vh-3.5rem)] xl:min-h-0' : 'hidden'}`}>
        {selected ? (
          <SupplierPanel key={selected.supplier_id} supplier={selected} onEdit={() => setEditing(selected)} onBack={() => open(null)} />
        ) : selectedId && suppliers ? (
          <div className="p-8 text-center text-small text-ink-500">That supplier isn't in this list. <button type="button" onClick={() => open(null)} className="font-medium text-brand-700">Back to all</button></div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <p className="text-small font-medium text-ink-700">Pick a supplier to see what you owe them, their prices and every order</p>
          </div>
        )}
      </section>

      {editing && (
        <SupplierForm initial={editing.supplier_id ? editing : emptyForm} onClose={() => setEditing(null)}
                      onSaved={(saved) => { const isNew = !editing.supplier_id; setEditing(null); toast.success(isNew ? `${saved.name} added` : 'Saved'); load(); if (isNew) open(saved.supplier_id); }} />
      )}
    </div>
  );
};

export default SuppliersPage;
