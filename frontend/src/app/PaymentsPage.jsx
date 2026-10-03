/*
 * Payments: money taken from customers and money paid to suppliers, kept
 * apart (the payments table holds both; po_id marks a supplier payment).
 * Exact totals per period and method come from GET /payments/summary; the
 * list (capped at 200) is grouped by day and links to the bill or order.
 *
 * Paying a bill happens on the bill (or at the till), paying a supplier on
 * the purchase order. The form here is only for a customer payment with no
 * bill: an advance, or an old balance from before FlowXP.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Plus, QrCode, Search } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { localISO } from '../lib/dates.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '../components/ui.jsx';

const METHODS = [['CASH', 'Cash'], ['UPI', 'UPI'], ['CARD', 'Card'], ['BANK_TRANSFER', 'Bank'], ['CREDIT', 'Credit'], ['OTHER', 'Other']];
const METHOD_LABEL = Object.fromEntries(METHODS);

const d0 = (iso) => new Date(`${iso}T00:00`);
const plusDays = (iso, n) => { const d = d0(iso); d.setDate(d.getDate() + n); return localISO(d); };
const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['month', 'This month'], ['custom', 'Pick dates']];
const periodFor = (key, custom) => {
  const today = localISO(); const now = new Date();
  if (key === 'today') return { from: today, to: today, label: 'today' };
  if (key === 'yesterday') { const y = plusDays(today, -1); return { from: y, to: y, label: 'yesterday' }; }
  if (key === '7d') return { from: plusDays(today, -6), to: today, label: 'in the last 7 days' };
  if (key === 'month') return { from: localISO(new Date(now.getFullYear(), now.getMonth(), 1)), to: today, label: `in ${now.toLocaleDateString([], { month: 'long' })} so far` };
  const from = custom.from || today; const to = custom.to && custom.to >= from ? custom.to : from;
  return { from, to, label: from === to ? `on ${d0(from).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : 'in these dates' };
};
const dayLabel = (iso) => {
  const today = localISO();
  if (iso === today) return 'Today';
  if (iso === plusDays(today, -1)) return 'Yesterday';
  return d0(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};
const time = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

/* ── A payment with no bill ───────────────────────────────────────────── */

