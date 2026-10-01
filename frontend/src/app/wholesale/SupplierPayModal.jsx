/* Pay a supplier against a received purchase order. */
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { PAYMENT_METHODS, money } from '../../lib/wholesale.js';
import { Button, Field, Input, Modal, Select } from '../../components/ui.jsx';
import { NumberField, useAction } from './parts.jsx';

export const SupplierPayModal = ({ po, onClose, onDone }) => {
  const [f, setF] = useState({ amount: String(po.balance), method: 'BANK_TRANSFER', reference: '' });
  const [busy, run] = useAction();
  return (
    <Modal title="Pay the supplier" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-small text-ink-500">{po.supplier} · {po.po_number} · {money(po.balance)} still owed</p>
        <NumberField id="sp-amt" label="Amount" prefix="₹" min={0.01} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        <Field id="sp-method" label="Method"><Select id="sp-method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field id="sp-ref" label={f.method === 'CHEQUE' ? 'Cheque number' : 'Reference'}><Input id="sp-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={80} /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!(Number(f.amount) > 0)} onClick={async () => { const r = await run(() => api(`/wholesale/purchase-orders/${po.po_id}/payments`, { method: 'POST', body: { amount: Number(f.amount), method: f.method, reference_number: f.reference || undefined }, idempotencyKey: `pay-${po.po_id}-${po.paid}-${f.amount}` }), 'Payment recorded'); if (r) onDone(); }}>Record payment</Button></div>
      </div>
    </Modal>
  );
};

export default SupplierPayModal;
