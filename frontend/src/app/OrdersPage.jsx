/*
 * Running tabs — dine-in, takeaway and delivery orders that haven't been
 * billed yet. A tab is not a sale: nothing is charged, no stock moves and no
 * GST is worked out until "Bill" turns it into an invoice through the same
 * modules/billing.js transaction the POS uses (orders.controller.js bill()).
 *
 * Laid out like the till: the open orders on the left (with how long each has
 * been open, what is on it and where the kitchen is with it), the chosen order
 * on the right (add items, send to the kitchen, split, move, merge, and take
 * the money). /app/orders?order=ID opens one directly (the floor links here).
 * Billing takes the payment in the same step, paid in full by the chosen
 * method unless "Pay later" is picked, so no tab is closed as unpaid by accident.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bike, CheckCircle2, ChefHat, ClipboardList, Clock, Combine, Minus, MoveRight, Plus, Printer, Scissors, Search, ShoppingBag, Trash2, UtensilsCrossed, X } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { useAuth } from '../context/AuthContext.jsx';
import UpiCollect from '../components/UpiCollect.jsx';
import FoodMark from '../components/FoodMark.jsx';
import { LoyaltyCard, MobileLookup, PointsPanel, RewardHint } from '../components/LoyaltyCard.jsx';
import { getDevicePrefs, openDrawer, printKot as printKotSlip, printReceipt, setDevicePref } from '../lib/printing.js';
import ModifierPicker, { needsChoices, useModifierGroups } from '../components/ModifierPicker.jsx';
import { AnimatedNumber, Alert, Badge, Button, Field, Input, Modal, Select, humanize, useToast, useDialog, StatCard } from '../components/ui.jsx';
import { platformName } from '../lib/business.js';

const TYPE_LABEL = { DINE_IN: 'Dine-in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery' };
const TYPE_ICON = { DINE_IN: UtensilsCrossed, TAKEAWAY: ShoppingBag, DELIVERY: Bike };
const METHODS = [['CASH', 'Cash'], ['UPI', 'UPI'], ['CARD', 'Card'], ['BANK_TRANSFER', 'Bank'], ['OTHER', 'Other'], ['LATER', 'Pay later']];
const POLL_MS = 15000;

const minutesSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
const ageMin = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);
const age = (iso) => ageMin(minutesSince(iso));
const titleOf = (o) => o.table_name || (o.platform ? humanize(o.platform) : `Takeaway ${o.order_number}`);
const LONG_MIN = 45;
// food ready to take out, items still to send, or waiting too long
const needsAttention = (o) => { const s = o.summary || {}; return s.ready > 0 || s.not_sent > 0 || minutesSince(o.created_at) >= LONG_MIN; };

/* Where the kitchen is with an order, as one thin bar: amber not sent, blue cooking, green ready. */
const ProgressBar = ({ s }) => (s.not_sent + s.cooking + s.ready > 0 ? (
  <span aria-hidden="true" className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
    {s.not_sent > 0 && <span className="bg-warning" style={{ flex: s.not_sent }} />}
    {s.cooking > 0 && <span className="bg-brand-400" style={{ flex: s.cooking }} />}
    {s.ready > 0 && <span className="bg-success" style={{ flex: s.ready }} />}
  </span>
) : null);

/* ── Starting an order ─────────────────────────────────────────────────── */

