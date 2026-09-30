/*
 * One bill: the document itself (what prints, as A4 or PDF through the
 * browser) and, beside it, where its money stands, its payments, refunds and
 * credit notes, and the next thing to do with it. Taking a payment can use the
 * UPI QR (components/UpiCollect.jsx) when the business has a UPI ID.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, FileText, MessageCircle, Printer, Receipt, Wallet } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { getDevicePrefs, openDrawer, openPrint, printReceipt } from '../../lib/printing.js';
import CreditNoteModal from '../../components/CreditNoteModal.jsx';
import EWayBillModal from '../../components/EWayBillModal.jsx';
import UpiCollect from '../../components/UpiCollect.jsx';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '../../components/ui.jsx';

const METHODS = [['CASH', 'Cash'], ['UPI', 'UPI'], ['CARD', 'Card'], ['BANK_TRANSFER', 'Bank'], ['CREDIT', 'Credit'], ['OTHER', 'Other']];
const METHOD_LABEL = Object.fromEntries(METHODS);
const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const longDate = (d) => new Date(String(d).length === 10 ? `${d}T00:00` : d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/* ── Take a payment ───────────────────────────────────────────────────── */

const PayForm = ({ invoice, upiVpa, payee, onSaved, onClose }) => {
  const idem = useIdempotencyKey();
  const due = invoice.balance_due;
  const [amount, setAmount] = useState(due.toFixed(2));
  const [method, setMethod] = useState('CASH');
  const [people, setPeople] = useState(1);
  const [reference, setReference] = useState('');
  const [qr, setQr] = useState(null);   // the amount a UPI QR is showing for
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // splitting what is left equally: each share rounded up to the paisa; record one payment per person
  const share = (n) => Math.ceil((due / n) * 100) / 100;
  const upiQr = method === 'UPI' && Boolean(upiVpa);

  const submit = async (e) => {
    e.preventDefault();
    if (upiQr) { setQr(Number(amount)); return; }
    setError(''); setBusy(true);
    try {
      await api(`/invoices/${invoice.invoice_id}/payments`, { method: 'POST', idempotencyKey: idem.get(), body: { amount: Number(amount), method, reference_number: reference.trim() || undefined } });
      idem.settle();
      if (method === 'CASH' && getDevicePrefs().openDrawer) openDrawer();
      onSaved(`${formatCurrency(Number(amount))} ${METHOD_LABEL[method]} recorded`);
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  if (qr != null) {
    return <UpiCollect invoice={invoice} amount={qr} vpa={upiVpa} payee={payee} onPaid={() => onSaved(`${formatCurrency(qr)} UPI recorded`)} onLater={() => setQr(null)} />;
  }
  return (
    <Modal title={`Take payment for ${invoice.invoice_number}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="tabular -mt-2 text-small text-ink-500">{formatCurrency(due)} still due{invoice.customer_name ? ` from ${invoice.customer_name}` : ''}</p>
        <Alert>{error}</Alert>
        <div role="radiogroup" aria-label="Paid by" className="grid grid-cols-3 gap-1.5">
          {METHODS.map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={method === v} onClick={() => setMethod(v)}
                    className={`h-10 rounded-lg border text-small font-medium ${method === v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>{label}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="pay-amount" label="Amount (₹)"><Input id="pay-amount" type="number" inputMode="decimal" min="0.01" step="0.01" max={due} value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus className="tabular font-semibold" /></Field>
          <Field id="people" label="Split between">
            <Select id="people" value={people} onChange={(e) => { const n = Number(e.target.value); setPeople(n); setAmount(share(n).toFixed(2)); }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n === 1 ? 'One payment' : `${n} people`}</option>)}
            </Select>
          </Field>
        </div>
        {people > 1 && <p className="tabular -mt-2 text-caption text-ink-500">About {formatCurrency(share(people))} each. Record one payment per person; the last one pays exactly what is left.</p>}
        {!upiQr && method !== 'CASH' && <Field id="pay-ref" label="Reference (optional)" hint="UTR, card slip or cheque number"><Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
        {method === 'UPI' && <p className="text-caption text-ink-500">{upiQr ? `Shows a QR for this amount, paid to ${upiVpa}.` : 'Add your UPI ID in Business settings to show a QR here.'}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : upiQr ? 'Show UPI QR' : 'Record payment'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* A refund is its own record; cancelling a bill never pays anything back. */
const RefundForm = ({ invoice, refundable, onSaved, onClose }) => {
  const idem = useIdempotencyKey();
  const [amount, setAmount] = useState(refundable.toFixed(2));
  const [method, setMethod] = useState('CASH');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api(`/invoices/${invoice.invoice_id}/refund`, { method: 'POST', idempotencyKey: idem.get(), body: { amount: Number(amount), method, reason } });
      idem.settle();
      onSaved(`${formatCurrency(Number(amount))} refunded`);
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Refund on ${invoice.invoice_number}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="tabular -mt-2 text-small text-ink-500">Up to {formatCurrency(refundable)} can still be given back. This records money returned; to take items back into stock or correct GST, issue a credit note.</p>
        <Alert>{error}</Alert>
        <Field id="r-amount" label="Amount (₹)"><Input id="r-amount" type="number" min="0.01" step="0.01" max={refundable} value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></Field>
        <div role="radiogroup" aria-label="Given back by" className="grid grid-cols-4 gap-1.5">
          {[['CASH', 'Cash'], ['UPI', 'UPI'], ['CARD', 'Card'], ['OTHER', 'Other']].map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={method === v} onClick={() => setMethod(v)}
                    className={`h-9 rounded-lg border text-small font-medium ${method === v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>{label}</button>
          ))}
        </div>
        <Field id="r-reason" label="Why"><Input id="r-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong item, quality complaint" required /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record refund'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* ── The page ─────────────────────────────────────────────────────────── */

const Line = ({ label, value, tone = 'text-ink-700', strong }) => (
  <div className={`flex justify-between gap-4 ${strong ? 'text-body font-semibold text-ink-900' : `text-small ${tone}`}`}><span>{label}</span><span className="tabular">{value}</span></div>
);

const MoreMenu = ({ items }) => {
  const ref = useRef(null);
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  const close = () => { if (ref.current) ref.current.open = false; };
  return (
    <details ref={ref} className="relative">
      <summary className="flex h-10 cursor-pointer list-none items-center justify-center gap-1.5 rounded-(--radius-control) border border-line-strong bg-surface px-3 text-small font-medium text-ink-700 hover:border-ink-400 [&::-webkit-details-marker]:hidden">More <ChevronDown aria-hidden="true" className="h-4 w-4" /></summary>
      <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-(--radius-card) border border-line bg-surface py-1 shadow-lg">
        {shown.map(([label, onClick, danger]) => (
          <button key={label} type="button" onClick={() => { close(); onClick(); }} className={`block w-full px-3.5 py-2 text-left text-small hover:bg-surface-2 ${danger ? 'text-danger' : 'text-ink-700'}`}>{label}</button>
        ))}
      </div>
    </details>
  );
};

const InvoiceDetail = () => {
  const { id } = useParams();
  const { business } = useAuth();
  const toast = useToast();
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [modal, setModal] = useState(null);   // pay | refund | credit | eway
  const load = () => api(`/invoices/${id}`).then((d) => { setInvoice(d); setError(''); }).catch((caught) => setError(caught.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (msg) => { setModal(null); if (msg) toast.success(msg); load(); };

  const sendBill = async () => {
    setActionError('');
    const phone = invoice.customer_phone || window.prompt('Customer mobile number to send the bill to:');
    if (!phone) return;
    try {
      const m = await api('/messaging/send-bill', { method: 'POST', body: { invoice_id: Number(id), phone } });
      toast.success(m.status === 'SENT' ? 'Bill sent' : m.status === 'SKIPPED' ? 'Not sent: no messaging service is connected yet' : `Could not send: ${m.error}`);
    } catch (caught) { setActionError(caught.message); }
  };
  const cancel = async () => {
    const paidNote = invoice.amount_paid - invoice.refunded > 0 ? ` ${formatCurrency(invoice.amount_paid - invoice.refunded)} was paid on it and is not refunded automatically; record a refund if you give it back.` : '';
    if (!window.confirm(`Cancel ${invoice.invoice_number}? Stock comes back and it stops counting as a sale.${paidNote}`)) return;
    setActionError('');
    try { await api(`/invoices/${id}/cancel`, { method: 'POST' }); toast.success(`${invoice.invoice_number} cancelled`); load(); }
    catch (caught) { setActionError(caught.message); }
  };

  if (error) return <div className="mx-auto max-w-3xl"><Alert>{error}</Alert><Link to="/app/billing/invoices" className="text-small font-medium text-brand-700">← All invoices</Link></div>;
  if (!invoice) return <div className="mx-auto max-w-6xl"><div className="h-[560px] animate-pulse rounded-(--radius-panel) bg-surface-3" /></div>;

  const issued = invoice.status === 'ISSUED';
  const due = issued ? invoice.balance_due : 0;
  const refundable = Math.round((invoice.amount_paid - invoice.refunded) * 100) / 100;
  const outlet = invoice.outlet;
  const seller = invoice.seller || {};
  // a line's name often already carries its choices ("Butter Chicken (Medium)"); list only the ones it doesn't
  const extraChoices = (i) => (i.modifiers || []).map((m) => m.name || m).filter((n) => n && !i.description.includes(n));
  const when = new Date(invoice.created_at || `${invoice.invoice_date}T00:00`);
  const history = [
    ...invoice.payments.map((p) => ({ key: `p${p.payment_id}`, at: p.date, label: `${METHOD_LABEL[p.method] || p.method} payment`, note: p.reference_number, amount: p.amount, sign: '+' })),
    ...(invoice.refunds || []).map((r) => ({ key: `r${r.refund_id}`, at: r.created_at, label: `Refund · ${METHOD_LABEL[r.method] || r.method}`, note: r.reason, amount: r.amount, sign: '−' })),
    ...(invoice.credit_notes || []).map((c) => ({ key: `c${c.cn_id}`, at: c.date, label: `Credit note ${c.cn_number}`, note: c.reason, amount: c.total, sign: '−', print: c.cn_id }))
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to="/app/billing/invoices" className="flex items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" />All invoices</Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => printReceipt(id)}><Receipt aria-hidden="true" className="h-4 w-4" />Receipt</Button>
          <Button variant="secondary" onClick={() => window.print()}><Printer aria-hidden="true" className="h-4 w-4" />A4 / PDF</Button>
          {issued && <Button variant="secondary" onClick={sendBill}><MessageCircle aria-hidden="true" className="h-4 w-4" />Send</Button>}
          <MoreMenu items={[
            issued && ['Issue a credit note', () => setModal('credit')],
            refundable > 0 && ['Refund money', () => setModal('refund')],
            issued && invoice.customer_gstin && ['OWNER', 'ADMIN'].includes(business?.role) && ['E-way bill', () => setModal('eway')],
            issued && ['Cancel this bill', cancel, true]
          ]} />
        </div>
      </div>
      <Alert>{actionError}</Alert>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── The document: this is what prints ── */}
        <article className="rounded-(--radius-panel) border border-line bg-surface p-6 sm:p-8 print:border-0 print:p-0">
          {!issued && <p className="mb-5 rounded-lg bg-danger/10 px-3 py-2 text-center text-small font-semibold text-danger">CANCELLED: this bill is not a sale and does not count in totals.</p>}
          <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
            <div className="min-w-0">
              <p className="text-title font-semibold text-ink-900">{business?.name}</p>
              <p className="mt-1 text-small text-ink-500">{[outlet && outlet.name !== business?.name && outlet.name, outlet?.address || seller.address, outlet?.city || seller.city].filter(Boolean).join(', ')}</p>
              {(outlet?.phone || seller.phone) && <p className="text-small text-ink-500">{outlet?.phone || seller.phone}</p>}
              {(outlet?.gstin || seller.gstin) && <p className="text-small text-ink-500">GSTIN {outlet?.gstin || seller.gstin}</p>}
            </div>
            <div className="text-right">
              <p className="text-caption font-semibold uppercase tracking-[0.14em] text-ink-500">{invoice.tax > 0 ? 'Tax invoice' : 'Invoice'}</p>
              <p className="mt-1 text-h3 font-semibold text-ink-900">{invoice.invoice_number}</p>
              <p className="text-small text-ink-500">{longDate(invoice.invoice_date)}{invoice.created_at && `, ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</p>
            </div>
          </header>

          <div className="grid gap-4 border-b border-line py-5 text-small sm:grid-cols-2">
            <div>
              <p className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Billed to</p>
              {invoice.customer_name ? (
                <div className="mt-1 text-ink-900">
                  {invoice.customer_id ? <Link to={`/app/customers?c=${invoice.customer_id}`} className="font-medium hover:text-brand-700 print:no-underline">{invoice.customer_name}</Link> : <p className="font-medium">{invoice.customer_name}</p>}
                  {invoice.customer_phone && <p className="text-ink-500">{invoice.customer_phone}</p>}
                  {invoice.customer_gstin && <p className="text-ink-500">GSTIN {invoice.customer_gstin}</p>}
                </div>
              ) : <p className="mt-1 text-ink-500">Walk-in customer</p>}
            </div>
            <div className="sm:text-right">
              {(invoice.order_number || invoice.table_name) && <p className="text-ink-700">{[invoice.table_name && `Table ${invoice.table_name}`, invoice.order_number].filter(Boolean).join(' · ')}</p>}
              {invoice.cashier && <p className="text-ink-500">Served by {invoice.cashier}</p>}
              {invoice.irn && <p className="break-all text-caption text-ink-500">IRN {invoice.irn}</p>}
              {invoice.eway_bill_no && <p className="text-caption text-ink-500">E-way bill {invoice.eway_bill_no}</p>}
            </div>
          </div>

          <table className="mt-2 w-full text-small">
            <thead>
              <tr className="border-b border-line text-left text-caption font-semibold uppercase tracking-[0.08em] text-ink-500">
                <th className="py-2.5 font-semibold">Item</th>
                <th className="py-2.5 text-right font-semibold">Qty</th>
                <th className="hidden py-2.5 text-right font-semibold sm:table-cell print:table-cell">Rate</th>
                {invoice.tax > 0 && <th className="hidden py-2.5 text-right font-semibold sm:table-cell print:table-cell">GST</th>}
                <th className="py-2.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invoice.items.map((i) => (
                <tr key={i.item_id} className="align-top">
                  <td className="py-3 pr-3">
                    <p className="font-medium text-ink-900">{i.description}</p>
                    {extraChoices(i).length > 0 && <p className="text-caption text-ink-500">{extraChoices(i).join(', ')}</p>}
                    {i.discount > 0 && <p className="text-caption text-success">−{formatCurrency(i.discount)} off</p>}
                    <p className="tabular text-caption text-ink-500 sm:hidden print:hidden">{formatCurrency(i.unit_price)} each{invoice.tax > 0 ? ` · ${i.tax_rate}% GST` : ''}</p>
                  </td>
                  <td className="tabular py-3 text-right text-ink-700">{qty(i.quantity)}</td>
                  <td className="tabular hidden py-3 text-right text-ink-700 sm:table-cell print:table-cell">{formatCurrency(i.unit_price)}</td>
                  {invoice.tax > 0 && <td className="tabular hidden py-3 text-right text-ink-500 sm:table-cell print:table-cell">{i.tax_rate}%</td>}
                  <td className="tabular py-3 text-right font-medium text-ink-900">{formatCurrency(i.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ml-auto mt-4 max-w-xs space-y-1.5 border-t border-line pt-4">
            <Line label="Subtotal" value={formatCurrency(invoice.subtotal)} />
            {invoice.cgst > 0 && <Line label="CGST" value={formatCurrency(invoice.cgst)} tone="text-ink-500" />}
            {invoice.sgst > 0 && <Line label="SGST" value={formatCurrency(invoice.sgst)} tone="text-ink-500" />}
            {invoice.igst > 0 && <Line label="IGST" value={formatCurrency(invoice.igst)} tone="text-ink-500" />}
            {invoice.discount - invoice.coupon_discount > 0 && <Line label="Discount" value={`−${formatCurrency(invoice.discount - invoice.coupon_discount)}`} />}
            {invoice.coupon_discount > 0 && <Line label={`Coupon ${invoice.coupon_code}`} value={`−${formatCurrency(invoice.coupon_discount)}`} />}
            {invoice.points_discount > 0 && <Line label={`Points used (${invoice.points_redeemed})`} value={`−${formatCurrency(invoice.points_discount)}`} tone="text-success" />}
            {invoice.loyalty_discount > 0 && <Line label="Loyalty reward" value={`−${formatCurrency(invoice.loyalty_discount)}`} tone="text-success" />}
            {invoice.round_off !== 0 && <Line label="Round off" value={`${invoice.round_off > 0 ? '+' : '−'}${formatCurrency(Math.abs(invoice.round_off))}`} tone="text-ink-500" />}
            <div className="border-t border-line pt-2"><Line label="Total" value={formatCurrency(invoice.total)} strong /></div>
            {invoice.amount_paid > 0 && <Line label="Paid" value={formatCurrency(invoice.amount_paid)} tone="text-ink-500" />}
            {invoice.refunded > 0 && <Line label="Refunded" value={`−${formatCurrency(invoice.refunded)}`} tone="text-ink-500" />}
            {due > 0 && <Line label="Balance due" value={formatCurrency(due)} tone="font-semibold text-warning" />}
          </div>

          {invoice.notes && <p className="mt-6 border-t border-line pt-4 text-small text-ink-700">{invoice.notes}</p>}
          <p className="mt-8 text-center text-caption text-ink-400">Thank you{business?.name ? ` for choosing ${business.name}` : ''}.</p>
        </article>

        {/* ── Beside it: money and what to do next (never printed) ── */}
        <aside className="space-y-4 print:hidden">
          <section aria-label="Money" className="rounded-(--radius-card) border border-line bg-surface p-5">
            {!issued ? (
              <p className="text-small font-semibold text-ink-500">Cancelled</p>
            ) : due > 0 ? <>
              <p className="text-caption text-ink-500">{invoice.payment_status === 'PARTIAL' ? 'Part paid · still due' : 'Not paid yet'}</p>
              <p className="tabular mt-1 text-[28px] font-semibold leading-none tracking-tight text-warning">{formatCurrency(due)}</p>
              <p className="tabular mt-1 text-caption text-ink-500">of {formatCurrency(invoice.total)}{invoice.amount_paid > 0 && ` · ${formatCurrency(invoice.amount_paid)} paid`}</p>
              <Button className="mt-4 w-full" onClick={() => setModal('pay')}><Wallet aria-hidden="true" className="h-4 w-4" />Take payment</Button>
            </> : <>
              <p className="text-caption text-ink-500">Paid in full</p>
              <p className="tabular mt-1 text-[28px] font-semibold leading-none tracking-tight text-success">{formatCurrency(invoice.amount_paid)}</p>
              {invoice.refunded > 0 && <p className="tabular mt-1 text-caption text-ink-500">{formatCurrency(invoice.refunded)} refunded since</p>}
            </>}
          </section>

          <section aria-label="History" className="rounded-(--radius-card) border border-line bg-surface p-5">
            <h2 className="mb-3 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">History</h2>
            <ol className="space-y-3 text-small">
              <li className="flex justify-between gap-3">
                <span><span className="block font-medium text-ink-900">Bill raised</span><span className="block text-caption text-ink-500">{longDate(invoice.invoice_date)}{invoice.cashier && ` · ${invoice.cashier}`}</span></span>
                <span className="tabular text-ink-700">{formatCurrency(invoice.total)}</span>
              </li>
              {history.map((h) => (
                <li key={h.key} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-medium text-ink-900">{h.label}</span>
                    <span className="block truncate text-caption text-ink-500">{longDate(h.at)}{h.note && ` · ${h.note}`}{h.print && <> · <button type="button" onClick={() => openPrint('credit-note', h.print)} className="font-medium text-brand-700">Print</button></>}</span>
                  </span>
                  <span className={`tabular shrink-0 font-medium ${h.sign === '+' ? 'text-success' : 'text-ink-700'}`}>{h.sign}{formatCurrency(h.amount)}</span>
                </li>
              ))}
              {!issued && <li className="font-medium text-danger">Cancelled</li>}
            </ol>
          </section>

          {invoice.loyalty_message && issued && (
            <p className="rounded-(--radius-card) border border-line bg-surface-2 p-4 text-small text-ink-700">{invoice.loyalty_message}</p>
          )}
          <p className="flex items-start gap-2 px-1 text-caption text-ink-500"><FileText aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />A4 / PDF prints only the bill itself. To save a PDF, choose “Save as PDF” as the printer.</p>
        </aside>
      </div>

      {modal === 'pay' && <PayForm invoice={invoice} upiVpa={business?.upi_vpa} payee={business?.name} onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'refund' && <RefundForm invoice={invoice} refundable={refundable} onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'credit' && <CreditNoteModal invoice={invoice} onClose={() => setModal(null)} onIssued={() => done('Credit note issued')} />}
      {modal === 'eway' && <EWayBillModal invoice={invoice} onClose={() => setModal(null)} onDone={() => done()} />}
    </div>
  );
};

export default InvoiceDetail;
