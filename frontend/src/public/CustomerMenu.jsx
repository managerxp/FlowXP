/*
 * The page a customer's own phone opens after scanning a table's QR code. No
 * login, no AuthContext, no app shell: only the table's qr_token in the URL,
 * matching publicOrdering.controller.js on the backend.
 *
 * Laid out like the menus people already know: who you are ordering from and
 * at which table, a search, a row of categories, dishes with their veg mark,
 * price, description and photo with an Add button, and an order bar at the
 * bottom. The restaurant's visit card is on the page too: type a mobile
 * number to see your stamps, and the same number goes on the order.
 *
 * Deliberately does not import lib/api.js's api() helper: that attaches a
 * session and a business header, both meaningless here. A plain fetch is the
 * whole client this page needs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { CheckCircle2, ChevronDown, Gift, MapPin, Minus, Plus, Search, UtensilsCrossed, X } from 'lucide-react';
import { Alert, Button, Logo } from '../components/ui.jsx';
import { useIdempotencyKey } from '../lib/idempotency.js';
import ModifierPicker, { needsChoices } from '../components/ModifierPicker.jsx';
import FoodMark from '../components/FoodMark.jsx';

const publicApi = async (path, options = {}) => {
  const response = await fetch(`/api/public${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.idempotencyKey && { 'Idempotency-Key': options.idempotencyKey }) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'Something went wrong');
  return payload.data;
};

const formatPrice = (amount, currency) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(Number(amount)) ? 0 : 2 }).format(amount || 0);
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th'}`;
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/*
 * "Pay via UPI": not a payment gateway. `upi://pay` is the standard link every
 * UPI app handles, addressed to the business's own UPI ID with the amount
 * filled in, the same thing a UPI sticker on the counter carries. FlowXP never
 * learns whether the payment happened.
 */
