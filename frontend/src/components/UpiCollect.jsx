/*
 * Take a UPI payment for a saved bill: a QR for the exact amount due, made
 * from the business's own UPI ID (businesses.upi_vpa), that any UPI app can
 * scan. It is the same `upi://pay` link the receipt and the table QR menu use.
 *
 * This is not a payment gateway. FlowXP never hears from the bank, so the
 * cashier confirms on the customer's phone that it went through and then taps
 * "Payment received", which records it against the bill (POST
 * /invoices/:id/payments, method UPI). "Not paid yet" leaves the bill unpaid.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, Smartphone } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { printReceipt } from '../lib/printing.js';
import { Alert, Button, Field, Input, Modal } from './ui.jsx';

export const upiLink = ({ vpa, payee, amount, note }) =>
  `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payee)}&am=${Number(amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

/** `invoice` is a saved bill; `amount` (optional) collects less than its balance, for a part payment. */
const UpiCollect = ({ invoice, amount, vpa, payee, onPaid, onLater }) => {
  const idem = useIdempotencyKey();
  const due = Math.min(amount ?? invoice.balance_due ?? invoice.total, invoice.balance_due ?? invoice.total);
  const link = upiLink({ vpa, payee, amount: due, note: `${invoice.invoice_number} ${payee}`.slice(0, 50) });
  const [qr, setQr] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { QRCode.toDataURL(link, { width: 480, margin: 1, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr('')); }, [link]);

  const received = async () => {
    setBusy(true); setError('');
    try {
      const result = await api(`/invoices/${invoice.invoice_id}/payments`, {
        method: 'POST', idempotencyKey: idem.get(),
        body: { amount: due, method: 'UPI', reference_number: reference.trim() || undefined }
      });
      idem.settle();
      onPaid({ ...invoice, amount_paid: result.amount_paid, balance_due: result.balance_due, payment_status: result.balance_due > 0 ? 'PARTIAL' : 'PAID' });
    } catch (caught) { idem.settle(caught); setError(caught.message); setBusy(false); }
  };

  return (
    <Modal title="Scan to pay with UPI" onClose={onLater}>
      <div className="text-center">
        <p className="-mt-2 text-small text-ink-500">{invoice.invoice_number} · {payee}</p>
        <p className="tabular mt-3 text-[40px] font-semibold leading-none tracking-tight text-ink-900">{formatCurrency(due)}</p>
        <div className="mx-auto mt-4 flex h-60 w-60 items-center justify-center rounded-(--radius-card) border border-line bg-white p-3">
          {qr ? <img src={qr} alt={`UPI QR code to pay ${formatCurrency(due)} to ${vpa}`} className="h-full w-full" style={{ imageRendering: 'pixelated' }} /> : <div className="h-full w-full animate-pulse rounded bg-surface-3" />}
        </div>
        <p className="mt-3 text-small text-ink-700">Paying <span className="font-semibold text-ink-900">{vpa}</span></p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-caption text-ink-500"><Smartphone aria-hidden="true" className="h-3.5 w-3.5" />Any UPI app: GPay, PhonePe, Paytm, BHIM or a bank app</p>
        {/* The bill is saved and unpaid, so the printed copy carries this same QR for the exact amount due. */}
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => printReceipt(invoice.invoice_id)}><Printer aria-hidden="true" className="h-4 w-4" />Print bill with this QR</Button>
      </div>

      <div className="mt-5 rounded-lg bg-surface-2 px-3.5 py-3 text-small text-ink-700">
        FlowXP can’t see UPI payments by itself. Check the customer’s phone shows <strong>paid</strong> to {vpa} for {formatCurrency(due)}, then tap Payment received.
      </div>
      <div className="mt-4">
        <Field id="upi-ref" label="UPI reference (optional)" hint="The 12-digit UTR from their screen, if you want it on record">
          <Input id="upi-ref" inputMode="numeric" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={40} />
        </Field>
      </div>
      <Alert>{error}</Alert>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onLater} disabled={busy}>Not paid yet</Button>
        <Button onClick={received} disabled={busy}>{busy ? 'Saving…' : 'Payment received'}</Button>
      </div>
      <p className="mt-3 text-center text-caption text-ink-500">Not paid yet keeps the bill, unpaid, so it can be paid later or another way.</p>
    </Modal>
  );
};

export default UpiCollect;
