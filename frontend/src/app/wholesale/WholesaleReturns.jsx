/*
 * Returns: goods back from customers (credit notes) and goods back to suppliers (debit notes), by reason.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Undo2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { PO_STATUS, RETURN_REASONS, dateText, longDate, money, qs, qty, useLoad } from '../../lib/wholesale.js';
import { Badge, Button, Input, ListState, Modal, PageHeader, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Chips, CustomerPicker, Pager, StatusPill, SupplierPicker, Toolbar } from './parts.jsx';
import { PurchaseReturnModal, SalesReturnModal } from './ReturnModals.jsx';

/* choose the invoice (of a customer) or the purchase order (of a supplier) to return against */
const PickDocument = ({ kind, onClose, onPick }) => {
  const [party, setParty] = useState(null);
  const docs = useLoad(party ? (kind === 'SALE' ? `/wholesale/customers/${party.customer_id}/invoices?limit=30` : `/wholesale/purchase-orders${qs({ supplier_id: party.supplier_id, status: 'RECEIVED,PARTIAL', limit: 30 })}`) : null, { paged: true });
  return (
    <Modal title={kind === 'SALE' ? 'Customer return: choose the invoice' : 'Return to supplier: choose the order'} onClose={onClose}>
      <div className="space-y-4">
        {kind === 'SALE' ? <CustomerPicker value={party} onChange={setParty} id="ret-customer" /> : <SupplierPicker value={party} onChange={setParty} id="ret-supplier" />}
        {party && <ListState loading={docs.loading && !docs.data} error={docs.error} empty={docs.data?.length === 0} emptyLabel={kind === 'SALE' ? 'No invoices' : 'No received orders'} />}
        {docs.data?.length > 0 && <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-(--radius-card) border border-line text-small">
          {docs.data.filter((d) => kind !== 'SALE' || d.status !== 'CANCELLED').map((d) => (
            <li key={d.invoice_id ?? d.po_id}><button type="button" onClick={() => onPick(d.invoice_id ?? d.po_id)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
              <span><span className="font-medium text-ink-900">{d.invoice_number ?? d.po_number}</span><span className="ml-2 text-caption text-ink-500">{dateText(d.invoice_date ?? d.po_date)}</span></span><span className="tabular text-ink-700">{money(d.total)}</span></button></li>))}
        </ul>}
      </div>
    </Modal>
  );
};

const ReturnDetail = ({ id, onClose }) => {
  const { data: r, loading, error } = useLoad(`/wholesale/returns/${id}`);
  return (
    <Modal title={r ? r.return_number : 'Return'} onClose={onClose}>
      <ListState loading={loading && !r} error={error} />
      {r && (
        <div className="space-y-4 text-small">
          <p className="text-ink-500">{r.kind === 'SALE' ? 'Sales return' : 'Purchase return'} · {RETURN_REASONS[r.reason]} · {longDate(r.created_at)} · {r.warehouse}</p>
          <p>{r.kind === 'SALE' ? <>Customer <Link to={`/app/wholesale/customers/${r.customer_id}`} className="font-medium text-brand-700">{r.customer}</Link> · invoice <Link to={`/app/billing/invoices/${r.invoice_id}`} className="font-medium text-brand-700">{r.invoice_number}</Link> · credit note <strong>{r.cn_number}</strong> {r.cn_total != null && `(${money(r.cn_total)})`}</>
            : <>Supplier <Link to={`/app/wholesale/suppliers/${r.supplier_id}`} className="font-medium text-brand-700">{r.supplier}</Link> · order <Link to={`/app/wholesale/purchasing/${r.po_id}`} className="font-medium text-brand-700">{r.po_number}</Link> · debit note <strong>{r.dn_number}</strong> {r.dn_total != null && `(${money(r.dn_total)})`}</>}</p>
          <Table><Thead><Th>Product</Th><Th className="text-right">Quantity</Th><Th>Goods</Th></Thead><tbody>{r.items.map((i, k) => <Tr key={k}><Td className="font-medium">{i.product}</Td><Td className="text-right tabular">{qty(i.quantity)} {i.unit_name || ''}{i.unit_name && i.unit_name !== i.base_unit && <span className="block text-caption text-ink-500">{qty(i.base_qty)} {i.base_unit}</span>}</Td><Td>{r.kind === 'SALE' ? <Badge tone={i.disposition === 'RESTOCK' ? 'success' : 'warning'}>{{ RESTOCK: 'Back on shelf', DAMAGED: 'Damaged', EXPIRED: 'Expired', NONE: 'Not returned' }[i.disposition]}{i.batch_no ? ` · ${i.batch_no}` : ''}</Badge> : <Badge tone="neutral">Sent back</Badge>}</Td></Tr>)}</tbody></Table>
          {r.notes && <p className="text-ink-700">{r.notes}</p>}
        </div>
      )}
    </Modal>
  );
};

const WholesaleReturns = () => {
  const { can } = useAuth();
  const [kind, setKind] = useState('');
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [choosing, setChoosing] = useState(null);     // 'SALE' | 'PURCHASE'
  const [doc, setDoc] = useState(null);               // { kind, id }
  const [open, setOpen] = useState(null);
  const [stamp, setStamp] = useState(0);
  const { data, meta, loading, error } = useLoad(`/wholesale/returns${qs({ kind, reason, q: q.trim() || undefined, limit: 50, offset, k: stamp })}`, { paged: true });
  return (
    <div>
      <PageHeader title="Returns" lead="Goods coming back from customers and going back to suppliers, with the credit and debit notes they produce."
                  action={<>{can('refunds') && <Button onClick={() => setChoosing('SALE')}><Undo2 aria-hidden="true" className="h-4 w-4" />Customer return</Button>}{can('purchases') && <Button variant="secondary" onClick={() => setChoosing('PURCHASE')}>Return to supplier</Button>}</>} />
      <Toolbar><div className="w-full sm:w-64"><Input type="search" placeholder="Return, customer or invoice" aria-label="Search returns" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div>
        <Chips label="Type" value={kind} onChange={(v) => { setKind(v); setOffset(0); }} options={[{ value: '', label: 'All' }, { value: 'SALE', label: 'From customers' }, { value: 'PURCHASE', label: 'To suppliers' }]} /></Toolbar>
      <div className="mb-4"><Chips label="Reason" value={reason} onChange={(v) => { setReason(v); setOffset(0); }} options={[{ value: '', label: 'Any reason' }, ...Object.entries(RETURN_REASONS).map(([value, label]) => ({ value, label }))]} /></div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={Undo2} emptyLabel="No returns" emptyBody="Returns you record appear here." />
      {data?.length > 0 && <><Table><Thead><Th>Return</Th><Th>Date</Th><Th>Type</Th><Th>Party</Th><Th>Document</Th><Th>Reason</Th><Th className="text-right">Value</Th></Thead>
        <tbody>{data.map((r) => <Tr key={r.return_id} onClick={() => setOpen(r.return_id)}><Td className="font-medium text-brand-700">{r.return_number}</Td><Td>{dateText(r.created_at)}</Td><Td>{r.kind === 'SALE' ? <Badge tone="brand">From customer</Badge> : <Badge tone="warning">To supplier</Badge>}</Td><Td>{r.customer || r.supplier}</Td><Td className="text-ink-500">{r.kind === 'SALE' ? `${r.invoice_number} · ${r.cn_number}` : `${r.po_number} · ${r.dn_number}`}</Td><Td>{RETURN_REASONS[r.reason]}</Td><Td className="text-right tabular">{money(r.cn_total ?? r.dn_total)}</Td></Tr>)}</tbody></Table><Pager meta={meta} onPage={setOffset} /></>}
      {choosing && <PickDocument kind={choosing} onClose={() => setChoosing(null)} onPick={(id) => { setDoc({ kind: choosing, id }); setChoosing(null); }} />}
      {doc?.kind === 'SALE' && <SalesReturnModal invoiceId={doc.id} onClose={() => setDoc(null)} onDone={() => { setDoc(null); setStamp((n) => n + 1); }} />}
      {doc?.kind === 'PURCHASE' && <PurchaseReturnModal poId={doc.id} onClose={() => setDoc(null)} onDone={() => { setDoc(null); setStamp((n) => n + 1); }} />}
      {open && <ReturnDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

export default WholesaleReturns;
