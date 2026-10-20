/*
 * Field sales: the rep's day on a phone. Today's beat in route order; open a retailer to see what they owe and which
 * schemes they qualify for, then record the visit, take an order and collect payment. Everything that changes data
 * goes through the same Idempotency-Key + offline queue as the till, so a rep with no signal keeps working: the
 * visit goes first and the order and receipt name it by `visit_ref`, which the server resolves once it arrives.
 */
import { useState } from 'react';
import { Check, ChevronLeft, CloudOff, MapPin, Minus, Phone, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api, NetworkError } from '../../lib/api.js';
import { queueSale, startAutoSync, useOnline, useQueuedSales } from '../../lib/offline.js';
import { VISIT_OUTCOMES, money, newRef, todayIn, useLoad } from '../../lib/distributor.js';
import { Alert, Badge, Button, EmptyState, Field, Input, ListState, Select, Textarea, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, useAction } from '../wholesale/parts.jsx';
import { ProductPicker } from '../wholesale/parts.jsx';
import { SalespersonSelect } from './parts.jsx';
import { useEffect } from 'react';
import { useT } from '../../i18n/useT.js';

const METHODS = { CASH: 'Cash', UPI: 'UPI', CHEQUE: 'Cheque', BANK_TRANSFER: 'Bank transfer' };

/** Send now; if there is no connection, keep it for later. Returns 'sent' or 'queued'. */
const sendOrQueue = async (path, body, label, key) => {
  if (navigator.onLine) {
    try { await api(path, { method: 'POST', body, idempotencyKey: key }); return 'sent'; }
    catch (e) { if (!(e instanceof NetworkError)) throw e; }
  }
  queueSale({ label, body, idempotencyKey: key, path });
  return 'queued';
};

const useVisit = ({ customer, salespersonId, beatId }) => {
  const [ref] = useState(newRef);
  const [recorded, setRecorded] = useState(false);
  // the visit is recorded the first time anything is saved for this retailer; later saves only name it
  const ensure = async (outcome, notes) => {
    if (recorded) return;
    const body = { customer_id: customer.customer_id, client_ref: ref, outcome, notes: notes || null, beat_id: beatId || null, salesperson_id: salespersonId || undefined };
    await sendOrQueue('/distributor/visits', body, `Visit · ${customer.name}`, `visit-${ref}`);
    setRecorded(true);
  };
  return { ref, ensure };
};

