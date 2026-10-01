/*
 * Goods receipts: the direct-purchase history (no purchase order list exists for pharmacy — see
 * backend/src/routes/pharmacy.routes.js). Receive new stock, or open a past receipt to see what it contained.
 */
import { useState } from 'react';
import { Plus, Truck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { dateText, money, qty, useLoad } from '../../lib/pharmacy.js';
import { Alert, Button, ListState, Modal, PageHeader, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Pager } from './parts.jsx';
import PharmacyGrnModal from './PharmacyGrnModal.jsx';

const GrnDetail = ({ id, onClose }) => {
  const { data, loading, error } = useLoad(`/pharmacy/grn/${id}`);
  return (
    <Modal title={data ? data.grn_number : 'Goods receipt'} onClose={onClose} wide>
      <Alert>{error}</Alert>
      {loading && !data && <p className="py-6 text-center text-small text-ink-500">Loading…</p>}
      {data && (
        <div className="space-y-4">
          <div className="grid gap-3 text-small sm:grid-cols-2">
            <p><span className="text-ink-500">Supplier</span><br /><span className="font-medium text-ink-900">{data.supplier}</span></p>
            <p><span className="text-ink-500">Branch</span><br /><span className="font-medium text-ink-900">{data.branch}</span></p>
            <p><span className="text-ink-500">Received on</span><br />{dateText(data.grn_date)}</p>
            {data.supplier_invoice_no && <p><span className="text-ink-500">Supplier invoice</span><br />{data.supplier_invoice_no}{data.supplier_invoice_date ? ` · ${dateText(data.supplier_invoice_date)}` : ''}</p>}
          </div>
          <Table><Thead><Th>Product</Th><Th className="text-right">Received</Th><Th className="text-right">Damaged</Th><Th className="text-right">Accepted</Th><Th className="text-right">Cost</Th><Th>Batch</Th><Th className="text-right">Expiry</Th></Thead>
            <tbody>{data.items.map((i, idx) => (
              <Tr key={idx}>
                <Td className="font-medium">{i.product}</Td>
                <Td className="text-right tabular">{qty(i.received)} {i.unit_name}</Td>
                <Td className="text-right tabular text-ink-500">{i.damaged ? qty(i.damaged) : '—'}</Td>
                <Td className="text-right tabular">{qty(i.accepted)}</Td>
                <Td className="text-right tabular">{money(i.cost)}</Td>
                <Td>{i.batch_no || '—'}</Td>
                <Td className="text-right">{i.expiry_date ? dateText(i.expiry_date) : '—'}</Td>
              </Tr>
            ))}</tbody>
          </Table>
          <p className="text-right text-small text-ink-500">Total <strong className="tabular text-ink-900">{money(data.total)}</strong></p>
          {data.notes && <p className="text-small text-ink-500">{data.notes}</p>}
        </div>
      )}
    </Modal>
  );
};

const PharmacyGrn = () => {
  const { can } = useAuth();
  const [offset, setOffset] = useState(0);
  const [receiving, setReceiving] = useState(false);
  const [viewing, setViewing] = useState(null);
  const { data, meta, loading, error, reload } = useLoad(`/pharmacy/grn?limit=50&offset=${offset}`, { paged: true });
  const canEdit = can('purchases') || can('inventory');

  return (
    <div>
      <PageHeader title="Goods receipts" lead="What you received from suppliers, direct — no purchase order step."
                  action={canEdit && <Button onClick={() => setReceiving(true)}><Plus aria-hidden="true" className="h-4 w-4" />Receive goods</Button>} />
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={Truck} emptyLabel="Nothing received yet"
                 emptyBody="Receipts you post will show up here." emptyAction={canEdit ? <Button onClick={() => setReceiving(true)}>Receive goods</Button> : undefined} />
      {data?.length > 0 && (
        <>
          <Table><Thead><Th>Receipt</Th><Th>Supplier</Th><Th>Branch</Th><Th>Date</Th><Th className="text-right">Total</Th></Thead>
            <tbody>{data.map((g) => (
              <Tr key={g.grn_id} onClick={() => setViewing(g.grn_id)}>
                <Td className="font-medium">{g.grn_number}{g.supplier_invoice_no && <span className="block text-caption text-ink-500">Inv. {g.supplier_invoice_no}</span>}</Td>
                <Td>{g.supplier}</Td>
                <Td className="text-ink-500">{g.branch}</Td>
                <Td className="text-ink-500">{dateText(g.grn_date)}</Td>
                <Td className="text-right tabular">{money(g.total)}</Td>
              </Tr>
            ))}</tbody>
          </Table>
          <Pager meta={meta} onPage={setOffset} />
        </>
      )}
      {receiving && <PharmacyGrnModal onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); reload(); }} />}
      {viewing && <GrnDetail id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
};

export default PharmacyGrn;
