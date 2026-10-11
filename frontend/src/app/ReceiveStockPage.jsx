/*
 * Receive stock: a delivery scanned in. Scan each item (or search by name), set the quantity, cost and, for products that
 * track expiry, the expiry date; then "Receive" records it as a purchase, which puts the stock on the shelf, updates the
 * cost, and files the expiry batches. Works on a phone at the back door as well as at a desk.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Minus, Plus, ScanLine, Search, Trash2, X } from 'lucide-react';
import BarcodeScanner from '../components/BarcodeScanner.jsx';
import QuickProductModal from '../components/QuickProductModal.jsx';
import SupplierBillImport from '../components/SupplierBillImport.jsx';
import { api, formatCurrency } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { localSearch } from '../lib/posCatalog.js';
import { usePosCatalog } from '../lib/usePosCatalog.js';
import { lookupCode, productDetail, qty as fmtQty } from '../lib/retailStock.js';
import { Alert, Button, Field, Input, Select, useToast } from '../components/ui.jsx';

const METHODS = [['CASH', 'Cash'], ['UPI', 'UPI'], ['BANK_TRANSFER', 'Bank'], ['CARD', 'Card'], ['OTHER', 'Other']];
const num = (v) => (v === '' || v == null ? 0 : Number(v));
const lineTotal = (l) => Math.round(num(l.qty) * num(l.cost) * (1 + num(l.tax_rate) / 100) * 100) / 100;

const ReceiveStockPage = () => {
  const { business, outletId, can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const idem = useIdempotencyKey();
  const catalog = usePosCatalog(`${business?.business_id}-${outletId}`);
  const [lines, setLines] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [cats, setCats] = useState([]);
  const [supplier, setSupplier] = useState('');
  const [bill, setBill] = useState('');
  const [billDate, setBillDate] = useState('');
  const [importing, setImporting] = useState(false);     // the supplier-bill reader is open
  const [allowDup, setAllowDup] = useState(false);       // the person confirmed this bill number is a different delivery
  const [dupBill, setDupBill] = useState(false);         // the server says this supplier's bill number is already recorded
  const [paid, setPaid] = useState('');
  const [showPay, setShowPay] = useState(false);
  const [method, setMethod] = useState('CASH');
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState(null);     // { barcode } while the quick-create form is open
  const [pending, setPending] = useState(null);       // a scanned code with no product, waiting for the product it belongs to
  const [justMade, setJustMade] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const search = useRef(null);
  const [hit, setHit] = useState(0);

  useEffect(() => { api('/suppliers').then(setSuppliers).catch(() => {}); api('/categories').then(setCats).catch(() => {}); }, []);

  const matches = useMemo(() => (query.trim().length >= 2 ? localSearch(query, 8) : []), [query, catalog.count]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setHit(0); }, [query]);

  /* Add one of a product (or one more). The cost, GST and "tracks expiry" arrive a moment later from the product itself. */
  const add = (product, by = 1) => {
    let known = false;
    setLines((ls) => {
      known = ls.some((l) => l.product_id === product.product_id);
      if (known) return ls.map((l) => (l.product_id === product.product_id ? { ...l, qty: num(l.qty) + by } : l));
      return [{ product_id: product.product_id, name: product.name, unit: product.unit || 'pc', sku: product.sku, qty: by, cost: '', tax_rate: '', track_expiry: false, expiry: '', batch: '', loaded: false }, ...ls];
    });
    if (!known) {
      productDetail(product.product_id).then((d) => setLines((ls) => ls.map((l) => (l.product_id === d.product_id
        ? { ...l, cost: l.cost === '' ? String(d.purchase_price ?? '') : l.cost, tax_rate: l.tax_rate === '' ? String(d.tax_rate ?? 0) : l.tax_rate, track_expiry: Boolean(d.track_expiry), unit: d.unit || l.unit, loaded: true } : l)))).catch(() => {});
    }
    return known;
  };
  /* The lines of a bill the person has checked in the reader: the quantity, cost, GST and expiry come from the bill,
     and what was matched is remembered on each line so it can be learned once the stock is received. */
  const useBill = (r) => {
    setImporting(false);
    if (r.supplier_id) setSupplier(String(r.supplier_id));
    if (r.invoice_no) setBill(r.invoice_no);
    setBillDate(r.invoice_date || '');
    setAllowDup(Boolean(r.allow_duplicate)); setDupBill(false);
    for (const l of r.lines) {
      add(l.product, l.qty);
      patch(l.product.product_id, { cost: l.cost === '' ? '' : String(l.cost), tax_rate: l.tax_rate === '' ? '' : String(l.tax_rate), ...(l.expiry ? { expiry: l.expiry } : {}), ...(l.batch ? { batch: l.batch } : {}), learn: l.learn });
    }
  };
  const patch = (id, change) => setLines((ls) => ls.map((l) => (l.product_id === id ? { ...l, ...change } : l)));
  const remove = (id) => setLines((ls) => ls.filter((l) => l.product_id !== id));
  const count = (id) => lines.find((l) => l.product_id === id)?.qty ?? 0;

  const onScan = async (raw) => {
    let product;
    try { product = await lookupCode(raw); } catch (e) { return { status: 'error', label: e.message }; }
    if (!product) return { status: 'unknown' };
    const before = count(product.product_id);
    add(product);
    return { status: 'ok', label: product.name, detail: `× ${before + 1}` };
  };

  const choose = async (product) => {
    if (pending) {
      try { await api(`/products/${product.product_id}/barcodes`, { method: 'POST', body: { barcode: pending } }); toast.success(`Barcode saved on ${product.name}`); }
      catch (e) { toast.error(e.message); return; }
      setPending(null);
    }
    add(product); setQuery(''); search.current?.focus();
  };
  const onSearchKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHit((h) => Math.min(matches.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHit((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Escape') setQuery('');
    else if (e.key === 'Enter' && query.trim()) {
      e.preventDefault();
      lookupCode(query).then((p) => { if (p) choose(p); else if (matches[hit]) choose(matches[hit]); }).catch(() => matches[hit] && choose(matches[hit]));
    }
  };

  const total = lines.reduce((t, l) => t + lineTotal(l), 0);
  const missingExpiry = lines.filter((l) => l.track_expiry && !l.expiry);
  const invalid = lines.some((l) => !(num(l.qty) > 0));
  const ready = lines.length > 0 && !invalid && !missingExpiry.length && lines.every((l) => l.loaded);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const po = await api('/purchases', {
        method: 'POST', idempotencyKey: idem.get(),
        body: {
          supplier_id: supplier ? Number(supplier) : undefined, notes: bill.trim() ? `Supplier bill ${bill.trim()}` : undefined,
          supplier_invoice_no: bill.trim() || undefined, supplier_invoice_date: billDate || undefined, ...(allowDup ? { allow_duplicate_bill: true } : {}),
          items: lines.map((l) => ({ product_id: l.product_id, quantity: num(l.qty), unit_cost: num(l.cost), tax_rate: num(l.tax_rate), ...(l.track_expiry ? { expiry_date: l.expiry, batch_no: l.batch.trim() || undefined } : {}) })),
          ...(num(paid) > 0 ? { payment: { amount: num(paid), method } } : {})
        }
      });
      idem.settle();
      // what the person matched on the bill is remembered, so the same wording or code is found next time (best effort)
      const pairs = lines.filter((l) => l.learn).map((l) => l.learn);
      if (pairs.length) api('/retail/invoice-import/learn', { method: 'POST', body: { supplier_id: supplier ? Number(supplier) : undefined, pairs } }).catch(() => {});
      toast.success(`${lines.length} item${lines.length === 1 ? '' : 's'} received${po.po_number ? ` (${po.po_number})` : ''}`);
      navigate('/app/stock');
    } catch (e) { idem.settle(e); setError(e.message); setDupBill(e.code === 'DUPLICATE_BILL'); setBusy(false); }
  };

  if (!can('inventory')) return <Alert>You do not have access to receive stock.</Alert>;

  return (
    <div>
      <Link to="/app/stock" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-900"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Stock center</Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Receive stock</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-500">Scan what arrived, or read the supplier’s bill. The stock goes on the shelf when you press Receive, and the cost you enter becomes the product’s cost.</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:max-w-3xl">
        <Field id="rc-supplier" label="Supplier"><Select id="rc-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">No supplier</option>{suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}</Select></Field>
        <Field id="rc-bill" label="Supplier’s bill number" hint="Optional. Kept with the purchase."><Input id="rc-bill" value={bill} onChange={(e) => setBill(e.target.value)} maxLength={60} /></Field>
      </div>

      <div className="mt-5 flex flex-wrap items-start gap-3">
        <Button size="lg" className="min-h-12" onClick={() => setScanning(true)}><ScanLine aria-hidden="true" className="h-5 w-5" />Scan items</Button>
        <Button size="lg" variant="secondary" className="min-h-12" onClick={() => setImporting(true)}><FileText aria-hidden="true" className="h-5 w-5" />Read a supplier bill</Button>
        <div className="relative min-w-60 flex-1">
          {pending && (
            <p className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 py-2 text-small text-brand-700">
              Pick the product that barcode <strong className="tabular font-semibold">{pending}</strong> belongs to.
              <button type="button" onClick={() => setPending(null)} aria-label="Forget this barcode" className="rounded p-1 hover:bg-brand-100"><X aria-hidden="true" className="h-4 w-4" /></button>
            </p>
          )}
          <Search aria-hidden="true" className={`pointer-events-none absolute left-3.5 ${pending ? 'top-[3.4rem]' : 'top-6'} h-4 w-4 -translate-y-1/2 text-ink-400`} />
          <Input ref={search} aria-label="Search products" className="min-h-12 pl-10" placeholder="Search by name, SKU or barcode" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} />
          {matches.length > 0 && (
            <ul role="listbox" aria-label="Matching products" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-(--radius-card) border border-line bg-surface p-1 shadow-lg">
              {matches.map((p, i) => (
                <li key={p.product_id} role="option" aria-selected={i === hit}>
                  <button type="button" onClick={() => choose(p)} className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-small ${i === hit ? 'bg-surface-2' : 'hover:bg-surface-2'}`}>
                    <span className="min-w-0 truncate font-medium text-ink-900">{p.name}</span><span className="shrink-0 text-caption text-ink-500">{p.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="mt-10 max-w-md text-small text-ink-500">Nothing scanned yet. Scan a barcode with the camera, or a barcode scanner or the keyboard in the search box.</p>
      ) : (
        <ul className="mt-6 space-y-3" aria-label="Items received">
          {lines.map((l) => (
            <li key={l.product_id} className="rounded-(--radius-card) border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-medium text-ink-900">{l.name}</p><p className="text-caption text-ink-500">{l.sku}</p></div>
                <button type="button" onClick={() => remove(l.product_id)} aria-label={`Remove ${l.name}`} className="-mr-1 -mt-1 flex h-11 w-11 items-center justify-center rounded-lg text-ink-400 hover:bg-surface-2 hover:text-danger"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[auto_8rem_6rem_1fr]">
                <div>
                  <span className="mb-1.5 block text-sm font-medium text-ink-700">Quantity</span>
                  <div className="flex items-center">
                    <button type="button" aria-label="One less" onClick={() => patch(l.product_id, { qty: Math.max(0, num(l.qty) - 1) })} className="flex h-11 w-11 items-center justify-center rounded-l-lg border border-line-strong hover:bg-surface-2"><Minus aria-hidden="true" className="h-4 w-4" /></button>
                    <input aria-label={`Quantity of ${l.name}`} inputMode="decimal" value={l.qty} onChange={(e) => patch(l.product_id, { qty: e.target.value })} className="tabular h-11 w-20 border-y border-line-strong bg-surface text-center text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/40" />
                    <button type="button" aria-label="One more" onClick={() => patch(l.product_id, { qty: num(l.qty) + 1 })} className="flex h-11 w-11 items-center justify-center rounded-r-lg border border-line-strong hover:bg-surface-2"><Plus aria-hidden="true" className="h-4 w-4" /></button>
                  </div>
                </div>
                <Field id={`cost-${l.product_id}`} label="Cost each (₹)" hint={l.loaded && !(num(l.cost) > 0) ? 'Enter what you paid' : undefined}><Input id={`cost-${l.product_id}`} inputMode="decimal" value={l.cost} onChange={(e) => patch(l.product_id, { cost: e.target.value })} /></Field>
                <Field id={`gst-${l.product_id}`} label="GST %"><Input id={`gst-${l.product_id}`} inputMode="decimal" value={l.tax_rate} onChange={(e) => patch(l.product_id, { tax_rate: e.target.value })} /></Field>
                <p className="tabular self-end pb-2.5 text-right text-body font-semibold text-ink-900">{formatCurrency(lineTotal(l))}</p>
              </div>
              {l.track_expiry && (
                <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                  <Field id={`exp-${l.product_id}`} label="Expiry date" error={l.expiry ? '' : 'Required: this product tracks expiry'}><Input id={`exp-${l.product_id}`} type="date" value={l.expiry} onChange={(e) => patch(l.product_id, { expiry: e.target.value })} aria-invalid={!l.expiry} /></Field>
                  <Field id={`batch-${l.product_id}`} label="Batch number" hint="Optional. Without one, the same expiry date is one batch."><Input id={`batch-${l.product_id}`} value={l.batch} onChange={(e) => patch(l.product_id, { batch: e.target.value })} maxLength={40} /></Field>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <div className="sticky bottom-0 z-30 mt-6 border-t border-line bg-surface/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
          <div className="mx-auto flex max-w-5xl items-center gap-x-4">
            <div className="min-w-0 flex-1">
              <p className="text-small text-ink-500">{lines.length} item{lines.length === 1 ? '' : 's'} · {fmtQty(lines.reduce((n, l) => n + num(l.qty), 0))} {lines.reduce((n, l) => n + num(l.qty), 0) === 1 ? 'unit' : 'units'}</p>
              <p className="tabular text-title font-semibold text-ink-900">{formatCurrency(total)} <span className="text-small font-normal text-ink-500">with GST</span></p>
            </div>
            <Button size="lg" className="min-h-12 shrink-0" onClick={submit} loading={busy} disabled={!ready}>Receive {lines.length} item{lines.length === 1 ? '' : 's'}</Button>
          </div>
          {can('purchases') && (showPay || num(paid) > 0 ? (
            <div className="mx-auto mt-2 flex max-w-5xl items-end gap-2">
              <div className="w-32"><Field id="rc-paid" label="Paid now (₹)"><Input id="rc-paid" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" autoFocus /></Field></div>
              <div className="w-32"><Field id="rc-method" label="Paid by"><Select id="rc-method" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field></div>
            </div>
          ) : (
            <button type="button" onClick={() => setShowPay(true)} className="mt-1 flex min-h-11 items-center text-small font-medium text-brand-600 hover:underline">Record a payment to the supplier</button>
          ))}
          {(error || missingExpiry.length > 0) && (
            <div className="mx-auto mt-2 max-w-5xl">
              <Alert>{error}</Alert>
              {dupBill && <button type="button" onClick={() => { setAllowDup(true); setDupBill(false); setError(''); }} className="mt-1 text-small font-medium text-brand-600 hover:underline">It is a different delivery: allow it, then press Receive again</button>}
              {!error && <p className="text-caption text-warning">Add the expiry date for {missingExpiry.map((l) => l.name).join(', ')}.</p>}
            </div>
          )}
        </div>
      )}

      {scanning && (
        <BarcodeScanner
          onScan={onScan} skipCode={justMade} canCreate={can('product_quick_add')}
          onClose={() => { setScanning(false); setJustMade(null); }}
          onSearch={(code) => { setScanning(false); setPending(code || null); setTimeout(() => search.current?.focus(), 0); }}
          onCreate={(code) => { setScanning(false); setCreating({ barcode: code }); }}
        />
      )}
      {importing && <SupplierBillImport suppliers={suppliers} categories={cats} search={localSearch} onClose={() => setImporting(false)} onUse={useBill} />}
      {creating && (
        <QuickProductModal
          barcode={creating.barcode} categories={cats}
          onCancel={() => { setCreating(null); setScanning(true); }}
          onCreated={(product) => { add(product); setJustMade(creating.barcode); setCreating(null); setScanning(true); }}
          onUseExisting={(existing) => { setCreating(null); add(existing); setScanning(true); }}
        />
      )}
      {lines.length > 0 && <div className="sr-only" aria-live="polite">{lines.length} items on this delivery</div>}
    </div>
  );
};

export default ReceiveStockPage;