const TablePicker = ({ onClose, onPick }) => {
  const [tables, setTables] = useState(null);
  useEffect(() => { api('/tables').then(setTables).catch(() => setTables([])); }, []);
  const free = (tables || []).filter((t) => !t.open_order_id);
  return (
    <Modal title="New dine-in order" onClose={onClose} wide>
      {!tables ? <p className="text-small text-ink-500">Loading tables…</p> : free.length === 0 ? (
        <p className="py-4 text-small text-ink-500">Every table has an order. Free one up, or add a table on the Tables screen.</p>
      ) : (
        <>
          <p className="mb-3 text-small text-ink-500">Pick the table.</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {free.map((t) => (
              <button key={t.table_id} type="button" onClick={() => onPick(t)}
                      className="rounded-(--radius-card) border border-line-strong px-3 py-3 text-left hover:border-brand-500 hover:bg-brand-50">
                <span className="block text-body font-semibold text-ink-900">{t.name}</span>
                <span className="block text-caption text-ink-500">{[t.zone, t.seats && `${t.seats} seats`].filter(Boolean).join(' · ') || 'Free'}</span>
                {t.next_reservation && <span className="mt-1 block text-caption font-medium text-warning">Booked {new Date(t.next_reservation.reserved_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
};

/* ── Floor operations: move, merge, split ─────────────────────────────── */

const OpenItemsPicker = ({ items, selected, setSelected }) => {
  const toggle = (item) => setSelected((cur) => {
    const next = { ...cur };
    if (next[item.order_item_id]) delete next[item.order_item_id]; else next[item.order_item_id] = item.quantity;
    return next;
  });
  const setQty = (item, q) => setSelected((cur) => ({ ...cur, [item.order_item_id]: Math.min(item.quantity, Math.max(1, q)) }));
  return (
    <ul className="space-y-1.5">
      {items.map((item) => {
        const on = selected[item.order_item_id] != null;
        return (
          <li key={item.order_item_id} className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-small ${on ? 'border-brand-500 bg-brand-50' : 'border-line'}`}>
            <label className="flex min-w-0 flex-1 items-center gap-3">
              <input type="checkbox" checked={on} onChange={() => toggle(item)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
              <span className="min-w-0">
                <span className="font-medium text-ink-900">{item.description}</span>
                {item.modifiers?.length > 0 && <span className="block truncate text-caption text-ink-500">{item.modifiers.map((m) => m.name).join(', ')}</span>}
              </span>
            </label>
            {on && item.quantity > 1 ? (
              <span className="flex items-center gap-2">
                <button type="button" aria-label="Fewer" onClick={() => setQty(item, selected[item.order_item_id] - 1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-line-strong"><Minus className="h-3 w-3" /></button>
                <span className="tabular w-12 text-center font-semibold">{selected[item.order_item_id]} / {item.quantity}</span>
                <button type="button" aria-label="More" onClick={() => setQty(item, selected[item.order_item_id] + 1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-line-strong"><Plus className="h-3 w-3" /></button>
              </span>
            ) : <span className="text-ink-500">× {item.quantity}</span>}
            <span className="tabular w-20 text-right font-semibold text-ink-900">{formatCurrency(item.unit_price * (on ? selected[item.order_item_id] : item.quantity))}</span>
          </li>
        );
      })}
    </ul>
  );
};

const selection = (selected) => Object.entries(selected).map(([id, quantity]) => ({ order_item_id: Number(id), quantity }));

/* Split the bill (a separate invoice for the chosen items) or move those items to another table. */
const SplitModal = ({ order, onDone, onClose }) => {
  const idem = useIdempotencyKey();
  const [mode, setMode] = useState('bill');
  const [selected, setSelected] = useState({});
  const [pay, setPay] = useState('CASH');
  const [tables, setTables] = useState([]);
  const [tableId, setTableId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState([]);
  const isDineIn = order.order_type === 'DINE_IN';
  const open = order.items.filter((i) => i.status !== 'CANCELLED' && !i.billed);

  useEffect(() => { if (isDineIn) api('/tables').then((rows) => setTables(rows.filter((t) => t.table_id !== order.table_id && (t.open_order_id || t.status === 'FREE')))).catch(() => {}); }, [isDineIn, order.table_id]);

  const chosen = selection(selected);
  const run = async () => {
    setBusy(true); setError('');
    try {
      if (mode === 'bill') {
        const invoice = await api(`/orders/${order.order_id}/bill`, {
          method: 'POST', idempotencyKey: idem.get(),
          body: { items: chosen, payment: pay !== 'LATER' ? { method: pay, amount: 'FULL' } : undefined }
        });
        idem.settle();
        setMade((m) => [...m, invoice]);
        setSelected({});
        if (invoice.order_closed) { onDone(invoice); return; }
      } else {
        await api(`/orders/${order.order_id}/split`, { method: 'POST', idempotencyKey: idem.get(), body: { items: chosen, table_id: Number(tableId) } });
        idem.settle();
        setSelected({});
      }
      onDone();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Split this order" onClose={onClose} wide>
      <div className="space-y-4">
        <div role="radiogroup" className="inline-flex rounded-lg border border-line p-1">
          {[['bill', 'Bill separately'], ...(isDineIn ? [['move', 'Move to another table']] : [])].map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={mode === key} onClick={() => setMode(key)}
                    className={`rounded-md px-3 py-1.5 text-small font-medium ${mode === key ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-surface-2'}`}>{label}</button>
          ))}
        </div>
        <p className="text-small text-ink-500">
          {mode === 'bill' ? 'Tick what one guest is paying for. They get their own invoice; the rest stays open.' : 'Tick what is moving. If that table already has an order, the items join it; otherwise a new order opens there.'}
        </p>
        <Alert>{error}</Alert>
        {made.length > 0 && (
          <p className="rounded-lg bg-success/10 p-3 text-small text-success">
            Billed: {made.map((m) => `${m.invoice_number} (${formatCurrency(m.total)}${m.payment_status === 'PAID' ? ', paid' : ''})`).join(' · ')}
          </p>
        )}
        {open.length === 0 ? <p className="text-small text-ink-500">Everything on this order has been billed.</p> : <OpenItemsPicker items={open} selected={selected} setSelected={setSelected} />}

        {open.length > 0 && (
          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
            {mode === 'bill' ? (
              <Field id="split-pay" label="Paid by">
                <Select id="split-pay" value={pay} onChange={(e) => setPay(e.target.value)}>
                  {METHODS.map(([v, l]) => <option key={v} value={v}>{v === 'LATER' ? 'Not paid yet' : l}</option>)}
                </Select>
              </Field>
            ) : (
              <Field id="split-table" label="Move to">
                <Select id="split-table" value={tableId} onChange={(e) => setTableId(e.target.value)}>
                  <option value="">Choose a table…</option>
                  {tables.map((t) => <option key={t.table_id} value={t.table_id}>{t.name}{t.open_order_id ? ` · has ${t.open_order_number}` : ' · free'}</option>)}
                </Select>
              </Field>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              <Button onClick={run} disabled={busy || !chosen.length || (mode === 'move' && !tableId)}>
                {busy ? 'Working…' : mode === 'bill' ? `Bill ${chosen.length || ''} selected`.trim() : 'Move selected'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

const MoveTableModal = ({ order, onDone, onClose }) => {
  const idem = useIdempotencyKey();
  const [tables, setTables] = useState([]);
  const [tableId, setTableId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api('/tables').then((rows) => setTables(rows.filter((t) => !t.open_order_id && t.status === 'FREE'))).catch(() => {}); }, []);

  const go = async () => {
    setBusy(true); setError('');
    try { await api(`/orders/${order.order_id}/transfer`, { method: 'POST', idempotencyKey: idem.get(), body: { table_id: Number(tableId) } }); idem.settle(); onDone(); }
    catch (caught) { idem.settle(caught); setError(caught.message); setBusy(false); }
  };
  return (
    <Modal title={`Move ${order.table_name || 'order'} to another table`} onClose={onClose}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="move-table" label="New table" hint={!tables.length ? 'No free tables right now.' : 'Only free tables are listed. To join two tables, use Merge.'}>
          <Select id="move-table" value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">Choose a table…</option>
            {tables.map((t) => <option key={t.table_id} value={t.table_id}>{t.name}{t.zone ? ` · ${t.zone}` : ''}</option>)}
          </Select>
        </Field>
        <Button onClick={go} disabled={busy || !tableId} className="w-full">{busy ? 'Moving…' : 'Move order'}</Button>
      </div>
    </Modal>
  );
};

const MergeModal = ({ order, onDone, onClose }) => {
  const idem = useIdempotencyKey();
  const [candidates, setCandidates] = useState([]);
  const [fromId, setFromId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/orders?open_only=true').then((rows) => setCandidates(rows.filter((o) => o.order_type === 'DINE_IN' && o.order_id !== order.order_id))).catch(() => {});
  }, [order.order_id]);

  const go = async () => {
    setBusy(true); setError('');
    try { await api(`/orders/${order.order_id}/merge`, { method: 'POST', idempotencyKey: idem.get(), body: { from_order_id: Number(fromId) } }); idem.settle(); onDone(); }
    catch (caught) { idem.settle(caught); setError(caught.message); setBusy(false); }
  };
  const picked = candidates.find((o) => String(o.order_id) === fromId);
  return (
    <Modal title={`Merge another table into ${order.table_name || order.order_number}`} onClose={onClose}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="merge-from" label="Merge in" hint={!candidates.length ? 'There is no other open dine-in order.' : undefined}>
          <Select id="merge-from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">Choose an order…</option>
            {candidates.map((o) => <option key={o.order_id} value={o.order_id}>{o.table_name} · {o.order_number}</option>)}
          </Select>
        </Field>
        {picked && <p className="rounded-lg bg-surface-2 p-3 text-small text-ink-700">Everything on {picked.table_name} moves onto this order and {picked.table_name} becomes free. This can't be undone, but you can split items back out.</p>}
        <Button onClick={go} disabled={busy || !fromId} className="w-full">{busy ? 'Merging…' : 'Merge orders'}</Button>
      </div>
    </Modal>
  );
};

/* ── One line on the order ─────────────────────────────────────────────── */

const ITEM_STATUS = { PENDING: ['Not sent', 'warning'], PREPARING: ['Cooking', 'brand'], READY: ['Ready', 'success'], SERVED: ['Served', 'neutral'], CANCELLED: ['Cancelled', 'neutral'] };

const OrderLine = ({ item, onQty, onCancel }) => {
  const [label, tone] = ITEM_STATUS[item.status] || [humanize(item.status), 'neutral'];
  const pending = item.status === 'PENDING' && !item.billed;
  const cancelled = item.status === 'CANCELLED';
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className={`text-small font-medium leading-snug ${cancelled ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
          {!pending && <span className="tabular mr-1.5">{item.quantity} ×</span>}{item.description}
        </p>
        {item.modifiers?.length > 0 && <p className="text-caption text-brand-700">{item.modifiers.map((m) => m.name).join(' · ')}</p>}
        {item.kitchen_notes && <p className="text-caption text-ink-500">“{item.kitchen_notes}”</p>}
        <p className="mt-1 flex items-center gap-2">
          <Badge tone={item.billed ? 'success' : tone}>{item.billed ? 'Billed' : label}</Badge>
          <span className="tabular text-caption text-ink-500">{formatCurrency(item.unit_price)} each</span>
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <p className="tabular text-small font-semibold text-ink-900">{formatCurrency(item.line_total)}</p>
        {pending && (
          <div className="flex items-center gap-1">
            <div className="flex items-center rounded-lg border border-line-strong">
              <button type="button" onClick={() => (item.quantity > 1 ? onQty(item, item.quantity - 1) : onCancel(item))} aria-label={`One less ${item.description}`} className="flex h-8 w-8 items-center justify-center hover:bg-surface-2"><Minus className="h-3.5 w-3.5" /></button>
              <span className="tabular w-8 text-center text-small font-medium">{item.quantity}</span>
              <button type="button" onClick={() => onQty(item, item.quantity + 1)} aria-label={`One more ${item.description}`} className="flex h-8 w-8 items-center justify-center hover:bg-surface-2"><Plus className="h-3.5 w-3.5" /></button>
            </div>
            <button type="button" onClick={() => onCancel(item)} aria-label={`Remove ${item.description}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-danger/5 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
          </div>
        )}
        {!pending && !cancelled && !item.billed && item.status !== 'SERVED' && (
          <button type="button" onClick={() => onCancel(item)} className="text-caption text-ink-500 hover:text-danger">Cancel</button>
        )}
      </div>
    </li>
  );
};

/* Tap to add: the menu as big buttons by category, the way a counter works.
   Each tap adds one; the count on a tile is how many are on this order. */
const MenuPicker = ({ products, counts, onAdd, onClose, title }) => {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const available = products.filter((p) => p.is_available !== false);
  const categories = useMemo(() => {
    const map = new Map();
    for (const p of available) { const k = p.category_name || 'Other'; map.set(k, (map.get(k) || 0) + 1); }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [products]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim().toLowerCase();
  const shown = available.filter((p) => (category === 'all' || (p.category_name || 'Other') === category) && (!q || p.name.toLowerCase().includes(q)));
  const total = Object.values(counts).reduce((t, n) => t + n, 0);
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="space-y-3">
        <label className="relative block">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <span className="sr-only">Search the menu</span>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the menu" className="!pl-9" />
        </label>
        <div role="group" aria-label="Category" className="flex gap-1.5 overflow-x-auto pb-1">
          {[['all', 'All', available.length], ...categories.map(([k, n]) => [k, k, n])].map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setCategory(k)} aria-pressed={category === k}
                    className={`shrink-0 rounded-lg border px-3 py-1.5 text-small font-medium ${category === k ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>
              {label} <span className={`tabular ml-0.5 ${category === k ? 'text-white/70' : 'text-ink-400'}`}>{n}</span>
            </button>
          ))}
        </div>
        <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
          {shown.map((p) => {
            const n = counts[p.product_id] || 0;
            return (
              <button key={p.product_id} type="button" onClick={() => onAdd(p)}
                      className={`relative flex min-h-[84px] flex-col justify-between rounded-(--radius-card) border p-3 text-left transition-colors duration-(--duration-fast) active:bg-brand-50 ${n ? 'border-brand-500 bg-brand-50/60' : 'border-line bg-surface hover:border-ink-400'}`}>
                <span className="flex items-start gap-1.5 pr-6"><span className="mt-[3px]"><FoodMark type={p.food_type} size={12} /></span><span className="line-clamp-2 text-small font-semibold text-ink-900">{p.name}</span></span>
                <span className="mt-2 flex items-baseline justify-between gap-1">
                  <span className="tabular text-small text-ink-700">{formatCurrency(p.selling_price)}</span>
                  {p.modifier_group_ids?.length > 0 && <span className="text-caption text-ink-500">options</span>}
                </span>
                {n > 0 && <span className="tabular absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-500 px-1.5 text-caption font-semibold text-white">{n}</span>}
              </button>
            );
          })}
          {shown.length === 0 && <p className="col-span-full py-6 text-center text-small text-ink-500">Nothing matches.</p>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <p className="tabular text-small text-ink-700">{total} item{total === 1 ? '' : 's'} on the order</p>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
};

/* ── The chosen order ──────────────────────────────────────────────────── */

const OrderPanel = ({ orderId, onChanged, onBack }) => {
  const dialog = useDialog();
  const billKey = useIdempotencyKey();
  const { business, hasFeature } = useAuth();
  const multiBrand = hasFeature('multi_brand');
  const deliveryFleet = hasFeature('delivery_fleet');
  const withGroups = useModifierGroups();
  const toast = useToast();
  const navigate = useNavigate();
  const [picking, setPicking] = useState(null);
  const [floorOp, setFloorOp] = useState(null);   // 'split' | 'move' | 'merge'
  const [rush, setRush] = useState(false);
  const [printKot, setPrintKot] = useState(() => getDevicePrefs().autoPrintKot);
  const [order, setOrder] = useState(null);
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [pointsInfo, setPointsInfo] = useState(null);
  const [redeem, setRedeem] = useState('');
  const [changingCustomer, setChangingCustomer] = useState(false);
  const [card, setCard] = useState(null);
  const [waiters, setWaiters] = useState([]);
  const [brands, setBrands] = useState([]);
  const [riders, setRiders] = useState([]);
  const [method, setMethod] = useState('CASH');
  const [received, setReceived] = useState('');
  const [done, setDone] = useState(null);         // the invoice, once billed
  const [collecting, setCollecting] = useState(null);   // billed, waiting for its UPI payment
  const [menuOpen, setMenuOpen] = useState(false);
  const openedFor = useRef(null);   // the order the menu opened for by itself, once
  const searchRef = useRef(null);

  const load = () => api(`/orders/${orderId}`).then((o) => {
    setOrder(o);
    if (openedFor.current !== o.order_id) { openedFor.current = o.order_id; if (o.items.length === 0 && !['BILLED', 'CANCELLED', 'MERGED'].includes(o.status)) setMenuOpen(true); }
  }).catch((e) => setError(e.message));
  useEffect(() => { setOrder(null); setDone(null); setError(''); setQuery(''); setCouponCode(''); setRedeem(''); setMethod('CASH'); setReceived(''); load(); }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api('/tables/waiters').then(setWaiters).catch(() => {}); api('/products?kind=DISH').then(setProducts).catch(() => {}); }, []);
  useEffect(() => { if (multiBrand) api('/brands').then(setBrands).catch(() => {}); }, [multiBrand]);
  useEffect(() => { if (deliveryFleet) api('/orders/riders').then(setRiders).catch(() => {}); }, [deliveryFleet]);

  useEffect(() => {
    if (!order?.customer_id) { setCard(null); setPointsInfo(null); return; }
    api(`/loyalty/customers/${order.customer_id}`).then((d) => { setCard(d.loyalty); setPointsInfo(d.points); }).catch(() => { setCard(null); setPointsInfo(null); });
  }, [order?.customer_id]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => (q ? products.filter((p) => p.is_available !== false && (p.name.toLowerCase().includes(q) || p.sku?.toLowerCase() === q || p.barcode?.toLowerCase() === q)).slice(0, 8) : []), [products, q]);

  const refresh = () => { load(); onChanged(); };
  const run = async (fn) => { setError(''); try { await fn(); refresh(); } catch (caught) { setError(caught.message); } };

  const addItem = (product, modifierIds = []) => run(async () => {
    setQuery(''); setPicking(null);
    const same = !modifierIds.length && order?.items.find((i) => i.product_id === product.product_id && i.status === 'PENDING' && !i.billed && !i.modifiers?.length && !i.kitchen_notes);
    if (same) await api(`/orders/${orderId}/items/${same.order_item_id}`, { method: 'PATCH', body: { quantity: same.quantity + 1 } });
    else await api(`/orders/${orderId}/items`, { method: 'POST', body: { items: [{ product_id: product.product_id, quantity: 1, modifier_ids: modifierIds }] } });
    if (!menuOpen) searchRef.current?.focus();
  });
  const choose = (p) => { const full = withGroups(p); if (needsChoices(full)) { setQuery(''); setPicking(full); } else addItem(p); };
  const setQty = (item, quantity) => run(() => api(`/orders/${orderId}/items/${item.order_item_id}`, { method: 'PATCH', body: { quantity } }));
  const cancelItem = async (item) => {
    if (item.status !== 'PENDING' && !(await dialog.confirm({ title: `Cancel ${item.description}?`, body: 'The kitchen will see it as cancelled.', confirmLabel: 'Cancel item', cancelLabel: 'Keep item', danger: true }))) return;
    run(() => api(`/orders/${orderId}/items/${item.order_item_id}`, { method: 'PATCH', body: { status: 'CANCELLED' } }));
  };
  const setWaiter = (id) => run(() => api(`/orders/${orderId}/waiter`, { method: 'PATCH', body: { waiter_user_id: id ? Number(id) : null } }));
  const setBrand = (id) => run(() => api(`/orders/${orderId}/brand`, { method: 'PATCH', body: { brand_id: id ? Number(id) : null } }));
  const setRider = (id) => run(() => api(`/orders/${orderId}/rider`, { method: 'PATCH', body: { rider_user_id: id ? Number(id) : null } }));
  const setDeliveryStatus = (status) => run(() => api(`/orders/${orderId}/delivery-status`, { method: 'POST', body: { status } }));
  const attachCustomer = (customer) => run(async () => { await api(`/orders/${orderId}/customer`, { method: 'PATCH', body: { customer_id: customer?.customer_id ?? null } }); setChangingCustomer(false); });
  const cancelOrder = async () => {
    if (!(await dialog.confirm({ title: 'Cancel this whole order?', body: 'Items not yet billed are cancelled and the kitchen is told.', confirmLabel: 'Cancel order', cancelLabel: 'Keep order', danger: true }))) return;
    run(async () => { await api(`/orders/${orderId}/cancel`, { method: 'POST' }); toast.success('Order cancelled'); onBack(); });
  };

  const pendingCount = order?.items.filter((i) => i.status === 'PENDING').length || 0;
  const sendKot = async () => {
    setBusy(true); setError('');
    try {
      const kot = await api(`/orders/${orderId}/kot`, { method: 'POST', body: { priority: rush ? 'RUSH' : 'NORMAL' } });
      setRush(false); refresh();
      toast.success(`Sent to the kitchen${kot?.kot_number ? ` (${kot.kot_number})` : ''}`);
      if (printKot) printKotSlip(kot.kot_id);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const open = order ? order.items.filter((i) => i.status !== 'CANCELLED' && !i.billed) : [];
  // GST added the way the bill adds it; coupons, points and round-off are only known once billed
  const gstOn = Boolean(business?.gst_enabled);
  const withTax = (i, amount) => amount * (1 + (gstOn ? Number(i.tax_rate || 0) / 100 : 0));
  // the loyalty reward comes off the bill: up to reward_quantity of the reward item, tax and all
  const rewardLine = card?.reward_ready ? open.find((i) => i.product_id === card.reward_product_id) : null;
  const rewardOff = rewardLine ? withTax(rewardLine, Math.min(rewardLine.quantity, card.reward_quantity || 1) * rewardLine.unit_price) : 0;
  const itemCount = open.reduce((n, i) => n + Number(i.quantity), 0);
  const subtotal = open.reduce((sum, i) => sum + Number(i.line_total), 0);
  const gst = open.reduce((sum, i) => sum + withTax(i, i.line_total), 0) - subtotal;
  const total = Math.max(0, Math.round((subtotal + gst - rewardOff) * 100) / 100);
  const payLater = method === 'LATER';
  const amount = received === '' ? null : Number(received);
  const partial = !payLater && amount != null && amount < total;
  const change = method === 'CASH' && amount != null && amount > total ? amount - total : 0;
  // UPI with the business's UPI ID set: bill first, then a QR for exactly what the bill came to
  const upiQr = method === 'UPI' && Boolean(business?.upi_vpa);

  const billOrder = async () => {
    setBusy(true); setError('');
    try {
      const invoice = await api(`/orders/${orderId}/bill`, {
        method: 'POST', idempotencyKey: billKey.get(),
        body: {
          coupon_code: couponCode.trim() || undefined,
          redeem_points: Number(redeem) > 0 ? Number(redeem) : undefined,
          payment: payLater || upiQr ? undefined : { method, amount: amount ?? 'FULL' }
        }
      });
      billKey.settle();
      if (upiQr) { setCollecting({ invoice, amount: partial ? amount : undefined }); onChanged(); return; }
      const cash = method === 'CASH' && !payLater;
      if (getDevicePrefs().autoPrintReceipt) printReceipt(invoice.invoice_id, { cash });
      else if (cash && getDevicePrefs().openDrawer) openDrawer();
      setDone({ ...invoice, change: method === 'CASH' && amount != null ? Math.max(0, Math.round((amount - invoice.total) * 100) / 100) : 0 });
      onChanged();
    } catch (caught) { billKey.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  const finishUpi = (invoice) => {
    setCollecting(null); setDone({ ...invoice, change: 0 });
    if (getDevicePrefs().autoPrintReceipt) printReceipt(invoice.invoice_id, { cash: false });
  };
  if (collecting) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-small text-ink-500">
        Waiting for the UPI payment on {collecting.invoice.invoice_number}…
        <UpiCollect invoice={collecting.invoice} amount={collecting.amount} vpa={business.upi_vpa} payee={business.name}
                    onPaid={finishUpi} onLater={() => finishUpi(collecting.invoice)} />
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <CheckCircle2 aria-hidden="true" className="h-10 w-10 text-success" />
        <p className="mt-3 text-caption font-semibold uppercase tracking-[0.12em] text-success">Bill saved</p>
        <p className="mt-1 text-h3 font-semibold text-ink-900">{done.invoice_number}</p>
        <p className="tabular mt-2 text-[36px] font-semibold leading-none tracking-tight text-ink-900">{formatCurrency(done.total)}</p>
        {done.change > 0 && <p className="tabular mt-4 rounded-lg bg-brand-50 px-3 py-2 text-body font-semibold text-brand-700">Give back {formatCurrency(done.change)} change</p>}
        <p className="mt-3 text-small text-ink-500">{done.payment_status === 'PAID' ? 'Paid in full.' : done.payment_status === 'PARTIAL' ? `Part paid. ${formatCurrency(done.balance_due)} still due.` : `Not paid yet. ${formatCurrency(done.balance_due ?? done.total)} due.`}</p>
        <div className="mt-6 grid w-full max-w-xs gap-2">
          <Button onClick={onBack}>Back to orders</Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => printReceipt(done.invoice_id)}><Printer aria-hidden="true" className="h-4 w-4" />Print</Button>
            <Button variant="secondary" onClick={() => navigate(`/app/billing/invoices/${done.invoice_id}`)}>View bill</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!order) return <div className="p-6"><Alert>{error}</Alert>{!error && <p className="text-small text-ink-500">Loading the order…</p>}</div>;

  // A platform order waiting on the counter: nothing is sent to the kitchen until this is decided.
  if (order.status === 'PENDING_ACCEPT') {
    const acceptDelivery = () => run(async () => {
      const res = await api(`/orders/${orderId}/accept`, { method: 'POST' });
      toast.success(`Sent to the kitchen · ${res.kot_number}`);
    });
    const rejectDelivery = async () => {
      const reason = await dialog.prompt({ title: `Turn down this ${platformName(order.platform)} order`, label: 'Reason', body: 'The platform sees this.', required: false, confirmLabel: 'Turn down', danger: true });
      if (reason == null) return;
      run(async () => { await api(`/orders/${orderId}/reject`, { method: 'POST', body: { reason } }); toast.success('Order turned down'); onBack(); });
    };
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <button type="button" onClick={onBack} aria-label="Back to orders" className="-ml-1 rounded-lg p-1 text-ink-500 hover:bg-surface-2 lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger"><Bike aria-hidden="true" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title font-semibold text-ink-900">New {platformName(order.platform)} order</h2>
            <p className="text-caption text-ink-500">{order.order_number}{order.external_order_number ? ` · their order ${order.external_order_number}` : ''} · {order.customer_name || 'Customer'} · waiting {age(order.created_at)}</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Alert>{error}</Alert>
          <p className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Items</p>
          <ul className="divide-y divide-line">
            {order.items.map((i) => (
              <li key={i.order_item_id} className="flex items-start justify-between gap-3 py-2.5">
                <span><span className="tabular mr-1.5 font-semibold">{i.quantity} ×</span>{i.description}{i.kitchen_notes && <span className="block text-caption text-ink-500">“{i.kitchen_notes}”</span>}</span>
                <span className="tabular shrink-0 font-semibold text-ink-900">{formatCurrency(i.line_total)}</span>
              </li>
            ))}
          </ul>
          {order.notes && <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-small text-ink-900">“{order.notes}”</p>}
        </div>
        <div className="border-t border-line p-5">
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" variant="secondary" onClick={rejectDelivery} disabled={busy} className="border-danger/40 text-danger hover:bg-danger/5">Reject</Button>
            <Button size="lg" onClick={acceptDelivery} disabled={busy}><ChefHat aria-hidden="true" className="h-4 w-4" />{busy ? 'Working…' : 'Accept · send to kitchen'}</Button>
          </div>
        </div>
      </div>
    );
  }

  const Icon = TYPE_ICON[order.order_type] || ShoppingBag;
  const closed = ['BILLED', 'CANCELLED', 'MERGED'].includes(order.status);
  const isDineIn = order.order_type === 'DINE_IN';
  const isDelivery = order.order_type === 'DELIVERY';
  const billedCount = order.items.filter((i) => i.billed).length;
  const notSent = order.items.filter((i) => i.status === 'PENDING');
  const inKitchen = order.items.filter((i) => i.status !== 'PENDING');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="border-b border-line px-5 py-3">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onBack} aria-label="Back to orders" className="-ml-1 mt-0.5 rounded-lg p-1 text-ink-500 hover:bg-surface-2 lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
          <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isDineIn ? 'bg-brand-50 text-brand-600' : 'bg-ink-900 text-white'}`}><Icon aria-hidden="true" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[20px] font-bold leading-tight text-ink-900">{titleOf(order)}</h2>
            <p className="flex flex-wrap items-center gap-x-1.5 text-caption text-ink-500">
              <span>{TYPE_LABEL[order.order_type]}</span>
              {!titleOf(order).includes(order.order_number) && <span>· {order.order_number}</span>}
              <span className={`flex items-center gap-1 ${minutesSince(order.created_at) >= LONG_MIN ? 'font-semibold text-danger' : ''}`}>· <Clock aria-hidden="true" className="h-3 w-3" />{age(order.created_at)}</span>
              {order.customer_name && <span>· {order.customer_name}</span>}
            </p>
          </div>
          {!closed && <button type="button" onClick={cancelOrder} className="rounded-md px-2 py-1 text-caption font-medium text-ink-500 hover:bg-danger/5 hover:text-danger">Cancel order</button>}
        </div>
        {!closed && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setFloorOp('split')} disabled={total === 0}><Scissors aria-hidden="true" className="h-3.5 w-3.5" />Split</Button>
            {isDineIn && order.table_id && <Button size="sm" variant="secondary" onClick={() => setFloorOp('move')}><MoveRight aria-hidden="true" className="h-3.5 w-3.5" />Move table</Button>}
            {isDineIn && <Button size="sm" variant="secondary" onClick={() => setFloorOp('merge')}><Combine aria-hidden="true" className="h-3.5 w-3.5" />Merge</Button>}
            {isDineIn && (
              <Select aria-label="Waiter" className="!h-8 !w-auto !py-0 text-small" value={order.waiter_user_id || ''} onChange={(e) => setWaiter(e.target.value)}>
                <option value="">No waiter</option>
                {waiters.map((w) => <option key={w.user_id} value={w.user_id}>{w.name}</option>)}
              </Select>
            )}
            {multiBrand && brands.length > 0 && (
              <Select aria-label="Brand" className="!h-8 !w-auto !py-0 text-small" value={order.brand_id || ''} onChange={(e) => setBrand(e.target.value)}>
                <option value="">No brand</option>
                {brands.map((b) => <option key={b.brand_id} value={b.brand_id}>{b.name}</option>)}
              </Select>
            )}
            {isDelivery && deliveryFleet && riders.length > 0 && (
              <Select aria-label="Rider" className="!h-8 !w-auto !py-0 text-small" value={order.rider_user_id || ''} onChange={(e) => setRider(e.target.value)}>
                <option value="">No rider</option>
                {riders.map((r) => <option key={r.user_id} value={r.user_id}>{r.name}</option>)}
              </Select>
            )}
          </div>
        )}
        {isDelivery && deliveryFleet && order.rider_user_id && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {[['PICKED_UP', 'Picked up', order.picked_up_at], ['OUT_FOR_DELIVERY', 'Out for delivery', order.out_for_delivery_at], ['DELIVERED', 'Delivered', order.delivered_at]].map(([status, label, done], i, steps) => {
              const priorDone = i === 0 || steps[i - 1][2];
              return (
                <Button key={status} size="sm" variant={done ? 'primary' : 'secondary'} disabled={!priorDone || closed} onClick={() => setDeliveryStatus(status)}>
                  {done && <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />}{label}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {/* add items */}
      {!closed && (
        <div className="relative flex gap-2 border-b border-line px-5 py-3">
          <Button onClick={() => setMenuOpen(true)} className="shrink-0"><UtensilsCrossed aria-hidden="true" className="h-4 w-4" />Menu</Button>
          <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); choose(results[0]); } if (e.key === 'Escape') setQuery(''); }}
                 placeholder="or type a name / scan" aria-label="Add an item to this order"
                 className="h-10 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-small text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none" />
          {results.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
              {results.map((p) => (
                <li key={p.product_id}>
                  <button type="button" onClick={() => choose(p)} className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-small hover:bg-surface-2">
                    <span className="font-medium text-ink-900">{p.name}{p.modifier_group_ids?.length ? <span className="ml-2 text-caption text-ink-500">options</span> : null}</span>
                    <span className="tabular font-semibold text-ink-900">{formatCurrency(p.selling_price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          </div>
        </div>
      )}

      {/* items */}
      <div className="min-h-[140px] flex-1 overflow-y-auto px-5">
        <Alert>{error}</Alert>
        {order.items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-10 text-center">
            <p className="text-small font-medium text-ink-700">Nothing on this order yet</p>
            <p className="mt-1 text-caption text-ink-500">Tap Menu to add items, then send them to the kitchen.</p>
            {!closed && <Button className="mt-3" onClick={() => setMenuOpen(true)}>Open the menu</Button>}
          </div>
        ) : (
          <>
            {notSent.length > 0 && (
              <section className="pt-3">
                <h3 className="text-caption font-semibold uppercase tracking-[0.12em] text-warning">Not sent to the kitchen</h3>
                <ul className="divide-y divide-line">{notSent.map((i) => <OrderLine key={i.order_item_id} item={i} onQty={setQty} onCancel={cancelItem} />)}</ul>
              </section>
            )}
            {inKitchen.length > 0 && (
              <section className="pt-3">
                <h3 className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Sent to the kitchen</h3>
                <ul className="divide-y divide-line">{inKitchen.map((i) => <OrderLine key={i.order_item_id} item={i} onQty={setQty} onCancel={cancelItem} />)}</ul>
              </section>
            )}
            {order.kots?.length > 0 && (
              <p className="flex flex-wrap items-center gap-1.5 pb-3 pt-1 text-caption text-ink-500">
                Tickets:
                {order.kots.map((k) => <button key={k.kot_id} type="button" onClick={() => printKotSlip(k.kot_id)} className="rounded-md border border-line-strong px-2 py-0.5 font-medium text-ink-700 hover:bg-surface-2">{k.kot_number} · reprint</button>)}
              </p>
            )}
          </>
        )}
      </div>

      {/* kitchen, customer, money */}
      {!closed && (
        <div className="border-t border-line px-5 py-4">
          {pendingCount > 0 && (
            <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3 text-caption text-ink-700">
                  <label className="flex items-center gap-1.5" title="Puts this ticket on top of the kitchen screen, in red"><input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} className="h-4 w-4 accent-[var(--color-danger)]" /> Rush</label>
                  <label className="flex items-center gap-1.5" title="Also prints the kitchen slip on this device's printer"><input type="checkbox" checked={printKot} onChange={(e) => { setPrintKot(e.target.checked); setDevicePref('autoPrintKot', e.target.checked); }} className="h-4 w-4 accent-[var(--color-brand-500)]" /> Print ticket</label>
                </div>
                <Button onClick={sendKot} disabled={busy}><ChefHat aria-hidden="true" className="h-4 w-4" />Send {pendingCount} to kitchen</Button>
              </div>
              <p className="mt-2 text-caption text-ink-500">
                {rush ? 'Rush: this ticket goes to the top of the kitchen screen, in red.' : 'The kitchen screen shows these straight away and starts their timers.'}
                {printKot ? ' A kitchen slip prints too.' : ''}
              </p>
            </div>
          )}

          <details className="group mb-3">
            <summary className="flex cursor-pointer list-none items-center justify-between text-small">
              <span className="text-ink-700">{order.customer_id ? <>Customer: <span className="font-medium text-ink-900">{order.customer_name}</span></> : 'Customer, coupon and points'}</span>
              <span className="text-caption font-medium text-brand-600 group-open:hidden">Add</span>
            </summary>
            <div className="mt-3 space-y-2.5">
              {order.customer_id && !changingCustomer ? (
                <>
                  <button type="button" onClick={() => setChangingCustomer(true)} className="text-caption font-medium text-brand-600">Change customer</button>
                  <LoyaltyCard card={card} compact />
                  <RewardHint card={card} items={open} total={total} onAdd={() => { const p = products.find((x) => x.product_id === card.reward_product_id); if (p) addItem(p); }} />
                  <PointsPanel points={pointsInfo} total={total} value={redeem} onChange={setRedeem} />
                </>
              ) : (
                <MobileLookup onPick={(customer) => attachCustomer(customer)} placeholder="Customer mobile number" />
              )}
              <Input placeholder="Coupon code (optional)" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} aria-label="Coupon code" className="!py-2" />
            </div>
          </details>

          {open.length > 0 && (
            <dl className="mb-2 space-y-1 text-small">
              <div className="flex justify-between text-ink-700"><dt>{itemCount} item{itemCount === 1 ? '' : 's'}</dt><dd className="tabular">{formatCurrency(subtotal)}</dd></div>
              {gstOn && gst > 0 && <div className="flex justify-between text-ink-500"><dt>GST</dt><dd className="tabular">{formatCurrency(gst)}</dd></div>}
              {rewardOff > 0 && <div className="flex justify-between font-medium text-success"><dt>Free {card.reward_item} (loyalty)</dt><dd className="tabular">−{formatCurrency(rewardOff)}</dd></div>}
            </dl>
          )}
          <div className="flex items-baseline justify-between border-t border-line pt-2">
            <span className="text-body font-semibold text-ink-900">{billedCount ? 'Left to bill' : 'Total'} <span className="text-caption font-normal text-ink-500">(estimate)</span></span>
            <AnimatedNumber value={total} format={formatCurrency} className="text-[26px] font-semibold leading-none tracking-tight text-ink-900" />
          </div>

          <div role="radiogroup" aria-label="How is it paid?" className="mt-3 grid grid-cols-3 gap-1.5">
            {METHODS.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={method === value} onClick={() => { setMethod(value); setReceived(''); }}
                      className={`h-9 rounded-lg border text-small font-medium ${method === value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>{label}</button>
            ))}
          </div>
          {!payLater && (
            <div className="mt-2 flex items-center gap-3">
              <div className="w-32"><Input type="number" min="0" step="0.01" value={received} onChange={(e) => setReceived(e.target.value)} placeholder={total.toFixed(2)} aria-label={method === 'CASH' ? 'Cash received' : 'Amount paid now'} className="!py-1.5 text-right" /></div>
              <p className="tabular text-caption text-ink-500">
                {change > 0 ? <span className="text-small font-semibold text-brand-700">Change {formatCurrency(change)}</span>
                  : partial ? <span className="text-warning">{formatCurrency(total - amount)} stays due</span>
                  : method === 'CASH' ? 'Cash received, if not exact' : 'Paid in full'}
              </p>
            </div>
          )}
          {pendingCount > 0 && <p className="mt-2 text-caption text-warning">{pendingCount} item{pendingCount === 1 ? ' has' : 's have'} not been sent to the kitchen yet.</p>}
          <Button onClick={billOrder} disabled={busy || total === 0} size="lg" className="mt-3 h-11 w-full">
            {busy ? 'Working…' : payLater ? `Save bill · ${formatCurrency(total)} unpaid` : upiQr ? `Bill and show UPI QR · ${formatCurrency(partial ? amount : total)}` : partial ? `Take ${formatCurrency(amount)} · rest due` : `${billedCount ? 'Bill the rest' : 'Bill'} · ${formatCurrency(total)}`}
          </Button>
        </div>
      )}

      {menuOpen && order && <MenuPicker title={`Add to ${titleOf(order)}`} products={products} counts={open.reduce((m, i) => ({ ...m, [i.product_id]: (m[i.product_id] || 0) + i.quantity }), {})} onAdd={choose} onClose={() => setMenuOpen(false)} />}
      {picking && <ModifierPicker product={picking} onClose={() => setPicking(null)} onConfirm={(ids) => addItem(picking, ids)} />}
      {floorOp === 'split' && <SplitModal order={order} onClose={() => setFloorOp(null)} onDone={(closedBy) => { if (closedBy) { setFloorOp(null); setDone({ ...closedBy, change: 0 }); onChanged(); } else refresh(); }} />}
      {floorOp === 'move' && <MoveTableModal order={order} onClose={() => setFloorOp(null)} onDone={() => { setFloorOp(null); refresh(); }} />}
      {floorOp === 'merge' && <MergeModal order={order} onClose={() => setFloorOp(null)} onDone={() => { setFloorOp(null); refresh(); }} />}
    </div>
  );
};

/* ── The screen ────────────────────────────────────────────────────────── */

const FILTERS = [['ALL', 'All'], ['DINE_IN', 'Dine-in'], ['TAKEAWAY', 'Takeaway'], ['DELIVERY', 'Delivery']];

const OrderCard = ({ order, active, onOpen }) => {
  const Icon = TYPE_ICON[order.order_type] || ShoppingBag;
  const s = order.summary || { items: 0, estimate: 0, not_sent: 0, cooking: 0, ready: 0 };
  const mins = minutesSince(order.created_at);
  const title = titleOf(order);
  const n = Number(s.items || 0);
  const sub = [title.includes(order.order_number) ? null : order.order_number, order.external_order_number ? `${platformName(order.platform)} ${order.external_order_number}` : null, n ? `${n} item${n === 1 ? '' : 's'}` : null, order.customer_name, order.waiter_name, order.brand_name, order.rider_name].filter(Boolean).join(' · ');
  const pendingAccept = order.status === 'PENDING_ACCEPT';
  const stripe = pendingAccept ? 'bg-danger' : mins >= LONG_MIN ? 'bg-danger' : s.ready > 0 ? 'bg-success' : s.not_sent > 0 ? 'bg-warning' : 'bg-brand-500';
  const status = pendingAccept ? <span className="font-bold text-danger">Awaiting accept or reject</span>
    : s.ready > 0 ? <span className="text-success">{s.ready} ready to serve</span>
    : s.not_sent > 0 ? <span className="text-warning">{s.not_sent} not sent to the kitchen</span>
    : s.cooking > 0 ? <span className="text-ink-700">{s.cooking} cooking</span>
    : !s.items ? <span className="text-ink-500">Nothing added yet</span>
    : <span className="text-ink-500">All served</span>;
  return (
    <button type="button" onClick={onOpen} aria-current={active ? 'true' : undefined}
            className={`relative flex w-full flex-col gap-2 overflow-hidden rounded-(--radius-card) border bg-surface p-3 pt-3.5 text-left shadow-sm transition-colors duration-(--duration-fast) ${active ? 'border-brand-500 ring-1 ring-brand-500' : 'border-line hover:border-line-strong'}`}>
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${stripe}`} />
      <span className="flex items-start gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${order.order_type === 'DINE_IN' ? 'bg-brand-50 text-brand-600' : 'bg-ink-900 text-white'}`}><Icon aria-hidden="true" className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-small font-bold text-ink-900">{title}</span>
          <span className="block truncate text-caption text-ink-500">{sub || TYPE_LABEL[order.order_type]}</span>
        </span>
        <span className={`tabular flex shrink-0 items-center gap-1 whitespace-nowrap text-caption font-medium ${mins >= LONG_MIN ? 'text-danger' : mins >= 25 ? 'text-warning' : 'text-ink-500'}`}><Clock aria-hidden="true" className="h-3 w-3" />{age(order.created_at)}</span>
      </span>
      <ProgressBar s={s} />
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-caption font-semibold">{status}</span>
        <span className="tabular shrink-0 text-small font-bold text-ink-900">{s.items ? formatCurrency(s.estimate) : ''}</span>
      </span>
    </button>
  );
};

/* Compact tiles: this list sits beside the open order, so the four must fit a column about 550px wide. */
const Stat = ({ className = '', ...props }) => <StatCard className={`!p-3 ${className}`} {...props} />;

const OrdersPage = () => {
  const [params, setParams] = useSearchParams();
  const selected = params.get('order') ? Number(params.get('order')) : null;
  const toast = useToast();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [search, setSearch] = useState('');
  const [attention, setAttention] = useState(false);

  const load = () => api('/orders?open_only=true').then((rows) => { setOrders(rows); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, []);

  const open = (id) => setParams(id ? { order: String(id) } : {});
  const start = async (body) => {
    setStarting(true);
    try {
      const order = await api('/orders', { method: 'POST', body });
      setPicking(false); await load(); open(order.order_id);
    } catch (caught) { toast.error(caught.message); }
    finally { setStarting(false); }
  };

  const all = orders || [];
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, all.filter((o) => k === 'ALL' || o.order_type === k).length])), [orders]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = search.trim().toLowerCase();
  const shown = all
    .filter((o) => (filter === 'ALL' || o.order_type === filter) && (!attention || needsAttention(o))
      && (!q || [o.order_number, o.table_name, o.customer_name, o.waiter_name, o.platform].some((v) => v && String(v).toLowerCase().includes(q))))
    .slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const sum = (key) => all.reduce((n, o) => n + Number(o.summary?.[key] || 0), 0);
  const running = sum('estimate');
  const notSent = sum('not_sent');
  const ready = sum('ready');
  const attentionCount = all.filter(needsAttention).length;
  const oldest = all.length ? Math.max(...all.map((o) => minutesSince(o.created_at))) : 0;
  const clear = () => { setFilter('ALL'); setAttention(false); setSearch(''); };

  return (
    <div className="-m-4 grid grid-cols-1 sm:-m-6 lg:-m-8 lg:h-[calc(100vh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_440px]">
      <section aria-label="Open orders" className={`min-w-0 flex-col p-4 sm:p-6 lg:flex lg:overflow-hidden ${selected ? 'hidden' : 'flex'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-h3 font-semibold text-ink-900">Orders</h1>
            <p className="text-small text-ink-500">Open tabs, oldest first. Nothing is charged until you bill.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => start({ order_type: 'TAKEAWAY' })} disabled={starting}><ShoppingBag aria-hidden="true" className="h-4 w-4" />New takeaway</Button>
            <Button onClick={() => setPicking(true)} disabled={starting}><UtensilsCrossed aria-hidden="true" className="h-4 w-4" />New dine-in</Button>
          </div>
        </div>

        {orders && all.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label="Open orders" value={all.length} note={`${counts.DINE_IN} dine-in, ${counts.TAKEAWAY + counts.DELIVERY} away`} />
            <Stat label="Running bills" value={formatCurrency(running)} note="not billed, with GST" />
            <Stat label="Need attention" value={attentionCount} tone={attentionCount ? 'text-danger' : 'text-success'} active={attention}
                  note={attentionCount ? [ready && `${ready} ready`, notSent && `${notSent} to send`].filter(Boolean).join(' · ') || `open ${LONG_MIN}+ min` : 'All on track'}
                  onClick={attentionCount ? () => setAttention((a) => !a) : undefined} />
            <Stat label="Oldest open" value={ageMin(oldest)} tone={oldest >= LONG_MIN ? 'text-danger' : 'text-ink-900'} note="since it started" />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Order type" className="flex gap-1.5 overflow-x-auto">
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
                      className={`shrink-0 rounded-lg border px-3 py-1.5 text-small font-medium ${filter === key ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>
                {label} <span className={`tabular ml-1 ${filter === key ? 'text-white/70' : 'text-ink-400'}`}>{counts[key] || 0}</span>
              </button>
            ))}
          </div>
          {all.length > 0 && (
            <label className="relative ml-auto w-full sm:w-56">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <span className="sr-only">Find an order</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Table, order, customer"
                     className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-small text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none" />
            </label>
          )}
        </div>

        <div className="mt-4 min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
          <Alert>{error}</Alert>
          {!orders && !error ? (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-(--radius-card) bg-surface-3" />)}</div>
          ) : shown.length === 0 ? (
            <div className="rounded-(--radius-card) border border-dashed border-line-strong bg-surface p-10 text-center">
              {all.length > 0 ? (
                <>
                  <p className="text-body font-medium text-ink-900">No orders match</p>
                  <button type="button" onClick={clear} className="mt-2 text-small font-medium text-brand-600 hover:underline">Show every open order</button>
                </>
              ) : (
                <>
                  <ClipboardList aria-hidden="true" className="mx-auto h-8 w-8 text-ink-400" />
                  <p className="mt-3 text-body font-medium text-ink-900">No open orders</p>
                  <p className="mt-1 text-small text-ink-500">Start a takeaway or a dine-in order above. Orders from the table QR menu appear here too.</p>
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
              {shown.map((o) => <OrderCard key={o.order_id} order={o} active={o.order_id === selected} onOpen={() => open(o.order_id)} />)}
            </div>
          )}
        </div>
      </section>

      <section aria-label="Selected order" className={`min-h-0 min-w-0 flex-col border-line bg-surface lg:flex lg:border-l ${selected ? 'flex min-h-[calc(100vh-3.5rem)] lg:min-h-0' : 'hidden'}`}>
        {selected ? (
          <OrderPanel key={selected} orderId={selected} onChanged={load} onBack={() => { open(null); load(); }} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"><ClipboardList aria-hidden="true" className="h-6 w-6" /></span>
            <p className="mt-3 text-body font-semibold text-ink-900">Pick an order to see it here</p>
            <p className="mt-1 max-w-xs text-small text-ink-500">Add items, send them to the kitchen and take the payment, all from this side.</p>
            <div className="mt-5 grid w-full max-w-xs gap-2">
              <Button onClick={() => start({ order_type: 'TAKEAWAY' })} disabled={starting}><ShoppingBag aria-hidden="true" className="h-4 w-4" />New takeaway</Button>
              <Button variant="secondary" onClick={() => setPicking(true)} disabled={starting}><UtensilsCrossed aria-hidden="true" className="h-4 w-4" />New dine-in</Button>
            </div>
          </div>
        )}
      </section>

      {picking && <TablePicker onClose={() => setPicking(false)} onPick={(t) => start({ order_type: 'DINE_IN', table_id: t.table_id })} />}
    </div>
  );
};

export default OrdersPage;
