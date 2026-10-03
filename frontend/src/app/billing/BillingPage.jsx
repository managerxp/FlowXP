/*
 * The POS screen (design.md §28): find the item, build the bill, take the
 * money. Laid out for speed at a busy counter:
 *
 *   left   search or scan, category buttons, a grid of items to tap
 *   right  the current bill: customer, lines with − / + steppers, discounts,
 *          the total, how it is paid, and one big Charge button
 *
 * Split payments: several methods on one bill; the last part, left blank,
 * is "the rest" and the server fills it in to the paisa. Hold: park the bill
 * (kept per outlet on the server, see heldBills.controller.js) and resume it
 * here or at another till.
 *
 * Keyboard: "/" jumps to search, Enter adds the matching item (an exact
 * barcode or SKU first), Escape clears the search, Ctrl/⌘ + Enter charges.
 *
 * Money: everything shown here is an ESTIMATE while the bill is being built.
 * What is charged and recorded is worked out server-side (modules/billing.js);
 * the confirmation shows the server's real figures. A bill is paid in full by
 * the chosen method unless the cashier types a smaller amount or chooses
 * "Pay later" ('FULL' asks the server to record exactly the final total,
 * rounding included, which the browser cannot know in advance).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChefHat, CheckCircle2, ClipboardList, CloudOff, Minus, PackagePlus, Pause, Plus, Printer, ScanLine, Search, Split, Trash2, UserRound, X } from 'lucide-react';
import { api, formatCurrency, NetworkError } from '../../lib/api.js';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import ModifierPicker, { needsChoices, useModifierGroups } from '../../components/ModifierPicker.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { Alert, Button, Input, Modal, Select, humanize, useToast, useDialog } from '../../components/ui.jsx';
import { LoyaltyCard, MobileLookup, PointsPanel, RewardHint } from '../../components/LoyaltyCard.jsx';
import { getDevicePrefs, openDrawer, printKot as printKotSlip, printReceipt, setDevicePref } from '../../lib/printing.js';
import { queueSale } from '../../lib/offline.js';
import { RESTAURANT_TYPES, RETAIL_TYPES } from '../../lib/business.js';
import UpiCollect from '../../components/UpiCollect.jsx';
import BarcodeScanner from '../../components/BarcodeScanner.jsx';
import QuickProductModal from '../../components/QuickProductModal.jsx';
import { catalogInfo, loadCatalog, localLookup, localSearch, subscribeCatalog, syncCatalog, upsertLocal } from '../../lib/posCatalog.js';

/* How the bill is paid. "Pay later" records it unpaid (a customer's credit). */
const METHODS = [
  ['CASH', 'Cash'], ['UPI', 'UPI'], ['CARD', 'Card'], ['BANK_TRANSFER', 'Bank'], ['OTHER', 'Other'], ['LATER', 'Pay later']
];
const SPLIT_METHODS = METHODS.filter(([value]) => value !== 'LATER');
const TILE_LIMIT = 60;
const clock = (ts) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

let keySeq = 0;
const lineTotal = (l) => Number(l.quantity || 0) * Number(l.unit_price || 0) - Number(l.discount || 0);
const matches = (p, q) => p.name.toLowerCase().includes(q) || p.sku?.toLowerCase() === q || p.barcode?.toLowerCase() === q;

/* ── The item grid ─────────────────────────────────────────────────────── */

const ProductTile = ({ product, inCart, onAdd, highlight = false }) => {
  const off = product.is_available === false;
  return (
    <button
      type="button"
      onClick={() => onAdd(product)}
      disabled={off}
      aria-current={highlight || undefined}
      className={`relative flex min-h-[88px] flex-col justify-between rounded-(--radius-card) border bg-surface p-3 text-left transition-[border-color,transform] duration-(--duration-fast) hover:border-brand-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line ${highlight ? 'border-brand-500 ring-2 ring-brand-500/40' : 'border-line'}`}
    >
      {inCart > 0 && (
        <span className="tabular absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-white">
          {inCart}<span className="sr-only"> in the bill</span>
        </span>
      )}
      <span className="line-clamp-2 pr-6 text-small font-medium leading-snug text-ink-900">{product.name}</span>
      <span className="mt-2 flex flex-wrap items-end justify-between gap-x-2 gap-y-0.5">
        <span className="tabular shrink-0 text-small font-semibold text-ink-900">{formatCurrency(product.selling_price)}</span>
        <span className="ml-auto text-right text-[11px] leading-tight text-ink-500">
          {off ? 'Not available' : product.track_inventory
            ? <span className={product.low_stock ? 'font-medium text-warning' : ''}>{Number(product.current_stock)} {product.unit} left</span>
            : product.modifier_group_ids?.length ? 'Options' : ''}
        </span>
      </span>
    </button>
  );
};

/* ── One line of the bill ──────────────────────────────────────────────── */

const Stepper = ({ value, onChange, label }) => (
  <div className="flex items-center rounded-lg border border-line-strong">
    <button type="button" onClick={() => onChange(Math.max(0, Number(value) - 1))} aria-label={`One less ${label}`} className="flex h-8 w-8 items-center justify-center text-ink-700 hover:bg-surface-2 pointer-coarse:h-11 pointer-coarse:w-11"><Minus className="h-3.5 w-3.5" /></button>
    <input
      type="number" min="0" step="any" value={value} aria-label={`Quantity of ${label}`}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      className="tabular h-8 w-11 border-x border-line bg-transparent text-center text-small font-medium text-ink-900 [appearance:textfield] focus:outline-none pointer-coarse:h-11 [&::-webkit-inner-spin-button]:appearance-none"
    />
    <button type="button" onClick={() => onChange(Number(value || 0) + 1)} aria-label={`One more ${label}`} className="flex h-8 w-8 items-center justify-center text-ink-700 hover:bg-surface-2 pointer-coarse:h-11 pointer-coarse:w-11"><Plus className="h-3.5 w-3.5" /></button>
  </div>
);

