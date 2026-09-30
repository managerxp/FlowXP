/*
 * The salon till.
 *
 * Left: what can be sold (services, retail products, packages, memberships, gift cards). Right: the bill —
 * client, lines with who did each one, offers, points, payments. The bill on the right is always the server's
 * own quote (POST /salon/pos/quote runs the real billing pipeline and rolls it back), so GST, membership
 * discounts, offers, points and stock checks shown here are exactly what the sale will do; nothing is
 * calculated twice in the browser.
 *
 * Keys: "/" search · F2 client · F9 or Ctrl+Enter take payment · Esc clears the search.
 * A sale that cannot reach the server is kept on this device and sent when the connection returns (the same
 * offline queue the restaurant till uses), with an Idempotency-Key so it can never be billed twice.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronDown, Crown, Gift, Minus, PackagePlus, Plus, Printer, Scissors, Search, ShoppingBag, Tag, Trash2, Wallet } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { queueSale, useOnline } from '../../lib/offline.js';
import { getDevicePrefs, printReceipt } from '../../lib/printing.js';
import { PAYMENT_LABEL, dateText, useDebounced, useLoad } from '../../lib/salon.js';
import { Alert, Badge, Button, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Select, Textarea, useToast } from '../../components/ui.jsx';
import ClientPicker from './ClientPicker.jsx';
import { Chips } from './parts.jsx';

const money = (n) => formatCurrency(n);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
let lineSeq = 0;
const newKey = () => `l${++lineSeq}`;

const TABS = [
  { value: 'SERVICE', label: 'Services', icon: Scissors },
  { value: 'PRODUCT', label: 'Products', icon: ShoppingBag },
  { value: 'PACKAGE', label: 'Packages', icon: PackagePlus },
  { value: 'MEMBERSHIP', label: 'Memberships', icon: Crown },
  { value: 'GIFT_CARD', label: 'Gift card', icon: Gift }
];

/* ── the cart, as the API wants it ────────────────────────────────────────── */

const useOf = (line) => {
  if (!line.use) return undefined;
  if (line.use === 'MEMBERSHIP') return { kind: 'MEMBERSHIP' };
  return { kind: 'PACKAGE', cp_id: Number(line.use.split(':')[1]) };
};

const toItem = (l) => {
  const base = l.discount ? { discount: num(l.discount) } : {};
  if (l.type === 'SERVICE') {
    const edited = Object.entries(l.actual || {}).filter(([, v]) => v !== '' && v != null).map(([ingredient_id, quantity]) => ({ ingredient_id: Number(ingredient_id), quantity: num(quantity) }));
    return { type: 'SERVICE', service_id: l.ref, staff_id: l.staff_id ? Number(l.staff_id) : undefined, quantity: l.quantity, use: useOf(l), ...base, ...(edited.length ? { consumption_actual: edited } : {}) };
  }
  if (l.type === 'PRODUCT') return { type: 'PRODUCT', product_id: l.ref, quantity: l.quantity, staff_id: l.staff_id ? Number(l.staff_id) : undefined, ...base };
  if (l.type === 'PACKAGE') return { type: 'PACKAGE', package_id: l.ref, staff_id: l.staff_id ? Number(l.staff_id) : undefined };
  if (l.type === 'MEMBERSHIP') return { type: 'MEMBERSHIP', plan_id: l.ref, staff_id: l.staff_id ? Number(l.staff_id) : undefined };
  return { type: 'GIFT_CARD', amount: num(l.price), ...(l.expires_on ? { expires_on: l.expires_on } : {}) };
};

/* ── catalogue pane ───────────────────────────────────────────────────────── */

const Tile = ({ title, sub, price, onClick, disabled, badge }) => (
  <button type="button" onClick={onClick} disabled={disabled}
          className="flex min-h-[4.5rem] flex-col justify-between rounded-(--radius-card) border border-line bg-surface p-3 text-left transition-[border-color,box-shadow] duration-(--duration-fast) hover:border-brand-500 hover:shadow-sm disabled:opacity-50">
    <span className="text-small font-medium leading-snug text-ink-900">{title}</span>
    <span className="mt-2 flex items-end justify-between gap-2">
      <span className="text-caption text-ink-500">{sub}</span>
      <span className="flex items-center gap-1.5">{badge}<span className="tabular text-small font-semibold text-ink-900">{price}</span></span>
    </span>
  </button>
);

