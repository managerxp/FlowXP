/*
 * The POS screen: search or scan → cart → customer → discount → payment →
 * invoice. Everything shown here — subtotal, tax split, total — is an
 * ESTIMATE for the cashier's benefit while building the cart. The number
 * that actually gets charged and recorded is whatever invoices.controller.js
 * computes server-side from modules/tax.js; this file never recomputes GST
 * rounding rules a second time; it approximates them for display only, and
 * the confirmation screen after submit shows the server's real figures.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatCurrency } from '../../lib/api.js';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import ModifierPicker, { needsChoices, useModifierGroups } from '../../components/ModifierPicker.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { Alert, Button, Card, Input, Select } from '../../components/ui.jsx';
import { LoyaltyCard, MobileLookup } from '../../components/LoyaltyCard.jsx';
import { getDevicePrefs, openPrint } from '../../lib/printing.js';

const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CREDIT', 'OTHER'];

const lineKey = (line) => line.key;
let keySeq = 0;

const BillingPage = () => {
  const { business } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [cart, setCart] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [card, setCard] = useState(null);            // the chosen customer's loyalty card
  const [couponCode, setCouponCode] = useState('');
  const [couponInfo, setCouponInfo] = useState(null); // { code, discount } once checked
  const [couponError, setCouponError] = useState('');
  const [invoiceDiscount, setInvoiceDiscount] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paidNow, setPaidNow] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const withGroups = useModifierGroups();
  const [picking, setPicking] = useState(null);

  useEffect(() => { api('/customers').then(setCustomers).catch(() => {}); }, []);

  // Whoever is chosen, show where their visit card stands.
  useEffect(() => {
    if (!customerId) { setCard(null); return; }
    api(`/loyalty/customers/${customerId}`).then((d) => setCard(d.loyalty)).catch(() => setCard(null));
  }, [customerId]);

  /* Debounced product search — a fetch per keystroke is fine for a shop's
     catalogue size, but there is no reason to fire one before typing pauses. */
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const handle = setTimeout(() => {
      api(`/products?kind=DISH&search=${encodeURIComponent(query)}`).then(setResults).catch(() => {});
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const addProduct = (product, modifierIds = [], selected = []) => {
    const sig = [...modifierIds].sort((a, b) => a - b).join(',');
    const delta = selected.reduce((s, m) => s + m.price_delta, 0);
    setCart((c) => {
      const existing = c.find((l) => l.product_id === product.product_id && l.sig === sig);
      if (existing) return c.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, {
        key: keySeq++, sig, modifier_ids: modifierIds, product_id: product.product_id,
        name: selected.length ? `${product.name} (${selected.map((m) => m.name).join(', ')})` : product.name, unit: product.unit,
        unit_price: product.selling_price + delta, quantity: 1, discount: 0, tax_rate: product.tax_rate,
        track_inventory: product.track_inventory, current_stock: product.current_stock
      }];
    });
    setQuery(''); setResults([]); setPicking(null);
  };

  const addCustomLine = () => {
    setCart((c) => [...c, {
      key: keySeq++, product_id: null, name: '', unit: '', unit_price: 0, quantity: 1,
      discount: 0, tax_rate: 0, track_inventory: false, custom: true
    }]);
  };

  const updateLine = (key, patch) => setCart((c) => c.map((l) => (lineKey(l) === key ? { ...l, ...patch } : l)));
  const removeLine = (key) => setCart((c) => c.filter((l) => lineKey(l) !== key));

  /* Display-only totals — see the file header. gst_enabled and an intra-state
     assumption (no per-customer state lookup here) are enough for a cashier
     to see "about how much", which is all a running total needs to be before
     the bill is actually cut. */
  const totals = useMemo(() => {
    const gstEnabled = Boolean(business?.gst_enabled);
    let subtotal = 0, tax = 0;
    for (const l of cart) {
      const gross = Number(l.quantity || 0) * Number(l.unit_price || 0) - Number(l.discount || 0);
      const lineTax = gstEnabled ? gross * (Number(l.tax_rate || 0) / 100) : 0;
      subtotal += gross; tax += lineTax;
    }
    const discount = Number(invoiceDiscount || 0);
    const before = Math.max(0, subtotal + tax - discount);
    const coupon = couponInfo ? Math.min(couponInfo.discount, before) : 0;   // a preview; billing works out the real figure
    return { subtotal, tax, discount, coupon, before, total: Math.max(0, before - coupon), gstEnabled };
  }, [cart, invoiceDiscount, couponInfo, business?.gst_enabled]);

  // A checked coupon was checked against a particular bill; changing the bill means checking again.
  useEffect(() => { setCouponInfo(null); setCouponError(''); }, [cart, invoiceDiscount, customerId]);

  const applyCoupon = async () => {
    setCouponError('');
    try {
      const result = await api('/coupons/check', { method: 'POST', body: { code: couponCode, customer_id: customerId || undefined, total: totals.before } });
      setCouponInfo(result);
    } catch (caught) { setCouponInfo(null); setCouponError(caught.message); }
  };

  const filteredCustomers = customerSearch
    ? customers.filter((c) => c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.phone?.includes(customerSearch))
    : customers;

  const resetSale = () => {
    setCart([]); setCustomerId(''); setCustomerSearch(''); setInvoiceDiscount('0'); setCouponCode(''); setCouponInfo(null); setCouponError(''); setCard(null);
    setPaidNow(''); setNotes(''); setConfirmation(null); setError('');
  };

  const idem = useIdempotencyKey();

  const charge = async () => {
    setError('');
    if (!cart.length) { setError('Add at least one item'); return; }
    for (const l of cart) {
      if (l.custom && (!l.name.trim() || !l.unit_price)) { setError('Every custom line needs a description and a price'); return; }
    }
    setBusy(true);
    try {
      const items = cart.map((l) => l.custom
        ? { description: l.name, quantity: l.quantity, unit_price: l.unit_price, tax_rate: l.tax_rate, discount: l.discount || undefined }
        : { product_id: l.product_id, quantity: l.quantity, discount: l.discount || undefined, modifier_ids: l.modifier_ids?.length ? l.modifier_ids : undefined });

      const invoice = await api('/invoices', {
        method: 'POST',
        idempotencyKey: idem.get(),
        body: {
          customer_id: customerId || undefined,
          items,
          discount: Number(invoiceDiscount) || undefined,
          coupon_code: couponCode.trim() || undefined,
          notes: notes || undefined,
          payment: paidNow ? { method: paymentMethod, amount: Number(paidNow) } : undefined
        }
      });
      idem.settle();
      setConfirmation(invoice);
      if (getDevicePrefs().autoPrintReceipt) openPrint('receipt', invoice.invoice_id);
    } catch (caught) {
      idem.settle(caught);
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  if (confirmation) {
    return (
      <div className="mx-auto max-w-md">
        <Card className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-success">Invoice created</p>
          <h1 className="mt-2 text-2xl font-bold text-ink-900">{confirmation.invoice_number}</h1>
          <p className="mt-1 text-3xl font-extrabold text-ink-900">{formatCurrency(confirmation.total)}</p>
          {confirmation.loyalty_reward && <p className="mt-2 rounded-lg bg-success/10 px-3 py-2 text-sm font-semibold text-success">Loyalty reward: {confirmation.loyalty_reward.item} free ({formatCurrency(confirmation.loyalty_reward.amount)} off)</p>}
          {confirmation.coupon_code && <p className="mt-2 text-sm text-ink-500">Coupon {confirmation.coupon_code}: {formatCurrency(confirmation.coupon_discount)} off</p>}
          <p className="mt-2 text-sm text-ink-500">
            {confirmation.payment_status === 'PAID' ? 'Paid in full.'
              : confirmation.payment_status === 'PARTIAL' ? `Balance due: ${formatCurrency(confirmation.balance_due)}`
              : 'Nothing collected yet.'}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button onClick={() => openPrint('receipt', confirmation.invoice_id)}>Print receipt</Button>
            <Button variant="secondary" onClick={() => navigate(`/app/billing/invoices/${confirmation.invoice_id}`)}>View invoice</Button>
            <Button variant="secondary" onClick={resetSale}>Start new sale</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div>
        <h1 className="mb-4 text-2xl font-bold tracking-tight text-ink-900">New sale</h1>

        <div className="relative mb-4">
          <Input
            placeholder="Search product by name, SKU or barcode…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
              {results.map((p) => (
                <button
                  key={p.product_id}
                  type="button"
                  onClick={() => { const full = withGroups(p); if (needsChoices(full)) { setResults([]); setPicking(full); } else addProduct(p); }}
                  className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm hover:bg-surface-2"
                >
                  <span>
                    <span className="font-medium text-ink-900">{p.name}</span>
                    {p.track_inventory && (
                      <span className={`ml-2 text-xs ${p.low_stock ? 'text-warning' : 'text-ink-400'}`}>{p.current_stock} {p.unit} left</span>
                    )}
                  </span>
                  <span className="font-semibold text-ink-900">{formatCurrency(p.selling_price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {picking && <ModifierPicker product={picking} onClose={() => setPicking(null)} onConfirm={(ids, selected) => addProduct(picking, ids, selected)} />}

        <div className="mb-4">
          <Button type="button" variant="secondary" size="sm" onClick={addCustomLine}>+ Custom line</Button>
        </div>

        {cart.length === 0 ? (
          <p className="rounded-[--radius-card] border border-dashed border-line-strong py-12 text-center text-sm text-ink-400">
            Cart is empty — search for a product above.
          </p>
        ) : (
          <div className="space-y-2">
            {cart.map((l) => (
              <div key={l.key} className="glass flex flex-wrap items-center gap-3 rounded-[--radius-card] p-3">
                {l.custom ? (
                  <Input placeholder="Description" value={l.name} onChange={(e) => updateLine(l.key, { name: e.target.value })} className="min-w-40 flex-1" />
                ) : (
                  <span className="min-w-32 flex-1 text-sm font-medium text-ink-900">{l.name}</span>
                )}

                {/* Input hardcodes w-full internally, and a same-property
                    utility clash (w-full vs w-20) is decided by Tailwind's
                    stylesheet order, not by className string order — so the
                    override cannot be relied on directly. Sizing the wrapper
                    instead sidesteps the clash entirely. */}
                <div className="w-20">
                  <Input type="number" min="0.001" step="0.001" value={l.quantity}
                         onChange={(e) => updateLine(l.key, { quantity: Number(e.target.value) })} className="text-right" />
                </div>

                {l.custom ? (
                  <div className="w-24">
                    <Input type="number" min="0" step="0.01" placeholder="Price ₹" value={l.unit_price || ''}
                           onChange={(e) => updateLine(l.key, { unit_price: Number(e.target.value) })} className="text-right" />
                  </div>
                ) : (
                  <span className="w-24 text-right text-sm text-ink-500">{formatCurrency(l.unit_price)}</span>
                )}

                <div className="w-24">
                  <Input type="number" min="0" step="0.01" placeholder="Discount ₹" value={l.discount || ''}
                         onChange={(e) => updateLine(l.key, { discount: Number(e.target.value) })} className="text-right" />
                </div>

                <span className="w-24 text-right text-sm font-semibold text-ink-900">
                  {formatCurrency(Number(l.quantity || 0) * Number(l.unit_price || 0) - Number(l.discount || 0))}
                </span>

                {l.track_inventory && l.quantity > l.current_stock && (
                  <span className="text-xs font-semibold text-danger">Only {l.current_stock} in stock</span>
                )}

                <button type="button" onClick={() => removeLine(l.key)} className="text-ink-400 hover:text-danger" aria-label="Remove">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <Card className="sticky top-6 space-y-4">
          <Alert>{error}</Alert>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">Customer</label>
            {!customerId && (
              <div className="mb-2">
                <MobileLookup onPick={(c, loyalty) => { setCustomerId(c.customer_id); setCustomerSearch(c.name); setCard(loyalty); setCustomers((list) => (list.some((x) => x.customer_id === c.customer_id) ? list : [...list, c])); }} />
              </div>
            )}
            <Input placeholder="Or search by name, or leave blank for walk-in" value={customerSearch}
                   onChange={(e) => { setCustomerSearch(e.target.value); setCustomerId(''); }} />
            {customerSearch && !customerId && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line bg-surface">
                {filteredCustomers.slice(0, 8).map((c) => (
                  <button key={c.customer_id} type="button"
                          onClick={() => { setCustomerId(c.customer_id); setCustomerSearch(c.name); }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2">
                    {c.name} {c.phone && <span className="text-ink-400">· {c.phone}</span>}
                  </button>
                ))}
                {filteredCustomers.length === 0 && <p className="px-3 py-2 text-sm text-ink-400">No match — sale will be walk-in.</p>}
              </div>
            )}
          </div>

          {customerId && card && <LoyaltyCard card={card} compact />}

          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">Coupon code</label>
            <div className="flex gap-2">
              <Input placeholder="e.g. WELCOME10" value={couponCode} onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponInfo(null); setCouponError(''); }} />
              <Button type="button" variant="secondary" onClick={applyCoupon} disabled={!couponCode.trim() || !cart.length}>Apply</Button>
            </div>
            {couponInfo && <p className="mt-1 text-xs font-medium text-success">{couponInfo.code}: {formatCurrency(couponInfo.discount)} off{couponInfo.description ? ` · ${couponInfo.description}` : ''}</p>}
            {couponError && <p className="mt-1 text-xs text-danger" role="alert">{couponError}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">Bill discount (₹)</label>
            <Input type="number" min="0" step="0.01" value={invoiceDiscount} onChange={(e) => setInvoiceDiscount(e.target.value)} />
          </div>

          <div className="space-y-1.5 border-t border-line pt-4 text-sm">
            <div className="flex justify-between text-ink-500"><span>Subtotal</span><span>{formatCurrency(totals.subtotal)}</span></div>
            {totals.gstEnabled && <div className="flex justify-between text-ink-500"><span>GST (est.)</span><span>{formatCurrency(totals.tax)}</span></div>}
            {totals.discount > 0 && <div className="flex justify-between text-ink-500"><span>Discount</span><span>−{formatCurrency(totals.discount)}</span></div>}
            {totals.coupon > 0 && <div className="flex justify-between text-success"><span>Coupon {couponInfo.code}</span><span>−{formatCurrency(totals.coupon)}</span></div>}
            {card?.reward_ready && <div className="flex justify-between text-success"><span>Free {card.reward_item}</span><span>applied if on the bill</span></div>}
            <div className="flex justify-between text-base font-bold text-ink-900"><span>Total</span><span>{formatCurrency(totals.total)}</span></div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Payment</label>
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Amount paid</label>
              <Input type="number" min="0" step="0.01" placeholder={totals.total.toFixed(2)} value={paidNow} onChange={(e) => setPaidNow(e.target.value)} />
            </div>
          </div>
          <button type="button" onClick={() => setPaidNow(totals.total ? totals.total.toFixed(2) : '')} className="text-xs font-semibold text-brand-600">
            Paid in full
          </button>

          <Button onClick={charge} disabled={busy || !cart.length} className="w-full" size="lg">
            {busy ? 'Charging…' : `Charge ${formatCurrency(totals.total)}`}
          </Button>
        </Card>
      </div>
    </div>
  );
};

export default BillingPage;
