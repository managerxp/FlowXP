/*
 * What can be done with a payment link beside the link itself. One the client settled another way (cash, UPI, bank transfer) is marked paid, and the plan or add-on
 * switches on exactly as if the link had been paid; a paid one can have a receipt emailed to the owner. The link is not cancelled at the gateway, so it must not be sent again.
 */
import { useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { formatCurrency } from '../lib/api.js';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '../components/ui.jsx';

const HOW = [['CASH', 'Cash'], ['UPI', 'UPI'], ['BANK_TRANSFER', 'Bank transfer'], ['CHEQUE', 'Cheque'], ['CARD', 'Card'], ['OTHER', 'Other']];
const todayIso = () => new Date().toISOString().slice(0, 10);

const OrderActions = ({ businessId, kind, order, ownerEmail, ownerPhone, onDone }) => {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ method: 'CASH', paid_on: todayIso(), note: '', send_receipt: Boolean(ownerEmail), send_whatsapp: Boolean(ownerPhone) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `/businesses/${businessId}/orders/${kind}/${order.order_id}`;
  const id = (k) => `mp-${k}-${kind}-${order.order_id}`;

  const mark = async () => {
    setBusy(true); setError('');
    try {
      const out = await adminApi(`${base}/mark-paid`, { method: 'POST', body: { ...f, note: f.note || undefined } });
      const to = [out.receipt_sent_to, out.whatsapp_sent_to && `WhatsApp ${out.whatsapp_sent_to}`].filter(Boolean).join(' and ');
      toast.success(to ? `Marked paid. Receipt sent to ${to}` : 'Marked paid');
      if (out.receipt_error) toast.error(`Receipt not sent: ${out.receipt_error}`);
      setOpen(false);
      await onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const receipt = async (channel) => {
    try { const out = await adminApi(`${base}/receipt`, { method: 'POST', body: { channel } }); toast.success(`Receipt sent to ${out.sent_to}`); await onDone(); }
    catch (e) { toast.error(e.message); }
  };

  if (order.status === 'PAID') {
    const how = order.paid_method ? (HOW.find(([k]) => k === order.paid_method)?.[1] || order.paid_method) : 'Online';
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-caption text-ink-500">{how}{order.paid_at ? `, ${new Date(order.paid_at).toLocaleDateString()}` : ''}</span>
        <button type="button" className="text-small text-brand-600 hover:underline" onClick={() => receipt('email')}>{order.receipt_sent_at ? 'Email receipt again' : 'Email receipt'}</button>
        <button type="button" className="text-small text-brand-600 hover:underline" onClick={() => receipt('whatsapp')}>Send on WhatsApp</button>
      </div>
    );
  }
  if (order.status === 'CANCELLED') return <span className="text-caption text-ink-500">—</span>;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setError(''); setOpen(true); }}>Mark paid</Button>
      {open && (
        <Modal title="Mark this payment as received" onClose={() => setOpen(false)}
               footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy} onClick={mark}>{busy ? 'Saving…' : `Mark ${formatCurrency(order.amount)} paid`}</Button></>}>
          <p className="mb-3 text-small text-ink-700">Use this when the client paid you directly instead of through the link. The plan or add-on is switched on now and the amount counts in your revenue.</p>
          {error && <Alert>{error}</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={id('how')} label="Paid by">
              <Select id={id('how')} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{HOW.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</Select>
            </Field>
            <Field id={id('on')} label="Date received">
              <Input id={id('on')} type="date" max={todayIso()} value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3">
            <Field id={id('note')} label="Note (optional)" hint="For example: collected at the shop">
              <Input id={id('note')} value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-small text-ink-900">
            <input type="checkbox" checked={f.send_receipt} disabled={!ownerEmail} onChange={(e) => setF({ ...f, send_receipt: e.target.checked })} />
            {ownerEmail ? `Email a receipt to ${ownerEmail}` : 'No owner email to send a receipt to'}
          </label>
          <label className="mt-2 flex items-center gap-2 text-small text-ink-900">
            <input type="checkbox" checked={f.send_whatsapp} disabled={!ownerPhone} onChange={(e) => setF({ ...f, send_whatsapp: e.target.checked })} />
            {ownerPhone ? `Send the receipt on WhatsApp to ${ownerPhone}` : 'No owner phone number to send on WhatsApp'}
          </label>
          <p className="mt-3 text-caption text-ink-500">The payment link still works. Do not send it again.</p>
        </Modal>
      )}
    </>
  );
};

export default OrderActions;
