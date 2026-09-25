/*
 * Invoice history: filter and click through to a single invoice.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatCurrency } from '../../lib/api.js';
import { Button, Input, ListState, PageHeader, Select, StatusBadge, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';

const InvoicesPage = () => {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('payment_status', status);
    api(`/invoices?${params}`).then(setInvoices).catch((caught) => setError(caught.message));
  }, [search, status]);

  return (
    <div>
      <PageHeader title="Invoices" lead="Every bill you've raised." action={<div className="flex gap-2"><Button variant="secondary" to="/app/billing/credit-notes">Credit notes</Button><Button to="/app/billing">New sale</Button></div>} />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input placeholder="Search invoice # or customer…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-40">
          <option value="">All payment status</option>
          <option value="PAID">Paid</option>
          <option value="PARTIAL">Partial</option>
          <option value="UNPAID">Unpaid</option>
        </Select>
      </div>

      <ListState loading={!invoices && !error} error={error} empty={invoices?.length === 0} emptyLabel="No invoices yet." />

      {invoices?.length > 0 && (
        <Table>
          <Thead><Th>Invoice #</Th><Th>Date</Th><Th>Customer</Th><Th className="text-right">Total</Th><Th>Payment</Th><Th>Status</Th></Thead>
          <tbody>
            {invoices.map((inv) => (
              <Tr key={inv.invoice_id} onClick={() => navigate(`/app/billing/invoices/${inv.invoice_id}`)}>
                <Td className="font-medium text-brand-600">{inv.invoice_number}</Td>
                <Td className="text-ink-500">{inv.invoice_date}</Td>
                <Td>{inv.customer_name || 'Walk-in'}</Td>
                <Td className="text-right font-semibold">{formatCurrency(inv.total)}</Td>
                <Td><StatusBadge status={inv.payment_status} /></Td>
                <Td><StatusBadge status={inv.status} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

export default InvoicesPage;
