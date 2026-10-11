/*
 * The pharmacy till: quote-then-commit, same shape as the salon's (see modules/pharmacy/pos.js's header note on
 * why pharmacy needs its own sale path — it has to know which batch each unit came from). The quote call runs
 * the real pricing and FEFO allocation inside a transaction the server rolls back, so what is shown before
 * "Charge" is exactly what charging will do.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { withApproval } from '../../lib/approval.js';
import { PAYMENT_METHODS, money, useDebounced } from '../../lib/pharmacy.js';
import { Alert, Button, PageHeader, Select, useToast, useDialog } from '../../components/ui.jsx';
import { BatchSelect, CustomerPicker, NumberField, ProductPicker } from './parts.jsx';

let seq = 0;
const num = (v) => (v === '' || v == null ? 0 : Number(v));

const CartLine = ({ l, onChange, onRemove }) => (
  <div className="rounded-(--radius-card) border border-line p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate font-medium text-ink-900">{l.name}</p>
        <p className="text-caption text-ink-500">{money(l.selling_price)} / {l.unit}</p>
      </div>
      <button type="button" aria-label={`Remove ${l.name}`} onClick={onRemove} className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><X className="h-4 w-4" /></button>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Decrease quantity" onClick={() => onChange({ quantity: String(Math.max(0, num(l.quantity) - 1)) })} className="flex h-7 w-7 items-center justify-center rounded-lg border border-line hover:bg-surface-2"><Minus className="h-3.5 w-3.5" /></button>
        <input aria-label="Quantity" value={l.quantity} onChange={(e) => onChange({ quantity: e.target.value })} inputMode="decimal" className="h-7 w-14 rounded-lg border border-line text-center text-small tabular" />
        <button type="button" aria-label="Increase quantity" onClick={() => onChange({ quantity: String(num(l.quantity) + 1) })} className="flex h-7 w-7 items-center justify-center rounded-lg border border-line hover:bg-surface-2"><Plus className="h-3.5 w-3.5" /></button>
      </div>
      <input aria-label="Discount" placeholder="Discount ₹" value={l.discount} onChange={(e) => onChange({ discount: e.target.value })} inputMode="decimal" className="h-7 w-24 rounded-lg border border-line px-2 text-small" />
      {l.line_total != null && <span className="ml-auto tabular text-small font-semibold text-ink-900">{money(l.line_total)}</span>}
    </div>
    {l.batch_tracking && <div className="mt-2"><BatchSelect productId={l.product_id} value={l.batch_id} onChange={(v) => onChange({ batch_id: v })} id={`batch-${l.key}`} /></div>}
  </div>
);

const PharmacyPos = () => {
  const toast = useToast();
  const idem = useIdempotencyKey();
  const dialog = useDialog();
  const searchRef = useRef(null);
  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [invDiscount, setInvDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState([{ method: 'CASH', amount: '' }]);
  const [payLater, setPayLater] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);

  const add = useCallback((p) => {
    setCart((c) => {
      const same = c.find((l) => l.product_id === p.product_id && !l.batch_tracking);
      if (same) return c.map((l) => (l === same ? { ...l, quantity: String(num(l.quantity) + 1) } : l));
      return [...c, { key: `l${++seq}`, product_id: p.product_id, name: p.name, unit: p.unit, selling_price: p.selling_price, batch_tracking: p.batch_tracking || p.expiry_tracking, quantity: '1', discount: '', batch_id: null }];
    });
  }, []);
  const update = (key, patch) => setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key) => setCart((c) => c.filter((l) => l.key !== key));

  const buildBody = useCallback(() => ({
    customerId: customer?.customer_id ?? undefined,
    items: cart.filter((l) => num(l.quantity) > 0).map((l) => ({ product_id: l.product_id, quantity: num(l.quantity), batch_id: l.batch_id || undefined, discount: l.discount ? num(l.discount) : undefined })),
    discount: invDiscount ? num(invDiscount) : undefined,
    notes: notes.trim() || undefined
  }), [customer, cart, invDiscount, notes]);

  const signature = JSON.stringify(buildBody());
  const debounced = useDebounced(signature, 350);
  useEffect(() => {
    const body = JSON.parse(debounced);
    if (!body.items.length) { setQuote(null); setQuoteError(''); return undefined; }
    let live = true;
    setQuoting(true);
    api('/pharmacy/pos/quote', { method: 'POST', body })
      .then((q) => { if (live) { setQuote(q); setQuoteError(''); } })
      .catch((e) => { if (live) setQuoteError(e.message); })
      .finally(() => { if (live) setQuoting(false); });
    return () => { live = false; };
  }, [debounced]);

  const fresh = quote && debounced === signature && !quoteError;
  const total = quote?.invoice?.total ?? cart.reduce((s, l) => s + Math.max(0, num(l.selling_price) * num(l.quantity) - num(l.discount)), 0);
  const lineOf = (productId) => quote?.lines?.find((x) => x.product_id === productId);

  const reset = () => {
    setCart([]); setCustomer(null); setInvDiscount(''); setNotes(''); setRows([{ method: 'CASH', amount: '' }]); setPayLater(false); setQuote(null); setQuoteError(''); setDone(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const payments = () => {
    if (payLater) return undefined;
    const blanks = rows.filter((r) => r.amount === '');
    if (blanks.length > 1) throw new Error('Only one payment can be left blank to take "the rest"');
    return rows.filter((r) => r.amount !== '' || blanks.length === 1).map((r) => ({ method: r.method, amount: r.amount === '' ? 'REST' : num(r.amount) }));
  };

  const charge = async () => {
    if (saving || !cart.length) return;
    let body;
    try { body = { ...buildBody(), payments: payments() }; } catch (e) { toast.error(e.message); return; }
    setSaving(true);
    try {
      const result = await withApproval(dialog, (approval) => api('/pharmacy/pos/invoices', { method: 'POST', body: approval ? { ...body, approval } : body, idempotencyKey: idem.get() }), idem.settle);
      idem.settle(null);
      setDone(result);
    } catch (e) { idem.settle(e); toast.error(e.message); } finally { setSaving(false); }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-h3 font-semibold text-ink-900">{done.invoice.invoice_number}</p>
        <p className="mt-2 text-lead text-ink-500">{money(done.invoice.total)} charged.</p>
        <Button className="mt-6" onClick={reset}>New sale</Button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Billing" lead="Sell from the shelf, batch-aware and FEFO by default." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <ProductPicker onPick={add} inputRef={searchRef} autoFocus placeholder="Search or scan a product" />
          {cart.length === 0 ? (
            <p className="py-16 text-center text-small text-ink-400">Nothing on the bill yet. Search a product to add it.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {cart.map((l) => <CartLine key={l.key} l={{ ...l, line_total: lineOf(l.product_id)?.line_total }} onChange={(p) => update(l.key, p)} onRemove={() => remove(l.key)} />)}
            </div>
          )}
        </div>
        <div className="space-y-4 rounded-(--radius-card) border border-line bg-surface p-4">
          <CustomerPicker value={customer} onChange={setCustomer} />
          <Alert>{quoteError}</Alert>
          <div className="space-y-1.5 border-t border-line pt-3 text-small">
            <div className="flex justify-between text-ink-500"><span>Subtotal</span><span className="tabular">{money(quote?.invoice?.subtotal)}</span></div>
            {num(quote?.invoice?.discount) > 0 && <div className="flex justify-between text-ink-500"><span>Discount</span><span className="tabular">−{money(quote.invoice.discount)}</span></div>}
            <div className="flex justify-between text-ink-500"><span>GST</span><span className="tabular">{money(quote?.invoice?.tax)}</span></div>
            <div className="flex justify-between text-title font-semibold text-ink-900"><span>Total</span><span className="tabular">{fresh ? money(total) : quoting ? '…' : money(total)}</span></div>
          </div>
          <NumberField id="pos-disc" label="Bill discount" prefix="₹" value={invDiscount} onChange={setInvDiscount} />
          <div className="space-y-2 border-t border-line pt-3">
            <label className="flex items-center gap-2 text-small"><input type="checkbox" checked={payLater} onChange={(e) => setPayLater(e.target.checked)} className="h-4 w-4 accent-(--color-brand-500)" disabled={!customer} />Pay later{!customer && ' (choose a customer first)'}</label>
            {!payLater && rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <Select aria-label="Payment method" value={r.method} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))} className="w-auto">{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                <input aria-label="Amount" placeholder="the rest" value={r.amount} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} inputMode="decimal" className="h-9 w-28 rounded-(--radius-control) border border-line px-2 text-small" />
                {rows.length > 1 && <button type="button" aria-label="Remove payment" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2"><X className="h-4 w-4" /></button>}
              </div>
            ))}
            {!payLater && rows.length < 3 && <button type="button" onClick={() => setRows((rs) => [...rs, { method: 'CASH', amount: '' }])} className="text-small font-medium text-brand-600 hover:text-brand-700">+ Split payment</button>}
          </div>
          <Button className="w-full" size="lg" onClick={charge} loading={saving} disabled={!cart.length || !fresh}>Charge {money(total)}</Button>
        </div>
      </div>
    </div>
  );
};

export default PharmacyPos;
