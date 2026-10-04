/*
 * A debit note against a purchase order that has arrived: goods sent back to the supplier, or a price
 * overcharge. It lowers what you owe them (and, for returns, takes the stock back out).
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { Alert, Button, Field, Input, Modal, Select, useToast, PageLoader } from './ui.jsx';

const DebitNoteModal = ({ poId, poNumber, onClose, onDone }) => {
  const toast = useToast();
  const key = useIdempotencyKey();
  const [kind, setKind] = useState('RETURN');
  const [options, setOptions] = useState(null);
  const [rows, setRows] = useState({});          // item_id -> { quantity, unit_cost }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api(`/purchases/${poId}/debit-notes/options`).then(setOptions).catch((e) => setError(e.message)); }, [poId]);
  useEffect(() => { setRows({}); }, [kind]);

  const set = (id, field, value) => setRows((r) => ({ ...r, [id]: { ...r[id], [field]: value } }));
  const chosen = (options?.items || []).filter((i) => Number(rows[i.item_id]?.quantity) > 0);
  const estimate = chosen.reduce((s, i) => {
    const q = Number(rows[i.item_id].quantity);
    const unit = kind === 'RETURN' ? i.unit_cost : Number(rows[i.item_id].unit_cost || 0);
    return s + q * unit * (1 + i.tax_rate / 100);
  }, 0);

  const save = async () => {
    setBusy(true); setError('');
    try {
      const note = await api(`/purchases/${poId}/debit-notes`, {
        method: 'POST', idempotencyKey: key.get(),
        body: { kind, reason, items: chosen.map((i) => ({ item_id: i.item_id, quantity: Number(rows[i.item_id].quantity), unit_cost: kind === 'PRICE' ? Number(rows[i.item_id].unit_cost) : undefined })) }
      });
      key.settle();
      toast.success(`${note.dn_number} issued for ${formatCurrency(note.total)}${note.credit > 0 ? `. ${formatCurrency(note.credit)} is a credit, because the order was already paid.` : ''}`);
      onDone(note);
    } catch (caught) { key.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Debit note — ${poNumber}`} onClose={onClose} wide>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="dn-kind" label="What is it for?">
          <Select id="dn-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="RETURN">Goods sent back to the supplier</option>
            <option value="PRICE">A price overcharge</option>
          </Select>
        </Field>
        {!options && !error && <PageLoader compact />}
        {options && (
          <div className="space-y-2">
            <p className="text-xs text-ink-500">{kind === 'RETURN' ? 'Enter how many of each item go back. Stock is reduced and tax reversed at the same rate as the purchase.' : 'Enter how many units were overcharged and the extra you were charged per unit.'}</p>
            {options.items.map((i) => (
              <div key={i.item_id} className="grid grid-cols-12 items-center gap-2">
                <span className="col-span-5 text-sm text-ink-900">{i.description}<span className="block text-xs text-ink-400">arrived {i.received}{kind === 'RETURN' ? ` · returned ${i.returned}` : ''} · {formatCurrency(i.unit_cost)} each</span></span>
                <Input className={kind === 'PRICE' ? 'col-span-3' : 'col-span-4'} type="number" min="0" max={kind === 'RETURN' ? i.returnable : i.received} step="0.001" placeholder={kind === 'RETURN' ? `Up to ${i.returnable}` : 'Units'} value={rows[i.item_id]?.quantity ?? ''} onChange={(e) => set(i.item_id, 'quantity', e.target.value)} disabled={kind === 'RETURN' && i.returnable <= 0} aria-label={`Quantity of ${i.description}`} />
                {kind === 'PRICE' && <Input className="col-span-4" type="number" min="0" step="0.01" placeholder="Extra ₹ per unit" value={rows[i.item_id]?.unit_cost ?? ''} onChange={(e) => set(i.item_id, 'unit_cost', e.target.value)} aria-label={`Overcharge per unit for ${i.description}`} />}
              </div>
            ))}
          </div>
        )}
        <Field id="dn-reason" label="Reason" hint="The supplier will read this."><Input id="dn-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={kind === 'RETURN' ? 'Damaged on arrival, wrong item…' : 'Charged above the agreed rate…'} /></Field>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-sm text-ink-700">About <strong className="text-ink-900">{formatCurrency(estimate)}</strong> off what you owe (with tax)</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={busy || !chosen.length || !reason.trim()} onClick={save}>{busy ? 'Saving…' : 'Issue debit note'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default DebitNoteModal;
