/*
 * Sales orders: the list (filter by stage, customer, dates, warehouse; export), and the back-order board — lines
 * customers are waiting on because stock does not cover them yet.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, Download, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { ORDER_STATUS, dateText, fetchAll, money, qs, qty, saveCsv, useDebounced, useLoad } from '../../lib/wholesale.js';
import { Alert, Button, Input, ListState, PageHeader, Table, Td, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { Chips, Pager, StatusPill, Tabs, Toolbar, WarehouseSelect } from './parts.jsx';

const STAGES = [
  ['', 'All'], ['DRAFT,PENDING', 'To confirm'], ['CONFIRMED,PARTIALLY_FULFILLED,PACKED', 'To ship'], ['DISPATCHED', 'On the road'], ['DELIVERED,FULFILLED', 'Done'], ['CANCELLED', 'Cancelled']
];

const Backorders = () => {
  const { data, loading, error } = useLoad('/wholesale/backorders');
  const navigate = useNavigate();
  return (
    <div>
      <p className="mb-4 max-w-2xl text-small text-ink-500">Lines customers are waiting on. When a goods receipt brings stock in, the oldest orders are filled first, automatically.</p>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={ClipboardList} emptyLabel="No back-orders" emptyBody="Every confirmed order is covered by stock." />
      {data?.length > 0 && (
        <Table>
          <Thead><Th>Order</Th><Th>Customer</Th><Th>Product</Th><Th className="text-right">Short by</Th><Th className="text-right">Available now</Th><Th>Ordered</Th></Thead>
          <tbody>
            {data.map((r, i) => (
              <Tr key={i} onClick={() => navigate(`/app/wholesale/orders/${r.order_id}`)}>
                <Td className="font-medium text-brand-700">{r.order_number}</Td><Td>{r.customer}</Td><Td>{r.product}</Td>
                <Td className="text-right tabular font-semibold text-warning">{qty(r.short)} {r.unit}</Td><Td className="text-right tabular">{qty(r.available)} {r.unit}</Td><Td>{dateText(r.order_date)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

const WholesaleOrders = () => {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('backorders') === '1' ? 'backorders' : 'orders';
  const status = params.get('status') || '';
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [offset, setOffset] = useState(0);
  const term = useDebounced(q.trim(), 250);
  const query = useMemo(() => qs({ status, q: term, from, to, branch_id: warehouse, limit: 50, offset }), [status, term, from, to, warehouse, offset]);
  const { data, meta, loading, error } = useLoad(tab === 'orders' ? `/wholesale/orders${query}` : null, { paged: true });
  const [busy, setBusy] = useState(false);

  const set = (patch) => { const next = new URLSearchParams(params); for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k)); setParams(next, { replace: true }); setOffset(0); };

  const exportCsv = async () => {
    setBusy(true);
    try {
      const rows = await fetchAll(`/wholesale/orders${qs({ status, q: term, from, to, branch_id: warehouse })}`);
      saveCsv(`sales-orders-${new Date().toISOString().slice(0, 10)}.csv`, [
        { key: 'order_number', label: 'Order' }, { key: 'order_date', label: 'Date' }, { key: 'customer', label: 'Customer' }, { key: 'salesperson', label: 'Salesperson' }, { key: 'status', label: 'Status' },
        { key: 'warehouse', label: 'Warehouse' }, { key: 'subtotal', label: 'Subtotal' }, { key: 'tax', label: 'GST' }, { key: 'total', label: 'Total' }, { key: 'customer_po', label: 'Customer PO' }
      ], rows);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Sales orders" lead="From a customer’s order to the dispatched invoice."
                  action={<>
                    {can('export') && <Button variant="secondary" onClick={exportCsv} loading={busy}><Download aria-hidden="true" className="h-4 w-4" />Export</Button>}
                    {can('sales_orders') && <Button to="/app/wholesale/orders/new"><Plus aria-hidden="true" className="h-4 w-4" />New order</Button>}
                  </>} />
      <Tabs tabs={[{ key: 'orders', label: 'Orders' }, { key: 'backorders', label: 'Back-orders' }]} value={tab} onChange={(k) => set({ backorders: k === 'backorders' ? '1' : '', status: '' })} />
      {tab === 'backorders' ? <Backorders /> : (
        <>
          <Toolbar>
            <div className="w-full sm:w-64"><Input type="search" placeholder="Order, customer or PO number" aria-label="Search orders" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div>
            <Input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} className="w-auto" />
            <Input type="date" aria-label="To date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} className="w-auto" />
            <WarehouseSelect allowAll value={warehouse} onChange={(v) => { setWarehouse(v); setOffset(0); }} label="" id="order-warehouse" />
          </Toolbar>
          <div className="mb-4"><Chips label="Stage" value={status} onChange={(v) => set({ status: v })} options={STAGES.map(([value, label]) => ({ value, label }))} /></div>
          <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={ClipboardList} emptyLabel="No orders here" emptyBody={status || term ? 'Nothing matches those filters.' : 'Take your first order to get started.'}
                     emptyAction={can('sales_orders') && !status && !term ? <Button to="/app/wholesale/orders/new">New order</Button> : undefined} />
          {data?.length > 0 && (
            <>
              <Table>
                <Thead><Th>Order</Th><Th>Date</Th><Th>Customer</Th><Th>Salesperson</Th><Th>Status</Th><Th className="text-right">Lines</Th><Th className="text-right">Total</Th></Thead>
                <tbody>
                  {data.map((o) => (
                    <Tr key={o.order_id} onClick={() => navigate(`/app/wholesale/orders/${o.order_id}`)}>
                      <Td className="font-medium text-brand-700">{o.order_number}{o.approval_needed && <span className="ml-2 text-caption font-normal text-warning">needs approval</span>}</Td>
                      <Td>{dateText(o.order_date)}</Td><Td>{o.customer}</Td><Td className="text-ink-500">{o.salesperson || '—'}</Td>
                      <Td><StatusPill map={ORDER_STATUS} status={o.status} /></Td><Td className="text-right tabular">{o.lines}</Td><Td className="text-right tabular font-medium">{money(o.total)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <Pager meta={meta} onPage={setOffset} />
            </>
          )}
        </>
      )}
    </div>
  );
};

export default WholesaleOrders;
