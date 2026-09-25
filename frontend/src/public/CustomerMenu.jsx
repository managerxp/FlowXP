/*
 * The page a customer's own phone opens after scanning a table's QR code —
 * the first bare, unauthenticated page in this app (see App.jsx: every other
 * route sits inside either the marketing SiteLayout or the authenticated
 * AppShell). No nav, no login, no AuthContext: this page never carries a
 * session, only the table's qr_token in the URL, matching
 * publicOrdering.controller.js on the backend.
 *
 * Deliberately does not import lib/api.js's api() helper — that helper
 * attaches an Authorization header and an X-Business-Id header, both
 * meaningless here since there is no business-scoped session to speak of.
 * A plain fetch is the whole client this page needs.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { Button, Alert, Logo } from '../components/ui.jsx';
import { useIdempotencyKey } from '../lib/idempotency.js';
import ModifierPicker, { needsChoices } from '../components/ModifierPicker.jsx';

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
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 0 }).format(amount || 0);

/*
 * "Pay via UPI" — not a payment gateway integration. `upi://pay` is a
 * standard deep link every UPI app (GPay, PhonePe, Paytm...) already
 * registers itself to handle; this just builds one addressed to the
 * business's own VPA (businesses.upi_vpa) with the order's amount prefilled,
 * the same information a UPI QR sticker on the counter carries. FlowXP never
 * learns whether the payment actually happened — there is no webhook for
 * that here, unlike a real gateway.
 */