const Catalogue = ({ catalog, tab, setTab, add, search, setSearch, searchRef, features }) => {
  const [category, setCategory] = useState('all');
  const term = useDebounced(search.trim(), 250);
  const [products, setProducts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [giftAmount, setGiftAmount] = useState('');

  useEffect(() => {
    if (tab !== 'PRODUCT') return undefined;
    let live = true;
    setBusy(true);
    api(`/salon/pos/products?limit=48${term ? `&q=${encodeURIComponent(term)}` : ''}`).then((rows) => { if (live) setProducts(rows); }).catch(() => { if (live) setProducts([]); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [tab, term]);

  const match = (name) => !term || name.toLowerCase().includes(term.toLowerCase());
  const services = catalog.services.filter((s) => match(s.name) && (category === 'all' || String(s.category_id) === category));

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input ref={searchRef} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search services and products  ( / )" aria-label="Search the catalogue" className="pl-9" />
        </div>
      </div>
      <div role="tablist" aria-label="What to sell" className="mb-3 flex gap-1 overflow-x-auto">
        {TABS.filter((t) => (t.value !== 'PACKAGE' || features.packages) && (t.value !== 'MEMBERSHIP' || features.memberships) && (t.value !== 'GIFT_CARD' || features.giftCards)).map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}
                  className={`flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-small font-medium transition-colors duration-(--duration-fast) ${tab === t.value ? 'bg-brand-500 text-white' : 'bg-surface text-ink-700 ring-1 ring-line hover:ring-line-strong'}`}>
            <t.icon aria-hidden="true" className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === 'SERVICE' && (
        <>
          {catalog.categories.length > 0 && (
            <div className="mb-3"><Chips label="Service category" value={category} onChange={setCategory} options={[{ value: 'all', label: 'All' }, ...catalog.categories.map((c) => ({ value: String(c.category_id), label: c.name }))]} /></div>
          )}
          {services.length === 0 ? <EmptyState compact icon={Scissors} title={term ? 'No service matches' : 'No services yet'} body={term ? 'Try another word.' : 'Add your services under Services.'} />
            : <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {services.map((s) => <Tile key={s.service_id} title={s.name} sub={`${s.duration_min} min`} price={money(s.price)} onClick={() => add({ type: 'SERVICE', ref: s.service_id, name: s.name, price: s.price })} />)}
            </div>}
        </>
      )}

      {tab === 'PRODUCT' && (busy && products.length === 0 ? <PageLoader /> : products.length === 0 ? <EmptyState compact icon={ShoppingBag} title="No products found" body="Retail products are added under Products." />
        : <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => (
            <Tile key={p.product_id} title={p.name} sub={[p.brand, p.stock != null ? `${p.stock} in stock` : null].filter(Boolean).join(' · ') || p.unit} price={money(p.price)}
                  badge={p.stock != null && p.stock <= 0 ? <Badge tone="danger">Out</Badge> : null}
                  onClick={() => add({ type: 'PRODUCT', ref: p.product_id, name: p.name, price: p.price })} />
          ))}
        </div>)}

      {tab === 'PACKAGE' && (catalog.packages.filter((p) => match(p.name)).length === 0 ? <EmptyState compact icon={PackagePlus} title="No packages" body="Create packages under Memberships & offers." />
        : <div className="grid gap-2.5 sm:grid-cols-2">
          {catalog.packages.filter((p) => match(p.name)).map((p) => (
            <Tile key={p.package_id} title={p.name} sub={p.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')} price={money(p.price)} onClick={() => add({ type: 'PACKAGE', ref: p.package_id, name: p.name, price: p.price, single: true })} />
          ))}
        </div>)}

      {tab === 'MEMBERSHIP' && (catalog.membership_plans.filter((p) => match(p.name)).length === 0 ? <EmptyState compact icon={Crown} title="No membership plans" body="Create plans under Memberships & offers." />
        : <div className="grid gap-2.5 sm:grid-cols-2">
          {catalog.membership_plans.filter((p) => match(p.name)).map((p) => (
            <Tile key={p.plan_id} title={p.name} sub={`${p.duration_days} days${p.benefits?.discount_pct ? ` · ${p.benefits.discount_pct}% off` : ''}`} price={money(p.price)} onClick={() => add({ type: 'MEMBERSHIP', ref: p.plan_id, name: `${p.name} membership`, price: p.price, single: true })} />
          ))}
        </div>)}

      {tab === 'GIFT_CARD' && (
        <div className="max-w-sm rounded-(--radius-card) border border-line bg-surface p-4">
          <p className="mb-3 text-small text-ink-500">Sell a gift card for any amount. It is issued when the bill is paid in full, and the code is shown on the screen and the receipt.</p>
          <div className="mb-3 flex flex-wrap gap-1.5">{[500, 1000, 2000, 5000].map((a) => <Button key={a} variant="secondary" size="sm" onClick={() => setGiftAmount(String(a))}>{money(a)}</Button>)}</div>
          <Field id="gift-amount" label="Amount (₹)"><Input id="gift-amount" type="number" min="1" inputMode="decimal" value={giftAmount} onChange={(e) => setGiftAmount(e.target.value)} /></Field>
          <Button className="mt-3" disabled={num(giftAmount) <= 0} onClick={() => { add({ type: 'GIFT_CARD', ref: null, name: 'Gift card', price: num(giftAmount), single: true }); setGiftAmount(''); }}><Plus aria-hidden="true" className="h-4 w-4" />Add gift card</Button>
        </div>
      )}
    </div>
  );
};

/* ── one cart line ────────────────────────────────────────────────────────── */

const CartLine = ({ line, quoted, staff, ent, catalogService, update, remove }) => {
  const [open, setOpen] = useState(false);
  const isService = line.type === 'SERVICE';
  const choices = staff.filter((s) => !isService || !s.service_ids?.length || s.service_ids.includes(line.ref));
  const usable = [];
  if (isService && ent) {
    if (ent.membership) {
      const f = ent.membership.free_services.find((x) => x.service_id === line.ref);
      if (f && f.remaining > 0) usable.push({ value: 'MEMBERSHIP', label: `Free with ${ent.membership.plan_name} (${f.remaining} left)` });
    }
    for (const p of ent.packages) { const it = p.items.find((i) => i.service_id === line.ref); if (it) usable.push({ value: `PACKAGE:${p.cp_id}`, label: `${p.name} (${it.remaining} left)` }); }
  }
  const variable = catalogService?.consumables || [];
  const total = quoted?.total;
  const needsStaff = line.type === 'SERVICE';

  return (
    <li className="border-b border-line px-4 py-3 last:border-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-small font-medium text-ink-900">{line.name}</p>
          <p className="text-caption text-ink-500">
            {line.use ? <span className="font-medium text-success">Included — no charge</span> : <>{money(line.price)}{line.quantity > 1 ? ` × ${line.quantity}` : ''}</>}
            {quoted && quoted.discount > 0 && <span className="ml-2 text-success">−{money(quoted.discount)}</span>}
          </p>
        </div>
        {!line.single && (
          <div className="flex items-center gap-1" role="group" aria-label={`Quantity of ${line.name}`}>
            <button type="button" aria-label="One fewer" onClick={() => update({ quantity: Math.max(1, line.quantity - 1) })} className="flex h-7 w-7 items-center justify-center rounded-lg border border-line-strong text-ink-700 hover:bg-surface-2"><Minus className="h-3.5 w-3.5" /></button>
            <span className="tabular w-6 text-center text-small font-semibold">{line.quantity}</span>
            <button type="button" aria-label="One more" onClick={() => update({ quantity: line.quantity + 1 })} className="flex h-7 w-7 items-center justify-center rounded-lg border border-line-strong text-ink-700 hover:bg-surface-2"><Plus className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <span className="tabular w-20 shrink-0 text-right text-small font-semibold text-ink-900">{total != null ? money(total) : money(line.use ? 0 : line.price * line.quantity)}</span>
        <button type="button" onClick={remove} aria-label={`Remove ${line.name}`} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(needsStaff || line.type === 'PRODUCT' || line.type === 'PACKAGE' || line.type === 'MEMBERSHIP') && staff.length > 0 && (
          <label className="flex items-center gap-1.5 text-caption text-ink-500">
            {needsStaff ? 'Done by' : 'Sold by'}
            <Select aria-label={`${needsStaff ? 'Done by' : 'Sold by'} for ${line.name}`} value={line.staff_id || ''} onChange={(e) => update({ staff_id: e.target.value })} className="!w-auto !py-1 !text-caption">
              <option value="">{needsStaff ? 'Choose…' : 'Nobody'}</option>
              {choices.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.name}</option>)}
            </Select>
          </label>
        )}
        {usable.length > 0 && (
          <label className="flex items-center gap-1.5 text-caption text-ink-500">
            Use
            <Select aria-label={`How to pay for ${line.name}`} value={line.use || ''} onChange={(e) => update({ use: e.target.value })} className="!w-auto !py-1 !text-caption">
              <option value="">Charge for it</option>
              {usable.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </Select>
          </label>
        )}
        {(line.type === 'SERVICE' || line.type === 'PRODUCT') && !line.use && (
          <label className="flex items-center gap-1.5 text-caption text-ink-500">
            Discount ₹
            <span className="w-20"><Input aria-label={`Discount on ${line.name}`} type="number" min="0" inputMode="decimal" value={line.discount} onChange={(e) => update({ discount: e.target.value })} className="!py-1 !text-caption" /></span>
          </label>
        )}
        {variable.length > 0 && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1 text-caption font-medium text-brand-600">
            Materials used<ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {open && variable.length > 0 && (
        <div className="mt-2 grid gap-2 rounded-(--radius-control) bg-surface-2 p-3 sm:grid-cols-2">
          <p className="text-caption text-ink-500 sm:col-span-2">Stock is taken off using the usual amounts. Change one if the stylist used something different.</p>
          {variable.map((m) => (
            <label key={m.ingredient_id} className="flex items-center justify-between gap-2 text-caption text-ink-700">
              <span>{m.name}{m.is_variable && <span className="ml-1 text-warning">varies</span>}</span>
              <span className="flex items-center gap-1"><span className="w-20"><Input type="number" min="0" step="any" aria-label={`${m.name} used`} placeholder={String(Math.round(m.quantity * 100) / 100)} value={line.actual?.[m.ingredient_id] ?? ''} onChange={(e) => update({ actual: { ...(line.actual || {}), [m.ingredient_id]: e.target.value } })} className="!py-1 !text-caption" /></span>{m.unit}</span>
            </label>
          ))}
        </div>
      )}
    </li>
  );
};

/* ── payment rows ─────────────────────────────────────────────────────────── */

const PaymentRows = ({ methods, rows, setRows, total, payLater, setPayLater, hasClient }) => {
  const [cards, setCards] = useState({});
  const set = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const paid = rows.reduce((s, r) => s + (r.amount === '' ? 0 : num(r.amount)), 0);
  const blanks = rows.filter((r) => r.amount === '').length;
  const toast = useToast();

  const check = async (i) => {
    try {
      const c = await api(`/salon/gift-cards/lookup?code=${encodeURIComponent(rows[i].code || '')}`);
      setCards((x) => ({ ...x, [i]: c }));
      if (!c.usable) toast.error(c.expired ? 'That gift card has expired' : 'That gift card cannot be used');
      else if (rows[i].amount === '') set(i, { amount: String(Math.min(c.balance, total || c.balance)) });
    } catch (error) { setCards((x) => ({ ...x, [i]: null })); toast.error(error.message); }
  };

  return (
    <div className="space-y-2.5">
      <label className={`flex items-center gap-2 text-small ${hasClient ? 'text-ink-700' : 'text-ink-400'}`}>
        <input type="checkbox" disabled={!hasClient} checked={payLater} onChange={(e) => setPayLater(e.target.checked)} className="h-4 w-4 accent-(--color-brand-500)" />
        Pay later — leave the whole bill unpaid{!hasClient && ' (choose a client first)'}
      </label>
      {!payLater && rows.map((r, i) => (
        <div key={i} className="rounded-(--radius-control) border border-line p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label={`Payment method ${i + 1}`} value={r.method} onChange={(e) => set(i, { method: e.target.value, code: '' })} className="!w-auto min-w-32 !py-1.5">
              {methods.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m] || m}</option>)}
            </Select>
            <div className="relative min-w-28 flex-1">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-small text-ink-400">₹</span>
              <Input aria-label={`Amount paid by ${PAYMENT_LABEL[r.method] || r.method}`} type="number" min="0" inputMode="decimal" value={r.amount} placeholder={blanks === 1 && r.amount === '' ? 'The rest' : 'Amount'} onChange={(e) => set(i, { amount: e.target.value })} className="!py-1.5 pl-7" />
            </div>
            {rows.length > 1 && <button type="button" aria-label="Remove this payment" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
          </div>
          {r.method === 'GIFT_CARD' && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="min-w-40 flex-1"><Input aria-label="Gift card code" value={r.code || ''} onChange={(e) => set(i, { code: e.target.value.toUpperCase() })} placeholder="Gift card code" className="!py-1.5 uppercase" /></div>
              <Button size="sm" variant="secondary" onClick={() => check(i)} disabled={!r.code}>Check balance</Button>
              {cards[i]?.usable && <span className="text-caption font-medium text-success">{money(cards[i].balance)} available</span>}
            </div>
          )}
          {['UPI', 'CARD', 'BANK_TRANSFER', 'WALLET'].includes(r.method) && (
            <div className="mt-2"><Input aria-label="Reference" value={r.reference || ''} onChange={(e) => set(i, { reference: e.target.value })} placeholder="Reference (optional)" className="!py-1.5 !text-caption" /></div>
          )}
        </div>
      ))}
      {!payLater && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setRows((r) => [...r, { method: methods.find((m) => !r.some((x) => x.method === m)) || 'CASH', amount: '' }])}><Plus aria-hidden="true" className="h-4 w-4" />Split the payment</Button>
          {blanks === 0 && paid > 0 && total > 0 && Math.abs(paid - total) > 0.005 && (
            <span className={`text-caption font-medium ${paid < total ? 'text-warning' : 'text-danger'}`}>{paid < total ? `${money(total - paid)} will be left unpaid` : `${money(paid - total)} more than the bill`}</span>
          )}
        </div>
      )}
    </div>
  );
};

