/*
 * Suppliers: the mirror of CustomersPage.jsx — payable balance instead of
 * outstanding, nothing else is different enough to share a component over.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { Alert, Button, Field, Input, ListState, Modal, PageHeader, Table, Td, Th, Thead, Tr } from '../components/ui.jsx';

const emptyForm = { name: '', phone: '', email: '', address: '', gstin: '' };

const SupplierForm = ({ initial, onSaved, onClose }) => {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isEdit = Boolean(initial.supplier_id);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      if (isEdit) await api(`/suppliers/${initial.supplier_id}`, { method: 'PATCH', body: form });
      else await api('/suppliers', { method: 'POST', body: form });
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={isEdit ? 'Edit supplier' : 'Add supplier'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="name" label="Name"><Input id="name" value={form.name} onChange={set('name')} required autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="phone" label="Phone"><Input id="phone" type="tel" value={form.phone} onChange={set('phone')} /></Field>
          <Field id="email" label="Email" hint="Optional"><Input id="email" type="email" value={form.email} onChange={set('email')} /></Field>
        </div>
        <Field id="address" label="Address" hint="Optional"><Input id="address" value={form.address} onChange={set('address')} /></Field>
        <Field id="gstin" label="GSTIN" hint="Optional"><Input id="gstin" value={form.gstin} onChange={set('gstin')} maxLength={15} className="uppercase" /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add supplier'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const SuppliersPage = () => {
  const [suppliers, setSuppliers] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const params = new URLSearchParams(); if (search) params.set('search', search);
      setSuppliers(await api(`/suppliers?${params}`));
    } catch (caught) { setError(caught.message); }
  };
  useEffect(() => { load(); }, [search]);

  return (
    <div>
      <PageHeader title="Suppliers" lead="Who you buy from, and what you owe them." action={<Button onClick={() => setEditing({})}>Add supplier</Button>} />
      <Input placeholder="Search by name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-4 max-w-xs" />
      <ListState loading={!suppliers && !error} error={error} empty={suppliers?.length === 0} emptyLabel="No suppliers yet." />
      {suppliers?.length > 0 && (
        <Table>
          <Thead><Th>Name</Th><Th>Phone</Th><Th className="text-right">Total purchases</Th><Th className="text-right">Payable</Th><Th></Th></Thead>
          <tbody>
            {suppliers.map((s) => (
              <Tr key={s.supplier_id}>
                <Td className="font-medium">{s.name}</Td>
                <Td className="text-ink-500">{s.phone || '—'}</Td>
                <Td className="text-right">{formatCurrency(s.total_purchases)}</Td>
                <Td className={`text-right ${s.payable_balance > 0 ? 'font-semibold text-warning' : 'text-ink-400'}`}>
                  {formatCurrency(s.payable_balance)}
                </Td>
                <Td className="text-right"><button onClick={() => setEditing(s)} className="text-xs font-semibold text-brand-600">Edit</button></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <SupplierForm
          initial={editing.supplier_id ? editing : emptyForm}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
};

export default SuppliersPage;