/* ── take an order ────────────────────────────────────────────────────────── */
const OrderTaker = ({ customer, visit, beatId, salespersonId, onDone, schemes }) => {
  const tr = useT();
  const toast = useToast();
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [busy, run] = useAction();
  const [key] = useState(newRef);
  const setQty = (id, q) => setLines((ls) => ls.map((l) => (l.product_id === id ? { ...l, quantity: Math.max(0, q) } : l)).filter((l) => l.quantity > 0 && l.quantity >= l.moq));
  const add = (p) => setLines((ls) => ls.some((l) => l.product_id === p.product_id) ? ls.map((l) => (l.product_id === p.product_id ? { ...l, quantity: l.quantity + 1 } : l)) : [...ls, { product_id: p.product_id, name: p.name, unit: p.unit, price: p.wholesale_price ?? p.selling_price, moq: Number(p.moq) || 1, quantity: Number(p.moq) || 1 }]);
  const total = lines.reduce((s, l) => s + l.quantity * Number(l.price || 0), 0);
  const submit = async () => {
    const r = await run(async () => {
      await visit.ensure('ORDER');
      const body = { customer_id: customer.customer_id, submit: true, source: 'FIELD', visit_ref: visit.ref, beat_id: beatId || undefined, salesperson_id: salespersonId || undefined, notes: notes || undefined, lines: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })) };
      return sendOrQueue('/wholesale/orders', body, `Order · ${customer.name}`, `order-${key}`);
    });
    if (r) { toast.success(r === 'queued' ? tr('Saved on this phone — it will send when you are back online') : tr('Order placed')); onDone(); }
  };
  return (
    <div className="space-y-3">
      {schemes?.length > 0 && (
        <div className="rounded-lg bg-brand-50 p-3 text-small text-brand-800">
          <p className="mb-1 font-semibold">{tr('Offers for {{customer_name}}', { customer_name: customer.name })}</p>
          <ul className="space-y-0.5">{schemes.slice(0, 4).map((s) => <li key={s.scheme_id}>• {s.description || s.name}</li>)}</ul>
          <p className="mt-1 text-caption text-brand-700">{tr('Free goods and discounts are added when the order is saved.')}</p>
        </div>
      )}
      <ProductPicker onPick={add} placeholder={tr('Search or scan a product')} />
      {lines.length === 0 && <p className="py-6 text-center text-small text-ink-500">{tr('Add the products they want.')}</p>}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {lines.map((l) => (
          <li key={l.product_id} className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium text-ink-900">{l.name}</span><span className="text-caption text-ink-500">{money(l.price)} / {l.unit}{l.moq > 1 ? ` · min ${l.moq}` : ''}</span></span>
            <button type="button" aria-label={tr('One less {{l_name}}', { l_name: l.name })} onClick={() => setQty(l.product_id, l.quantity - 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line"><Minus aria-hidden="true" className="h-4 w-4" /></button>
            <input aria-label={tr('Quantity of {{l_name}}', { l_name: l.name })} inputMode="decimal" value={l.quantity} onChange={(e) => setQty(l.product_id, Number(e.target.value) || 0)} className="h-9 w-14 rounded-lg border border-line text-center text-small tabular" />
            <button type="button" aria-label={tr('One more {{l_name}}', { l_name: l.name })} onClick={() => setQty(l.product_id, l.quantity + 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line"><Plus aria-hidden="true" className="h-4 w-4" /></button>
            <button type="button" aria-label={tr('Remove {{l_name}}', { l_name: l.name })} onClick={() => setQty(l.product_id, 0)} className="p-1 text-ink-400 hover:text-danger"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      <Field id="fs-notes" label={tr('Note')}><Input id="fs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder={tr('Delivery instructions, PO number…')} /></Field>
      <div className="flex items-center justify-between border-t border-line pt-3">
        <div><p className="text-caption text-ink-500">{tr('Before offers and tax')}</p><p className="text-body font-semibold tabular">{money(total)}</p></div>
        <Button onClick={submit} loading={busy} disabled={!lines.length}>{tr('Place order')}</Button>
      </div>
    </div>
  );
};

/* ── collect payment ──────────────────────────────────────────────────────── */
const Collector = ({ customer, outstanding, visit, onDone }) => {
  const tr = useT();
  const toast = useToast();
  const [amount, setAmount] = useState(outstanding > 0 ? String(outstanding) : '');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [busy, run] = useAction();
  const [key] = useState(newRef);
  const needsRef = method !== 'CASH';
  const submit = async () => {
    const r = await run(async () => {
      await visit.ensure('COLLECTION');
      return sendOrQueue('/wholesale/receipts', { customer_id: customer.customer_id, amount: Number(amount), method, reference: reference || undefined, visit_ref: visit.ref }, `Payment · ${customer.name}`, `receipt-${key}`);
    });
    if (r) { toast.success(r === 'queued' ? tr('Saved on this phone — it will send when you are back online') : tr('Payment recorded')); onDone(); }
  };
  return (
    <div className="space-y-3">
      <p className="text-small text-ink-500">{tr('Outstanding')} <span className="font-semibold text-ink-900 tabular">{money(outstanding)}</span>{tr('. The payment settles the oldest invoices first.')}</p>
      <div className="grid grid-cols-2 gap-3">
        <NumberField id="fs-amt" label={tr('Amount')} prefix="₹" value={amount} onChange={setAmount} />
        <Field id="fs-method" label={tr('Paid by')}><Select id="fs-method" value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      </div>
      {needsRef && <Field id="fs-ref" label={method === 'CHEQUE' ? tr('Cheque number') : tr('Transaction reference')}><Input id="fs-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></Field>}
      <Button className="w-full" onClick={submit} loading={busy} disabled={!(Number(amount) > 0) || (needsRef && !reference.trim())}>{tr('Record payment')}</Button>
    </div>
  );
};

/* ── one retailer ─────────────────────────────────────────────────────────── */
const Retailer = ({ stop, beatId, salespersonId, onBack, onChanged }) => {
  const tr = useT();
  const { data, loading, error, reload } = useLoad(`/distributor/field/customers/${stop.customer_id}`);
  const schemes = useLoad(`/distributor/schemes/eligible?customer_id=${stop.customer_id}`).data;
  const [mode, setMode] = useState(null);
  const [outcome, setOutcome] = useState('NO_ORDER');
  const [notes, setNotes] = useState('');
  const [busy, run] = useAction();
  const toast = useToast();
  const customer = { customer_id: stop.customer_id, name: stop.name };
  const visit = useVisit({ customer, salespersonId, beatId });
  const done = () => { setMode(null); if (navigator.onLine) { reload(); onChanged(); } };
  const log = async () => {
    const r = await run(async () => { await visit.ensure(outcome, notes); return true; });
    if (r) { toast.success(tr('Visit recorded')); done(); }
  };
  const c = data?.customer;
  const credit = data?.credit;
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-small font-medium text-brand-700"><ChevronLeft aria-hidden="true" className="h-4 w-4" />{tr('Today’s beat')}</button>
      <div>
        <h2 className="text-h3 font-semibold text-ink-900">{stop.name}</h2>
        <p className="text-small text-ink-500">{[c?.contact_person, c?.city, c?.territory].filter(Boolean).join(' · ')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {stop.phone && <a href={`tel:${stop.phone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-small"><Phone aria-hidden="true" className="h-4 w-4" />{tr('Call')}</a>}
          {(stop.address || c?.address) && <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.address || c.address)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-small"><MapPin aria-hidden="true" className="h-4 w-4" />{tr('Directions')}</a>}
        </div>
      </div>
      <ListState loading={loading && !data} error={error} />
      {credit && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['Owes', credit.outstanding], ['Overdue', credit.overdue], ['Can still buy', credit.available]].map(([l, v]) => (
            <div key={l} className="rounded-lg border border-line p-2"><p className="text-caption text-ink-500">{l}</p><p className={`text-small font-semibold tabular ${l === 'Overdue' && v > 0 ? 'text-danger' : 'text-ink-900'}`}>{v == null ? tr('No limit') : v < 0 ? `Over by ${money(-v)}` : money(v)}</p></div>
          ))}
        </div>
      )}
      {!mode && (
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => setMode('order')}>{tr('Take order')}</Button>
          <Button variant="secondary" onClick={() => setMode('collect')} disabled={!(credit?.outstanding > 0)}>{tr('Collect payment')}</Button>
          <Button variant="secondary" className="col-span-2" onClick={() => setMode('visit')}>{tr('Log visit without order')}</Button>
        </div>
      )}
      {mode === 'order' && <Panel title={tr('New order')} action={<button type="button" className="text-small text-brand-700" onClick={() => setMode(null)}>{tr('Cancel')}</button>}><div><OrderTaker customer={customer} visit={visit} beatId={beatId} salespersonId={salespersonId} schemes={schemes} onDone={done} /></div></Panel>}
      {mode === 'collect' && <Panel title={tr('Collect payment')} action={<button type="button" className="text-small text-brand-700" onClick={() => setMode(null)}>{tr('Cancel')}</button>}><div><Collector customer={customer} outstanding={credit?.outstanding || 0} visit={visit} onDone={done} /></div></Panel>}
      {mode === 'visit' && (
        <Panel title={tr('Log visit')} action={<button type="button" className="text-small text-brand-700" onClick={() => setMode(null)}>{tr('Cancel')}</button>}>
          <div className="space-y-3">
            <Field id="fs-outcome" label={tr('What happened')}><Select id="fs-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>{Object.entries(VISIT_OUTCOMES).filter(([k]) => !['ORDER', 'COLLECTION'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field id="fs-vnotes" label={tr('Notes')}><Textarea id="fs-vnotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
            <Button className="w-full" onClick={log} loading={busy}>{tr('Save visit')}</Button>
          </div>
        </Panel>
      )}
      {data?.open_invoices?.length > 0 && (
        <Panel title={tr('Unpaid invoices')}><ul className="divide-y divide-line">{data.open_invoices.map((i) => <li key={i.invoice_id} className="flex items-center justify-between px-4 py-2 text-small"><span>{i.invoice_number}{i.overdue && <span className="ml-2"><Badge tone="danger">{tr('Overdue')}</Badge></span>}</span><span className="tabular">{money(i.balance)}</span></li>)}</ul></Panel>
      )}
      {data?.orders?.length > 0 && (
        <Panel title={tr('Recent orders')}><ul className="divide-y divide-line">{data.orders.map((o) => <li key={o.order_id} className="flex items-center justify-between px-4 py-2 text-small"><span>{o.order_number} <span className="text-ink-500">{String(o.order_date).slice(0, 10)}</span></span><span className="tabular">{money(o.total)}</span></li>)}</ul></Panel>
      )}
    </div>
  );
};

/* ── the day ──────────────────────────────────────────────────────────────── */
const FieldSales = () => {
  const tr = useT();
  const { business } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const waiting = useQueuedSales();
  const isRep = business?.role === 'FIELD_SALES';
  const [repId, setRepId] = useState('');
  const [open, setOpen] = useState(null);
  const query = isRep ? '' : (repId ? `?salesperson_id=${repId}` : null);
  const { data, loading, error, reload } = useLoad(query === null ? null : `/distributor/field/today${query}`);

  useEffect(() => startAutoSync((r) => { if (r.sent) { toast.success(`${r.sent} saved item${r.sent === 1 ? '' : 's'} sent`); reload(); } }), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (open) return <Retailer stop={open.stop} beatId={open.beatId} salespersonId={isRep ? undefined : Number(repId) || undefined} onBack={() => setOpen(null)} onChanged={reload} />;
  const s = data?.summary;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div><h1 className="text-h2 font-semibold text-ink-900">{tr('Today’s beat')}</h1><p className="text-small text-ink-500">{data ? `${data.salesperson.name} · ${new Date(`${data.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}` : todayIn()}</p></div>
        {(!online || waiting.length > 0) && <Badge tone="warning"><CloudOff aria-hidden="true" className="mr-1 h-3 w-3" />{online ? `${waiting.length} to send` : tr('Offline')}</Badge>}
      </div>
      {!isRep && <SalespersonSelect id="fs-rep" label={tr('Salesperson')} value={repId} onChange={setRepId} emptyLabel={tr('Choose a salesperson')} />}
      {!isRep && !repId && <Alert>{tr('Choose a salesperson to see their beat.')}</Alert>}
      <ListState loading={loading && !data} error={error} />
      {s && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[['Visited', `${s.visited}/${s.planned}`], ['Orders', `${s.orders}`], ['Order value', money(s.order_value)], ['Collected', money(s.collected)]].map(([l, v]) => (
            <div key={l} className="rounded-lg border border-line bg-surface p-3"><p className="text-caption text-ink-500">{l}</p><p className="text-body font-semibold tabular">{v}</p></div>
          ))}
        </div>
      )}
      {s?.month_target && <p className="rounded-lg bg-surface-2 px-3 py-2 text-small text-ink-700">Month target {s.month_target.achievement_pct}% · {money(s.month_target.remaining)} to go{s.month_target.days_left > 0 ? `, about ${money(s.month_target.required_per_day)} a day` : ''}</p>}
      {data && data.beats.length === 0 && <EmptyState compact icon={MapPin} title={tr('No beat today')} body={tr('Nothing is planned for this weekday. Ask your manager to assign a beat.')} />}
      {data?.beats.map((b) => (
        <Panel key={b.beat_id} title={b.name} lead={tr('{{customers_length}} retailers', { customers_length: b.customers.length })}>
          <ul className="divide-y divide-line">
            {b.customers.map((c) => (
              <li key={c.customer_id}>
                <button type="button" onClick={() => setOpen({ stop: c, beatId: b.beat_id })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption tabular">{c.visited ? <Check aria-hidden="true" className="h-4 w-4 text-success" /> : c.seq}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium text-ink-900">{c.name}</span><span className="block truncate text-caption text-ink-500">{c.outstanding > 0 ? `Owes ${money(c.outstanding)}` : tr('Nothing owed')}{c.overdue > 0 ? ` · ${money(c.overdue)} overdue` : ''}</span></span>
                  {c.visited && <Badge tone="success">{VISIT_OUTCOMES[c.visit_outcome] || 'Visited'}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
};

export default FieldSales;
