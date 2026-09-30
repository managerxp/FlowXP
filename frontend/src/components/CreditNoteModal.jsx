/*
 * Issue a credit note against an invoice: choose what comes back and how much,
 * say why, and choose how it is settled. The server works out the tax and the
 * settlement exactly; the figures shown here are only an estimate for the person.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { Alert, Button, Field, Input, Modal, Select, useToast } from './ui.jsx';

const METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'];

const CreditNoteModal = ({ invoice, onClose, onIssued }) => {
  const toast = useToast();
  const idem = useIdempotencyKey();
  const [options, setOptions] = useState(null);
  const [qty, setQty] = useState({});
  const [reason, setReason] = useState('');
  const [settle, setSettle] = useState('none');       // none | refund
  const [method, setMethod] = useState('CASH');
  const [restock, setRestock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api(`/invoices/${invoice.invoice_id}/credit-notes/options`).then(setOptions).catch((e) => setError(e.message)); }, [invoice.invoice_id]);

  const chosen = (options?.items ?? []).map((i) => ({ ...i, take: Math.min(i.remaining, Number(qty[i.item_id] || 0)) })).filter((i) => i.take > 0);
  const estimate = chosen.reduce((s, i) => s + i.take * i.unit_total, 0);
  const fromBalance = Math.min(estimate, options?.balance_due ?? 0);
  const canRestock = chosen.some((i) => i.tracks_stock);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const note = await api(`/invoices/${invoice.invoice_id}/credit-notes`, {
        method: 'POST', idempotencyKey: idem.get(),
        body: { reason, restock: restock && canRestock, refund: settle === 'refund' ? { method } : undefined, items: chosen.map((i) => ({ item_id: i.item_id, quantity: i.take })) }
      });
      idem.settle();
      toast.success(`${note.cn_number} issued for ${formatCurrency(note.total)}`);
      onIssued(note);
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Credit note — ${invoice.invoice_number}`} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        {!options ? <p className="text-sm text-ink-400">Loading…</p> : (
          <>
            <p className="text-sm text-ink-600">Choose what is being returned or corrected. GST on those items is reversed, and the credit note gets its own number.</p>
            <div className="space-y-2">
              {options.items.map((i) => (
                <div key={i.item_id} className="grid grid-cols-[1fr_7rem] items-center gap-3 rounded-lg border border-line p-3">
                  <div>
                    <p className="text-sm font-medium text-ink-900">{i.description}</p>
                    <p className="text-xs text-ink-500">Sold {i.quantity} · {formatCurrency(i.unit_total)} each{i.tax_rate ? ` (GST ${i.tax_rate}% included)` : ''} · {i.remaining} left to credit</p>
                  </div>
                  <Input type="number" min="0" max={i.remaining} step="0.001" placeholder="0" disabled={i.remaining <= 0} value={qty[i.item_id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [i.item_id]: e.target.value }))} aria-label={`Quantity of ${i.description} to credit`} />
                </div>
              ))}
            </div>

            <Field id="cn-reason" label="Reason" hint="Printed on the credit note."><Input id="cn-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong item served, returned unopened" required /></Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="cn-settle" label="What happens to the money">
                <Select id="cn-settle" value={settle} onChange={(e) => setSettle(e.target.value)}>
                  <option value="none">Just the credit note (no money moves)</option>
                  <option value="refund">Pay back what was already paid</option>
                </Select>
              </Field>
              {settle === 'refund' && (
                <Field id="cn-method" label="Refund by"><Select id="cn-method" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</Select></Field>
              )}
            </div>
            {canRestock && (
              <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" /> Put the returned items back in stock</label>
            )}

            <div className="rounded-lg bg-surface-2 p-3 text-sm text-ink-700">
              <p>About <strong>{formatCurrency(estimate)}</strong> will be credited{fromBalance > 0 ? `; ${formatCurrency(fromBalance)} of it comes off what the customer still owes` : ''}.</p>
              <p className="mt-1 text-xs text-ink-400">The exact amount, tax split and any share of a bill discount are worked out when you issue it. An invoice with a credit note can’t be cancelled.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy || !chosen.length || !reason.trim()}>{busy ? 'Issuing…' : 'Issue credit note'}</Button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
};

export default CreditNoteModal;
