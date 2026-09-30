/*
 * Purchases: what is on its way from suppliers, what is still to be paid, and
 * everything bought. The list on the left, the chosen order on the right
 * (?po=ID) with its lines, money, payments and the next step for its status.
 *
 * Editing, sending and receiving an order stay in PurchaseOrderModal (one
 * place for those rules); returns in DebitNoteModal. "Record a purchase" is
 * the shortcut for goods that are already here (POST /purchases receives on
 * the spot).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, PackageCheck, Plus, Search, Sparkles, Trash2, Truck, Wallet } from 'lucide-react';
import PurchaseOrderModal from '../components/PurchaseOrderModal.jsx';
import DebitNoteModal from '../components/DebitNoteModal.jsx';
import { api, formatCurrency } from '../lib/api.js';
import { localISO } from '../lib/dates.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '../components/ui.jsx';

const METHODS = [['CASH', 'Cash'], ['UPI', 'UPI'], ['BANK_TRANSFER', 'Bank'], ['CARD', 'Card'], ['OTHER', 'Other']];
const METHOD_LABEL = { ...Object.fromEntries(METHODS), CREDIT: 'Credit' };
const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const day = (d) => (d ? new Date(String(d).length === 10 ? `${d}T00:00` : d).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null);
const daysLate = (po) => (['ORDERED', 'PARTIAL'].includes(po.status) && po.expected_date && po.expected_date < localISO()
  ? Math.round((new Date(`${localISO()}T00:00`) - new Date(`${po.expected_date}T00:00`)) / 86400000) : 0);
const owes = (po) => ['RECEIVED', 'PARTIAL'].includes(po.status) && po.balance_due > 0;

/* One label that says where an order is, and a tone for it. */
const statusOf = (po) => {
  if (po.status === 'DRAFT') return ['Draft', 'neutral'];
  if (po.status === 'CANCELLED') return ['Cancelled', 'neutral'];
  if (po.status === 'ORDERED') return daysLate(po) ? [`${daysLate(po)} day${daysLate(po) === 1 ? '' : 's'} late`, 'danger'] : ['Ordered', 'brand'];
  if (po.status === 'PARTIAL') return ['Part received', 'warning'];
  return po.payment_status === 'PAID' ? ['Paid', 'success'] : po.payment_status === 'PARTIAL' ? ['Part paid', 'warning'] : ['Unpaid', 'warning'];
};
const TONES = { neutral: 'bg-surface-2 text-ink-700', brand: 'bg-brand-50 text-brand-700', warning: 'bg-warning/10 text-warning', danger: 'bg-danger/10 text-danger', success: 'bg-success/10 text-success' };
const Chip = ({ tone = 'neutral', children }) => <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-caption font-semibold ${TONES[tone]}`}>{children}</span>;

const whenLine = (po) => {
  if (po.status === 'DRAFT') return 'Not sent yet';
  if (po.status === 'CANCELLED') return `Cancelled · ${day(po.po_date)}`;
  if (po.status === 'ORDERED') return po.expected_date ? `Expected ${day(po.expected_date)}` : `Ordered ${day(po.ordered_at)}`;
  if (po.status === 'PARTIAL') return `Part came ${day(po.received_at || po.po_date)}`;
  return `Received ${day(po.received_at || po.po_date)}`;
};

/* ── Pay a supplier ───────────────────────────────────────────────────── */

const PayModal = ({ po, onClose, onPaid }) => {
  const idem = useIdempotencyKey();
  const toast = useToast();
  const [amount, setAmount] = useState(String(po.balance_due));
  const [method, setMethod] = useState('UPI');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api(`/purchases/${po.po_id}/payments`, { method: 'POST', idempotencyKey: idem.get(), body: { amount: Number(amount), method, reference_number: ref || undefined } });
      idem.settle();
      toast.success(`Paid ${formatCurrency(Number(amount))} to ${po.supplier_name || 'the supplier'}`);
      onPaid();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  const left = Math.max(0, Math.round((po.balance_due - Number(amount || 0)) * 100) / 100);
  return (
    <Modal title={`Pay ${po.supplier_name || 'supplier'}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="tabular -mt-2 text-small text-ink-500">{po.po_number} · {formatCurrency(po.balance_due)} still owed</p>
        <Alert>{error}</Alert>
        <Field id="pay-amount" label="Amount (₹)">
          <Input id="pay-amount" type="number" min="0.01" step="0.01" max={po.balance_due} value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        </Field>
        <div role="radiogroup" aria-label="Paid by" className="grid grid-cols-5 gap-1.5">
          {METHODS.map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={method === v} onClick={() => setMethod(v)}
                    className={`h-9 rounded-lg border text-small font-medium ${method === v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>{label}</button>
          ))}
        </div>
        {method !== 'CASH' && <Field id="pay-ref" label="Reference (optional)" hint="UTR, cheque or transaction number"><Input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>}
        <p className="tabular text-small text-ink-500">{left > 0 ? `${formatCurrency(left)} will still be owed.` : 'This clears the order.'}</p>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* ── Goods already here ───────────────────────────────────────────────── */

const emptyLine = () => ({ key: Math.random(), product_id: '', description: '', quantity: '1', unit_cost: '', tax_rate: '0' });

const PurchaseForm = ({ products, suppliers, onSaved, onClose }) => {
  const idem = useIdempotencyKey();
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [paidNow, setPaidNow] = useState('');
  const [method, setMethod] = useState('CASH');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pick = (key, productId) => {
    const p = products.find((x) => String(x.product_id) === productId);
    setLine(key, { product_id: productId, description: p?.name || '', unit_cost: p?.purchase_price ? String(p.purchase_price) : '', tax_rate: String(p?.tax_rate ?? 0) });
  };
  const lineTotal = (l) => { const g = Number(l.quantity || 0) * Number(l.unit_cost || 0); return g + g * (Number(l.tax_rate || 0) / 100); };
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  const unitOf = (l) => products.find((p) => String(p.product_id) === l.product_id)?.unit;

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const items = lines.filter((l) => (l.product_id || l.description.trim()) && Number(l.quantity) > 0 && l.unit_cost !== '').map((l) => ({
        product_id: l.product_id ? Number(l.product_id) : null, description: l.description || undefined,
        quantity: Number(l.quantity), unit_cost: Number(l.unit_cost), tax_rate: Number(l.tax_rate) || 0
      }));
      if (!items.length) throw new Error('Add at least one item with a quantity and a cost');
      const po = await api('/purchases', {
        method: 'POST', idempotencyKey: idem.get(),
        body: { supplier_id: supplierId || null, items, payment: paidNow ? { amount: Number(paidNow), method } : undefined }
      });
      idem.settle();
      onSaved(po);
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Record a purchase" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <p className="-mt-2 text-small text-ink-500">For goods that have already arrived. Stock goes up now; to order first, use New order.</p>
        <Alert>{error}</Alert>
        <Field id="rp-supplier" label="Supplier (optional)">
          <Select id="rp-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">No supplier on file</option>
            {suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
          </Select>
        </Field>

        <div>
          <div className="hidden grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_4.5rem_6rem_2rem] gap-2 pb-1.5 text-caption font-medium text-ink-500 sm:grid">
            <span>Item</span><span>Quantity</span><span>Cost each ₹</span><span>GST %</span><span className="text-right">Line</span><span />
          </div>
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_4.5rem_6rem_2rem] items-center gap-2 max-sm:grid-cols-3 max-sm:rounded-lg max-sm:border max-sm:border-line max-sm:p-2">
                <div className="flex min-w-0 gap-2 max-sm:col-span-3">
                  <Select aria-label="Item" value={l.product_id} onChange={(e) => pick(l.key, e.target.value)} className="min-w-0">
                    <option value="">Something not in your list…</option>
                    {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
                  </Select>
                  {!l.product_id && <Input aria-label="Description" placeholder="What is it?" value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} className="min-w-0" />}
                </div>
                <Input aria-label="Quantity" type="number" min="0.001" step="0.001" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} placeholder={unitOf(l) || 'Qty'} />
                <Input aria-label="Cost each" type="number" min="0" step="0.01" value={l.unit_cost} onChange={(e) => setLine(l.key, { unit_cost: e.target.value })} placeholder="₹" />
                <Input aria-label="GST percent" type="number" min="0" step="0.01" value={l.tax_rate} onChange={(e) => setLine(l.key, { tax_rate: e.target.value })} />
                <span className="tabular text-right text-small font-medium text-ink-900 max-sm:hidden">{formatCurrency(lineTotal(l))}</span>
                <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [emptyLine()]))}
                        aria-label="Remove line" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-surface-2 hover:text-danger max-sm:hidden"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setLines((ls) => [...ls, emptyLine()])}><Plus aria-hidden="true" className="h-4 w-4" />Add a line</Button>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line pt-4">
          <div className="flex items-end gap-2">
            <div className="w-36"><Field id="rp-paid" label="Paid now (₹)" hint="Blank = on credit"><Input id="rp-paid" type="number" min="0" step="0.01" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} /></Field></div>
            {paidNow && <div className="w-28"><Field id="rp-method" label="By"><Select id="rp-method" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</Select></Field></div>}
          </div>
          <p className="tabular text-right"><span className="block text-caption text-ink-500">Total, with GST</span><span className="text-title font-semibold text-ink-900">{formatCurrency(total)}</span></p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record and add to stock'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* ── One order ────────────────────────────────────────────────────────── */

const Steps = ({ po }) => {
  if (po.status === 'CANCELLED') return <p className="text-small font-medium text-ink-500">This order was cancelled. Nothing was received from it.</p>;
  const steps = [
    ['Drafted', po.created_at || po.po_date, true],
    ['Ordered', po.ordered_at, Boolean(po.ordered_at) || ['PARTIAL', 'RECEIVED'].includes(po.status)],
    [po.status === 'PARTIAL' ? 'Part received' : 'Received', po.received_at, ['PARTIAL', 'RECEIVED'].includes(po.status)],
    ['Paid', null, po.payment_status === 'PAID' && po.status === 'RECEIVED']
  ];
  return (
    <ol className="grid grid-cols-4 gap-1">
      {steps.map(([label, at, done], i) => (
        <li key={label} className="min-w-0">
          <span aria-hidden="true" className={`block h-1 rounded-full ${done ? 'bg-brand-500' : 'bg-surface-3'}`} />
          <span className={`mt-1.5 flex items-center gap-1 text-caption font-medium ${done ? 'text-ink-900' : 'text-ink-400'}`}>{done && <Check aria-hidden="true" className="h-3 w-3 text-brand-600" />}{label}</span>
          <span className="block text-caption text-ink-500">{done && at ? day(at) : i === 2 && po.expected_date && !done ? `due ${day(po.expected_date)}` : ' '}</span>
        </li>
      ))}
    </ol>
  );
};

const Money = ({ label, value, strong, tone }) => (
  <div className="flex justify-between gap-3">
    <dt className={strong ? 'font-semibold text-ink-900' : 'text-ink-500'}>{label}</dt>
    <dd className={`tabular ${strong ? `text-body font-semibold ${tone || 'text-ink-900'}` : 'text-ink-900'}`}>{value}</dd>
  </div>
);

const OrderPanel = ({ poId, refreshKey, onAction, onChanged, onBack }) => {
  const toast = useToast();
  const [po, setPo] = useState(null);
  const [error, setError] = useState('');
  const load = () => api(`/purchases/${poId}`).then(setPo).catch((e) => setError(e.message));
  useEffect(() => { setPo(null); setError(''); load(); }, [poId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (confirmText, path, done) => {
    if (!window.confirm(confirmText)) return;
    setError('');
    try { await api(`/purchases/${poId}/${path}`, { method: 'POST' }); toast.success(done); onChanged(); load(); }
    catch (caught) { setError(caught.message); }
  };

  if (!po) return <div className="p-6">{error ? <Alert>{error}</Alert> : <div className="h-64 animate-pulse rounded-(--radius-card) bg-surface-3" />}</div>;
  const [label, tone] = statusOf(po);
  const arrived = ['PARTIAL', 'RECEIVED'].includes(po.status);
  const toCome = po.items.filter((i) => i.outstanding > 0 && po.status === 'PARTIAL');

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-4 sm:p-6">
        <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-900 xl:hidden"><ArrowLeft className="h-4 w-4" />All purchases</button>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-title font-semibold text-ink-900">{po.po_number}</h2>
          <Chip tone={tone}>{label}</Chip>
          {po.source === 'FORECAST' && <Chip><Sparkles aria-hidden="true" className="h-3 w-3" />From forecast</Chip>}
        </div>
        <p className="mt-0.5 text-small text-ink-500">{po.supplier_name || 'No supplier on file'}</p>
        <div className="mt-4"><Steps po={po} /></div>

        <div className="mt-4 flex flex-wrap gap-2">
          {po.status === 'DRAFT' && <>
            <Button size="sm" onClick={() => onAction('edit')}><Truck aria-hidden="true" className="h-4 w-4" />Review and send</Button>
            <Button size="sm" variant="ghost" onClick={() => act('Cancel this draft? Nothing has been ordered or received.', 'cancel', 'Order cancelled')}>Cancel order</Button>
          </>}
          {po.status === 'ORDERED' && <>
            <Button size="sm" onClick={() => onAction('receive')}><PackageCheck aria-hidden="true" className="h-4 w-4" />Goods arrived</Button>
            <Button size="sm" variant="secondary" onClick={() => onAction('edit')}>Edit or resend</Button>
            <Button size="sm" variant="ghost" onClick={() => act('Cancel this order? Nothing has been received, so stock is unaffected.', 'cancel', 'Order cancelled')}>Cancel order</Button>
          </>}
          {po.status === 'PARTIAL' && <>
            <Button size="sm" onClick={() => onAction('receive')}><PackageCheck aria-hidden="true" className="h-4 w-4" />Rest arrived</Button>
            <Button size="sm" variant="secondary" onClick={() => act('Close this order as short? The rest is not coming, and nothing more will be expected.', 'close-short', 'Order closed')}>Rest isn't coming</Button>
          </>}
          {owes(po) && <Button size="sm" variant={po.status === 'RECEIVED' ? 'primary' : 'secondary'} onClick={() => onAction('pay', po)}><Wallet aria-hidden="true" className="h-4 w-4" />Pay supplier</Button>}
          {arrived && <Button size="sm" variant="secondary" onClick={() => onAction('return', po)}>Return or price correction</Button>}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        <Alert>{error}</Alert>
        {daysLate(po) > 0 && <p className="rounded-lg bg-danger/10 px-3 py-2 text-small font-medium text-danger">Expected {day(po.expected_date)}, {daysLate(po)} day{daysLate(po) === 1 ? '' : 's'} ago. Worth a call to {po.supplier_name || 'the supplier'}.</p>}
        {toCome.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/5 px-3.5 py-3 text-small">
            <p className="font-semibold text-ink-900">Still to come</p>
            <p className="mt-0.5 text-ink-700">{toCome.map((i) => `${qty(i.outstanding)} ${i.description}`).join(', ')}</p>
          </div>
        )}

        <section aria-label="Items">
          <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Items</h3>
          <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
            {po.items.map((i) => {
              const got = i.received_quantity;
              const short = arrived && got != null && got < i.quantity;
              return (
                <li key={i.item_id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-small font-medium text-ink-900">{i.description}</span>
                    <span className="tabular block text-caption text-ink-500">
                      {arrived ? <>{qty(got ?? 0)} of {qty(i.quantity)} came{short && <span className="font-medium text-warning"> · short</span>}</> : <>{qty(i.quantity)} ordered</>}
                      {' · '}{formatCurrency(i.unit_cost)} each{i.tax_rate > 0 && ` + ${i.tax_rate}% GST`}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-small font-semibold text-ink-900">{formatCurrency(i.line_total)}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Money">
          <dl className="space-y-1.5 text-small">
            {po.tax > 0 && <><Money label="Before GST" value={formatCurrency(po.subtotal)} /><Money label="GST" value={formatCurrency(po.tax)} /></>}
            <Money label={arrived ? 'Total' : 'Order total'} value={formatCurrency(po.total)} strong />
            {po.debited > 0 && <Money label="Returned or credited" value={`−${formatCurrency(po.debited)}`} />}
            {arrived && <><Money label="Paid" value={formatCurrency(po.amount_paid)} /><Money label="Still owed" value={formatCurrency(po.balance_due)} strong tone={po.balance_due > 0 ? 'text-warning' : 'text-success'} /></>}
          </dl>
          {!arrived && po.status !== 'CANCELLED' && <p className="mt-2 text-caption text-ink-500">Nothing is owed until the goods arrive; the bill follows what actually came.</p>}
        </section>

        {po.payments.length > 0 && (
          <section aria-label="Payments">
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Payments</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface text-small">
              {po.payments.map((p) => (
                <li key={p.payment_id} className="flex justify-between gap-3 px-4 py-2.5">
                  <span><span className="block font-medium text-ink-900">{METHOD_LABEL[p.method] || p.method}</span><span className="block text-caption text-ink-500">{day(p.payment_date)}{p.reference_number && ` · ${p.reference_number}`}</span></span>
                  <span className="tabular font-semibold text-ink-900">{formatCurrency(p.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {po.notes && <section aria-label="Note"><h3 className="mb-1 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Note</h3><p className="text-small text-ink-700">{po.notes}</p></section>}
      </div>
    </div>
  );
};

/* ── The screen ───────────────────────────────────────────────────────── */

const OrderRow = ({ po, active, onOpen }) => {
  const [label, tone] = statusOf(po);
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={active ? 'true' : undefined}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-(--duration-fast) ${active ? 'bg-brand-50' : 'hover:bg-surface-2'}`}>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-small font-semibold text-ink-900">{po.supplier_name || 'No supplier'}</span>
            <Chip tone={tone}>{label}</Chip>
            {po.source === 'FORECAST' && <Sparkles aria-label="From the stock forecast" className="h-3.5 w-3.5 text-ink-400" />}
          </span>
          <span className="block truncate text-caption text-ink-500">{po.po_number} · {whenLine(po)}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block text-small font-semibold text-ink-900">{formatCurrency(po.total)}</span>
          {owes(po) && <span className="tabular block text-caption font-medium text-warning">{formatCurrency(po.balance_due)} to pay</span>}
        </span>
      </button>
    </li>
  );
};