const BillLine = ({ line, onChange, onRemove, selected = false, onSelect }) => {
  const [discountOpen, setDiscountOpen] = useState(Boolean(line.discount));
  const label = line.name || 'custom item';
  return (
    <li className={`-mx-5 px-5 py-3 ${selected ? 'bg-brand-50/70 shadow-[inset_3px_0_0_var(--color-brand-500)]' : ''}`} onClick={onSelect}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {line.custom ? (
            <div className="flex gap-2">
              <Input placeholder="What is it?" value={line.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Custom item description" className="!py-1.5" />
              <div className="w-24 shrink-0">
                <Input type="number" min="0" step="0.01" placeholder="₹ price" value={line.unit_price || ''} aria-label="Custom item price"
                       onChange={(e) => onChange({ unit_price: Number(e.target.value) })} className="!py-1.5 text-right" />
              </div>
            </div>
          ) : (
            <p className="text-small font-medium leading-snug text-ink-900">{line.name}</p>
          )}
          <p className="tabular mt-0.5 text-caption text-ink-500">
            {formatCurrency(line.unit_price)} each
            {line.discount > 0 && <span className="text-success"> · {formatCurrency(line.discount)} off</span>}
            {!discountOpen && <button type="button" onClick={() => setDiscountOpen(true)} className="ml-2 font-medium text-brand-600 hover:text-brand-700 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center pointer-coarse:px-1">Discount</button>}
          </p>
          {line.track_inventory && Number(line.quantity) > Number(line.current_stock) && (
            <p className="mt-0.5 text-caption font-medium text-danger">Only {Number(line.current_stock)} in stock</p>
          )}
          {discountOpen && (
            <div className="mt-2 flex items-center gap-2">
              <div className="w-28">
                <Input type="number" min="0" step="0.01" placeholder="₹ off this line" aria-label={`Discount on ${label} in rupees`} value={line.discount || ''}
                       onChange={(e) => onChange({ discount: Number(e.target.value) })} className="!py-1.5 text-right" />
              </div>
              <button type="button" onClick={() => { onChange({ discount: 0 }); setDiscountOpen(false); }} className="text-caption text-ink-500 hover:text-ink-900 pointer-coarse:min-h-11 pointer-coarse:px-2">Remove</button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <p className="tabular text-small font-semibold text-ink-900">{formatCurrency(lineTotal(line))}</p>
          <div className="flex items-center gap-1">
            <Stepper value={line.quantity} label={label} onChange={(q) => onChange({ quantity: q })} />
            <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-danger/5 hover:text-danger pointer-coarse:h-11 pointer-coarse:w-11"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </li>
  );
};

/* ── After charging ────────────────────────────────────────────────────── */

const Done = ({ confirmation, change, onNew, onView }) => {
  const newRef = useRef(null);
  useEffect(() => { newRef.current?.focus(); }, []);
  const offline = confirmation.offline;
  return (
    <div className="mx-auto max-w-md pt-6">
      <div className="rise rounded-(--radius-panel) border border-line bg-surface p-8 text-center shadow-md">
        {offline
          ? <CloudOff aria-hidden="true" className="mx-auto h-10 w-10 text-warning" />
          : <CheckCircle2 aria-hidden="true" className="mx-auto h-10 w-10 text-success" />}
        <p className={`mt-3 text-caption font-semibold uppercase tracking-[0.12em] ${offline ? 'text-warning' : 'text-success'}`}>
          {offline ? 'Saved on this device' : 'Bill saved'}
        </p>
        <h1 className="mt-1 text-h3 font-semibold text-ink-900">{offline ? "You're offline" : confirmation.invoice_number}</h1>
        <p className="tabular mt-2 text-[40px] font-semibold leading-none tracking-tight text-ink-900">{formatCurrency(confirmation.total)}</p>

        {change > 0 && !offline && (
          <p className="tabular mt-4 rounded-lg bg-brand-50 px-3 py-2.5 text-body font-semibold text-brand-700">Give back {formatCurrency(change)} change</p>
        )}

        {confirmation.order && (
          <div className="mt-4 rounded-lg border border-line bg-surface-2 px-4 py-3">
            <p className="flex items-center justify-center gap-1.5 text-caption font-semibold text-success"><ChefHat aria-hidden="true" className="h-4 w-4" />Sent to the kitchen · {confirmation.order.kot_number}</p>
            <p className="tabular mt-1 text-[30px] font-bold leading-none tracking-tight text-ink-900">{confirmation.order.order_number}</p>
            <p className="mt-1 text-caption text-ink-500">Tell the customer this number, and call it when the order is ready.</p>
          </div>
        )}

        <div className="mt-4 space-y-1.5 text-small text-ink-500">
          {offline ? (
            <p>It will be billed automatically when the connection is back, and gets its invoice number then. Hand over a written note for now{confirmation.toKitchen ? ', and tell the kitchen yourself: it was not sent to the kitchen screen' : ''}.</p>
          ) : (
            <>
              <p>{confirmation.payment_status === 'PAID' ? 'Paid in full.'
                : confirmation.payment_status === 'PARTIAL' ? `Part paid. ${formatCurrency(confirmation.balance_due)} still due.`
                : `Not paid yet. ${formatCurrency(confirmation.balance_due ?? confirmation.total)} due.`}</p>
              {confirmation.payments_taken?.length > 1 && (
                <p className="tabular">{confirmation.payments_taken.map((p) => `${humanize(p.method)} ${formatCurrency(p.amount)}`).join(' + ')}</p>
              )}
              {confirmation.loyalty_reward && <p className="font-medium text-success">Loyalty reward: {confirmation.loyalty_reward.item} free ({formatCurrency(confirmation.loyalty_reward.amount)} off)</p>}
              {confirmation.loyalty_points && <p>{confirmation.loyalty_points.redeemed > 0 && `${confirmation.loyalty_points.redeemed} points used (${formatCurrency(confirmation.points_discount)} off). `}Earned {confirmation.loyalty_points.earned} points · balance {confirmation.loyalty_points.balance}{confirmation.loyalty_points.tier ? ` · ${confirmation.loyalty_points.tier}` : ''}</p>}
              {confirmation.coupon_code && <p>Coupon {confirmation.coupon_code}: {formatCurrency(confirmation.coupon_discount)} off</p>}
            </>
          )}
        </div>

        <div className="mt-7 grid gap-2">
          <Button ref={newRef} size="lg" onClick={onNew}>New sale</Button>
          {!offline && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => printReceipt(confirmation.invoice_id)}><Printer aria-hidden="true" className="h-4 w-4" />Print</Button>
              <Button variant="secondary" onClick={onView}>View bill</Button>
            </div>
          )}
        </div>
        <p className="mt-4 text-caption text-ink-400">Press Enter for a new sale</p>
      </div>
    </div>
  );
};

/* ── Bills on hold ─────────────────────────────────────────────────────── */

const HeldBills = ({ bills, onResume, onDiscard, onClose }) => (
  <Modal title="Bills on hold" onClose={onClose} wide>
    {bills.length === 0 ? (
      <p className="py-6 text-center text-small text-ink-500">No bills on hold at this outlet.</p>
    ) : (
      <ul className="-mx-2 divide-y divide-line">
        {bills.map((h) => (
          <li key={h.hold_id} className="flex flex-wrap items-center gap-3 px-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-small font-semibold text-ink-900">{h.label || h.bill.customer_name || `Bill held at ${clock(h.created_at)}`}</p>
              <p className="tabular text-caption text-ink-500">
                {Number(h.item_count)} item{Number(h.item_count) === 1 ? '' : 's'} · about {formatCurrency(h.estimate)} · {clock(h.created_at)}{h.held_by ? ` by ${h.held_by}` : ''}
              </p>
            </div>
            <Button size="sm" onClick={() => onResume(h)}>Resume</Button>
            <Button size="sm" variant="ghost" onClick={() => onDiscard(h)} className="text-danger hover:bg-danger/5 hover:text-danger">Discard</Button>
          </li>
        ))}
      </ul>
    )}
    <p className="mt-4 text-caption text-ink-500">Held bills are kept for this outlet. Prices, stock and coupons are checked again when you charge.</p>
  </Modal>
);

/* ── Open orders, billed from here ─────────────────────────────────────── */

const orderTitle = (o) => o.table_name || (o.platform ? humanize(o.platform) : `Takeaway ${o.order_number}`);
const ORDER_KIND = { DINE_IN: 'Dine-in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery' };
const orderKind = (o) => (o.platform ? humanize(o.platform) : ORDER_KIND[o.order_type] || null);
const minutesAgo = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
const LINE_STATUS = { PENDING: ['Not sent', 'text-warning'], PREPARING: ['Cooking', 'text-brand-700'], READY: ['Ready', 'text-success'], SERVED: ['Served', 'text-ink-500'] };

const OpenOrders = ({ orders, onPick, onClose }) => (
  <Modal title="Open orders" onClose={onClose} wide>
    {orders.length === 0 ? (
      <p className="py-6 text-center text-small text-ink-500">No open orders at this outlet. Tables, takeaways and QR orders that are not billed yet show here.</p>
    ) : (
      <ul className="-mx-2 divide-y divide-line">
        {orders.map((o) => {
          const s = o.summary || {};
          const mins = minutesAgo(o.created_at);
          return (
            <li key={o.order_id}>
              <button type="button" onClick={() => onPick(o)} className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-small font-semibold text-ink-900">{orderTitle(o)}</span>
                  <span className="block truncate text-caption text-ink-500">
                    {[orderTitle(o).includes(o.order_number) ? null : o.order_number, `${Number(s.items || 0)} items`, o.customer_name, mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`].filter(Boolean).join(' · ')}
                  </span>
                  {s.not_sent > 0 && <span className="block text-caption font-medium text-warning">{s.not_sent} not sent to the kitchen</span>}
                </span>
                <span className="tabular shrink-0 text-small font-semibold text-ink-900">{formatCurrency(s.estimate || 0)}</span>
                <span className="shrink-0 rounded-md bg-brand-50 px-2 py-1 text-caption font-semibold text-brand-700">Bill</span>
              </button>
            </li>
          );
        })}
      </ul>
    )}
    <p className="mt-4 text-caption text-ink-500">Billing an order here closes that same order, so it is never billed twice.</p>
  </Modal>
);

/* One line of an open order: its kitchen state, and − / + only while it is not sent yet. */
const OrderBillLine = ({ line, onQty }) => {
  const [label, tone] = LINE_STATUS[line.status] || ['', ''];
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-small font-medium leading-snug text-ink-900">{!line.pending && <span className="tabular mr-1">{line.quantity} ×</span>}{line.name}</p>
        <p className="tabular mt-0.5 text-caption text-ink-500"><span className={`font-semibold ${tone}`}>{label}</span> · {formatCurrency(line.unit_price)} each</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <p className="tabular text-small font-semibold text-ink-900">{formatCurrency(lineTotal(line))}</p>
        {line.pending && <Stepper value={line.quantity} label={line.name} onChange={(q) => onQty(line, q)} />}
      </div>
    </li>
  );
};

/* ── The screen ────────────────────────────────────────────────────────── */

const BillingPage = () => {
  const dialog = useDialog();
  const { business, outletId, can } = useAuth();
  const navigate = useNavigate();
  const searchRef = useRef(null);

  const [products, setProducts] = useState(null);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [card, setCard] = useState(null);                // the chosen customer's visit card
  const [pointsInfo, setPointsInfo] = useState(null);    // the chosen customer's points
  const [redeem, setRedeem] = useState('');
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponInfo, setCouponInfo] = useState(null);   // { code, discount } once checked
  const [couponError, setCouponError] = useState('');
  const [invoiceDiscount, setInvoiceDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState('CASH');
  const [received, setReceived] = useState('');         // cash handed over, or a part payment
  const [cardRef, setCardRef] = useState('');           // the card machine's approval code, to match the settlement later
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [change, setChange] = useState(0);
  const [collecting, setCollecting] = useState(null);   // a saved bill waiting for its UPI payment
  const withGroups = useModifierGroups();
  const [picking, setPicking] = useState(null);
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState([]);                // [{ key, method, amount }] while split
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdLabel, setHoldLabel] = useState('');
  const [heldBills, setHeldBills] = useState([]);
  const [heldOpen, setHeldOpen] = useState(false);
  const toast = useToast();
  // restaurants and cafés: counter sales can go to the kitchen, and open orders can be billed here
  const restaurant = RESTAURANT_TYPES.includes(business?.business_type);
  const [toKitchen, setToKitchen] = useState(() => getDevicePrefs().posSendToKitchen);
  const [orderId, setOrderId] = useState(null);         // billing an open order instead of a new sale
  const [order, setOrder] = useState(null);
  const [openOrders, setOpenOrders] = useState([]);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const orderMode = orderId != null;

  // supermarkets and shops: scanning, quick products, keyboard lines, server-side search and an offline catalogue
  const retail = RETAIL_TYPES.includes(business?.business_type);
  const [scanning, setScanning] = useState(false);
  const [quickFor, setQuickFor] = useState(null);       // the barcode being made into a product ('' = none scanned)
  const [resumeScan, setResumeScan] = useState(false);  // go back to the camera after making the product
  const [justMade, setJustMade] = useState(null);       // its barcode: not to be counted again if the item is still in view
  const [cats, setCats] = useState([]);
  const [quick, setQuick] = useState([]);
  const [selKey, setSelKey] = useState(null);           // the selected bill line, for + / − / Delete
  const [hi, setHi] = useState(0);                      // the highlighted tile while arrowing through search results
  const [catalog, setCatalog] = useState(catalogInfo);
  const scope = `${business?.business_id}-${outletId}`;
  const cartRef = useRef([]);
  const selRef = useRef(null); selRef.current = selKey;

  const loadHeld = () => api('/held-bills').then(setHeldBills).catch(() => {});
  useEffect(() => { loadHeld(); }, []);
  // a delivery order not yet accepted has nothing decided about it — bill it once it's in the kitchen
  const loadOpenOrders = () => api('/orders?open_only=true').then((rows) => setOpenOrders(rows.filter((o) => o.status !== 'PENDING_ACCEPT'))).catch(() => {});
  useEffect(() => {
    if (!restaurant) return undefined;
    loadOpenOrders();
    const t = setInterval(loadOpenOrders, 30000);
    return () => clearInterval(t);
  }, [restaurant]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOrder = (id = orderId) => api(`/orders/${id}`).then((o) => {
    if (['BILLED', 'CANCELLED', 'MERGED'].includes(o.status)) { toast.error(`${orderTitle(o)} is already ${o.status === 'BILLED' ? 'billed' : o.status.toLowerCase()}`); setOrderId(null); loadOpenOrders(); return; }
    if (o.status === 'PENDING_ACCEPT') { toast.error(`${orderTitle(o)} needs to be accepted or rejected first — see Orders`); setOrderId(null); loadOpenOrders(); return; }
    setOrder(o);
    setCustomerId(o.customer_id || ''); setCustomerName(o.customer_name || '');
  }).catch((e) => { setError(e.message); setOrderId(null); });
  useEffect(() => { if (orderId) loadOrder(orderId); else setOrder(null); }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // what is still to bill on the order, shaped like bill lines so the totals below work the same
  const orderLines = useMemo(() => (order ? order.items.filter((i) => i.status !== 'CANCELLED' && !i.billed).map((i) => ({
    key: `o${i.order_item_id}`, order_item_id: i.order_item_id, product_id: i.product_id, status: i.status, pending: i.status === 'PENDING',
    name: i.modifiers?.length ? `${i.description} (${i.modifiers.map((m) => m.name).join(', ')})` : i.description,
    unit_price: i.unit_price, quantity: i.quantity, discount: 0, tax_rate: i.tax_rate
  })) : []), [order]);

  const load = () => api('/products?kind=DISH').then(setProducts).catch(() => setProducts([]));
  useEffect(() => { if (!retail) load(); api('/customers').then(setCustomers).catch(() => {}); }, [retail]); // eslint-disable-line react-hooks/exhaustive-deps

  /* A shop's till never loads the whole catalogue to filter it in the browser: it asks the server for a page that
     matches what was typed (indexed, so it stays quick at 100,000 products), and falls back to its own copy when
     the connection is down. */
  useEffect(() => {
    if (!retail) return undefined;
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ kind: 'DISH', limit: '60' });
      if (query.trim()) params.set('search', query.trim());
      const picked = category && cats.find((c) => c.name === category);
      if (picked) params.set('category_id', picked.category_id);
      try { setProducts(await api(`/products?${params}`)); }
      catch (caught) { setProducts(caught instanceof NetworkError ? localSearch(query, 60, category) : []); }
      setHi(0);
    }, query ? 200 : 0);
    return () => clearTimeout(timer);
  }, [retail, query, category, cats, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!retail) return undefined;
    api('/categories').then(setCats).catch(() => {});
    api('/products?kind=DISH&quick=true&limit=30').then(setQuick).catch(() => {});
    return undefined;
  }, [retail, scope]);

  // the offline copy: read what the device has, then refresh it, on opening and every few minutes
  useEffect(() => {
    if (!retail) return undefined;
    const off = subscribeCatalog(() => setCatalog(catalogInfo()));
    const sync = () => syncCatalog(scope, async (after, limit) => {
      const r = await api(`/products/pos-catalog?after=${after}&limit=${limit}`, { withMeta: true });
      return { data: r.data, next: r.meta?.next_after };
    }).catch(() => {});
    loadCatalog(scope).then(() => { if (!catalogInfo().fresh) sync(); });
    const timer = setInterval(sync, 5 * 60 * 1000);
    window.addEventListener('online', sync);
    return () => { off(); clearInterval(timer); window.removeEventListener('online', sync); };
  }, [retail, scope]);

  useEffect(() => {
    if (!customerId) { setCard(null); setPointsInfo(null); return; }
    api(`/loyalty/customers/${customerId}`).then((d) => { setCard(d.loyalty); setPointsInfo(d.points); }).catch(() => { setCard(null); setPointsInfo(null); });
  }, [customerId]);

  const categories = useMemo(() => (retail ? cats.map((c) => c.name) : [...new Set((products || []).map((p) => p.category_name).filter(Boolean))].sort()), [products, retail, cats]);
  const q = query.trim().toLowerCase();
  // a shop's list is already what the server matched; a restaurant's small menu is filtered here
  const shown = useMemo(() => (retail ? (products || []) : (products || [])
    .filter((p) => (!category || p.category_name === category) && (!q || matches(p, q)))), [products, category, q, retail]);
  const billLines = orderMode ? orderLines : cart;
  cartRef.current = cart;
  // keep one bill line selected (the last added) so + / − / Delete always have a target
  useEffect(() => {
    if (!retail) return;
    if (!cart.length) { if (selKey !== null) setSelKey(null); return; }
    if (!cart.some((l) => l.key === selKey)) setSelKey(cart[cart.length - 1].key);
  }, [cart, retail, selKey]);
  const inCart = useMemo(() => billLines.reduce((m, l) => (l.product_id ? m.set(l.product_id, (m.get(l.product_id) || 0) + Number(l.quantity || 0)) : m), new Map()), [billLines]);

  /* Billing an open order: what is tapped goes on the order itself (not sent to the kitchen yet),
     so the order stays the one record of what this guest had. */
  const addToOrder = async (product, modifierIds = []) => {
    setPicking(null); setError('');
    try {
      const same = !modifierIds.length && order?.items.find((i) => i.product_id === product.product_id && i.status === 'PENDING' && !i.billed && !i.modifiers?.length && !i.kitchen_notes);
      if (same) await api(`/orders/${orderId}/items/${same.order_item_id}`, { method: 'PATCH', body: { quantity: same.quantity + 1 } });
      else await api(`/orders/${orderId}/items`, { method: 'POST', body: { items: [{ product_id: product.product_id, quantity: 1, modifier_ids: modifierIds }] } });
      await loadOrder();
    } catch (caught) { setError(caught.message); }
  };
  const setOrderQty = async (line, quantity) => {
    setError('');
    try {
      await api(`/orders/${orderId}/items/${line.order_item_id}`, { method: 'PATCH', body: Number(quantity) > 0 ? { quantity: Number(quantity) } : { status: 'CANCELLED' } });
      await loadOrder();
    } catch (caught) { setError(caught.message); }
  };

  const addProduct = (product, modifierIds = [], selected = []) => {
    if (orderMode) { addToOrder(product, modifierIds); return; }
    const sig = [...modifierIds].sort((a, b) => a - b).join(',');
    setSelKey(cartRef.current.find((l) => l.product_id === product.product_id && l.sig === sig)?.key ?? null);
    const delta = selected.reduce((s, m) => s + m.price_delta, 0);
    setCart((c) => {
      const existing = c.find((l) => l.product_id === product.product_id && l.sig === sig);
      if (existing) return c.map((l) => (l === existing ? { ...l, quantity: Number(l.quantity || 0) + 1 } : l));
      return [...c, {
        key: keySeq++, sig, modifier_ids: modifierIds, product_id: product.product_id,
        name: selected.length ? `${product.name} (${selected.map((m) => m.name).join(', ')})` : product.name, unit: product.unit,
        unit_price: product.selling_price + delta, quantity: 1, discount: 0, tax_rate: product.tax_rate,
        track_inventory: product.track_inventory, current_stock: product.current_stock
      }];
    });
    setPicking(null);
  };
  /* A tap on a tile, or Enter in search: dishes with required choices ask first. */
  const choose = (product) => {
    const full = withGroups(product);
    if (needsChoices(full)) setPicking(full); else addProduct(product);
  };

  const addCustomLine = () => setCart((c) => [...c, { key: keySeq++, product_id: null, name: '', unit: '', unit_price: 0, quantity: 1, discount: 0, tax_rate: 0, track_inventory: false, custom: true }]);
  const updateLine = (key, patch) => setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key) => setCart((c) => c.filter((l) => l.key !== key));

  /* Display-only totals — see the file header. */
  const totals = useMemo(() => {
    const gstEnabled = Boolean(business?.gst_enabled);
    let subtotal = 0, tax = 0;
    for (const l of billLines) {
      const gross = lineTotal(l);
      subtotal += gross;
      tax += gstEnabled ? gross * (Number(l.tax_rate || 0) / 100) : 0;
    }
    const discount = Number(invoiceDiscount || 0);
    const before = Math.max(0, subtotal + tax - discount);
    const coupon = couponInfo ? Math.min(couponInfo.discount, before) : 0;
    const pointsOff = pointsInfo ? Math.min((Number(redeem) || 0) * pointsInfo.point_value, Math.max(0, before - coupon)) : 0;
    // the loyalty reward: billing makes up to reward_quantity of the reward item free (tax and all)
    const rewardLine = card?.reward_ready ? billLines.find((l) => l.product_id === card.reward_product_id) : null;
    const rewardOff = rewardLine ? Math.min(Number(rewardLine.quantity), card.reward_quantity || 1) * rewardLine.unit_price * (1 + (gstEnabled ? Number(rewardLine.tax_rate || 0) / 100 : 0)) : 0;
    return { subtotal, tax, discount, coupon, pointsOff, rewardOff, before, total: Math.max(0, before - coupon - pointsOff - rewardOff), gstEnabled };
  }, [billLines, invoiceDiscount, couponInfo, pointsInfo, redeem, business?.gst_enabled, card]);

  // A checked coupon was checked against a particular bill; changing the bill means checking again.
  useEffect(() => { setCouponInfo(null); setCouponError(''); }, [billLines, invoiceDiscount, customerId]);

  const applyCoupon = async () => {
    setCouponError('');
    try {
      setCouponInfo(await api('/coupons/check', { method: 'POST', body: { code: couponCode, customer_id: customerId || undefined, total: totals.before } }));
    } catch (caught) { setCouponInfo(null); setCouponError(caught.message); }
  };

  // on an open order the customer is saved on the order, so the Orders screen sees them too
  const orderCustomer = (id) => orderMode && api(`/orders/${orderId}/customer`, { method: 'PATCH', body: { customer_id: id } }).catch((e) => setError(e.message));
  const pickCustomer = (c) => {
    setCustomerId(c.customer_id); setCustomerName(c.name); setCustomerOpen(false); setCustomerSearch(''); setRedeem('');
    setCustomers((list) => (list.some((x) => x.customer_id === c.customer_id) ? list : [...list, c]));
    orderCustomer(c.customer_id);
  };
  const clearCustomer = () => { setCustomerId(''); setCustomerName(''); setCard(null); setPointsInfo(null); setRedeem(''); orderCustomer(null); };
  // /app/billing?customer=ID (from the customer screen's New bill) starts the sale with them on it
  const [params, setParams] = useSearchParams();
  // /app/billing?order=ID bills that open order here
  useEffect(() => {
    const id = params.get('customer');
    const order = params.get('order');
    if (!id && !order) return;
    if (id) api(`/customers/${id}`).then(pickCustomer).catch(() => {});
    if (order) setOrderId(Number(order));
    setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredCustomers = customerSearch
    ? customers.filter((c) => c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.phone?.includes(customerSearch)).slice(0, 6)
    : [];

  /* What is being paid now, and what that means for the cashier. */
  const payLater = method === 'LATER';
  const amount = received === '' ? null : Number(received);
  const cashChange = method === 'CASH' && amount != null && amount > totals.total ? amount - totals.total : 0;
  const partial = !payLater && amount != null && amount < totals.total;
  // UPI with the business's own UPI ID set: save the bill first, then show a QR for exactly what it came to
  const upiQr = !split && method === 'UPI' && Boolean(business?.upi_vpa);
  const fixedParts = parts.slice(0, -1).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const lastPart = parts[parts.length - 1];
  const lastFixed = lastPart && lastPart.amount !== '' ? Number(lastPart.amount) || 0 : null;
  const splitRest = Math.max(0, totals.total - fixedParts);
  const splitDue = lastFixed == null ? 0 : Math.max(0, totals.total - fixedParts - lastFixed);

  const startSplit = () => {
    setSplit(true);
    setParts([{ key: keySeq++, method: payLater ? 'CASH' : method, amount: '', reference: method === 'CARD' ? cardRef : '' }, { key: keySeq++, method: method === 'UPI' ? 'CASH' : 'UPI', amount: '', reference: '' }]);
    if (payLater) setMethod('CASH');
  };
  const stopSplit = () => { setSplit(false); setParts([]); };
  const setPart = (key, patch) => setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const resetSale = () => {
    setCart([]); setCustomerId(''); setCustomerName(''); setCard(null); setPointsInfo(null); setRedeem(''); setCustomerOpen(false); setInvoiceDiscount(''); setCouponCode(''); setCouponInfo(null); setCouponError('');
    setNotes(''); setExtrasOpen(false); setReceived(''); setCardRef(''); setMethod('CASH'); setConfirmation(null); setChange(0); setError(''); setQuery('');
    setSplit(false); setParts([]); setHoldOpen(false); setHoldLabel(''); setCollecting(null);
    setOrderId(null); setOrder(null);
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const idem = useIdempotencyKey();

  const charge = async () => {
    setError('');
    if (!billLines.length) { setError('Add at least one item'); return; }
    for (const l of billLines) {
      if (l.custom && (!l.name.trim() || !l.unit_price)) { setError('Every custom item needs a description and a price'); return; }
      if (!Number(l.quantity)) { setError(`Set a quantity for ${l.name || 'the custom item'}, or remove it`); return; }
    }
    if (split) {
      if (parts.slice(0, -1).some((p) => !(Number(p.amount) > 0))) { setError('Enter an amount for each part of the split. Leave only the last one blank for the rest.'); return; }
      if (fixedParts + (lastFixed || 0) > totals.total + 0.005) { setError(`The parts add up to ${formatCurrency(fixedParts + (lastFixed || 0))}, more than the bill.`); return; }
    }
    setBusy(true);
    let payload = null;
    const sending = restaurant && toKitchen;
    try {
      const cardSlip = (m, ref) => (m === 'CARD' && ref?.trim() ? { reference_number: ref.trim() } : {});
      const pay = split
        ? { payments: parts.map((p, i) => ({ method: p.method, amount: i === parts.length - 1 && p.amount === '' ? 'REST' : Number(p.amount), ...cardSlip(p.method, p.reference) })) }
        : { payment: payLater || upiQr ? undefined : { method, amount: amount ?? 'FULL', ...cardSlip(method, cardRef) } };
      const extras = {
        discount: Number(invoiceDiscount) || undefined,
        coupon_code: couponCode.trim() || undefined,
        redeem_points: Number(redeem) > 0 ? Number(redeem) : undefined,
        notes: notes || undefined
      };
      let invoice;
      if (orderMode) {
        // anything not yet sent goes to the kitchen first, then the order is billed and closes
        if (sending && orderLines.some((l) => l.pending)) {
          const kot = await api(`/orders/${orderId}/kot`, { method: 'POST', body: {} });
          if (getDevicePrefs().autoPrintKot) printKotSlip(kot.kot_id);
        }
        invoice = await api(`/orders/${orderId}/bill`, { method: 'POST', idempotencyKey: idem.get(), body: { ...extras, ...pay } });
        loadOpenOrders();
      } else {
      const items = cart.map((l) => l.custom
        ? { description: l.name, quantity: l.quantity, unit_price: l.unit_price, tax_rate: l.tax_rate, discount: l.discount || undefined }
        : { product_id: l.product_id, quantity: l.quantity, discount: l.discount || undefined, modifier_ids: l.modifier_ids?.length ? l.modifier_ids : undefined });

      // offline it falls back to a plain UPI sale: the queued copy carries the payment, and no kitchen ticket
      payload = {
        customer_id: customerId || undefined,
        items,
        ...extras,
        ...(split ? pay : { payment: payLater ? undefined : { method, amount: amount ?? 'FULL', ...cardSlip(method, cardRef) } })
      };
      // the QR step records the UPI payment once the customer has paid
      const body = { ...payload, ...pay, ...(sending ? { send_to_kitchen: true } : {}) };
      invoice = await api('/invoices', { method: 'POST', idempotencyKey: idem.get(), body });
      if (invoice.order && getDevicePrefs().autoPrintKot) printKotSlip(invoice.order.kot_id);
      }
      idem.settle();
      if (upiQr) { setCollecting({ invoice, amount: partial ? amount : undefined }); return; }
      // from the saved total: round-off and freebies can move it from the estimate
      setChange(!split && method === 'CASH' && amount != null ? Math.max(0, Math.round((amount - invoice.total) * 100) / 100) : 0);
      setConfirmation(invoice);
      const cash = split ? parts.some((p) => p.method === 'CASH') : method === 'CASH' && !payLater;
      if (getDevicePrefs().autoPrintReceipt) printReceipt(invoice.invoice_id, { cash });
      else if (cash && getDevicePrefs().openDrawer) openDrawer();
    } catch (caught) {
      // No connection: keep the sale on this device and send it when the connection is back (see lib/offlineQueue.js)
      if (caught instanceof NetworkError && payload) {
        const saved = queueSale({ label: `${formatCurrency(totals.total)} · ${cart.length} item${cart.length === 1 ? '' : 's'}`, body: payload, idempotencyKey: idem.get() });
        if (saved) { idem.settle(); setConfirmation({ offline: true, total: totals.total, toKitchen: sending }); setBusy(false); return; }
        setError('Too many sales are waiting to sync. Reconnect before taking more.');
      } else {
        idem.settle(caught);
        setError(caught.message);
      }
    } finally {
      setBusy(false);
    }
  };

  /* Put the bill on hold (kept on the server for this outlet) and clear the till. */
  const snapshot = () => ({
    lines: cart.map((l) => ({ product_id: l.product_id, custom: Boolean(l.custom), name: l.name, unit: l.unit, unit_price: l.unit_price, quantity: l.quantity, discount: l.discount, tax_rate: l.tax_rate, modifier_ids: l.modifier_ids || [], sig: l.sig || '', track_inventory: l.track_inventory, current_stock: l.current_stock })),
    customer_id: customerId || null, customer_name: customerName || null, coupon_code: couponCode.trim() || null,
    discount: Number(invoiceDiscount) || 0, notes: notes || null
  });
  const holdBill = async (label = holdLabel) => {
    try {
      await api('/held-bills', { method: 'POST', body: { label: label.trim() || undefined, bill: snapshot(), estimate: totals.total } });
      toast.success(label.trim() ? `Held: ${label.trim()}` : 'Bill put on hold');
      resetSale(); loadHeld();
      return true;
    } catch (caught) {
      setError(caught instanceof NetworkError ? "You're offline, so this bill can't be held right now." : caught.message);
      return false;
    }
  };
  /* Bill an open order here: the current sale goes on hold first, as when resuming a held bill. */
  const openOrder = async (o) => {
    if (o.order_id === orderId) { setOrdersOpen(false); loadOrder(o.order_id); return; }   // same id would never refetch after a reset
    if (!orderMode && cart.length) {
      if (!(await dialog.confirm({ title: 'Hold the current bill?', body: 'It goes on hold so you can bill this order. You can resume it any time.', confirmLabel: 'Hold and continue' }))) return;
      if (!(await holdBill('Held while billing an order'))) return;
    }
    resetSale(); setOrdersOpen(false); setOrderId(o.order_id);
  };

  const resume = async (h) => {
    if (orderMode) resetSale();
    else if (cart.length) {
      if (!(await dialog.confirm({ title: 'Hold the current bill?', body: 'It goes on hold so you can open this one. You can resume it any time.', confirmLabel: 'Hold and continue' }))) return;
      if (!(await holdBill('Held while resuming another'))) return;
    }
    try {
      const got = await api(`/held-bills/${h.hold_id}`, { method: 'DELETE' });
      const b = got.bill;
      setCart(b.lines.map((l) => ({ ...l, key: keySeq++ })));
      if (b.customer_id) { setCustomerId(b.customer_id); setCustomerName(b.customer_name || 'Customer'); }
      setCouponCode(b.coupon_code || ''); setInvoiceDiscount(b.discount ? String(b.discount) : ''); setNotes(b.notes || '');
      setExtrasOpen(Boolean(b.coupon_code || b.discount || b.notes));
      setHeldOpen(false); loadHeld();
      toast.success(`Resumed ${h.label || 'the held bill'}`);
    } catch (caught) { toast.error(caught.message); loadHeld(); }
  };
  const discard = async (h) => {
    if (!(await dialog.confirm({ title: `Discard ${h.label || 'this held bill'}?`, body: 'It cannot be brought back.', confirmLabel: 'Discard', danger: true }))) return;
    try { await api(`/held-bills/${h.hold_id}`, { method: 'DELETE' }); } catch (caught) { toast.error(caught.message); }
    loadHeld();
  };

  /* Keyboard: "/" to search, Ctrl/⌘ + Enter to charge, Enter for a new sale when done. A shop's till adds the keys a
     fast cashier expects: F2 customer, F4 discount, F8 payment, and + − Delete and the arrows for the selected line. */
  const chargeRef = useRef(charge); chargeRef.current = charge;
  const keys = useRef({});
  keys.current = { retail, scanning, quickFor };
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (e.key === '/' && !typing && !confirmation) { e.preventDefault(); searchRef.current?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !confirmation) { e.preventDefault(); chargeRef.current(); }
      const { retail: shop, scanning: camera, quickFor: making } = keys.current;
      if (!shop || confirmation || camera || making !== null || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'F2') { e.preventDefault(); setCustomerOpen(true); }
      else if (e.key === 'F4') { e.preventDefault(); setExtrasOpen(true); setTimeout(() => document.getElementById('bill-discount')?.focus(), 30); }
      else if (e.key === 'F8') { e.preventDefault(); document.getElementById('pay-received')?.focus(); }
      else if (!typing) {
        const lines = cartRef.current;
        const i = lines.findIndex((l) => l.key === selRef.current);
        if ((e.key === '+' || e.key === '=') && i >= 0) { e.preventDefault(); setCart((c) => c.map((l) => (l.key === selRef.current ? { ...l, quantity: Number(l.quantity || 0) + 1 } : l))); }
        else if ((e.key === '-' || e.key === '_') && i >= 0) { e.preventDefault(); setCart((c) => c.flatMap((l) => (l.key !== selRef.current ? [l] : Number(l.quantity || 0) > 1 ? [{ ...l, quantity: Number(l.quantity) - 1 }] : []))); }
        else if (e.key === 'Delete' && i >= 0) { e.preventDefault(); setCart((c) => c.filter((l) => l.key !== selRef.current)); }
        else if (e.key === 'ArrowDown' && lines.length) { e.preventDefault(); setSelKey(lines[Math.min(lines.length - 1, i + 1)].key); }
        else if (e.key === 'ArrowUp' && lines.length) { e.preventDefault(); setSelKey(lines[Math.max(0, i - 1)].key); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmation]);

  /* A scan, as the camera screen asks for it: found and added, found but not sellable, or no such barcode.
     The device's own copy answers first (instant, and it works with no connection); the server is the second opinion. */
  const handleScan = async (raw) => {
    const code = String(raw).trim();
    let product = retail && catalogInfo().ready ? localLookup(code) : null;
    if (!product) {
      try { product = await api(`/products/barcode/${encodeURIComponent(code)}`); }
      catch (caught) {
        if (caught instanceof NetworkError) return catalogInfo().ready ? { status: 'unknown' } : { status: 'error', label: "You're offline, and this device has no catalogue yet" };
        if (caught.status !== 404) return { status: 'error', label: caught.message };
      }
    }
    if (!product) return { status: 'unknown' };
    if (product.is_available === false) return { status: 'blocked', label: `${product.name} is not sold at this outlet` };
    const have = cartRef.current.filter((l) => l.product_id === product.product_id).reduce((n, l) => n + Number(l.quantity || 0), 0);
    addProduct(product);
    return { status: 'ok', label: product.name, detail: `× ${have + 1}` };
  };

  const afterScanner = () => { setScanning(false); setTimeout(() => searchRef.current?.focus(), 0); };
  const resumeCamera = () => { if (resumeScan) { setResumeScan(false); setScanning(true); } };

  const onSearchKey = async (e) => {
    if (e.key === 'Escape') { setQuery(''); return; }
    if (e.key === 'ArrowDown' && retail && shown.length) { e.preventDefault(); setHi((h) => Math.min(shown.length - 1, h + 1)); return; }
    if (e.key === 'ArrowUp' && retail && shown.length) { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); return; }
    if (e.key !== 'Enter' || !q) return;
    e.preventDefault();
    let pick = retail ? localLookup(query.trim()) : null;
    pick = pick || (products || []).find((p) => p.barcode?.toLowerCase() === q || p.sku?.toLowerCase() === q);   // the exact barcode or SKU
    if (!pick) {
      // a product's other barcodes, its ERP or supplier code: the server knows them all
      try {
        const found = await api(`/products/lookup/${encodeURIComponent(query.trim())}`);
        if (found.length > 1) { toast.error('More than one product has that code. Pick one from the list.'); return; }
        pick = found[0];
      } catch { /* not a code: fall through to the name match */ }
    }
    pick = pick || shown[retail ? hi : 0] || shown[0];
    if (pick && pick.is_available !== false) { choose(pick); setQuery(''); }
  };

  const finishUpi = (invoice) => {
    setCollecting(null); setChange(0); setConfirmation(invoice);
    if (getDevicePrefs().autoPrintReceipt) printReceipt(invoice.invoice_id, { cash: false });
  };

  if (confirmation) {
    return <Done confirmation={confirmation} change={change} onNew={resetSale} onView={() => navigate(`/app/billing/invoices/${confirmation.invoice_id}`)} />;
  }

  const itemCount = billLines.reduce((s, l) => s + Number(l.quantity || 0), 0);
  const chargeLabel = busy ? 'Charging…'
    : split ? (splitDue > 0 ? `Take ${formatCurrency(totals.total - splitDue)} · ${formatCurrency(splitDue)} due` : `Charge ${formatCurrency(totals.total)} · split ${parts.length} ways`)
    : payLater ? `Save bill · ${formatCurrency(totals.total)} unpaid`
    : upiQr ? `Show UPI QR · ${formatCurrency(partial ? amount : totals.total)}`
    : partial ? `Take ${formatCurrency(amount)} · ${formatCurrency(totals.total - amount)} due`
    : `Charge ${formatCurrency(totals.total)}`;

  return (
    <div className="-m-4 grid grid-cols-1 gap-0 sm:-m-6 lg:-m-8 lg:h-[calc(100vh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_400px]">
      {/* ── Left: find items ── */}
      <section aria-label="Items" className="flex min-h-0 min-w-0 flex-col p-4 sm:p-6 lg:overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              autoFocus
              placeholder="Search or scan a barcode"
              aria-label="Search items by name, SKU or barcode. Press Enter to add."
              className="h-12 w-full rounded-lg border border-line-strong bg-surface pl-11 pr-12 text-body text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
            />
            {query ? (
              <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus(); }} aria-label="Clear search" className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-400 hover:bg-surface-2 pointer-coarse:h-11 pointer-coarse:w-11"><X className="h-4 w-4" /></button>
            ) : (
              <kbd className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-caption text-ink-400 sm:block">/</kbd>
            )}
          </div>
          {retail && !orderMode && <Button onClick={() => setScanning(true)} className="h-12 shrink-0"><ScanLine aria-hidden="true" className="h-5 w-5" /><span className="hidden sm:inline">Scan</span><span className="sm:hidden">Scan</span></Button>}
          {!orderMode && <Button variant="secondary" onClick={addCustomLine} className="h-12 shrink-0"><PackagePlus aria-hidden="true" className="h-4 w-4" /><span className="hidden sm:inline">Custom item</span></Button>}
        </div>

        {retail && !query && !orderMode && quick.length > 0 && (
          <div className="mt-3" role="group" aria-label="Quick products">
            <p className="mb-1.5 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Quick</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {quick.map((p) => (
                <button key={p.product_id} type="button" onClick={() => choose(p)} disabled={p.is_available === false}
                        className="flex min-h-12 shrink-0 flex-col items-start justify-center rounded-lg border border-brand-500/30 bg-brand-50 px-3 py-1.5 text-left hover:border-brand-500 disabled:opacity-50 pointer-coarse:min-h-14">
                  <span className="max-w-36 truncate text-small font-semibold text-ink-900">{p.name}</span>
                  <span className="tabular text-caption text-ink-600">{formatCurrency(p.selling_price)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {retail && (
          <p className="mt-2 text-caption text-ink-500" aria-live="polite">
            {catalog.ready ? `Works offline: ${catalog.count.toLocaleString('en-IN')} products on this device${catalog.syncing ? ', updating…' : ''}` : catalog.syncing ? 'Getting the catalogue onto this device…' : 'Catalogue not on this device yet'}
          </p>
        )}
        {categories.length > 0 && (
          <div role="group" aria-label="Categories" className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {['', ...categories].map((c) => (
              <button key={c || 'all'} type="button" onClick={() => setCategory(c)} aria-pressed={category === c}
                      className={`shrink-0 rounded-lg border px-3 py-1.5 text-small font-medium transition-colors duration-(--duration-fast) pointer-coarse:min-h-11 pointer-coarse:px-4 ${category === c ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>
                {c || 'All'}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
          {products === null ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8.25rem,1fr))] gap-2">{Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-[88px] animate-pulse rounded-(--radius-card) bg-surface-3" />)}</div>
          ) : products.length === 0 ? (
            <div className="rounded-(--radius-card) border border-dashed border-line-strong p-10 text-center">
              <p className="text-body font-medium text-ink-900">No items to sell yet</p>
              <p className="mt-1 text-small text-ink-500">Add your products or menu, then bill them here.</p>
              <Button to="/app/products" className="mt-4">Add products</Button>
            </div>
          ) : shown.length === 0 ? (
            <p className="py-10 text-center text-small text-ink-500">Nothing matches “{query}”.{!orderMode && <> <button type="button" onClick={addCustomLine} className="font-medium text-brand-600">Add it as a custom item</button></>}</p>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(8.25rem,1fr))] gap-2">
                {shown.slice(0, TILE_LIMIT).map((p, i) => <ProductTile key={p.product_id} product={p} inCart={inCart.get(p.product_id) || 0} onAdd={choose} highlight={retail && Boolean(query) && i === hi} />)}
              </div>
              {shown.length > TILE_LIMIT && <p className="mt-3 text-center text-caption text-ink-500">Showing {TILE_LIMIT} of {shown.length}. Search to narrow it down.</p>}
            </>
          )}
        </div>
      </section>

      {ordersOpen && <OpenOrders orders={openOrders} onPick={openOrder} onClose={() => setOrdersOpen(false)} />}
      {heldOpen && <HeldBills bills={heldBills} onResume={resume} onDiscard={discard} onClose={() => setHeldOpen(false)} />}
      {picking && <ModifierPicker product={picking} onClose={() => setPicking(null)} onConfirm={(ids, selected) => addProduct(picking, ids, selected)} />}
      {scanning && (
        <BarcodeScanner onScan={handleScan} onClose={afterScanner} canCreate={can('product_quick_add')} skipCode={justMade}
                        onSearch={(code) => { afterScanner(); if (code) setQuery(code); }}
                        onCreate={(code) => { setScanning(false); setResumeScan(true); setJustMade(null); setQuickFor(code); }} />
      )}
      {quickFor !== null && (
        <QuickProductModal barcode={quickFor} categories={cats}
                           onCancel={() => { setQuickFor(null); resumeCamera(); }}
                           onCreated={(p) => { upsertLocal(p); addProduct(p); setJustMade(p.barcode || null); setQuickFor(null); toast.success(`${p.name} added, SKU ${p.sku || 'made'}`); resumeCamera(); }}
                           onUseExisting={async (c) => { setQuickFor(null); try { addProduct(await api(`/products/${c.product_id}`)); } catch (caught) { setError(caught.message); } resumeCamera(); }} />
      )}

      {/* ── Right: the bill ── */}
      <section id="bill" aria-label="Current bill" className="flex min-h-0 min-w-0 scroll-mt-16 flex-col border-t border-line bg-surface pb-20 lg:border-l lg:border-t-0 lg:pb-0">
        <div className="border-b border-line px-5 py-3">
          {/* What is being billed: a new counter sale, or an order already open on a table, takeaway or delivery. */}
          {restaurant && (
            <div role="group" aria-label="What are you billing?" className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
              {[
                { key: 'counter', active: !orderMode, label: 'Counter sale', onClick: () => { if (orderMode) resetSale(); } },
                { key: 'order', active: orderMode, label: 'Open order', count: openOrders.length, onClick: () => { loadOpenOrders(); setOrdersOpen(true); } }
              ].map((s) => (
                <button key={s.key} type="button" aria-pressed={s.active} onClick={s.onClick}
                        className={`flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-small font-medium transition-colors duration-(--duration-fast) pointer-coarse:min-h-11 ${s.active ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'}`}>
                  {s.label}
                  {s.count > 0 && <span className="tabular rounded-full bg-ink-900 px-1.5 text-[11px] font-semibold text-white">{s.count}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <h1 className="flex min-w-0 items-center gap-2 text-body font-semibold text-ink-900">
              <span className="truncate">{orderMode ? (order ? orderTitle(order) : 'Loading the order…') : 'Bill'}</span>
              {orderMode && order && orderKind(order) && <span className="shrink-0 rounded-md bg-brand-50 px-2 py-0.5 text-caption font-semibold text-brand-700">{orderKind(order)}</span>}
              {itemCount > 0 && <span className="tabular shrink-0 font-normal text-ink-500">· {itemCount} item{itemCount === 1 ? '' : 's'}</span>}
            </h1>
            {!orderMode && (
              <div className="flex shrink-0 items-center gap-1">
                {heldBills.length > 0 && (
                  <button type="button" onClick={() => { loadHeld(); setHeldOpen(true); }} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-small font-medium text-ink-700 hover:bg-surface-2 pointer-coarse:min-h-11 pointer-coarse:px-3">
                    Resume<span className="tabular rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-white">{heldBills.length}</span>
                  </button>
                )}
                {cart.length > 0 && (
                  <>
                    <button type="button" onClick={() => setHoldOpen((v) => !v)} aria-expanded={holdOpen} className="flex items-center gap-1 rounded-md px-2 py-1 text-small font-medium text-ink-700 hover:bg-surface-2 pointer-coarse:min-h-11 pointer-coarse:px-3">
                      <Pause aria-hidden="true" className="h-3.5 w-3.5" />Hold
                    </button>
                    <button type="button" onClick={async () => { if (await dialog.confirm({ title: 'Clear this bill?', body: 'Every item on it is removed.', confirmLabel: 'Clear bill', danger: true })) resetSale(); }} className="rounded-md px-2 py-1 text-small font-medium text-ink-500 hover:text-danger pointer-coarse:min-h-11 pointer-coarse:px-3">Clear</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {holdOpen && cart.length > 0 && (
          <form onSubmit={(e) => { e.preventDefault(); holdBill(); }} className="fade-in flex items-center gap-2 border-b border-line bg-surface-2 px-5 py-3">
            <Input autoFocus placeholder="Name it (optional): Table 4, blue shirt…" value={holdLabel} onChange={(e) => setHoldLabel(e.target.value)} aria-label="Name for the held bill" className="!py-2" />
            <Button type="submit" size="md">Hold bill</Button>
          </form>
        )}

        {/* Customer */}
        <div className="border-b border-line px-5 py-3">
          {customerId ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600"><UserRound aria-hidden="true" className="h-4 w-4" /></span>
                <p className="min-w-0 flex-1 truncate text-small font-medium text-ink-900">{customerName}</p>
                <button type="button" onClick={clearCustomer} className="text-small font-medium text-ink-500 hover:text-ink-900 pointer-coarse:min-h-11 pointer-coarse:px-2">Change</button>
              </div>
              {card && <LoyaltyCard card={card} compact />}
              <RewardHint card={card} items={billLines} total={totals.total} onAdd={() => { const p = (products || []).find((x) => x.product_id === card.reward_product_id); if (p) addProduct(p); }} />
              {pointsInfo && <PointsPanel points={pointsInfo} total={Math.max(0, totals.before - totals.coupon)} value={redeem} onChange={setRedeem} />}
            </div>
          ) : customerOpen ? (
            <div className="space-y-2">
              <MobileLookup onPick={(c, loyalty, points) => { pickCustomer(c); setCard(loyalty); setPointsInfo(points); }} />
              <Input placeholder="Or search by name" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} aria-label="Search customers by name" />
              {filteredCustomers.length > 0 && (
                <ul className="max-h-40 overflow-y-auto rounded-lg border border-line">
                  {filteredCustomers.map((c) => (
                    <li key={c.customer_id}><button type="button" onClick={() => pickCustomer(c)} className="block w-full px-3 py-2 text-left text-small hover:bg-surface-2">{c.name}</button></li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => setCustomerOpen(false)} className="text-small text-ink-500 hover:text-ink-900 pointer-coarse:min-h-11">Keep as walk-in</button>
            </div>
          ) : (
            <button type="button" onClick={() => setCustomerOpen(true)} className="flex min-h-9 w-full items-center gap-3 text-left pointer-coarse:min-h-11">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-ink-500"><UserRound aria-hidden="true" className="h-4 w-4" /></span>
              <span className="flex-1 text-small text-ink-700">Walk-in customer</span>
              <span className="text-small font-medium text-brand-600">Add customer</span>
            </button>
          )}
        </div>

        {orderMode && order && (
          <div className="flex items-start gap-2 border-b border-line bg-brand-50 px-5 py-2.5 text-caption text-brand-700">
            <ClipboardList aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>Billing open order <span className="font-semibold">{order.order_number}</span>. Items you tap are added to this order. Charging closes it.</p>
          </div>
        )}

        {/* Lines */}
        <div className="min-h-[120px] flex-1 overflow-y-auto px-5">
          {orderMode ? (
            orderLines.length === 0 ? (
              <p className="py-10 text-center text-small text-ink-500">{order ? 'Nothing left to bill on this order. Tap items to add them.' : 'Loading…'}</p>
            ) : (
              <ul className="divide-y divide-line">{orderLines.map((l) => <OrderBillLine key={l.key} line={l} onQty={setOrderQty} />)}</ul>
            )
          ) : cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-10 text-center">
              <p className="text-small font-medium text-ink-700">No items yet</p>
              <p className="mt-1 text-caption text-ink-500">Tap an item or scan a barcode to start the bill.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {cart.map((l) => <BillLine key={l.key} line={l} selected={retail && l.key === selKey} onSelect={() => setSelKey(l.key)} onChange={(patch) => updateLine(l.key, patch)} onRemove={() => removeLine(l.key)} />)}
            </ul>
          )}
        </div>

        {/* Totals and payment */}
        <div className="border-t border-line px-5 pt-3 lg:max-h-[66vh] lg:overflow-y-auto">
          <Alert>{error}</Alert>

          <div className={error ? 'mt-3' : ''}>
            {extrasOpen ? (
              <div className="mb-3 space-y-2.5 rounded-lg bg-surface-2 p-3">
                <div className="flex gap-2">
                  <Input placeholder="Coupon code" value={couponCode} aria-label="Coupon code"
                         onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponInfo(null); setCouponError(''); }} className="!py-2" />
                  <Button type="button" variant="secondary" size="md" onClick={applyCoupon} disabled={!couponCode.trim() || !billLines.length}>Apply</Button>
                </div>
                {couponInfo && <p className="text-caption font-medium text-success">{couponInfo.code}: {formatCurrency(couponInfo.discount)} off{couponInfo.description ? ` · ${couponInfo.description}` : ''}</p>}
                {couponError && <p className="text-caption text-danger" role="alert">{couponError}</p>}
                <div className="flex gap-2">
                  <div className="w-36"><Input type="number" min="0" step="0.01" placeholder="₹ off the bill" id="bill-discount" aria-label="Discount on the whole bill in rupees" value={invoiceDiscount} onChange={(e) => setInvoiceDiscount(e.target.value)} className="!py-2" /></div>
                  <Input placeholder="Note on the bill (optional)" aria-label="Note on the bill" value={notes} onChange={(e) => setNotes(e.target.value)} className="!py-2" />
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setExtrasOpen(true)} className="mb-1 inline-flex min-h-8 items-center text-small font-medium text-brand-600 hover:text-brand-700 pointer-coarse:min-h-11">+ Discount, coupon or note</button>
            )}
          </div>

          <dl className="tabular space-y-1 text-small">
            <div className="flex justify-between text-ink-500"><dt>Subtotal</dt><dd>{formatCurrency(totals.subtotal)}</dd></div>
            {totals.gstEnabled && <div className="flex justify-between text-ink-500"><dt>GST (estimate)</dt><dd>{formatCurrency(totals.tax)}</dd></div>}
            {totals.discount > 0 && <div className="flex justify-between text-ink-500"><dt>Discount</dt><dd>−{formatCurrency(totals.discount)}</dd></div>}
            {totals.coupon > 0 && <div className="flex justify-between text-success"><dt>Coupon {couponInfo.code}</dt><dd>−{formatCurrency(totals.coupon)}</dd></div>}
            {totals.pointsOff > 0 && <div className="flex justify-between text-success"><dt>Points ({redeem})</dt><dd>−{formatCurrency(totals.pointsOff)}</dd></div>}
            {totals.rewardOff > 0 && <div className="flex justify-between text-success"><dt>Free {card.reward_item} (loyalty)</dt><dd>−{formatCurrency(totals.rewardOff)}</dd></div>}
            <div className="flex items-baseline justify-between pt-1.5">
              <dt className="text-body font-semibold text-ink-900">Total</dt>
              <dd className="text-[28px] font-semibold leading-none tracking-tight text-ink-900">{formatCurrency(totals.total)}</dd>
            </div>
          </dl>

          {split ? (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-small font-semibold text-ink-900">Split payment</p>
                <button type="button" onClick={stopSplit} className="text-small font-medium text-ink-500 hover:text-ink-900 pointer-coarse:min-h-11 pointer-coarse:px-2">One payment</button>
              </div>
              {parts.map((p, i) => {
                const last = i === parts.length - 1;
                return (
                  <div key={p.key} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-32 shrink-0">
                      <Select value={p.method} onChange={(e) => setPart(p.key, { method: e.target.value })} aria-label={`Part ${i + 1} method`} className="!py-2">
                        {SPLIT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </Select>
                    </div>
                    <Input type="number" min="0" step="0.01" value={p.amount} onChange={(e) => setPart(p.key, { amount: e.target.value })}
                           placeholder={last ? `Rest · ${splitRest.toFixed(2)}` : '₹ amount'} aria-label={`Part ${i + 1} amount${last ? ', blank for the rest' : ''}`} className="!py-2 text-right" />
                    {parts.length > 2 && (
                      <button type="button" onClick={() => setParts((ps) => ps.filter((x) => x.key !== p.key))} aria-label={`Remove part ${i + 1}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-400 hover:bg-danger/5 hover:text-danger pointer-coarse:h-11 pointer-coarse:w-11"><X className="h-4 w-4" /></button>
                    )}
                  </div>
                  {p.method === 'CARD' && (
                    <Input value={p.reference || ''} maxLength={80} onChange={(e) => setPart(p.key, { reference: e.target.value })}
                           placeholder="Machine approval code (optional)" aria-label={`Part ${i + 1} card machine approval code`} className="!py-2" />
                  )}
                  </div>
                );
              })}
              <div className="flex items-center justify-between text-caption">
                {parts.length < 6
                  ? <button type="button" onClick={() => setParts((ps) => [...ps, { key: keySeq++, method: 'CARD', amount: '' }])} className="font-medium text-brand-600 hover:text-brand-700 pointer-coarse:min-h-11">+ Add another way</button>
                  : <span />}
                <span className={`tabular ${fixedParts > totals.total ? 'text-danger' : splitDue > 0 ? 'text-warning' : 'text-ink-500'}`}>
                  {fixedParts > totals.total ? 'More than the bill' : splitDue > 0 ? `${formatCurrency(splitDue)} stays due` : `Last part: ${formatCurrency(lastFixed ?? splitRest)}`}
                </span>
              </div>
            </div>
          ) : (
          <>
          <div role="radiogroup" aria-label="How is it paid?" className="pos-gap pos-methods mt-3 grid grid-cols-3 gap-1.5">
            {METHODS.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={method === value} onClick={() => { setMethod(value); setReceived(''); }}
                      className={`pos-method h-10 rounded-lg border text-small font-medium transition-colors duration-(--duration-fast) pointer-coarse:h-11 ${method === value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>
                {label}
              </button>
            ))}
          </div>

          {payLater ? (
            <p className={`mt-3 text-caption ${customerId ? 'text-ink-500' : 'text-warning'}`}>
              {customerId ? `Saved as unpaid on ${customerName}'s account.` : 'Saved as unpaid. Add a customer so you know who owes it.'}
            </p>
          ) : (
            <div className="mt-3 flex items-center gap-3">
              <div className="w-36">
                <Input type="number" min="0" step="0.01" value={received} onChange={(e) => setReceived(e.target.value)}
                       placeholder={totals.total ? totals.total.toFixed(2) : '0.00'}
                       id="pay-received" aria-label={method === 'CASH' ? 'Cash received' : 'Amount paid now'} className="!py-2 text-right pointer-coarse:!py-3" />
              </div>
              <p className="tabular flex-1 text-caption text-ink-500">
                {cashChange > 0 ? <span className="text-small font-semibold text-brand-700">Change {formatCurrency(cashChange)}</span>
                  : partial ? <span className="text-warning">Part payment. {formatCurrency(totals.total - amount)} stays due.</span>
                  : <span className="pos-hint">{method === 'CASH' ? 'Cash received. Leave blank if exact.' : 'Paid in full. Type less for a part payment.'}</span>}
              </p>
            </div>
          )}
          {method === 'CARD' && !split && (
            <div className="mt-3">
              <Input value={cardRef} maxLength={80} onChange={(e) => setCardRef(e.target.value)}
                     placeholder="Machine approval code (optional)" aria-label="Card machine approval code" className="!py-2 pointer-coarse:!py-3" />
              <p className="pos-hint mt-1 text-caption text-ink-500">From the card machine's slip. It is saved on the bill so you can match your settlement.</p>
            </div>
          )}
          {method === 'UPI' && !split && (
            <p className="pos-hint mt-2 text-caption text-ink-500">
              {business?.upi_vpa
                ? <>The bill is saved, then a QR for the exact amount appears for the customer to scan ({business.upi_vpa}).</>
                : <>To show a UPI QR for each bill, add your UPI ID in <Link to="/app/settings/business" className="font-medium text-brand-700 hover:underline">Business settings</Link>.</>}
            </p>
          )}
          <button type="button" onClick={startSplit} disabled={!billLines.length} className="mt-1 flex min-h-8 items-center gap-1.5 text-small font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50 pointer-coarse:min-h-11">
            <Split aria-hidden="true" className="h-3.5 w-3.5" />Split between payment methods
          </button>
          </>
          )}

          {restaurant && (!orderMode || orderLines.some((l) => l.pending)) && (
            <label className="pos-gap mt-3 flex items-start gap-2.5 rounded-lg border border-line px-3 py-2">
              <input type="checkbox" checked={toKitchen} onChange={(e) => { setToKitchen(e.target.checked); setDevicePref('posSendToKitchen', e.target.checked); }} className="mt-0.5 h-4 w-4 accent-[var(--color-brand-500)] pointer-coarse:h-5 pointer-coarse:w-5" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-small font-medium text-ink-900"><ChefHat aria-hidden="true" className="h-4 w-4 text-ink-500" />Send to the kitchen</span>
                <span className="pos-hint block text-caption text-ink-500">
                  {orderMode ? `The ${orderLines.filter((l) => l.pending).length} items not sent yet go to the kitchen, then the order is billed.`
                    : toKitchen ? 'The kitchen screen gets a ticket when you charge, with an order number to call out.' : 'Off: nothing goes to the kitchen (for drinks or packed items served at the counter).'}
                </span>
              </span>
            </label>
          )}

          <div className="-mx-5 bg-surface px-5 pb-3 pt-3 lg:sticky lg:bottom-0 lg:z-10 lg:pt-2"><Button onClick={charge} disabled={busy || !billLines.length} size="lg" className="h-12 w-full text-body">{chargeLabel}</Button></div>
          {collecting && (
            <UpiCollect invoice={collecting.invoice} amount={collecting.amount} vpa={business.upi_vpa} payee={business.name}
                        onPaid={finishUpi} onLater={() => finishUpi(collecting.invoice)} />
          )}
          <p className="pos-hint mt-2 hidden text-center text-caption text-ink-400 lg:block">
            {retail ? 'Ctrl + Enter to charge · / search · F2 customer · F4 discount · F8 payment · + − Del the selected line' : 'Ctrl + Enter to charge · / to search'}
          </p>
          <p className="mt-1 text-center text-caption text-ink-400 lg:hidden"><Link to="/app/billing/invoices" className="inline-flex min-h-11 items-center px-3 hover:text-ink-700">See earlier bills</Link></p>
        </div>
      </section>

      {/* Phone: the bill is below the items, so keep the total in reach. */}
      {billLines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg lg:hidden">
          <div className="min-w-0 flex-1">
            <p className="tabular text-title font-semibold leading-tight text-ink-900">{formatCurrency(totals.total)}</p>
            <p className="text-caption text-ink-500">{itemCount} item{itemCount === 1 ? '' : 's'}</p>
          </div>
          <Button onClick={() => document.getElementById('bill')?.scrollIntoView({ behavior: 'smooth' })} size="lg">Review and charge</Button>
        </div>
      )}
    </div>
  );
};

export default BillingPage;
