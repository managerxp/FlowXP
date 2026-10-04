/*
 * Purchasing: purchase orders (draft → approved → part / fully received), what is due to arrive, and the goods-receipt
 * register. Receive goods against an order, or without one for a direct purchase.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, PackageCheck, Plus, ShoppingBag } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { PO_STATUS, dateText, fetchAll, money, qs, qty, saveCsv, useDebounced, useLoad } from '../../lib/wholesale.js';
import { Button, Input, ListState, PageHeader, Table, Td, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { Chips, Pager, StatusPill, Tabs, Toolbar } from './parts.jsx';
import GrnModal from './GrnModal.jsx';

const Orders = () => {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const term = useDebounced(q.trim(), 250);
  const query = useMemo(() => qs({ status: status === 'UNPAID' ? undefined : status, unpaid: status === 'UNPAID' ? 1 : undefined, q: term, limit: 50, offset }), [status, term, offset]);
  const { data, meta, loading, error } = useLoad(`/wholesale/purchase-orders${query}`, { paged: true });
  const exportCsv = async () => { try { const rows = await fetchAll(`/wholesale/purchase-orders${qs({ q: term })}`); saveCsv('purchase-orders.csv', [{ key: 'po_number', label: 'Order' }, { key: 'po_date', label: 'Date' }, { key: 'supplier', label: 'Supplier' }, { key: 'status', label: 'Status' }, { key: 'subtotal', label: 'Before GST' }, { key: 'tax', label: 'GST' }, { key: 'total', label: 'Total' }, { key: 'paid', label: 'Paid' }, { key: 'balance', label: 'Balance' }, { key: 'supplier_invoice_no', label: 'Supplier invoice' }, { key: 'due_date', label: 'Due' }], rows); } catch (e) { toast.error(e.message); } };
  return (
    <div>
      <Toolbar>
        <div className="w-full sm:w-72"><Input type="search" placeholder="Order, supplier or supplier invoice" aria-label="Search purchase orders" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div>
        <Chips label="Status" value={status} onChange={(v) => { setParams(v ? { status: v } : {}, { replace: true }); setOffset(0); }} options={[{ value: '', label: 'All' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'ORDERED', label: 'Ordered' }, { value: 'PARTIAL', label: 'Part received' }, { value: 'RECEIVED', label: 'Received' }, { value: 'UNPAID', label: 'Unpaid' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
        {can('export') && <Button variant="secondary" className="ml-auto" onClick={exportCsv}><Download aria-hidden="true" className="h-4 w-4" />Export</Button>}
      </Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={ShoppingBag} emptyLabel="No purchase orders here" emptyBody={status || term ? 'Nothing matches those filters.' : 'Raise your first purchase order.'} emptyAction={can('purchases') && !status && !term ? <Button to="/app/wholesale/purchasing/new">New purchase order</Button> : undefined} />
      {data?.length > 0 && <><Table><Thead><Th>Order</Th><Th>Date</Th><Th>Supplier</Th><Th>Warehouse</Th><Th>Status</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th><Th>Due</Th></Thead>
        <tbody>{data.map((o) => <Tr key={o.po_id} onClick={() => navigate(`/app/wholesale/purchasing/${o.po_id}`)}><Td className="font-medium text-brand-700">{o.po_number}</Td><Td>{dateText(o.po_date)}</Td><Td>{o.supplier || '—'}</Td><Td className="text-ink-500">{o.warehouse}</Td><Td><StatusPill map={PO_STATUS} status={o.status} /></Td><Td className="text-right tabular">{money(o.total)}</Td><Td className={`text-right tabular ${o.balance > 0 ? 'font-semibold' : 'text-ink-400'}`}>{o.balance > 0 ? money(o.balance) : '—'}</Td><Td className="text-ink-500">{o.balance > 0 && o.due_date ? dateText(o.due_date) : ''}</Td></Tr>)}</tbody></Table><Pager meta={meta} onPage={setOffset} /></>}
    </div>
  );
};

const DueIn = () => {
  const navigate = useNavigate();
  const { data, loading, error } = useLoad('/wholesale/purchase-orders/due-in');
  return (
    <div>
      <p className="mb-4 max-w-2xl text-small text-ink-500">Ordered goods that have not fully arrived, soonest expected first.</p>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={PackageCheck} emptyLabel="Nothing on the way" emptyBody="No open purchase orders are waiting for goods." />
      {data?.length > 0 && <Table><Thead><Th>Order</Th><Th>Supplier</Th><Th>Warehouse</Th><Th>Expected</Th><Th>Status</Th><Th className="text-right">Lines</Th></Thead>
        <tbody>{data.map((o) => { const late = o.expected_date && new Date(o.expected_date) < new Date(new Date().toDateString()); return <Tr key={o.po_id} onClick={() => navigate(`/app/wholesale/purchasing/${o.po_id}`)}><Td className="font-medium text-brand-700">{o.po_number}</Td><Td>{o.supplier}</Td><Td className="text-ink-500">{o.warehouse}</Td><Td className={late ? 'font-semibold text-warning' : ''}>{o.expected_date ? `${dateText(o.expected_date)}${late ? ' · late' : ''}` : '—'}</Td><Td><StatusPill map={PO_STATUS} status={o.status} /></Td><Td className="text-right tabular">{o.lines}</Td></Tr>; })}</tbody></Table>}
    </div>
  );
};

const Grns = () => {
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const [open, setOpen] = useState(null);
  const { data, meta, loading, error } = useLoad(`/wholesale/grns${qs({ q: term, limit: 50, offset })}`, { paged: true });
  const detail = useLoad(open ? `/wholesale/grns/${open}` : null);
  return (
    <div>
      <Toolbar><div className="w-full sm:w-72"><Input type="search" placeholder="GRN, supplier or invoice" aria-label="Search goods receipts" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div></Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="No goods receipts yet" emptyBody="Receiving goods creates a goods receipt." />
      {data?.length > 0 && <><Table><Thead><Th>GRN</Th><Th>Date</Th><Th>Supplier</Th><Th>Order</Th><Th>Supplier invoice</Th><Th>Warehouse</Th><Th className="text-right">Value</Th></Thead>
        <tbody>{data.map((g) => <Tr key={g.grn_id} onClick={() => setOpen(open === g.grn_id ? null : g.grn_id)}><Td className="font-medium text-brand-700">{g.grn_number}</Td><Td>{dateText(g.grn_date)}</Td><Td>{g.supplier || '—'}</Td><Td>{g.po_number || '—'}</Td><Td>{g.supplier_invoice_no || '—'}</Td><Td className="text-ink-500">{g.warehouse}</Td><Td className="text-right tabular">{money(g.total_cost)}</Td></Tr>)}</tbody></Table><Pager meta={meta} onPage={setOffset} /></>}
      {open && detail.data && (
        <div className="mt-4 rounded-(--radius-card) border border-line bg-surface p-4">
          <p className="mb-2 text-small font-semibold">{detail.data.grn_number} · {detail.data.items.length} line{detail.data.items.length === 1 ? '' : 's'}</p>
          <Table><Thead><Th>Product</Th><Th className="text-right">Received</Th><Th className="text-right">Damaged</Th><Th className="text-right">Accepted</Th><Th className="text-right">Cost</Th><Th>Batch</Th><Th>Expiry</Th></Thead>
            <tbody>{detail.data.items.map((i) => <Tr key={i.grn_item_id}><Td className="font-medium">{i.product}</Td><Td className="text-right tabular">{qty(i.received)} {i.unit_name}</Td><Td className="text-right tabular">{i.damaged ? qty(i.damaged) : '—'}</Td><Td className="text-right tabular">{qty(i.accepted)}</Td><Td className="text-right tabular">{money(i.unit_cost)}</Td><Td>{i.batch_no || '—'}</Td><Td>{i.expiry_date ? dateText(i.expiry_date, { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}</Td></Tr>)}</tbody></Table>
        </div>
      )}
    </div>
  );
};

const WholesalePurchasing = () => {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'orders';
  const [receiving, setReceiving] = useState(false);
  const [stamp, setStamp] = useState(0);
  return (
    <div>
      <PageHeader title="Purchasing" lead="Order from suppliers, receive goods, and keep track of what is on the way."
                  action={<>{(can('purchases') || can('inventory')) && <Button variant="secondary" onClick={() => setReceiving(true)}><PackageCheck aria-hidden="true" className="h-4 w-4" />Receive goods</Button>}{can('purchases') && <Button to="/app/wholesale/purchasing/new"><Plus aria-hidden="true" className="h-4 w-4" />New purchase order</Button>}</>} />
      <Tabs tabs={[{ key: 'orders', label: 'Purchase orders' }, { key: 'due', label: 'Due in' }, { key: 'grns', label: 'Goods receipts' }]} value={tab} onChange={(k) => setParams(k === 'orders' ? {} : { tab: k }, { replace: true })} />
      <div key={stamp}>
        {tab === 'orders' && <Orders />}
        {tab === 'due' && <DueIn />}
        {tab === 'grns' && <Grns />}
      </div>
      {receiving && <GrnModal onClose={() => setReceiving(false)} onDone={(r) => { setReceiving(false); setStamp((n) => n + 1); if (r.po_id) navigate(`/app/wholesale/purchasing/${r.po_id}`); }} />}
    </div>
  );
};

export default WholesalePurchasing;
