/*
 * One invoice: full breakdown, its payment history, and the two actions the
 * brief asks for — record a further payment, and send/download it (here:
 * print, which covers "download as PDF" via the browser's own print-to-PDF —
 * a dedicated PDF renderer is more machinery than a V1 invoice needs).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatCurrency } from '../../lib/api.js';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { openPrint } from '../../lib/printing.js';
import CreditNoteModal from '../../components/CreditNoteModal.jsx';
import { Alert, Button, Card, Field, Input, Modal, Select, StatusBadge, Table, Td, Th, Thead, Tr, useToast } from '../../components/ui.jsx';

const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CREDIT', 'OTHER'];

const PayForm = ({ invoiceId, balanceDue, onSaved, onClose }) => {
  const [amount, setAmount] = useState(balanceDue.toFixed(2));
  const [method, setMethod] = useState('CASH');
  const [people, setPeople] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const idem = useIdempotencyKey();

  // Splitting the bill equally: each person's share, rounded up to the paisa, with the last one taking any remainder.
  const share = (n) => Math.ceil((balanceDue / n) * 100) / 100;

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api(`/invoices/${invoiceId}/payments`, { method: 'POST', idempotencyKey: idem.get(), body: { amount: Number(amount), method } });
      idem.settle();
      onSaved();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Record payment" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        {balanceDue > 0 && (
          <Field id="people" label="Split between" hint={people > 1 ? `Each of the ${people} pays about ₹${share(people).toFixed(2)}. Record one payment per person; the last one settles the exact balance.` : 'Choose how many people are still paying to split the balance equally.'}>
            <Select id="people" value={people} onChange={(e) => { const n = Number(e.target.value); setPeople(n); setAmount(share(n).toFixed(2)); }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n === 1 ? 'Just one payment' : `${n} people`}</option>)}
            </Select>
          </Field>
        )}
        <Field id="amount" label="Amount (₹)"><Input id="amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></Field>
        <Field id="method" label="Method">
          <Select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* A refund is a separate, explicit record — cancelling an invoice never pays anything back. */
