/*
 * Returns: goods coming back from a customer (a credit note on the invoice) and goods going back to a supplier (a debit
 * note on the purchase order). Each line says what happens to the goods — back on the shelf (in the batch they came
 * from), held as damaged or expired, or not physically returned.
 */
import { useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { PAYMENT_METHODS, RETURN_REASONS, dateText, money, qty, useLoad } from '../../lib/wholesale.js';
import { Alert, Button, Field, Input, ListState, Modal, Select, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { useAction } from './parts.jsx';

const DISPOSITIONS = { RESTOCK: 'Back on the shelf', DAMAGED: 'Damaged (hold aside)', EXPIRED: 'Expired (hold aside)', NONE: 'Not physically returned' };

export const SalesReturnModal = ({ invoiceId, onClose, onDone }) => {
  const { data: inv, loading, error } = useLoad(`/wholesale/invoices/${invoiceId}/returnable`);
  const [rows, setRows] = useState({});
  const [reason, setReason] = useState('DAMAGED');
  const [notes, setNotes] = useState('');
  const [refund, setRefund] = useState('');
  const [busy, run] = useAction();
  const set = (id, patch) => setRows((r) => ({ ...r, [id]: { quantity: '', disposition: reason === 'DAMAGED' ? 'DAMAGED' : reason === 'EXPIRED' ? 'EXPIRED' : 'RESTOCK', batch_id: '', ...r[id], ...patch } }));
  const lines = useMemo(() => (inv?.items || []).filter((i) => Number(rows[i.item_id]?.quantity) > 0), [inv, rows]);
  const estimate = lines.reduce((s, i) => s + Number(rows[i.item_id].quantity) * i.unit_price * (1 + i.tax_rate / 100), 0);
  const submit = async () => {
    const out = await run(() => api('/wholesale/returns/sales', { method: 'POST', body: { invoice_id: invoiceId, reason, notes: notes || undefined, refund: refund ? { method: refund } : undefined,
      items: lines.map((i) => ({ invoice_item_id: i.item_id, quantity: Number(rows[i.item_id].quantity), disposition: rows[i.item_id].disposition, batch_id: rows[i.item_id].batch_id ? Number(rows[i.item_id].batch_id) : undefined })) } }), 'Return recorded');
    if (out) onDone(out);
  };
  return (
    <Modal title={inv ? `Return against ${inv.invoice_number}` : 'Return'} onClose={onClose} wide>
      <Alert>{error}</Alert>
      <ListState loading={loading && !inv} />
      {inv && (
        <div className="space-y-4">
          {inv.status === 'CANCELLED' && <Alert>This invoice was cancelled and cannot be returned against.</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sr-reason" label="Reason"><Select id="sr-reason" value={reason} onChange={(e) => setReason(e.target.value)}>{Object.entries(RETURN_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field id="sr-notes" label="Notes"><Input id="sr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
          </div>
          <Table>
            <Thead><Th>Item</Th><Th className="text-right">Can return</Th><Th className="text-right">Return</Th><Th>The goods are</Th></Thead>
            <tbody>
              {inv.items.map((i) => {
                const r = rows[i.item_id] || {};
                return (
                  <Tr key={i.item_id}>
                    <Td><span className="font-medium">{i.description}</span><span className="block text-caption text-ink-500">{money(i.unit_price)} per {i.unit_name || 'unit'}{i.tax_rate ? ` + ${i.tax_rate}% GST` : ''}</span></Td>
                    <Td className="text-right tabular">{qty(i.returnable)} {i.unit_name}</Td>
                    <Td className="text-right"><div className="ml-auto w-24"><Input aria-label={`Return quantity of ${i.description}`} type="number" min="0" max={i.returnable} step="any" disabled={i.returnable <= 0} value={r.quantity ?? ''} onChange={(e) => set(i.item_id, { quantity: e.target.value })} className="text-right" /></div></Td>
                    <Td>{Number(r.quantity) > 0 && <div className="flex flex-wrap gap-2"><div className="w-48"><Select aria-label="What happens to the goods" value={r.disposition ?? 'RESTOCK'} onChange={(e) => set(i.item_id, { disposition: e.target.value })}>{Object.entries(DISPOSITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
                      {(r.disposition ?? 'RESTOCK') === 'RESTOCK' && i.batches.length > 1 && <div className="w-48"><Select aria-label="Batch" value={r.batch_id ?? ''} onChange={(e) => set(i.item_id, { batch_id: e.target.value })}><option value="">Which batch?</option>{i.batches.map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_no}{b.expiry_date ? ` · exp ${dateText(b.expiry_date, { day: 'numeric', month: 'short', year: '2-digit' })}` : ''}</option>)}</Select></div>}</div>}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-surface-2 px-4 py-3 text-small"><p className="text-caption text-ink-500">Credit note (estimate, exact amount is worked out when saved)</p><p className="tabular text-title font-semibold">{money(Math.round(estimate * 100) / 100)}</p><p className="text-caption text-ink-500">It first reduces what the customer still owes on the invoice ({money(inv.balance_due)}).</p></div>
            <Field id="sr-refund" label="Refund any excess now" hint="Only if they have already paid more than they now owe"><Select id="sr-refund" value={refund} onChange={(e) => setRefund(e.target.value)}><option value="">No — keep it as credit</option>{Object.entries(PAYMENT_METHODS).filter(([k]) => k !== 'CHEQUE').map(([k, v]) => <option key={k} value={k}>Refund by {v.toLowerCase()}</option>)}</Select></Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!lines.length || inv.status === 'CANCELLED'}>Issue credit note</Button></div>
        </div>
      )}
    </Modal>
  );
};

export const PurchaseReturnModal = ({ poId, onClose, onDone }) => {
  const { data: po, loading, error } = useLoad(`/wholesale/purchase-orders/${poId}`);
  const opts = useLoad(`/wholesale/purchase-orders/${poId}/debit-notes/options`);
  const [rows, setRows] = useState({});
  const [reason, setReason] = useState('QUALITY');
  const [notes, setNotes] = useState('');
  const [busy, run] = useAction();
  const lines = (opts.data?.items || []).filter((i) => Number(rows[i.item_id]) > 0);
  const total = lines.reduce((s, i) => s + Number(rows[i.item_id]) * i.unit_cost * (1 + i.tax_rate / 100), 0);
  const submit = async () => {
    const out = await run(() => api('/wholesale/returns/purchase', { method: 'POST', body: { po_id: poId, reason, notes: notes || undefined, items: lines.map((i) => ({ po_item_id: i.item_id, quantity: Number(rows[i.item_id]) })) } }), 'Return recorded');
    if (out) onDone(out);
  };
  return (
    <Modal title={po ? `Return goods from ${po.po_number}` : 'Return'} onClose={onClose} wide>
      <Alert>{error || opts.error}</Alert>
      <ListState loading={(loading || opts.loading) && !opts.data} />
      {opts.data && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pr-reason" label="Reason"><Select id="pr-reason" value={reason} onChange={(e) => setReason(e.target.value)}>{Object.entries(RETURN_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field id="pr-notes" label="Notes for the supplier"><Input id="pr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
          </div>
          <Table><Thead><Th>Item</Th><Th className="text-right">Received</Th><Th className="text-right">Already returned</Th><Th className="text-right">Return</Th></Thead>
            <tbody>{opts.data.items.map((i) => <Tr key={i.item_id}><Td><span className="font-medium">{i.description}</span><span className="block text-caption text-ink-500">{money(i.unit_cost)} each{i.tax_rate ? ` + ${i.tax_rate}% GST` : ''}</span></Td><Td className="text-right tabular">{qty(i.received)}</Td><Td className="text-right tabular">{i.returned ? qty(i.returned) : '—'}</Td>
              <Td className="text-right"><div className="ml-auto w-24"><Input aria-label={`Return quantity of ${i.description}`} type="number" min="0" max={i.returnable} step="any" disabled={i.returnable <= 0} value={rows[i.item_id] ?? ''} onChange={(e) => setRows({ ...rows, [i.item_id]: e.target.value })} className="text-right" /></div></Td></Tr>)}</tbody></Table>
          <div className="rounded-lg bg-surface-2 px-4 py-3 text-small"><p className="text-caption text-ink-500">Debit note value</p><p className="tabular text-title font-semibold">{money(Math.round(total * 100) / 100)}</p><p className="text-caption text-ink-500">It reduces what you owe this supplier. The goods leave your stock (oldest batch first unless you name one).</p></div>
          <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!lines.length}>Issue debit note</Button></div>
        </div>
      )}
    </Modal>
  );
};
