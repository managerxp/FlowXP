/*
 * Debit notes raised against suppliers: goods sent back and price corrections.
 * (Raise one from an order on the Purchases page.)
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { Alert, Badge, Button, ListState, Modal, PageHeader, Table, Td, Th, Thead, Tr } from '../components/ui.jsx';

const Detail = ({ id, onClose }) => {
  const [n, setN] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/debit-notes/${id}`).then(setN).catch((e) => setError(e.message)); }, [id]);
  return (
    <Modal title={n ? `${n.dn_number} — ${n.supplier_name || 'Supplier'}` : 'Debit note'} onClose={onClose}>
      <Alert>{error}</Alert>
      {n && (
        <div className="space-y-3 text-sm">
          <p className="text-ink-600">{n.kind === 'RETURN' ? 'Goods returned' : 'Price correction'} on {n.po_number} · {String(n.dn_date).slice(0, 10)}</p>
          <p className="rounded-lg bg-surface-2 p-3 text-ink-700">{n.reason}</p>
          <Table>
            <Thead><Th>Item</Th><Th className="text-right">Qty</Th><Th className="text-right">Rate</Th><Th className="text-right">Tax</Th><Th className="text-right">Total</Th></Thead>
            <tbody>{n.items.map((i, k) => <Tr key={k}><Td>{i.description}</Td><Td className="text-right">{i.quantity}</Td><Td className="text-right">{formatCurrency(i.unit_cost)}</Td><Td className="text-right">{formatCurrency(i.tax)}</Td><Td className="text-right">{formatCurrency(i.total)}</Td></Tr>)}</tbody>
          </Table>
          <div className="space-y-1 text-right">
            <p>Subtotal {formatCurrency(n.subtotal)} · Tax {formatCurrency(n.tax)}</p>
            <p className="text-base font-bold text-ink-900">Total {formatCurrency(n.total)}</p>
            <p className="text-ink-500">Taken off what you owed: {formatCurrency(n.applied)}{n.credit > 0 && <> · <span className="font-semibold text-success">Credit from the supplier: {formatCurrency(n.credit)}</span></>}</p>
          </div>
          <div className="flex justify-end"><Button variant="secondary" onClick={() => window.print()}>Print</Button></div>
        </div>
      )}
    </Modal>
  );
};

const DebitNotesPage = () => {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  useEffect(() => { api('/debit-notes').then(setRows).catch((e) => setError(e.message)); }, []);
  return (
    <div>
      <PageHeader title="Debit notes" lead="Goods sent back and price corrections against suppliers. Raise one from an order on the Purchases page." action={<Button variant="secondary" to="/app/purchases">← Purchases</Button>} />
      <ListState loading={!rows && !error} error={error} empty={rows?.length === 0} emptyLabel="No debit notes yet." />
      {rows?.length > 0 && (
        <Table>
          <Thead><Th>Note</Th><Th>Date</Th><Th>Supplier</Th><Th>Order</Th><Th>For</Th><Th className="text-right">Total</Th><Th className="text-right">Credit</Th></Thead>
          <tbody>
            {rows.map((n) => (
              <Tr key={n.dn_id} onClick={() => setOpen(n.dn_id)}>
                <Td className="font-medium">{n.dn_number}</Td>
                <Td className="text-ink-500">{String(n.dn_date).slice(0, 10)}</Td>
                <Td>{n.supplier_name || '—'}</Td>
                <Td>{n.po_number}</Td>
                <Td><Badge tone={n.kind === 'RETURN' ? 'warning' : 'brand'}>{n.kind === 'RETURN' ? 'Goods back' : 'Price'}</Badge></Td>
                <Td className="text-right">{formatCurrency(n.total)}</Td>
                <Td className={`text-right ${n.credit > 0 ? 'font-semibold text-success' : 'text-ink-400'}`}>{formatCurrency(n.credit)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

export default DebitNotesPage;