const RefundForm = ({ invoiceId, refundable, onSaved, onClose }) => {
  const toast = useToast();
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
      await api(`/invoices/${invoiceId}/refund`, { method: 'POST', idempotencyKey: idem.get(), body: { amount: Number(amount), method, reason } });
      idem.settle();
      toast.success('Refund recorded');
      onSaved();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Refund" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="r-amount" label="Amount (₹)" hint={`Up to ${formatCurrency(refundable)} can still be refunded.`}><Input id="r-amount" type="number" min="0.01" step="0.01" max={refundable} value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></Field>
        <Field id="r-method" label="Returned by">
          <Select id="r-method" value={method} onChange={(e) => setMethod(e.target.value)}>{['CASH', 'UPI', 'CARD', 'OTHER'].map((m) => <option key={m} value={m}>{m}</option>)}</Select>
        </Field>
        <Field id="r-reason" label="Reason"><Input id="r-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong item, quality complaint" required /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record refund'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const InvoiceDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { business } = useAuth();
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [crediting, setCrediting] = useState(false);

  const load = () => { api(`/invoices/${id}`).then(setInvoice).catch((caught) => setError(caught.message)); };
  useEffect(() => { load(); }, [id]);

  const cancel = async () => {
    if (!confirm('Cancel this invoice? Stock will be restored; any payment already collected is not automatically refunded.')) return;
    await api(`/invoices/${id}/cancel`, { method: 'POST' });
    load();
  };

  if (error) return <Alert>{error}</Alert>;
  if (!invoice) return <p className="text-sm text-ink-400">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="ghost" onClick={() => navigate('/app/billing/invoices')}>← All invoices</Button>
        <div className="flex gap-2">
          {invoice.status === 'ISSUED' && invoice.balance_due > 0 && (
            <Button variant="secondary" onClick={() => setPaying(true)}>Record payment</Button>
          )}
          {invoice.status === 'ISSUED' && <Button variant="secondary" onClick={() => setCrediting(true)}>Issue credit note</Button>}
          {invoice.amount_paid - invoice.refunded > 0 && (
            <Button variant="secondary" onClick={() => setRefunding(true)}>Refund</Button>
          )}
          <Button variant="secondary" onClick={() => openPrint('receipt', id)}>Print receipt</Button>
          <Button variant="secondary" onClick={() => window.print()}>Print invoice / PDF</Button>
          {invoice.status === 'ISSUED' && <Button variant="ghost" onClick={cancel}>Cancel invoice</Button>}
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">{business?.name}</h1>
            <p className="mt-1 text-sm text-ink-500">Invoice {invoice.invoice_number}</p>
            <p className="text-sm text-ink-500">{invoice.invoice_date}</p>
          </div>
          <div className="text-right">
            <StatusBadge status={invoice.status} />
            <div className="mt-1"><StatusBadge status={invoice.payment_status} /></div>
          </div>
        </div>

        {invoice.customer_name && (
          <div className="border-b border-line py-4 text-sm">
            <p className="font-semibold text-ink-900">Billed to</p>
            <p className="text-ink-500">{invoice.customer_name}</p>
            {invoice.customer_phone && <p className="text-ink-500">{invoice.customer_phone}</p>}
            {invoice.customer_gstin && <p className="text-ink-500">GSTIN: {invoice.customer_gstin}</p>}
          </div>
        )}

        <div className="py-4">
          <Table>
            <Thead><Th>Item</Th><Th className="text-right">Qty</Th><Th className="text-right">Price</Th><Th className="text-right">Tax</Th><Th className="text-right">Total</Th></Thead>
            <tbody>
              {invoice.items.map((i) => (
                <Tr key={i.item_id}>
                  <Td>{i.description}</Td>
                  <Td className="text-right">{i.quantity}</Td>
                  <Td className="text-right">{formatCurrency(i.unit_price)}</Td>
                  <Td className="text-right text-ink-500">{i.tax_rate}%</Td>
                  <Td className="text-right font-medium">{formatCurrency(i.line_total)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>

        <div className="ml-auto max-w-xs space-y-1.5 border-t border-line pt-4 text-sm">
          <div className="flex justify-between text-ink-500"><span>Subtotal</span><span>{formatCurrency(invoice.subtotal)}</span></div>
          {invoice.cgst > 0 && <div className="flex justify-between text-ink-500"><span>CGST</span><span>{formatCurrency(invoice.cgst)}</span></div>}
          {invoice.sgst > 0 && <div className="flex justify-between text-ink-500"><span>SGST</span><span>{formatCurrency(invoice.sgst)}</span></div>}
          {invoice.igst > 0 && <div className="flex justify-between text-ink-500"><span>IGST</span><span>{formatCurrency(invoice.igst)}</span></div>}
          {invoice.discount - invoice.coupon_discount > 0 && <div className="flex justify-between text-ink-500"><span>Discount</span><span>−{formatCurrency(invoice.discount - invoice.coupon_discount)}</span></div>}
          {invoice.coupon_discount > 0 && <div className="flex justify-between text-ink-500"><span>Coupon {invoice.coupon_code}</span><span>−{formatCurrency(invoice.coupon_discount)}</span></div>}
          {invoice.loyalty_discount > 0 && <div className="flex justify-between text-success"><span>Loyalty reward (free item)</span><span>−{formatCurrency(invoice.loyalty_discount)}</span></div>}
          {invoice.round_off !== 0 && <div className="flex justify-between text-ink-500"><span>Round off</span><span>{invoice.round_off > 0 ? '+' : '−'}{formatCurrency(Math.abs(invoice.round_off))}</span></div>}
          <div className="flex justify-between text-base font-bold text-ink-900"><span>Total</span><span>{formatCurrency(invoice.total)}</span></div>
          <div className="flex justify-between text-ink-500"><span>Paid</span><span>{formatCurrency(invoice.amount_paid)}</span></div>
          {invoice.refunded > 0 && <div className="flex justify-between text-ink-500"><span>Refunded</span><span>−{formatCurrency(invoice.refunded)}</span></div>}
          {invoice.balance_due > 0 && <div className="flex justify-between font-semibold text-warning"><span>Balance due</span><span>{formatCurrency(invoice.balance_due)}</span></div>}
        </div>

        {invoice.notes && <p className="mt-4 border-t border-line pt-4 text-sm text-ink-500">{invoice.notes}</p>}

        {invoice.credit_notes?.length > 0 && (
          <div className="mt-6 border-t border-line pt-4">
            <p className="mb-2 text-sm font-semibold text-ink-900">Credit notes</p>
            <ul className="space-y-1 text-sm text-ink-600">
              {invoice.credit_notes.map((c) => (
                <li key={c.cn_id} className="flex flex-wrap items-center justify-between gap-2">
                  <span><strong>{c.cn_number}</strong> · {String(c.date).slice(0, 10)} · {c.reason}</span>
                  <span className="flex items-center gap-3"><span className="font-medium text-ink-900">−{formatCurrency(c.total)}</span><button onClick={() => openPrint('credit-note', c.cn_id)} className="text-xs font-semibold text-brand-600 print:hidden">Print</button></span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {invoice.refunds?.length > 0 && (
          <div className="mt-6 border-t border-line pt-4">
            <p className="mb-2 text-sm font-semibold text-ink-900">Refunds</p>
            <ul className="space-y-1 text-sm text-ink-500">
              {invoice.refunds.map((r) => (
                <li key={r.refund_id} className="flex justify-between">
                  <span>{new Date(r.created_at).toLocaleDateString()} · {r.method} · {r.reason}</span>
                  <span className="font-medium text-ink-900">−{formatCurrency(r.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {invoice.payments.length > 0 && (
          <div className="mt-6 border-t border-line pt-4">
            <p className="mb-2 text-sm font-semibold text-ink-900">Payments</p>
            <ul className="space-y-1 text-sm text-ink-500">
              {invoice.payments.map((p) => (
                <li key={p.payment_id} className="flex justify-between">
                  <span>{p.date} · {p.method.replace('_', ' ')}</span>
                  <span className="font-medium text-ink-900">{formatCurrency(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {crediting && <CreditNoteModal invoice={invoice} onClose={() => setCrediting(false)} onIssued={() => { setCrediting(false); load(); }} />}
      {refunding && <RefundForm invoiceId={invoice.invoice_id} refundable={invoice.amount_paid - invoice.refunded} onClose={() => setRefunding(false)} onSaved={() => { setRefunding(false); load(); }} />}

      {paying && (
        <PayForm invoiceId={id} balanceDue={invoice.balance_due} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); load(); }} />
      )}
    </div>
  );
};

export default InvoiceDetail;
