/*
 * Offers the till applies by itself: a percentage off, buy X get Y free, or N for one price, for one product or a whole
 * category, between two dates, optionally only for a customer on the bill. The till shows what an offer took off each
 * line, and the server works the same figure out when the bill is made.
 */
import { useEffect, useMemo, useState } from 'react';
import { Percent, Plus, Tag, Trash2 } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { useSwr } from '../lib/useSwr.js';
import { useAuth } from '../context/AuthContext.jsx';
import { localSearch } from '../lib/posCatalog.js';
import { usePosCatalog } from '../lib/usePosCatalog.js';
import { Alert, Button, Field, Input, Modal, Select, useDialog, useToast } from '../components/ui.jsx';

const KINDS = [
  ['PERCENT_OFF', 'Percentage off', 'for example 10% off, or 15% off when you buy 3 or more'],
  ['BUY_X_GET_Y', 'Buy some, get some free', 'for example buy 1 get 1 free'],
  ['BUNDLE_PRICE', 'A bundle price', 'for example 3 for ₹140'],
  ['MIX_BUNDLE', 'Mix and match', 'for example any 3 of these biscuits for ₹50']
];
const DAYS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]];

const describe = (o) => {
  if (o.kind === 'PERCENT_OFF') return `${o.percent}% off${o.min_qty > 1 ? ` when you buy ${o.min_qty} or more` : ''}`;
  if (o.kind === 'BUY_X_GET_Y') return `Buy ${o.buy_qty}, get ${o.get_qty} free`;
  if (o.kind === 'MIX_BUNDLE') return `Any ${o.bundle_qty} for ${formatCurrency(o.bundle_price)}`;
  return `${o.bundle_qty} for ${formatCurrency(o.bundle_price)}`;
};
const when = (o) => {
  const days = o.days_of_week ? DAYS.filter(([, d]) => o.days_of_week.includes(d)).map(([n]) => n).join(', ') : null;
  return [days, o.start_time ? `${o.start_time} to ${o.end_time}` : null].filter(Boolean).join(', ');
};
const target = (o) => (o.kind === 'MIX_BUNDLE' ? `${o.products.length} products` : o.product_name || `All ${o.category_name}`);
const span = (o) => (o.starts_on || o.ends_on ? `${o.starts_on ? `from ${o.starts_on} ` : ''}${o.ends_on ? `until ${o.ends_on}` : ''}`.trim() : 'no end date');

const blank = { name: '', kind: 'PERCENT_OFF', target: 'product', product: null, products: [], days: [], start_time: '', end_time: '', category_id: '', percent: '10', min_qty: '1', buy_qty: '1', get_qty: '1', bundle_qty: '3', bundle_price: '', members_only: false, starts_on: '', ends_on: '' };