/* ── the finished sale ────────────────────────────────────────────────────── */

const Done = ({ result, queued, onNew, onClose }) => {
  const navigate = useNavigate();
  if (queued) {
    return (
      <Modal title="Saved on this device" onClose={onClose}>
        <p className="text-small text-ink-700">There is no connection right now, so this sale is saved here and will be billed automatically as soon as the connection is back. Nothing will be billed twice.</p>
        <div className="mt-5 flex justify-end"><Button onClick={onNew}>Start the next bill</Button></div>
      </Modal>
    );
  }
  const inv = result.invoice;
  const due = num(inv.balance_due);
  return (
    <Modal title={`Bill ${inv.invoice_number}`} onClose={onClose}>
      <div className="flex items-center gap-3 rounded-(--radius-card) bg-success/10 p-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success text-white"><Check aria-hidden="true" className="h-5 w-5" /></span>
        <div>
          <p className="text-body font-semibold text-ink-900">{money(inv.total)}{due > 0 ? <span className="ml-2 text-small font-medium text-warning">{money(due)} still to pay</span> : ' paid'}</p>
          <p className="text-caption text-ink-500">{result.lines.length} item{result.lines.length === 1 ? '' : 's'}{inv.points_earned ? ` · ${inv.points_earned} points earned` : ''}</p>
        </div>
      </div>
      {result.issued.gift_cards.length > 0 && (
        <div className="mt-4 space-y-2">
          {result.issued.gift_cards.map((g) => (
            <div key={g.code} className="rounded-(--radius-card) border border-dashed border-brand-500 bg-brand-50 p-3 text-center">
              <p className="text-caption font-medium text-ink-500">Gift card · {money(g.amount)}</p>
              <p className="tabular select-all font-mono text-title font-semibold tracking-widest text-brand-700">{g.code}</p>
              <p className="text-caption text-ink-500">Give this code to the client. It is also on the receipt.</p>
            </div>
          ))}
        </div>
      )}
      {result.issued.memberships.map((m) => <p key={m.membership_id} className="mt-3 text-small text-ink-700"><Crown aria-hidden="true" className="mr-1.5 inline h-4 w-4 text-warning" />Membership {m.renewed ? 'renewed' : 'started'} — runs to {dateText(String(m.expiry_date).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}.</p>)}
      {result.issued.packages.map((p) => <p key={p.cp_id} className="mt-3 text-small text-ink-700"><PackagePlus aria-hidden="true" className="mr-1.5 inline h-4 w-4 text-brand-600" />Package added — valid until {dateText(String(p.expiry_date).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}.</p>)}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => printReceipt(inv.invoice_id)}><Printer aria-hidden="true" className="h-4 w-4" />Print receipt</Button>
        <Button variant="secondary" onClick={() => navigate(`/app/billing/invoices/${inv.invoice_id}`)}>View bill</Button>
        <Button onClick={onNew}>Next bill</Button>
      </div>
    </Modal>
  );
};

/* ── the screen ───────────────────────────────────────────────────────────── */

const SalonPos = () => {
  const { hasFeature } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const idem = useIdempotencyKey();
  const [params, setParams] = useSearchParams();
  const catalogState = useLoad('/salon/pos/catalog');
  const catalog = catalogState.data;

  const [tab, setTab] = useState('SERVICE');
  const [search, setSearch] = useState('');
  const [client, setClient] = useState(null);
  const [cart, setCart] = useState([]);
  const [lastStaff, setLastStaff] = useState('');
  const [invDiscount, setInvDiscount] = useState('');
  const [offerCode, setOfferCode] = useState('');
  const [offerIds, setOfferIds] = useState([]);
  const [skipAuto, setSkipAuto] = useState(false);
  const [usePoints, setUsePoints] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState([{ method: 'CASH', amount: '' }]);
  const [payLater, setPayLater] = useState(false);
  const [appointment, setAppointment] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const searchRef = useRef(null);
  const clientRef = useRef(null);
  const ent = useLoad(client ? `/salon/pos/entitlements?customer_id=${client.customer_id}` : null);

  const features = { packages: hasFeature('salon_packages'), memberships: hasFeature('salon_memberships'), giftCards: hasFeature('salon_gift_cards') };
  const staff = catalog?.staff || [];
  const byService = useMemo(() => new Map((catalog?.services || []).map((s) => [s.service_id, s])), [catalog]);

  /* an appointment sent here from the calendar arrives as a ready cart */
  useEffect(() => {
    const id = params.get('appointment');
    if (!id || !catalog) return;
    let live = true;
    api(`/salon/appointments/${id}/cart`).then((c) => {
      if (!live) return;
      setAppointment(Number(id));
      if (c.customer_id) api(`/salon/clients/${c.customer_id}`).then((cl) => live && setClient({ customer_id: cl.customer_id, name: cl.name, phone: cl.phone, allergies: cl.allergies, membership: cl.membership })).catch(() => {});
      setCart(c.items.map((i) => ({ key: newKey(), type: 'SERVICE', ref: i.service_id, name: i.name, price: i.price, quantity: 1, staff_id: i.staff_id ? String(i.staff_id) : '', discount: '', use: '', actual: null })));
    }).catch((e) => toast.error(e.message)).finally(() => setParams({}, { replace: true }));
    return () => { live = false; };
  }, [params, catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = useCallback((item) => {
    const only = staff.length === 1 ? String(staff[0].staff_id) : '';
    setCart((c) => {
      const same = !item.single && c.find((l) => l.type === item.type && l.ref === item.ref && !l.use && !l.discount && !l.actual && (item.type !== 'SERVICE' || l.staff_id === lastStaff));
      if (same) return c.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { key: newKey(), quantity: 1, staff_id: item.type === 'GIFT_CARD' ? '' : (lastStaff || only), discount: '', use: '', actual: null, ...item }];
    });
  }, [lastStaff, staff]);

  const update = (key, patch) => {
    if (patch.staff_id !== undefined) setLastStaff(patch.staff_id);
    setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const remove = (key) => setCart((c) => c.filter((l) => l.key !== key));

  /* what the quote and the sale are both built from */
  const buildBody = useCallback(() => ({
    customer_id: client?.customer_id ?? undefined,
    items: cart.map(toItem),
    discount: invDiscount ? num(invDiscount) : undefined,
    offer_code: offerCode.trim() || undefined,
    offer_ids: offerIds.length ? offerIds : undefined,
    skip_auto_offers: skipAuto || undefined,
    redeem_points: usePoints ? Math.floor(num(usePoints)) : undefined,
    notes: notes.trim() || undefined,
    appointment_id: appointment || undefined
  }), [client, cart, invDiscount, offerCode, offerIds, skipAuto, usePoints, notes, appointment]);

  const signature = JSON.stringify(buildBody());
  const debounced = useDebounced(signature, 350);
  const waiting = cart.some((l) => l.type === 'SERVICE' && !l.staff_id);   // a service needs a person before the server can price it
  useEffect(() => {
    const body = JSON.parse(debounced);
    if (!cart.length || !body.items.length || waiting) { setQuote(null); setQuoteError(''); return undefined; }
    let live = true;
    setQuoting(true);
    api('/salon/pos/quote', { method: 'POST', body })
      .then((q) => { if (live) { setQuote(q); setQuoteError(''); } })
      .catch((e) => { if (live) setQuoteError(e.message); })
      .finally(() => { if (live) setQuoting(false); });
    return () => { live = false; };
  }, [debounced, cart.length, waiting]);

  const fresh = quote && debounced === signature && !quoteError && !waiting;
  const total = quote?.total ?? cart.reduce((s, l) => s + (l.use ? 0 : l.price * l.quantity), 0);
  const eligibleOffers = (ent.data?.offers || []).filter((o) => o.eligible && !o.auto_apply && !offerIds.includes(o.offer_id));
  const points = ent.data?.points;
  const needsStaffLine = cart.find((l) => l.type === 'SERVICE' && !l.staff_id);
  const methods = catalog?.payment_methods || ['CASH'];

  const reset = () => {
    setCart([]); setClient(null); setInvDiscount(''); setOfferCode(''); setOfferIds([]); setSkipAuto(false); setUsePoints(''); setNotes('');
    setRows([{ method: 'CASH', amount: '' }]); setPayLater(false); setAppointment(null); setQuote(null); setQuoteError(''); setSearch(''); setDone(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const payments = () => {
    if (payLater) return undefined;
    const blanks = rows.filter((r) => r.amount === '');
    if (blanks.length > 1) throw new Error('Only one payment can be left blank to take “the rest”');
    return rows.filter((r) => r.amount !== '' || blanks.length === 1).map((r) => ({
      method: r.method, amount: r.amount === '' ? 'REST' : num(r.amount),
      ...(r.method === 'GIFT_CARD' ? { code: r.code } : {}), ...(r.reference ? { reference_number: r.reference } : {})
    }));
  };

  const charge = useCallback(async () => {
    if (saving || !cart.length) return;
    if (needsStaffLine) { toast.error(`Choose who did ${needsStaffLine.name}`); return; }
    let body;
    try { body = { ...buildBody(), payments: payments() }; } catch (error) { toast.error(error.message); return; }
    setSaving(true);
    try {
      const result = await api('/salon/pos/invoices', { method: 'POST', body, idempotencyKey: idem.get() });
      idem.settle(null);
      if (getDevicePrefs().autoPrintReceipt) printReceipt(result.invoice.invoice_id);
      setDone({ result });
    } catch (error) {
      idem.settle(error);
      if (error instanceof TypeError) {
        const saved = queueSale({ label: `${money(total)} · ${cart.length} item${cart.length === 1 ? '' : 's'}`, body, idempotencyKey: idem.get(), path: '/salon/pos/invoices' });
        if (saved) { idem.settle(null); setDone({ queued: true }); }
        else toast.error('Too many sales are waiting to be sent. Reconnect and try again.');
      } else toast.error(error.message);
    } finally { setSaving(false); }
  }, [saving, cart, needsStaffLine, buildBody, idem, total, rows, payLater]); // eslint-disable-line react-hooks/exhaustive-deps

  /* keyboard: / search, F2 client, F9 or Ctrl+Enter charge */
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
      if (e.key === '/' && !typing && !done) { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'F2') { e.preventDefault(); clientRef.current?.focus(); }
      else if (e.key === 'F9' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) { e.preventDefault(); if (!done) charge(); }
      else if (e.key === 'Escape' && document.activeElement === searchRef.current) setSearch('');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [charge, done]);

  if (catalogState.loading && !catalog) return <PageLoader label="Opening the till…" />;
  if (catalogState.error) return <Alert>{catalogState.error}</Alert>;

  const t = quote;
  const lineOf = (i) => t?.lines?.[i];

  return (
    <div>
      <PageHeader title="Billing" lead="Ring up services and products, apply what the client has, take payment."
                  action={<span className="hidden text-caption text-ink-500 lg:block"><kbd className="rounded border border-line bg-surface px-1.5">/</kbd> search · <kbd className="rounded border border-line bg-surface px-1.5">F2</kbd> client · <kbd className="rounded border border-line bg-surface px-1.5">F9</kbd> take payment</span>} />
      {!online && <div className="mb-4 rounded-(--radius-control) border border-warning/30 bg-warning/10 px-3.5 py-2 text-small text-ink-900">You are offline. Bills taken now are kept on this device and sent when the connection returns.</div>}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_26rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
        <Catalogue catalog={catalog} tab={tab} setTab={setTab} add={add} search={search} setSearch={setSearch} searchRef={searchRef} features={features} />

        <aside aria-label="The bill" className="flex flex-col gap-3 lg:sticky lg:top-20">
          <div className="rounded-(--radius-card) border border-line bg-surface p-3">
            <ClientPicker value={client} onChange={(c) => { setClient(c); setOfferIds([]); setUsePoints(''); if (!c) setPayLater(false); }} inputRef={clientRef} placeholder="Client (optional) — name or mobile  ( F2 )" id="pos-client" />
            {client?.allergies && <p className="mt-2 rounded-lg bg-danger/10 px-3 py-1.5 text-caption font-medium text-danger">Allergy: {client.allergies}</p>}
            {ent.data && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-caption">
                {ent.data.membership && <Badge tone="warning">{ent.data.membership.plan_name} · {ent.data.membership.discount_pct ? `${ent.data.membership.discount_pct}% off · ` : ''}until {dateText(String(ent.data.membership.expiry_date).slice(0, 10), { day: 'numeric', month: 'short' })}</Badge>}
                {ent.data.packages.map((p) => <Badge key={p.cp_id} tone="brand">{p.name}: {p.items.map((i) => `${i.remaining}× ${i.name}`).join(', ')}</Badge>)}
                {ent.data.gift_cards.map((g) => <Badge key={g.card_id} tone="success">Gift card {money(g.balance)}</Badge>)}
                {points && points.balance > 0 && <Badge tone="neutral">{points.balance} points ({money(points.balance_value)})</Badge>}
              </div>
            )}
          </div>

          <div className="rounded-(--radius-card) border border-line bg-surface">
            {cart.length === 0 ? <EmptyState compact icon={Scissors} title="Nothing on the bill yet" body="Tap a service or product to add it." />
              : <ul>{cart.map((l, i) => <CartLine key={l.key} line={l} quoted={lineOf(i)} staff={staff} ent={ent.data} catalogService={byService.get(l.ref)} update={(p) => update(l.key, p)} remove={() => remove(l.key)} />)}</ul>}
          </div>

          {cart.length > 0 && (
            <div className="space-y-3 rounded-(--radius-card) border border-line bg-surface p-4">
              <div className="grid grid-cols-2 gap-2">
                <Field id="pos-discount" label="Bill discount ₹"><Input id="pos-discount" type="number" min="0" inputMode="decimal" value={invDiscount} onChange={(e) => setInvDiscount(e.target.value)} /></Field>
                <Field id="pos-offer" label="Offer code"><Input id="pos-offer" value={offerCode} onChange={(e) => setOfferCode(e.target.value.toUpperCase())} className="uppercase" /></Field>
              </div>
              {(eligibleOffers.length > 0 || offerIds.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {offerIds.map((id) => { const o = ent.data.offers.find((x) => x.offer_id === id); return <button key={id} type="button" onClick={() => setOfferIds((x) => x.filter((y) => y !== id))} className="flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-caption font-medium text-success"><Tag aria-hidden="true" className="h-3 w-3" />{o?.name} ✕</button>; })}
                  {eligibleOffers.map((o) => <button key={o.offer_id} type="button" onClick={() => setOfferIds((x) => [...x, o.offer_id])} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-caption font-medium text-ink-700 hover:border-brand-500"><Tag aria-hidden="true" className="h-3 w-3" />Apply {o.name}</button>)}
                </div>
              )}
              {t?.offers?.some((o) => ent.data?.offers?.find((x) => x.offer_id === o.offer_id && x.auto_apply)) && (
                <label className="flex items-center gap-2 text-caption text-ink-500"><input type="checkbox" checked={skipAuto} onChange={(e) => setSkipAuto(e.target.checked)} className="h-4 w-4 accent-(--color-brand-500)" />Don’t apply automatic offers to this bill</label>
              )}
              {points && points.balance >= points.min_redeem_points && (
                <Field id="pos-points" label={`Use points (you have ${points.balance}; each is worth ${money(points.point_value)})`} hint={`At least ${points.min_redeem_points}, and at most ${points.max_redeem_pct}% of the services and products.`}>
                  <Input id="pos-points" type="number" min="0" max={points.balance} value={usePoints} onChange={(e) => setUsePoints(e.target.value)} />
                </Field>
              )}
            </div>
          )}

          {cart.length > 0 && (
            <div className="rounded-(--radius-card) border border-line bg-surface p-4">
              {quoteError && <div className="mb-3"><Alert>{quoteError}</Alert></div>}
              <dl className={`space-y-1.5 text-small ${quoting || !fresh ? 'opacity-60' : ''}`} aria-live="polite">
                {t && <>
                  <div className="flex justify-between"><dt className="text-ink-500">Subtotal</dt><dd className="tabular">{money(t.subtotal)}</dd></div>
                  {t.membership_discount_pct && <div className="flex justify-between text-success"><dt>Membership ({t.membership_discount_pct}%)</dt><dd>applied</dd></div>}
                  {t.offers?.map((o) => <div key={o.offer_id} className="flex justify-between text-success"><dt>{o.name}</dt><dd className="tabular">−{money(o.amount)}</dd></div>)}
                  {t.discount > 0 && <div className="flex justify-between text-success"><dt>Discount</dt><dd className="tabular">−{money(t.discount)}</dd></div>}
                  {t.points_discount > 0 && <div className="flex justify-between text-success"><dt>Points</dt><dd className="tabular">−{money(t.points_discount)}</dd></div>}
                  {t.tax > 0 && (t.igst > 0
                    ? <div className="flex justify-between"><dt className="text-ink-500">IGST</dt><dd className="tabular">{money(t.igst)}</dd></div>
                    : <><div className="flex justify-between"><dt className="text-ink-500">CGST</dt><dd className="tabular">{money(t.cgst)}</dd></div><div className="flex justify-between"><dt className="text-ink-500">SGST</dt><dd className="tabular">{money(t.sgst)}</dd></div></>)}
                  {t.round_off !== 0 && <div className="flex justify-between"><dt className="text-ink-500">Round off</dt><dd className="tabular">{money(t.round_off)}</dd></div>}
                </>}
                <div className="flex items-baseline justify-between border-t border-line pt-2 text-body font-semibold text-ink-900"><dt>Total</dt><dd className="tabular text-title">{money(total)}</dd></div>
                {t?.points_earned > 0 && <div className="flex justify-between text-caption text-ink-500"><dt>Points earned</dt><dd>{t.points_earned}</dd></div>}
              </dl>

              <div className="mt-4"><PaymentRows methods={methods} rows={rows} setRows={setRows} total={total} payLater={payLater} setPayLater={setPayLater} hasClient={Boolean(client)} /></div>

              <details className="mt-3">
                <summary className="cursor-pointer text-caption font-medium text-ink-500">Add a note</summary>
                <Textarea aria-label="Note on the bill" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-2" />
              </details>

              <Button size="lg" className="mt-4 w-full" loading={saving} disabled={!cart.length || Boolean(quoteError) || quoting} onClick={charge}>
                <Wallet aria-hidden="true" className="h-5 w-5" />{payLater ? 'Save the bill' : `Take payment · ${money(total)}`}
              </Button>
              {needsStaffLine && <p className="mt-2 text-center text-caption text-warning">Choose who did {needsStaffLine.name}.</p>}
              <button type="button" onClick={reset} className="mt-2 w-full text-center text-caption text-ink-500 hover:text-danger">Clear the bill</button>
            </div>
          )}
        </aside>
      </div>

      {done && <Done result={done.result} queued={done.queued} onNew={reset} onClose={reset} />}
    </div>
  );
};

export default SalonPos;