const UpiPayment = ({ vpa, businessName, amount, note }) => {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const upiUri = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(businessName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

  useEffect(() => { QRCode.toDataURL(upiUri, { width: 220, margin: 1 }).then(setQrDataUrl); }, [upiUri]);

  return (
    <div className="mt-6 border-t border-line pt-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Pay via UPI</p>
      <p className="mt-1 text-sm text-ink-500">Scan with any UPI app, or tap below on your phone.</p>
      {qrDataUrl && <img src={qrDataUrl} alt="UPI payment QR code" className="mx-auto mt-4 h-44 w-44" />}
      <a href={upiUri} className="mt-4 block">
        <Button as="span" variant="secondary" className="w-full">Pay {amount.toFixed(2)} now</Button>
      </a>
      <p className="mt-2 text-xs text-ink-400">Paying is optional — you can also settle up with staff directly.</p>
    </div>
  );
};

/* Type a mobile number to see your visit card. Nothing is created and no name is shown. */
const LoyaltyLookup = ({ token, loyalty, phone, setPhone }) => {
  const [card, setCard] = useState(null);
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
    <div className="mb-6 rounded-[--radius-card] border border-brand-500/30 bg-brand-50 p-4">
      <p className="text-sm font-semibold text-ink-900">Visit {loyalty.visits_required} is on us</p>
      <p className="mt-0.5 text-xs text-ink-500">Get a free {loyalty.reward_item} on visit number {loyalty.visits_required}. Just use your mobile number when you order.{loyalty.min_bill > 0 && ` Bills of ${formatPrice(loyalty.min_bill)} or more count.`}</p>
      <div className="mt-3 flex gap-2">
        <input inputMode="tel" placeholder="Your mobile number" value={phone} onChange={(e) => { setPhone(e.target.value); setCard(null); }}
               className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none" />
        <Button type="button" variant="secondary" onClick={look} disabled={busy || phone.replace(/\D/g, '').length < 10}>Check</Button>
      </div>
      {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}
      {card && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: slots }, (_, i) => (
              <span key={i} className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i < card.stamps ? 'bg-brand-500 text-white' : 'border border-line-strong text-ink-400'}`}>{i < card.stamps ? '✓' : i + 1}</span>
            ))}
            <span className={`flex h-6 items-center rounded-full px-2 text-xs font-bold ${card.reward_ready ? 'bg-success text-white' : 'border border-dashed border-line-strong text-ink-400'}`}>FREE</span>
          </div>
          <p className={`mt-2 text-sm ${card.reward_ready ? 'font-semibold text-success' : 'text-ink-700'}`}>{card.message}</p>
        </div>
      )}
    </div>
  );
};

const CustomerMenu = () => {
  const { token } = useParams();
  const [menu, setMenu] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [cart, setCart] = useState([]); // lines: { key, product_id, name, price, modifier_ids, modifiers, quantity }
  const [picking, setPicking] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const orderKey = useIdempotencyKey();

  useEffect(() => {
    publicApi(`/menu/${token}`).then(setMenu).catch((e) => setLoadError(e.message));
  }, [token]);

  const addLine = (product, modifierIds = [], selected = []) => {
    const key = `${product.product_id}:${[...modifierIds].sort((a, b) => a - b).join(',')}`;
    setPicking(null);
    setCart((c) => (c.some((l) => l.key === key)
      ? c.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l))
      : [...c, { key, product_id: product.product_id, name: product.name, price: product.price, modifier_ids: modifierIds, modifiers: selected, quantity: 1 }]));
  };
  const changeQuantity = (key, delta) => setCart((c) => c.flatMap((l) => (l.key !== key ? [l] : l.quantity + delta <= 0 ? [] : [{ ...l, quantity: l.quantity + delta }])));

  const cartLines = cart;
  const unitPrice = (l) => l.price + l.modifiers.reduce((s, m) => s + m.price_delta, 0);
  const total = cartLines.reduce((sum, l) => sum + unitPrice(l) * l.quantity, 0);

  const placeOrder = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const result = await publicApi(`/menu/${token}/order`, {
        method: 'POST',
        idempotencyKey: orderKey.get(),
        body: {
          items: cartLines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, modifier_ids: l.modifier_ids })),
          customer_name: name || undefined,
          customer_phone: phone || undefined
        }
      });
      // The cart is about to be cleared for "Order more" — the UPI QR needs
      // this round's amount, so it travels with the confirmation rather than
      // being recomputed from a cart that won't exist by the time it renders.
      orderKey.settle();
      setConfirmation({ ...result, amount: total });
    } catch (caught) {
      orderKey.settle(caught);
      setSubmitError(caught.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-2 px-5 text-center">
        <div>
          <Logo />
          <p className="mt-6 text-base font-semibold text-ink-900">This ordering link isn't available</p>
          <p className="mt-1 text-sm text-ink-500">Ask a staff member for help.</p>
        </div>
      </div>
    );
  }

  if (confirmation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-2 px-5 py-10 text-center">
        <div className="glass w-full max-w-sm rounded-[--radius-card] p-7">
          <p className="text-xs font-semibold uppercase tracking-wider text-success">Sent to the kitchen</p>
          <h1 className="mt-2 text-xl font-bold text-ink-900">Order {confirmation.order_number}</h1>
          <p className="mt-2 text-sm text-ink-500">A staff member will bring it out to {confirmation.table_name}.</p>

          {menu.business.upi_vpa && (
            <UpiPayment
              vpa={menu.business.upi_vpa}
              businessName={menu.business.name}
              amount={confirmation.amount}
              note={confirmation.order_number}
            />
          )}

          <Button className="mt-6 w-full" variant={menu.business.upi_vpa ? 'ghost' : 'primary'} onClick={() => { setConfirmation(null); setCart([]); }}>
            Order more
          </Button>
        </div>
      </div>
    );
  }

  if (!menu) {
    return <div className="flex min-h-screen items-center justify-center bg-surface-2"><p className="text-sm text-ink-400">Loading menu…</p></div>;
  }

  return (
    <div className="min-h-screen bg-surface-2 pb-28">
      <header className="border-b border-line bg-surface px-5 py-4 text-center">
        <p className="text-lg font-bold text-ink-900">{menu.business.name}</p>
        <p className="text-sm text-ink-500">{menu.table.name}</p>
      </header>

      <main className="mx-auto max-w-lg px-5 py-6">
        {menu.loyalty && <LoyaltyLookup token={token} loyalty={menu.loyalty} phone={phone} setPhone={setPhone} />}
        {menu.categories.map((category) => (
          <section key={category.category_id ?? 'uncategorised'} className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">{category.name}</h2>
            <div className="space-y-2">
              {category.products.map((product) => {
                const quantity = cart.filter((l) => l.product_id === product.product_id).reduce((n, l) => n + l.quantity, 0);
                const customisable = needsChoices(product);
                const plainKey = `${product.product_id}:`;
                return (
                  <div key={product.product_id} className="glass flex items-center justify-between gap-3 rounded-[--radius-card] p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      {product.image_url && (
                        <img src={product.image_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">{product.name}</p>
                        {product.description && (
                          <p className="mt-0.5 truncate text-xs text-ink-500">{product.description}</p>
                        )}
                        <p className="mt-0.5 text-sm text-ink-500">{formatPrice(product.price, menu.business.currency)}</p>
                      </div>
                    </div>
                    {customisable ? (
                      <div className="flex items-center gap-2">
                        {quantity > 0 && <span className="text-sm font-semibold text-ink-900">×{quantity}</span>}
                        <Button size="sm" onClick={() => setPicking(product)}>{quantity > 0 ? 'Add another' : 'Choose'}</Button>
                      </div>
                    ) : quantity === 0 ? (
                      <Button size="sm" onClick={() => addLine(product)}>Add</Button>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => changeQuantity(plainKey, -1)}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-line-strong text-ink-700">−</button>
                        <span className="w-4 text-center font-semibold text-ink-900">{quantity}</span>
                        <button type="button" onClick={() => changeQuantity(plainKey, 1)}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-line-strong text-ink-700">+</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {cartLines.length > 0 && (
          <div className="glass mt-6 space-y-3 rounded-[--radius-card] p-4">
            <ul className="space-y-2 border-b border-line pb-3 text-sm">
              {cartLines.map((l) => (
                <li key={l.key} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-ink-900">{l.name}{l.modifiers.length > 0 && <span className="block truncate text-xs text-ink-500">{l.modifiers.map((m) => m.name).join(', ')}</span>}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <button type="button" aria-label="Fewer" onClick={() => changeQuantity(l.key, -1)} className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-ink-700">−</button>
                    <span className="w-4 text-center font-semibold">{l.quantity}</span>
                    <button type="button" aria-label="More" onClick={() => changeQuantity(l.key, 1)} className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-ink-700">+</button>
                  </span>
                </li>
              ))}
            </ul>
            <input
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
            />
            <input
              placeholder={menu.loyalty ? 'Mobile number (to earn visits)' : 'Phone (optional)'}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
            />
            <Alert>{submitError}</Alert>
          </div>
        )}
      </main>

      {picking && <ModifierPicker product={{ ...picking, price: picking.price }} onClose={() => setPicking(null)} onConfirm={(ids, selected) => addLine(picking, ids, selected)} />}

      {cartLines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface px-5 py-4">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-4">
            <span className="text-base font-bold text-ink-900">{formatPrice(total, menu.business.currency)}</span>
            <Button onClick={placeOrder} disabled={submitting} size="lg">
              {submitting ? 'Placing order…' : `Place order (${cartLines.reduce((n, l) => n + l.quantity, 0)})`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerMenu;
