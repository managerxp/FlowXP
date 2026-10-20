/*
 * Goods receipts: the direct-purchase history (no purchase order list exists for pharmacy — see
 * backend/src/routes/pharmacy.routes.js). Receive new stock, or open a past receipt to see what it contained.
 */
import { useState } from 'react';
import { Plus, Truck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { dateText, money, qty, useLoad } from '../../lib/pharmacy.js';
import { Alert, Button, ListState, Modal, PageHeader, Table, Td, Th, Thead, Tr, PageLoader } from '../../components/ui.jsx';
import { Pager } from './parts.jsx';
import PharmacyGrnModal from './PharmacyGrnModal.jsx';
import { useT } from '../../i18n/useT.js';

const GrnDetail = ({ id, onClose }) => {
  const tr = useT();
  const { data, loading, error } = useLoad(`/pharmacy/grn/${id}`);
  return (
    <Modal title={data ? data.grn_number : tr('Goods receipt')} onClose={onClose} wide>
      <Alert>{error}</Alert>
      {loading && !data && <PageLoader compact />}
      {data && (
        <div className="space-y-4">
          <div className="grid gap-3 text-small sm:grid-cols-2">
            <p><span className="text-ink-500">{tr('Supplier')}</span><br /><span className="font-medium text-ink-900">{data.supplier}</span></p>
            <p><span className="text-ink-500">{tr('Branch')}</span><br /><span className="font-medium text-ink-900">{data.branch}</span></p>
            <p><span className="text-ink-500">{tr('Received on')}</span><br />{dateText(data.grn_date)}</p>
            {data.supplier_invoice_no && <p><span className="text-ink-500">{tr('Supplier invoice')}</span><br />{data.supplier_invoice_no}{data.supplier_invoice_date ? ` · ${dateText(data.supplier_invoice_date)}` : ''}</p>}
          </div>
          <Table><Thead><Th>{tr('Product')}</Th><Th className="text-right">{tr('Received')}</Th><Th className="text-right">{tr('Damaged')}</Th><Th className="text-right">{tr('Accepted')}</Th><Th className="text-right">{tr('Cost')}</Th><Th>{tr('Batch')}</Th><Th className="text-right">{tr('Expiry')}</Th></Thead>
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
          <p className="text-right text-small text-ink-500">{tr('Total')} <strong className="tabular text-ink-900">{money(data.total)}</strong></p>
          {data.notes && <p className="text-small text-ink-500">{data.notes}</p>}
        </div>
      )}
    </Modal>
  );
};

const PharmacyGrn = () => {
  const tr = useT();
  const { can } = useAuth();
  const [offset, setOffset] = useState(0);
  const [receiving, setReceiving] = useState(false);
  const [viewing, setViewing] = useState(null);
  const { data, meta, loading, error, reload } = useLoad(`/pharmacy/grn?limit=50&offset=${offset}`, { paged: true });
  const canEdit = can('purchases') || can('inventory');

  return (
    <div>
      <PageHeader title={tr('Goods receipts')} lead={tr('What you received from suppliers, direct — no purchase order step.')}
                  action={canEdit && <Button onClick={() => setReceiving(true)}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Receive goods')}</Button>} />
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={Truck} emptyLabel={tr('Nothing received yet')}
                 emptyBody="Receipts you post will show up here." emptyAction={canEdit ? <Button onClick={() => setReceiving(true)}>{tr('Receive goods')}</Button> : undefined} />
      {data?.length > 0 && (
        <>
          <Table><Thead><Th>{tr('Receipt')}</Th><Th>{tr('Supplier')}</Th><Th>{tr('Branch')}</Th><Th>{tr('Date')}</Th><Th className="text-right">{tr('Total')}</Th></Thead>
            <tbody>{data.map((g) => (
              <Tr key={g.grn_id} onClick={() => setViewing(g.grn_id)}>
                <Td className="font-medium">{g.grn_number}{g.supplier_invoice_no && <span className="block text-caption text-ink-500">{tr('Inv. {{supplier_invoice_no}}', { supplier_invoice_no: g.supplier_invoice_no })}</span>}</Td>
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
