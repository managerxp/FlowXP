/*
 * Customers: contact record, outstanding balance, purchase history.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { Alert, Button, Card, Field, Input, ListState, Modal, PageHeader, Table, Td, Th, Thead, Tr } from '../components/ui.jsx';

const emptyForm = { name: '', phone: '', email: '', address: '', state: '', gstin: '', credit_limit: '' };

const CustomerForm = ({ initial, onSaved, onClose }) => {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isEdit = Boolean(initial.customer_id);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const body = { ...form, credit_limit: form.credit_limit || 0 };
      if (isEdit) await api(`/customers/${initial.customer_id}`, { method: 'PATCH', body });
      else await api('/customers', { method: 'POST', body });
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={isEdit ? 'Edit customer' : 'Add customer'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="name" label="Name"><Input id="name" value={form.name} onChange={set('name')} required autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="phone" label="Phone"><Input id="phone" type="tel" value={form.phone} onChange={set('phone')} /></Field>
          <Field id="email" label="Email" hint="Optional"><Input id="email" type="email" value={form.email} onChange={set('email')} /></Field>
        </div>
        <Field id="address" label="Address" hint="Optional"><Input id="address" value={form.address} onChange={set('address')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="state" label="State" hint="For GST — decides CGST/SGST vs IGST"><Input id="state" value={form.state} onChange={set('state')} /></Field>
          <Field id="gstin" label="GSTIN" hint="Optional"><Input id="gstin" value={form.gstin} onChange={set('gstin')} maxLength={15} className="uppercase" /></Field>
        </div>
        <Field id="credit_limit" label="Credit limit (₹)" hint="Advisory only — 0 means no limit">
          <Input id="credit_limit" type="number" min="0" step="0.01" value={form.credit_limit} onChange={set('credit_limit')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add customer'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const CustomersPage = () => {
  const [customers, setCustomers] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const params = new URLSearchParams(); if (search) params.set('search', search);
      setCustomers(await api(`/customers?${params}`));
    } catch (caught) { setError(caught.message); }
  };
  useEffect(() => { load(); }, [search]);

  return (
    <div>
      <PageHeader title="Customers" lead="Who buys from you, and what they owe." action={<Button onClick={() => setEditing({})}>Add customer</Button>} />
      <Input placeholder="Search by name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-4 max-w-xs" />
      <ListState loading={!customers && !error} error={error} empty={customers?.length === 0} emptyLabel="No customers yet." />
      {customers?.length > 0 && (
        <Table>
          <Thead><Th>Name</Th><Th>Phone</Th><Th className="text-right">Total purchases</Th><Th className="text-right">Outstanding</Th><Th></Th></Thead>
          <tbody>
            {customers.map((c) => (
              <Tr key={c.customer_id}>
                <Td className="font-medium">{c.name}</Td>
                <Td className="text-ink-500">{c.phone || '—'}</Td>
                <Td className="text-right">{formatCurrency(c.total_purchases)}</Td>
                <Td className={`text-right ${c.outstanding_balance > 0 ? 'font-semibold text-warning' : 'text-ink-400'}`}>
                  {formatCurrency(c.outstanding_balance)}
                </Td>
                <Td className="text-right"><button onClick={() => setEditing(c)} className="text-xs font-semibold text-brand-600">Edit</button></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <CustomerForm
          initial={editing.customer_id ? { ...editing, credit_limit: String(editing.credit_limit || '') } : emptyForm}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
};

export default CustomersPage;
