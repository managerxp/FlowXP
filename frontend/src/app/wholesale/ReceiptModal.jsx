/*
 * Record money received from a customer. One payment can settle several invoices: the oldest are paid first unless you
 * choose which ones; whatever is not allocated stays as the customer’s advance, to be applied to a later invoice.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { PAYMENT_METHODS, dateText, money, todayIn } from '../../lib/wholesale.js';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { Alert, Button, Field, Input, Modal, Select, Skeleton, useToast } from '../../components/ui.jsx';
import { CustomerPicker, NumberField, Segmented } from './parts.jsx';

const ReceiptModal = ({ customer: initial = null, onClose, onDone }) => {
  const toast = useToast();
  const key = useIdempotencyKey();
  const [customer, setCustomer] = useState(initial);
  const [open, setOpen] = useState(null);
  const [f, setF] = useState({ amount: '', method: 'UPI', reference: '', bank: '', cheque_date: '', receipt_date: todayIn(), notes: '' });
  const [how, setHow] = useState('OLDEST');           // OLDEST | CHOOSE | NONE
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!customer) { setOpen(null); return undefined; }
    let live = true;
    api(`/wholesale/customers/${customer.customer_id}/open-invoices`).then((d) => { if (live) setOpen(d); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [customer]);

  const amount = Number(f.amount) || 0;
  const chosen = useMemo(() => Object.entries(picked).map(([id, v]) => ({ invoice_id: Number(id), amount: Number(v) || 0 })).filter((x) => x.amount > 0), [picked]);
  const chosenTotal = chosen.reduce((s, x) => s + x.amount, 0);
  const owed = open?.invoices.reduce((s, i) => s + i.balance, 0) || 0;
  const plan = useMemo(() => {
    if (!open || !amount) return [];
    if (how === 'CHOOSE') return chosen;
    if (how === 'NONE') return [];
    let left = amount; const out = [];
    for (const i of open.invoices) { if (left <= 0) break; const take = Math.min(left, i.balance); out.push({ invoice_id: i.invoice_id, amount: Math.round(take * 100) / 100 }); left = Math.round((left - take) * 100) / 100; }
    return out;
  }, [open, amount, how, chosen]);
  const allocated = plan.reduce((s, x) => s + x.amount, 0);
  const advance = Math.max(0, Math.round((amount - allocated) * 100) / 100);

  const setF1 = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const chooseAuto = () => { const next = {}; let left = amount; for (const i of open?.invoices || []) { if (left <= 0) break; const take = Math.min(left, i.balance); next[i.invoice_id] = String(Math.round(take * 100) / 100); left -= take; } setPicked(next); };

  const submit = async (e) => {
    e.preventDefault();
    if (how === 'CHOOSE' && chosenTotal > amount + 0.001) { setError('You have allocated more than the amount received.'); return; }
    setBusy(true); setError('');
    try {
      const body = { customer_id: customer.customer_id, amount, method: f.method, reference: f.reference || undefined, bank: f.bank || undefined, cheque_date: f.cheque_date || undefined, receipt_date: f.receipt_date, notes: f.notes || undefined,
        ...(how === 'CHOOSE' ? { allocations: chosen } : { allocate: how }) };
      const r = await api('/wholesale/receipts', { method: 'POST', body, idempotencyKey: key.get() });
      key.settle(null);
      toast.success(`Receipt ${r.receipt_number} saved${r.advance > 0 ? ` · ${money(r.advance)} kept as advance` : ''}`);
      onDone?.(r);
    } catch (err) { key.settle(err); setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Record a payment" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <Alert>{error}</Alert>
        <Field id="rc-customer" label="Customer"><CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setPicked({}); }} id="rc-customer" disabled={Boolean(initial)} /></Field>
        {customer && !open && !error && <Skeleton className="h-24" />}
        {open && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField id="rc-amount" label="Amount received" prefix="₹" value={f.amount} onChange={setF1('amount')} required min={0.01} />
              <Field id="rc-method" label="Method"><Select id="rc-method" value={f.method} onChange={setF1('method')}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field id="rc-date" label="Date"><Input id="rc-date" type="date" max={todayIn()} value={f.receipt_date} onChange={setF1('receipt_date')} /></Field>
              <Field id="rc-ref" label={f.method === 'CHEQUE' ? 'Cheque number' : f.method === 'CASH' ? 'Reference' : 'Transaction reference'}><Input id="rc-ref" value={f.reference} onChange={setF1('reference')} required={['CHEQUE', 'BANK_TRANSFER', 'UPI'].includes(f.method)} maxLength={80} /></Field>
              {f.method === 'CHEQUE' && <><Field id="rc-bank" label="Bank"><Input id="rc-bank" value={f.bank} onChange={setF1('bank')} /></Field><Field id="rc-cdate" label="Cheque date"><Input id="rc-cdate" type="date" value={f.cheque_date} onChange={setF1('cheque_date')} /></Field></>}
              <div className="sm:col-span-3"><Field id="rc-notes" label="Notes"><Input id="rc-notes" value={f.notes} onChange={setF1('notes')} maxLength={300} /></Field></div>
            </div>
            <div className="rounded-(--radius-card) border border-line">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div><p className="text-small font-semibold text-ink-900">Which invoices does this pay?</p><p className="text-caption text-ink-500">{open.invoices.length ? `${open.invoices.length} open · ${money(owed)} due` : 'No open invoices.'}{open.advance > 0 ? ` · ${money(open.advance)} advance already held` : ''}</p></div>
                <Segmented label="Allocation" size="sm" value={how} onChange={(v) => { setHow(v); if (v === 'CHOOSE' && !chosen.length) chooseAuto(); }} options={[{ value: 'OLDEST', label: 'Oldest first' }, { value: 'CHOOSE', label: 'I’ll choose' }, { value: 'NONE', label: 'Keep as advance' }]} />
              </div>
              {open.invoices.length > 0 && (
                <ul className="divide-y divide-line">
                  {open.invoices.map((i) => {
                    const alloc = plan.find((p) => p.invoice_id === i.invoice_id)?.amount || 0;
                    return (
                      <li key={i.invoice_id} className="flex items-center gap-3 px-4 py-2 text-small">
                        <span className="min-w-0 flex-1"><span className="font-medium text-ink-900">{i.invoice_number}</span><span className="ml-2 text-caption text-ink-500">{dateText(i.invoice_date)} · due {dateText(i.due_date)}{i.days_overdue > 0 ? <span className="text-danger"> · {i.days_overdue} days late</span> : ''}</span></span>
                        <span className="tabular w-24 text-right text-ink-700">{money(i.balance)}</span>
                        {how === 'CHOOSE'
                          ? <div className="w-28"><Input aria-label={`Amount against ${i.invoice_number}`} type="number" min="0" max={i.balance} step="any" value={picked[i.invoice_id] ?? ''} onChange={(e) => setPicked((p) => ({ ...p, [i.invoice_id]: e.target.value }))} className="text-right" /></div>
                          : <span className={`tabular w-28 text-right ${alloc ? 'font-semibold text-success' : 'text-ink-300'}`}>{alloc ? `− ${money(alloc)}` : '—'}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5 text-small">
                <span>Settles <strong className="tabular">{money(allocated)}</strong></span>
                <span className={advance > 0 ? 'font-semibold text-brand-700' : 'text-ink-500'}>{advance > 0 ? `${money(advance)} stays as advance` : 'Nothing left over'}</span>
              </div>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} disabled={!customer || !open || amount <= 0}>Save payment</Button></div>
      </form>
    </Modal>
  );
};

export default ReceiptModal;