const PaymentForm = ({ customers, onSaved, onClose }) => {
  const idem = useIdempotencyKey();
  const [form, setForm] = useState({ customer_id: '', amount: '', method: 'CASH', reference_number: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/payments', { method: 'POST', idempotencyKey: idem.get(), body: { ...form, customer_id: Number(form.customer_id), amount: Number(form.amount) } });
      idem.settle();
      onSaved(`${formatCurrency(Number(form.amount))} from ${customers.find((c) => String(c.customer_id) === form.customer_id)?.name || 'the customer'} recorded`);
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Record a payment with no bill" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="-mt-2 text-small text-ink-500">For an advance, or an old balance from before FlowXP. It does not settle any bill: to take payment for a bill, open the bill.</p>
        <Alert>{error}</Alert>
        <Field id="pf-customer" label="From">
          <Select id="pf-customer" value={form.customer_id} onChange={set('customer_id')} required>
            <option value="" disabled>Choose a customer…</option>
            {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
          </Select>
        </Field>
        <Field id="pf-amount" label="Amount (₹)"><Input id="pf-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} required className="!h-12 !text-[20px] font-semibold tabular" /></Field>
        <div role="radiogroup" aria-label="Paid by" className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {METHODS.map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={form.method === v} onClick={() => setForm((f) => ({ ...f, method: v }))}
                    className={`h-9 rounded-lg border text-small font-medium ${form.method === v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>{label}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pf-ref" label="Reference (optional)" hint="UTR, card slip or cheque number"><Input id="pf-ref" value={form.reference_number} onChange={set('reference_number')} /></Field>
          <Field id="pf-notes" label="Note (optional)"><Input id="pf-notes" value={form.notes} onChange={set('notes')} placeholder="e.g. Advance for the party order" /></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* ── The screen ───────────────────────────────────────────────────────── */

const Row = ({ p }) => {
  const out = p.direction === 'out';
  const who = out ? (p.supplier_name || 'A supplier') : (p.customer_name || 'Walk-in customer');
  const what = out
    ? (p.po_id ? <Link to={`/app/purchases?po=${p.po_id}`} className="font-medium text-brand-700 hover:underline">{p.po_number}</Link> : 'Supplier payment')
    : p.invoice_id ? <Link to={`/app/billing/invoices/${p.invoice_id}`} className="font-medium text-brand-700 hover:underline">{p.invoice_number}</Link> : 'No bill: advance or old balance';
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${out ? 'bg-surface-2 text-ink-500' : 'bg-success/10 text-success'}`}>{out ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-small font-semibold text-ink-900">{who}</span>
        <span className="block truncate text-caption text-ink-500">{what}{p.reference_number && <> · {p.reference_number}</>}{p.notes && <> · {p.notes}</>}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`tabular block text-small font-semibold ${out ? 'text-ink-900' : 'text-success'}`}>{out ? '−' : '+'}{formatCurrency(p.amount)}</span>
        <span className="block text-caption text-ink-500">{METHOD_LABEL[p.method] || p.method}{time(p.created_at) && ` · ${time(p.created_at)}`}</span>
      </span>
    </li>
  );
};

const PaymentsPage = () => {
  const toast = useToast();
  const { business, outletId } = useAuth();
  const allView = outletId === 'all';
  const [direction, setDirection] = useState('in');
  const [periodKey, setPeriodKey] = useState('today');
  const [custom, setCustom] = useState({ from: plusDays(localISO(), -6), to: localISO() });
  const [method, setMethod] = useState(null);
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const period = useMemo(() => periodFor(periodKey, custom), [periodKey, custom]);

  const load = async () => {
    try {
      const q = `from=${period.from}&to=${period.to}`;
      const [s, list] = await Promise.all([api(`/payments/summary?${q}`), api(`/payments?${q}&direction=${direction}${method ? `&method=${method}` : ''}`)]);
      setSummary(s); setRows(list); setError('');
    } catch (caught) { setError(caught.message); }
  };
  useEffect(() => { setRows(null); load(); }, [period, direction, method, outletId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (adding && !customers.length) api('/customers').then(setCustomers).catch(() => {}); }, [adding]); // eslint-disable-line react-hooks/exhaustive-deps

  const side = summary?.[direction];
  const top = side?.by_method[0]?.total || 1;
  const q = search.trim().toLowerCase();
  const shown = (rows || []).filter((p) => !q || [p.customer_name, p.supplier_name, p.invoice_number, p.po_number, p.reference_number, p.notes].some((v) => String(v || '').toLowerCase().includes(q)));
  const byDay = useMemo(() => {
    const map = new Map();
    for (const p of shown) { const k = String(p.date).slice(0, 10); if (!map.has(k)) map.set(k, []); map.get(k).push(p); }
    return [...map.entries()];
  }, [shown]);
  const net = summary ? Math.round((summary.in.total - summary.out.total) * 100) / 100 : 0;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h3 font-semibold text-ink-900">Payments</h1>
          <p className="mt-1 text-small text-ink-500">Every rupee taken from customers and paid to suppliers.</p>
        </div>
        <Button variant="secondary" onClick={() => setAdding(true)} disabled={allView} title={allView ? 'Pick an outlet at the top to record a payment at it' : undefined}><Plus aria-hidden="true" className="h-4 w-4" />Payment with no bill</Button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Period" className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface-2 p-1">
          {PERIODS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={periodKey === k} onClick={() => setPeriodKey(k)}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-small font-medium ${periodKey === k ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'}`}>{label}</button>
          ))}
        </div>
        {periodKey === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From" value={custom.from} max={localISO()} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="!w-auto" />
            <span className="text-small text-ink-500">to</span>
            <Input type="date" aria-label="To" value={custom.to} min={custom.from} max={localISO()} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="!w-auto" />
          </div>
        )}
      </div>

      <Alert>{error}</Alert>

      <div className="mb-6 grid gap-2 sm:grid-cols-3">
        {[['in', 'Taken from customers', summary?.in], ['out', 'Paid to suppliers', summary?.out]].map(([k, label, s]) => (
          <button key={k} type="button" onClick={() => { setDirection(k); setMethod(null); }} aria-pressed={direction === k}
                  className={`rounded-(--radius-card) border bg-surface p-4 text-left transition-colors duration-(--duration-fast) ${direction === k ? 'border-brand-500 ring-1 ring-brand-500' : 'border-line hover:border-ink-400'}`}>
            <p className="flex items-center gap-1.5 text-caption text-ink-500">{k === 'in' ? <ArrowDownLeft aria-hidden="true" className="h-3.5 w-3.5 text-success" /> : <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />}{label}</p>
            <p className="tabular mt-1 text-title font-semibold text-ink-900">{s ? formatCurrency(s.total) : '—'}</p>
            <p className="text-caption text-ink-500">{s ? `${s.count} payment${s.count === 1 ? '' : 's'} ${period.label}` : ' '}</p>
          </button>
        ))}
        <div className="rounded-(--radius-card) border border-line bg-surface p-4">
          <p className="text-caption text-ink-500">In minus out</p>
          <p className={`tabular mt-1 text-title font-semibold ${net < 0 ? 'text-warning' : 'text-ink-900'}`}>{summary ? `${net < 0 ? '−' : ''}${formatCurrency(Math.abs(net))}` : '—'}</p>
          <p className="text-caption text-ink-500">before expenses and refunds</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
        <section aria-label="By method" className="space-y-4">
          <div className="rounded-(--radius-card) border border-line bg-surface p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-body font-semibold text-ink-900">{direction === 'in' ? 'How customers paid' : 'How suppliers were paid'}</h2>
              {method && <button type="button" onClick={() => setMethod(null)} className="text-caption font-medium text-brand-700">Show all</button>}
            </div>
            {!side ? <div className="h-24 animate-pulse rounded-lg bg-surface-3" /> : side.by_method.length === 0 ? <p className="text-small text-ink-500">Nothing {period.label}.</p> : (
              <ul className="space-y-1">
                {side.by_method.map((m) => (
                  <li key={m.method}>
                    <button type="button" onClick={() => setMethod(method === m.method ? null : m.method)} aria-pressed={method === m.method}
                            className={`w-full rounded-lg px-2 py-2 text-left ${method === m.method ? 'bg-brand-50' : method ? 'opacity-60 hover:bg-surface-2 hover:opacity-100' : 'hover:bg-surface-2'}`}>
                      <span className="flex items-baseline justify-between gap-3 text-small">
                        <span className="font-medium text-ink-900">{METHOD_LABEL[m.method] || m.method} <span className="tabular font-normal text-ink-500">· {m.count}</span></span>
                        <span className="tabular font-semibold text-ink-900">{formatCurrency(m.total)}</span>
                      </span>
                      <span aria-hidden="true" className="mt-1.5 block h-2 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.max(2, (m.total / top) * 100)}%` }} /></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {direction === 'in' && (
            <div className="flex items-start gap-3 rounded-(--radius-card) border border-line bg-surface p-4">
              <QrCode aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-ink-500" />
              <p className="text-small text-ink-700">
                {business?.upi_vpa
                  ? <>UPI QR at the till is on: each bill paid by UPI shows a QR for its exact amount, paid to <strong>{business.upi_vpa}</strong>.</>
                  : <>Add your UPI ID in <Link to="/app/settings/business" className="font-medium text-brand-700 hover:underline">Business settings</Link> and the till shows a QR for the exact amount of each UPI bill.</>}
              </p>
            </div>
          )}
        </section>

        <section aria-label="Payment list">
          <div className="mb-3 flex items-center gap-2">
            <label className="relative flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <span className="sr-only">Search payments</span>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={direction === 'in' ? 'Customer, bill number or reference' : 'Supplier, order number or reference'} className="!pl-9" />
            </label>
          </div>
          {!rows && !error && <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-3" />)}</div>}
          {rows && shown.length === 0 && (
            <p className="rounded-(--radius-card) border border-dashed border-line-strong p-8 text-center text-small text-ink-500">
              {q ? 'No payments match.' : direction === 'in' ? `No payments taken ${period.label}.` : `Nothing paid to suppliers ${period.label}.`}
            </p>
          )}
          <div className="space-y-5">
            {byDay.map(([date, list]) => (
              <div key={date}>
                <p className="mb-1.5 flex justify-between text-caption font-medium text-ink-500"><span>{dayLabel(date)}</span><span className="tabular">{formatCurrency(list.reduce((t, p) => t + p.amount, 0))}</span></p>
                <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">{list.map((p) => <Row key={p.payment_id} p={p} />)}</ul>
              </div>
            ))}
          </div>
          {rows?.length === 200 && <p className="mt-3 text-caption text-ink-500">Showing the latest 200. The totals above count every payment in the period.</p>}
        </section>
      </div>

      {adding && <PaymentForm customers={customers} onClose={() => setAdding(false)} onSaved={(msg) => { setAdding(false); toast.success(msg); setDirection('in'); load(); }} />}
    </div>
  );
};

export default PaymentsPage;
