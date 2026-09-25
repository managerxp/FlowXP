/*
 * Every payment taken, across every method and source. Recording a payment
 * against a specific invoice happens from the invoice itself (InvoiceDetail);
 * the form here is for a standalone payment — an advance, or a balance
 * settled before FlowXP existed — which is why it always asks for a customer.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { Alert, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr } from '../components/ui.jsx';

const METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CREDIT', 'OTHER'];

const PaymentForm = ({ customers, onSaved, onClose }) => {
  const [form, setForm] = useState({ customer_id: '', amount: '', method: 'CASH', reference_number: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const idem = useIdempotencyKey();

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/payments', { method: 'POST', idempotencyKey: idem.get(), body: { ...form, customer_id: Number(form.customer_id) } });
      idem.settle();
      onSaved();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Record a payment" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="customer_id" label="Customer" hint="For an advance, or a balance settled outside an invoice">
          <Select id="customer_id" value={form.customer_id} onChange={set('customer_id')} required>
            <option value="" disabled>Choose a customer…</option>
            {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="amount" label="Amount (₹)">
            <Input id="amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} required />
          </Field>
          <Field id="method" label="Method">
            <Select id="method" value={form.method} onChange={set('method')}>
              {METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </Select>
          </Field>
        </div>
        <Field id="reference_number" label="Reference number" hint="UPI/transaction ID, optional">
          <Input id="reference_number" value={form.reference_number} onChange={set('reference_number')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const PaymentsPage = () => {
  const [payments, setPayments] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try {
      const [list, custs] = await Promise.all([api('/payments'), api('/customers')]);
      setPayments(list); setCustomers(custs);
    } catch (caught) { setError(caught.message); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Payments" lead="Every rupee collected, across every method." action={<Button onClick={() => setAdding(true)}>Record payment</Button>} />
      <ListState loading={!payments && !error} error={error} empty={payments?.length === 0} emptyLabel="No payments recorded yet." />
      {payments?.length > 0 && (
        <Table>
          <Thead><Th>Date</Th><Th>Customer</Th><Th>Invoice</Th><Th>Method</Th><Th className="text-right">Amount</Th></Thead>
          <tbody>
            {payments.map((p) => (
              <Tr key={p.payment_id}>
                <Td className="text-ink-500">{p.date}</Td>
                <Td>{p.customer_name || '—'}</Td>
                <Td className="text-ink-500">{p.invoice_number || <span className="text-ink-400">Standalone</span>}</Td>
                <Td>{p.method.replace('_', ' ')}</Td>
                <Td className="text-right font-semibold">{formatCurrency(p.amount)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding && <PaymentForm customers={customers} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
};

export default PaymentsPage;