const VIEWS = [
  ['receive', 'To receive'],
  ['pay', 'To pay'],
  ['all', 'All']
];

const PurchasesPage = () => {
  const toast = useToast();
  const location = useLocation();
  const prefill = location.state?.prefill;
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('po') ? Number(params.get('po')) : null;
  const [openRows, setOpenRows] = useState(null);
  const [recent, setRecent] = useState(null);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [error, setError] = useState('');
  const [view, setView] = useState('receive');
  const [search, setSearch] = useState('');
  const [supplier, setSupplier] = useState('');
  const [modal, setModal] = useState(prefill ? { kind: 'order' } : null);   // { kind: order|receive|record|pay|return, id?, po? }
  const [refreshKey, setRefreshKey] = useState(0);

  const load = async () => {
    try {
      // ponytail: "All" shows the latest 200; add paging when a business has more history than that
      const [o, r, prods, sups] = await Promise.all([api('/purchases?status=DRAFT,ORDERED,PARTIAL'), api('/purchases'), api('/products'), api('/suppliers')]);
      setOpenRows(o); setRecent(r); setProducts(prods); setSuppliers(sups); setError('');
    } catch (caught) { setError(caught.message); }
  };
  useEffect(() => { load(); }, []);
  const changed = () => { setRefreshKey((k) => k + 1); load(); };
  const open = (id) => setParams(id ? { po: String(id) } : {});

  const toPay = useMemo(() => {
    const seen = new Map();
    for (const po of [...(openRows || []), ...(recent || [])]) if (owes(po)) seen.set(po.po_id, po);
    return [...seen.values()];
  }, [openRows, recent]);
  const late = (openRows || []).filter((po) => daysLate(po) > 0).length;
  const owed = toPay.reduce((s, po) => s + po.balance_due, 0);
  const source = view === 'receive' ? openRows : view === 'pay' ? toPay : recent;
  const q = search.trim().toLowerCase();
  const shown = (source || []).filter((po) => (!supplier || String(po.supplier_id) === supplier)
    && (!q || po.po_number.toLowerCase().includes(q) || String(po.supplier_name || '').toLowerCase().includes(q)));
  const counts = { receive: openRows?.length ?? 0, pay: toPay.length, all: recent?.length ?? 0 };

  return (
    <div className="-m-4 grid grid-cols-1 sm:-m-6 lg:-m-8 xl:h-[calc(100vh-3.5rem)] xl:grid-cols-[minmax(0,1fr)_460px]">
      <section aria-label="Purchase list" className={`min-w-0 p-4 sm:p-6 lg:p-8 xl:block xl:overflow-y-auto ${selectedId ? 'hidden' : 'block'}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-h3 font-semibold text-ink-900">Purchases</h1>
            <p className="tabular mt-1 text-small text-ink-500">
              {openRows ? <>
                {openRows.length} order{openRows.length === 1 ? '' : 's'} to receive
                {late > 0 && <> · <span className="font-semibold text-danger">{late} late</span></>}
                {owed > 0 && <> · <span className="font-medium text-warning">{formatCurrency(owed)} to pay suppliers</span></>}
              </> : 'Orders on their way, and what you owe suppliers.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setModal({ kind: 'record' })}>Record a purchase</Button>
            <Button onClick={() => setModal({ kind: 'order' })}><Plus aria-hidden="true" className="h-4 w-4" />New order</Button>
          </div>
        </div>

        <div role="tablist" aria-label="Show" className="mt-5 flex gap-1 border-b border-line">
          {VIEWS.map(([id, text]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
                    className={`-mb-px border-b-2 px-3 py-2 text-small font-medium ${view === id ? 'border-brand-500 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>
              {text} <span className={`tabular ml-0.5 ${view === id ? 'text-brand-700' : 'text-ink-400'}`}>{counts[id]}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <span className="sr-only">Search purchases</span>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order number or supplier" className="!pl-9" />
          </label>
          {suppliers.length > 1 && (
            <Select aria-label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} className="!w-auto">
              <option value="">All suppliers</option>
              {suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
            </Select>
          )}
        </div>

        <div className="mt-4">
          <Alert>{error}</Alert>
          {!source && !error && <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-3" />)}</div>}
          {source && shown.length === 0 && (
            <div className="rounded-(--radius-card) border border-dashed border-line-strong p-8 text-center">
              <p className="text-small font-medium text-ink-900">
                {q || supplier ? 'Nothing matches.' : view === 'receive' ? 'Nothing on its way.' : view === 'pay' ? 'Nothing owed to suppliers.' : 'No purchases yet.'}
              </p>
              {view === 'receive' && !q && !supplier && <p className="mt-1 text-small text-ink-500">Start a new order, or let the <Link to="/app/forecast" className="font-medium text-brand-700">stock forecast</Link> draft them for you.</p>}
            </div>
          )}
          {shown.length > 0 && (
            <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
              {shown.map((po) => <OrderRow key={po.po_id} po={po} active={po.po_id === selectedId} onOpen={() => open(po.po_id)} />)}
            </ul>
          )}
          <p className="mt-4 text-caption text-ink-500">Sent goods back or were overcharged? <Link to="/app/debit-notes" className="font-medium text-brand-700">See debit notes</Link>.</p>
        </div>
      </section>

      <section aria-label="Selected purchase" className={`min-h-0 min-w-0 flex-col border-line bg-surface xl:flex xl:border-l ${selectedId ? 'flex min-h-[calc(100vh-3.5rem)] xl:min-h-0' : 'hidden'}`}>
        {selectedId ? (
          <OrderPanel key={selectedId} poId={selectedId} refreshKey={refreshKey} onChanged={load} onBack={() => open(null)}
                      onAction={(kind, po) => setModal(kind === 'edit' ? { kind: 'order', id: selectedId } : kind === 'receive' ? { kind: 'receive', id: selectedId } : { kind, po })} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <p className="text-small font-medium text-ink-700">Pick an order to see what's on it, receive it, or pay for it</p>
          </div>
        )}
      </section>

      {modal?.kind === 'record' && (
        <PurchaseForm products={products} suppliers={suppliers} onClose={() => setModal(null)}
                      onSaved={(po) => { setModal(null); toast.success(`${po.po_number} recorded; stock updated`); setView('all'); changed(); open(po.po_id); }} />
      )}
      {/* A pre-filled draft (from the forecast) needs the product and supplier lists to resolve its ids, so wait for them. */}
      {(modal?.kind === 'order' || modal?.kind === 'receive') && (!prefill || modal.id || products.length > 0) && (
        <PurchaseOrderModal poId={modal.id} products={products} suppliers={suppliers} prefill={modal.id ? undefined : prefill}
                            initialMode={modal.kind === 'receive' ? 'receive' : 'edit'}
                            onClose={() => { setModal(null); changed(); }} onChanged={load} />
      )}
      {modal?.kind === 'pay' && <PayModal po={modal.po} onClose={() => setModal(null)} onPaid={() => { setModal(null); changed(); }} />}
      {modal?.kind === 'return' && <DebitNoteModal poId={modal.po.po_id} poNumber={modal.po.po_number} onClose={() => setModal(null)} onDone={() => { setModal(null); changed(); }} />}
    </div>
  );
};

export default PurchasesPage;