const UpiPayment = ({ vpa, businessName, amount, note }) => {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const upiUri = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(businessName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
  useEffect(() => { QRCode.toDataURL(upiUri, { width: 320, margin: 1 }).then(setQrDataUrl); }, [upiUri]);
  return (
    <div className="mt-6 rounded-(--radius-card) border border-line bg-surface p-5 text-center">
      <p className="text-small font-semibold text-ink-900">Pay now with UPI (optional)</p>
      <p className="mt-0.5 text-caption text-ink-500">Scan with any UPI app, or tap the button on this phone. You can also pay the staff.</p>
      {qrDataUrl && <img src={qrDataUrl} alt="UPI payment QR code" className="mx-auto mt-3 h-40 w-40" />}
      <a href={upiUri} className="mt-3 block"><Button as="span" variant="secondary" className="w-full">Pay {formatPrice(amount)} in a UPI app</Button></a>
    </div>
  );
};

/* ── The visit card ───────────────────────────────────────────────────── */

const Stamps = ({ total, filled, ready }) => (
  <div className="flex flex-wrap gap-1.5" aria-label={`${filled} of ${total} visits`}>
    {Array.from({ length: total }, (_, i) => (
      <span key={i} className={`flex h-7 w-7 items-center justify-center rounded-full text-caption font-bold ${i < filled ? 'bg-white text-brand-700' : 'border border-white/50 text-white/80'}`}>{i < filled ? '✓' : i + 1}</span>
    ))}
    <span className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-caption font-bold ${ready ? 'bg-white text-brand-700' : 'border border-dashed border-white/60 text-white'}`}><Gift aria-hidden="true" className="h-3.5 w-3.5" />FREE</span>
  </div>
);

/* Type a mobile number to see the card. Nothing is created and no name is shown. */
const LoyaltyCardPanel = ({ token, loyalty, phone, setPhone, card, setCard, rewardInCart, onAddReward }) => {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const slots = loyalty.visits_required - 1;
  const look = async () => {
    setError(''); setBusy(true);
    try { setCard(await publicApi(`/menu/${token}/loyalty`, { method: 'POST', body: { phone } })); }
    catch (caught) { setError(caught.message); setCard(null); }
    finally { setBusy(false); }
  };
  return (
    <section aria-label="Visit card" className="rounded-(--radius-panel) bg-brand-500 p-4 text-white shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-caption font-semibold uppercase tracking-[0.14em] text-white/80">Visit card</p>
          <p className="mt-1 text-body font-semibold">Every {ordinal(loyalty.visits_required)} visit: free {loyalty.reward_item}</p>
        </div>
        <Gift aria-hidden="true" className="h-7 w-7 shrink-0 text-white/90" />
      </div>
      <div className="mt-3"><Stamps total={slots} filled={card ? card.stamps : 0} ready={card?.reward_ready} /></div>
      {card ? (
        <>
          <p className="mt-3 text-small font-semibold">{card.member ? card.message : `New here? This visit starts your card. ${card.message}`}</p>
          {card.reward_ready && (rewardInCart
            ? <p className="mt-2 rounded-lg bg-white/15 px-3 py-2 text-small font-semibold">✓ Your free {card.reward_item} is in your order.</p>
            : onAddReward && <button type="button" onClick={onAddReward} className="mt-2 w-full rounded-lg bg-white py-2.5 text-small font-semibold text-brand-700">Add my free {card.reward_item}</button>)}
        </>
      ) : open ? (
        <div className="mt-3">
          <div className="flex gap-2">
            <input inputMode="tel" autoComplete="tel" placeholder="Your mobile number" value={phone} onChange={(e) => { setPhone(e.target.value); setCard(null); }} aria-label="Your mobile number"
                   className="min-w-0 flex-1 rounded-lg border-0 bg-white px-3.5 py-2.5 text-small text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-white/60" />
            <button type="button" onClick={look} disabled={busy || phone.replace(/\D/g, '').length < 10} className="rounded-lg bg-ink-900 px-4 text-small font-semibold text-white disabled:opacity-50">{busy ? '…' : 'Check'}</button>
          </div>
          {error && <p className="mt-2 text-caption text-white" role="alert">{error}</p>}
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-3 w-full rounded-lg bg-white py-2.5 text-small font-semibold text-brand-700">See my stamps</button>
      )}
      <p className="mt-2 text-caption text-white/80">Order with your mobile number and your visit counts{loyalty.min_bill > 0 ? ` (bills of ${formatPrice(loyalty.min_bill)} or more)` : ''}.</p>
    </section>
  );
};

/* ── One dish ─────────────────────────────────────────────────────────── */

const Dish = ({ product, quantity, currency, onAdd, onMinus, onChoose }) => {
  const customisable = needsChoices(product);
  return (
    <li className="flex gap-4 border-b border-dashed border-line py-5 last:border-0">
      <div className="min-w-0 flex-1">
        <FoodMark type={product.food_type} size={16} />
        <p className="mt-1.5 text-body font-semibold leading-snug text-ink-900">{product.name}</p>
        <p className="tabular mt-0.5 text-small font-medium text-ink-900">{formatPrice(product.price, currency)}</p>
        {product.description && <p className="mt-1.5 line-clamp-2 text-small text-ink-500">{product.description}</p>}
      </div>
      <div className="relative w-28 shrink-0 pb-4">
        <div className="h-28 w-28 overflow-hidden rounded-(--radius-card) bg-brand-50">
          {product.image_url
            ? <img src={product.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
            : <span aria-hidden="true" className="flex h-full w-full items-center justify-center text-brand-500/60"><UtensilsCrossed className="h-9 w-9" /></span>}
        </div>
        <div className="absolute inset-x-2 bottom-0">
          {quantity === 0 || customisable ? (
            <button type="button" onClick={customisable ? onChoose : onAdd} aria-label={`Add ${product.name}`}
                    className="flex h-9 w-full items-center justify-center rounded-lg border border-brand-500 bg-white text-small font-semibold text-brand-700 shadow-sm active:bg-brand-50">
              {quantity > 0 ? `${quantity} added · +` : '+ Add'}
            </button>
          ) : (
            <div className="flex h-9 w-full items-center justify-between rounded-lg bg-brand-500 px-1 text-white shadow-sm">
              <button type="button" onClick={onMinus} aria-label={`One less ${product.name}`} className="flex h-7 w-7 items-center justify-center"><Minus className="h-4 w-4" /></button>
              <span className="tabular text-small font-semibold">{quantity}</span>
              <button type="button" onClick={onAdd} aria-label={`One more ${product.name}`} className="flex h-7 w-7 items-center justify-center"><Plus className="h-4 w-4" /></button>
            </div>
          )}
        </div>
        {customisable && <p className="mt-1 text-center text-[11px] text-ink-500">customisable</p>}
      </div>
    </li>
  );
};

/* ── The page ─────────────────────────────────────────────────────────── */

const CustomerMenu = () => {
  const { token } = useParams();
  const [menu, setMenu] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [cart, setCart] = useState([]); // lines: { key, product_id, name, price, modifier_ids, modifiers, quantity }
  const [picking, setPicking] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [card, setCard] = useState(null);
  const [query, setQuery] = useState('');
  const [vegOnly, setVegOnly] = useState(false);
  const [active, setActive] = useState(0);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [sheet, setSheet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const orderKey = useIdempotencyKey();
  const sections = useRef([]);

  useEffect(() => { publicApi(`/menu/${token}`).then(setMenu).catch((e) => setLoadError(e.message)); }, [token]);

  const addLine = (product, modifierIds = [], selected = []) => {
    const key = `${product.product_id}:${[...modifierIds].sort((a, b) => a - b).join(',')}`;
    setPicking(null);
    setCart((c) => (c.some((l) => l.key === key)
      ? c.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l))
      : [...c, { key, product_id: product.product_id, name: product.name, food_type: product.food_type, price: product.price, modifier_ids: modifierIds, modifiers: selected, quantity: 1 }]));
  };
  const changeQuantity = (key, delta) => setCart((c) => c.flatMap((l) => (l.key !== key ? [l] : l.quantity + delta <= 0 ? [] : [{ ...l, quantity: l.quantity + delta }])));

  const unitPrice = (l) => l.price + l.modifiers.reduce((s, m) => s + m.price_delta, 0);
  const rewardLine = card?.reward_ready ? cart.find((l) => l.product_id === card.reward_product_id && !l.modifiers.length) : null;
  const rewardOff = rewardLine ? Math.min(rewardLine.quantity, card.reward_quantity || 1) * rewardLine.price : 0;
  const total = cart.reduce((sum, l) => sum + unitPrice(l) * l.quantity, 0) - rewardOff;
  const rewardProduct = card?.reward_ready ? (menu?.categories || []).flatMap((c) => c.products).find((p) => p.product_id === card.reward_product_id) : null;
  const count = cart.reduce((n, l) => n + l.quantity, 0);

  const q = query.trim().toLowerCase();
  const categories = useMemo(() => (menu?.categories || []).map((c) => ({
    ...c, products: c.products.filter((p) => (!vegOnly || p.food_type === 'VEG') && (!q || p.name.toLowerCase().includes(q) || String(p.description || '').toLowerCase().includes(q)))
  })).filter((c) => c.products.length > 0), [menu, q, vegOnly]);

  const jump = (i) => { setActive(i); setCollapsed((s) => { const n = new Set(s); n.delete(categories[i].name); return n; }); sections.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  const placeOrder = async () => {
    setSubmitting(true); setSubmitError('');
    try {
      const result = await publicApi(`/menu/${token}/order`, {
        method: 'POST', idempotencyKey: orderKey.get(),
        body: { items: cart.map((l) => ({ product_id: l.product_id, quantity: l.quantity, modifier_ids: l.modifier_ids })), customer_name: name || undefined, customer_phone: phone || undefined }
      });
      // the UPI QR needs this round's amount, so it travels with the confirmation (the cart is cleared for "Order more")
      orderKey.settle();
      setConfirmation({ ...result, amount: total, items: count });
      setSheet(false);
    } catch (caught) { orderKey.settle(caught); setSubmitError(caught.message); }
    finally { setSubmitting(false); }
  };

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page px-5 text-center">
        <div>
          <Logo />
          <p className="mt-6 text-body font-semibold text-ink-900">This ordering link isn't available</p>
          <p className="mt-1 text-small text-ink-500">Please ask a staff member for help.</p>
        </div>
      </div>
    );
  }
  if (!menu) {
    return <div className="flex min-h-screen items-center justify-center bg-page"><div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-label="Loading the menu" /></div>;
  }
  const b = menu.business;

  const header = (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
        {b.logo_url
          ? <img src={b.logo_url} alt="" className="h-11 w-11 shrink-0 rounded-full border border-line object-cover" />
          : <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-500 text-small font-bold text-white">{initials(b.name)}</span>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-ink-900">{b.name}</p>
          {(b.outlet || b.address) && <p className="flex items-center gap-1 truncate text-caption text-ink-500"><MapPin aria-hidden="true" className="h-3 w-3 shrink-0" />{[b.outlet !== b.name && b.outlet, b.address].filter(Boolean).join(' · ')}</p>}
        </div>
        <span className="shrink-0 rounded-lg bg-surface-2 px-3 py-1.5 text-small font-semibold text-ink-900">Table {menu.table.name}</span>
      </div>
    </header>
  );

  if (confirmation) {
    return (
      <div className="min-h-screen bg-page">
        {header}
        <main className="mx-auto max-w-lg px-4 py-8">
          <div className="rounded-(--radius-panel) border border-line bg-surface p-6 text-center">
            <CheckCircle2 aria-hidden="true" className="mx-auto h-12 w-12 text-success" />
            <p className="mt-3 text-caption font-semibold uppercase tracking-[0.14em] text-success">Sent to the kitchen</p>
            <h1 className="mt-1 text-h3 font-semibold text-ink-900">Order {confirmation.order_number}</h1>
            <p className="mt-2 text-small text-ink-500">{confirmation.items} item{confirmation.items === 1 ? '' : 's'} · {formatPrice(confirmation.amount, b.currency)}. We'll bring it to table {confirmation.table_name || menu.table.name}.</p>
            {menu.loyalty && phone && <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-small text-brand-700">Your visit is added to your card when you pay the bill{menu.loyalty.min_bill > 0 ? ` (${formatPrice(menu.loyalty.min_bill)} or more)` : ''}.</p>}
          </div>
          {b.upi_vpa && <UpiPayment vpa={b.upi_vpa} businessName={b.name} amount={confirmation.amount} note={confirmation.order_number} />}
          <Button className="mt-6 w-full" size="lg" onClick={() => { setConfirmation(null); setCart([]); }}>Order something more</Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page pb-28">
      {header}
      <div className="sticky top-[69px] z-10 border-b border-line bg-surface">
        <div className="mx-auto max-w-lg px-4 pt-3">
          <div className="flex gap-2">
            <label className="relative flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <span className="sr-only">Search the menu</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search dishes"
                     className="h-11 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-9 text-small text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none" />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear the search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-400"><X className="h-4 w-4" /></button>}
            </label>
            <button type="button" onClick={() => setVegOnly((v) => !v)} aria-pressed={vegOnly}
                    className={`flex h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-small font-medium ${vegOnly ? 'border-success bg-success/10 text-success' : 'border-line-strong text-ink-700'}`}>
              <FoodMark type="VEG" size={14} />Veg only
            </button>
          </div>
          <nav aria-label="Categories" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-2">
            {categories.map((c, i) => {
              const image = c.products.find((p) => p.image_url)?.image_url;
              return (
                <button key={c.category_id ?? c.name} type="button" onClick={() => jump(i)} aria-current={active === i ? 'true' : undefined} className="flex w-[76px] shrink-0 flex-col items-center gap-1">
                  <span className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-(--radius-card) border-2 ${active === i ? 'border-brand-500' : 'border-line bg-brand-50'}`}>
                    {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <UtensilsCrossed aria-hidden="true" className="h-6 w-6 text-brand-500/70" />}
                  </span>
                  <span className={`line-clamp-2 text-center text-caption leading-tight ${active === i ? 'font-semibold text-brand-700' : 'text-ink-700'}`}>{c.name}</span>
                  <span aria-hidden="true" className={`h-0.5 w-8 rounded-full ${active === i ? 'bg-brand-500' : 'bg-transparent'}`} />
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-lg px-4 pt-4">
        {menu.loyalty && <LoyaltyCardPanel token={token} loyalty={menu.loyalty} phone={phone} setPhone={setPhone} card={card} setCard={setCard}
                                          rewardInCart={Boolean(rewardLine)} onAddReward={rewardProduct ? () => addLine(rewardProduct) : null} />}

        {categories.length === 0 && <p className="py-16 text-center text-small text-ink-500">{q || vegOnly ? 'Nothing matches. Try another word, or show everything.' : 'The menu is being set up.'}</p>}
        {categories.map((c, i) => {
          const closed = collapsed.has(c.name);
          return (
            <section key={c.category_id ?? c.name} ref={(el) => { sections.current[i] = el; }} aria-label={c.name} className="scroll-mt-[190px] pt-5">
              <button type="button" onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(c.name)) n.delete(c.name); else n.add(c.name); return n; })} aria-expanded={!closed}
                      className="flex w-full items-center justify-between border-b border-line pb-3">
                <h2 className="text-body font-semibold uppercase tracking-[0.04em] text-ink-900">{c.name} <span className="tabular font-normal text-ink-500">({c.products.length})</span></h2>
                <ChevronDown aria-hidden="true" className={`h-5 w-5 text-ink-500 transition-transform duration-(--duration-fast) ${closed ? '' : 'rotate-180'}`} />
              </button>
              {!closed && (
                <ul>
                  {c.products.map((p) => (
                    <Dish key={p.product_id} product={p} currency={b.currency} quantity={cart.filter((l) => l.product_id === p.product_id).reduce((n, l) => n + l.quantity, 0)}
                          onAdd={() => addLine(p)} onMinus={() => changeQuantity(`${p.product_id}:`, -1)} onChoose={() => setPicking(p)} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        <p className="py-8 text-center text-caption text-ink-400">Prices are before GST; any GST is added on the bill.</p>
      </main>

      {picking && <ModifierPicker product={picking} onClose={() => setPicking(null)} onConfirm={(ids, selected) => addLine(picking, ids, selected)} />}

      {count > 0 && !sheet && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-4 pt-2">
          <button type="button" onClick={() => setSheet(true)} className="mx-auto flex h-14 w-full max-w-lg items-center justify-between rounded-(--radius-card) bg-brand-500 px-5 text-white shadow-lg active:bg-brand-600">
            <span className="text-left"><span className="block text-caption font-medium text-white/80">{count} item{count === 1 ? '' : 's'}</span><span className="tabular block text-body font-semibold">{formatPrice(total, b.currency)}</span></span>
            <span className="text-body font-semibold">View order →</span>
          </button>
        </div>
      )}

      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-ink-900/40" onClick={() => setSheet(false)}>
          <div role="dialog" aria-label="Your order" className="mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-(--radius-panel) bg-surface p-5 pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-title font-semibold text-ink-900">Your order</h2>
              <button type="button" onClick={() => setSheet(false)} aria-label="Close" className="p-1 text-ink-500"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-small text-ink-500">Table {menu.table.name}</p>
            <ul className="mt-4 divide-y divide-line">
              {cart.map((l) => (
                <li key={l.key} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex min-w-0 items-start gap-2">
                    <span className="mt-1"><FoodMark type={l.food_type} size={12} /></span>
                    <span className="min-w-0"><span className="block text-small font-medium text-ink-900">{l.name}</span>{l.modifiers.length > 0 && <span className="block truncate text-caption text-ink-500">{l.modifiers.map((m) => m.name).join(', ')}</span>}<span className="tabular block text-caption text-ink-500">{formatPrice(unitPrice(l) * l.quantity, b.currency)}</span></span>
                  </span>
                  <span className="flex shrink-0 items-center rounded-lg border border-brand-500">
                    <button type="button" aria-label={`One less ${l.name}`} onClick={() => changeQuantity(l.key, -1)} className="flex h-8 w-8 items-center justify-center text-brand-700"><Minus className="h-4 w-4" /></button>
                    <span className="tabular w-6 text-center text-small font-semibold text-ink-900">{l.quantity}</span>
                    <button type="button" aria-label={`One more ${l.name}`} onClick={() => changeQuantity(l.key, 1)} className="flex h-8 w-8 items-center justify-center text-brand-700"><Plus className="h-4 w-4" /></button>
                  </span>
                </li>
              ))}
            </ul>
            {rewardOff > 0 && <div className="mt-2 flex justify-between text-small font-medium text-success"><span>Free {card.reward_item} (your visit card)</span><span className="tabular">−{formatPrice(rewardOff, b.currency)}</span></div>}
            <div className="mt-2 flex justify-between border-t border-line pt-3 text-body font-semibold text-ink-900"><span>Total</span><span className="tabular">{formatPrice(total, b.currency)}</span></div>
            <p className="text-caption text-ink-500">GST, if any, is added on the bill.</p>
            <div className="mt-4 space-y-2">
              <input placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name"
                     className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3.5 text-small text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none" />
              <input placeholder={menu.loyalty ? 'Mobile number (to count this visit)' : 'Mobile number (optional)'} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel"
                     className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3.5 text-small text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none" />
            </div>
            <Alert>{submitError}</Alert>
            <Button onClick={placeOrder} disabled={submitting} size="lg" className="mt-4 h-12 w-full">{submitting ? 'Placing your order…' : `Place order · ${formatPrice(total, b.currency)}`}</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerMenu;