const OfferForm = ({ categories, onClose, onSaved }) => {
  const { business, outletId } = useAuth();
  const catalog = usePosCatalog(`${business?.business_id}-${outletId}`);
  const [f, setF] = useState(blank);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const toggleDay = (d) => setF((x) => ({ ...x, days: x.days.includes(d) ? x.days.filter((v) => v !== d) : [...x.days, d] }));
  const mix = f.kind === 'MIX_BUNDLE';
  const hits = useMemo(() => (q.trim().length >= 2 ? localSearch(q, 6) : []), [q, catalog.count]);   // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const body = {
        name: f.name, kind: f.kind, members_only: f.members_only, starts_on: f.starts_on || undefined, ends_on: f.ends_on || undefined,
        days_of_week: f.days.length ? f.days : undefined, start_time: f.start_time || undefined, end_time: f.end_time || undefined,
        ...(mix ? { product_ids: f.products.map((p) => p.product_id) } : f.target === 'product' ? { product_id: f.product?.product_id } : { category_id: f.category_id ? Number(f.category_id) : undefined }),
        ...(f.kind === 'PERCENT_OFF' ? { percent: Number(f.percent), min_qty: Number(f.min_qty) } : {}),
        ...(f.kind === 'BUY_X_GET_Y' ? { buy_qty: Number(f.buy_qty), get_qty: Number(f.get_qty) } : {}),
        ...(f.kind === 'BUNDLE_PRICE' || mix ? { bundle_qty: Number(f.bundle_qty), bundle_price: f.bundle_price } : {})
      };
      await api('/retail/promotions', { method: 'POST', body });
      onSaved();
    } catch (caught) { setError(caught.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="New offer" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="of-name" label="Name" hint="Shown on the bill line, so customers see what they got."><Input id="of-name" value={f.name} maxLength={80} onChange={set('name')} placeholder="e.g. Milk 3 for ₹140" required /></Field>
        <Field id="of-kind" label="What kind of offer">
          <Select id="of-kind" value={f.kind} onChange={set('kind')}>{KINDS.map(([v, l, h]) => <option key={v} value={v}>{l}: {h}</option>)}</Select>
        </Field>

        {mix && (
          <div className="relative">
            <Field id="of-mix" label="Products in the bundle" hint="Pick two or more. Any of them can make up the bundle.">
              <Input id="of-mix" placeholder="Search by name, SKU or barcode, then tap to add" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            </Field>
            {hits.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
                {hits.filter((p) => !f.products.some((x) => x.product_id === p.product_id)).map((p) => <li key={p.product_id}><button type="button" onClick={() => { setF((x) => ({ ...x, products: [...x.products, p] })); setQ(''); }} className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-small hover:bg-surface-2"><span className="truncate font-medium text-ink-900">{p.name}</span><span className="text-caption text-ink-500">{formatCurrency(p.selling_price)}</span></button></li>)}
              </ul>
            )}
            {f.products.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {f.products.map((p) => <span key={p.product_id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-small text-brand-700">{p.name}<button type="button" aria-label={`Remove ${p.name}`} onClick={() => setF((x) => ({ ...x, products: x.products.filter((v) => v.product_id !== p.product_id) }))} className="rounded-full hover:bg-brand-100"><Trash2 aria-hidden="true" className="h-3 w-3" /></button></span>)}
              </div>
            )}
          </div>
        )}
        {!mix && <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
          <Field id="of-target" label="Applies to"><Select id="of-target" value={f.target} onChange={set('target')}><option value="product">One product</option><option value="category">A whole category</option></Select></Field>
          {f.target === 'product' ? (
            <div className="relative">
              <Field id="of-product" label="Product">
                {f.product
                  ? <p className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-line-strong px-3 text-sm"><span className="truncate font-medium text-ink-900">{f.product.name}</span><button type="button" onClick={() => setF((x) => ({ ...x, product: null }))} className="text-small font-medium text-brand-600 hover:underline">Change</button></p>
                  : <Input id="of-product" placeholder="Search by name, SKU or barcode" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />}
              </Field>
              {!f.product && hits.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
                  {hits.map((p) => <li key={p.product_id}><button type="button" onClick={() => { setF((x) => ({ ...x, product: p })); setQ(''); }} className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-small hover:bg-surface-2"><span className="truncate font-medium text-ink-900">{p.name}</span><span className="text-caption text-ink-500">{formatCurrency(p.selling_price)}</span></button></li>)}
                </ul>
              )}
            </div>
          ) : (
            <Field id="of-cat" label="Category"><Select id="of-cat" value={f.category_id} onChange={set('category_id')} required><option value="">Choose…</option>{categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</Select></Field>
          )}
        </div>}

        {f.kind === 'PERCENT_OFF' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="of-percent" label="Percent off"><Input id="of-percent" inputMode="decimal" value={f.percent} onChange={set('percent')} required /></Field>
            <Field id="of-min" label="From quantity" hint="1 means every sale."><Input id="of-min" inputMode="decimal" value={f.min_qty} onChange={set('min_qty')} /></Field>
          </div>
        )}
        {f.kind === 'BUY_X_GET_Y' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="of-buy" label="Customer buys"><Input id="of-buy" inputMode="numeric" value={f.buy_qty} onChange={set('buy_qty')} required /></Field>
            <Field id="of-get" label="And gets free"><Input id="of-get" inputMode="numeric" value={f.get_qty} onChange={set('get_qty')} required /></Field>
          </div>
        )}
        {(f.kind === 'BUNDLE_PRICE' || mix) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="of-bq" label="Units in the bundle"><Input id="of-bq" inputMode="numeric" value={f.bundle_qty} onChange={set('bundle_qty')} required /></Field>
            <Field id="of-bp" label="Bundle price (₹)" hint="With GST, as on the shelf."><Input id="of-bp" inputMode="decimal" value={f.bundle_price} onChange={set('bundle_price')} required /></Field>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="of-from" label="Starts" hint="Optional."><Input id="of-from" type="date" value={f.starts_on} onChange={set('starts_on')} /></Field>
          <Field id="of-to" label="Ends" hint="Optional. The last day it applies."><Input id="of-to" type="date" value={f.ends_on} onChange={set('ends_on')} /></Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-700">Days <span className="font-normal text-ink-400">(none ticked means every day)</span></legend>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(([label, d]) => <button key={d} type="button" aria-pressed={f.days.includes(d)} onClick={() => toggleDay(d)} className={`h-9 min-w-12 rounded-lg border px-2.5 text-small font-medium ${f.days.includes(d) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700'}`}>{label}</button>)}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="of-st" label="From (time of day)" hint="Optional, like 16:00."><Input id="of-st" type="time" value={f.start_time} onChange={set('start_time')} /></Field>
          <Field id="of-et" label="Until" hint="Both, or neither. An end before the start runs overnight."><Input id="of-et" type="time" value={f.end_time} onChange={set('end_time')} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={f.members_only} onChange={set('members_only')} className="h-4 w-4 accent-[var(--color-brand-500)]" />Only when the bill has a customer on it</label>
        <p className="text-xs text-ink-400">If several offers fit one product, the one that saves the most is used. Offers never add up on top of each other.</p>
        <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!mix && f.target === 'product' && !f.product) || (mix && f.products.length < 2)}>{busy ? 'Saving…' : 'Save the offer'}</Button></div>
      </form>
    </Modal>
  );
};

const OffersPage = () => {
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const { business, outletId } = useAuth();
  const { data: rows, reload } = useSwr('/retail/promotions', `${business?.business_id}-${outletId}`);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = reload;
  useEffect(() => { api('/categories').then(setCategories).catch(() => {}); }, []);

  if (!can('products') && !can('settings')) return <Alert>You do not have access to offers.</Alert>;

  const toggle = async (o) => { try { await api(`/retail/promotions/${o.promo_id}`, { method: 'PUT', body: { is_active: !o.is_active } }); load(); } catch (e) { toast.error(e.message); } };
  const remove = async (o) => {
    if (!(await dialog.confirm({ title: `Remove “${o.name}”?`, body: 'Bills already made keep what they were charged.', confirmLabel: 'Remove', danger: true }))) return;
    try { await api(`/retail/promotions/${o.promo_id}`, { method: 'DELETE' }); load(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Offers</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-500">Offers the till applies by itself: percentage off, buy some get some free, or a bundle price.</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus aria-hidden="true" className="h-4 w-4" />New offer</Button>
      </div>
      <Alert>{error}</Alert>

      {rows?.length === 0 && (
        <div className="mt-8 flex flex-col items-center rounded-(--radius-card) border border-dashed border-line-strong px-6 py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600"><Tag aria-hidden="true" className="h-5 w-5" /></span>
          <p className="mt-3 text-sm font-semibold text-ink-900">No offers yet</p>
          <p className="mt-1 max-w-xs text-caption text-ink-500">Try “3 for ₹140” on milk, or 10% off a whole category this weekend.</p>
        </div>
      )}
      <ul className="mt-5 space-y-3" aria-label="Offers">
        {rows?.map((o) => (
          <li key={o.promo_id} className="flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-line bg-surface p-4">
            <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${o.live ? 'bg-success/10 text-success' : 'bg-surface-3 text-ink-400'}`}><Percent className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink-900">{o.name}</p>
              <p className="text-small text-ink-500">{describe(o)} · {target(o)} · {span(o)}{when(o) ? ` · ${when(o)}` : ''}{o.members_only ? ' · customers only' : ''}</p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${o.on_now ? 'bg-success/10 text-success' : 'bg-surface-3 text-ink-700'}`}>{o.on_now ? 'On now' : o.live ? 'Not now' : o.is_active ? 'Not today' : 'Off'}</span>
            <Button size="sm" variant="secondary" onClick={() => toggle(o)}>{o.is_active ? 'Switch off' : 'Switch on'}</Button>
            <button type="button" onClick={() => remove(o)} aria-label={`Remove ${o.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-400 hover:bg-danger/10 hover:text-danger"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      {creating && <OfferForm categories={categories} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); toast.success('Offer saved'); }} />}
    </div>
  );
};

export default OffersPage;
