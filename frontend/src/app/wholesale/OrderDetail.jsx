/*
 * One sales order: where it stands, what is reserved / picked / shipped / back-ordered line by line, the shipments and
 * invoices it produced, and the actions each stage allows (confirm, reserve, pick, cancel, close, print).
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClipboardList, Pencil, Printer } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { DELIVERY_STATUS, ORDER_STATUS, PICK_STATUS, dateText, longDate, money, priceSourceText, qty, useLoad } from '../../lib/wholesale.js';
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Skeleton, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Panel, StatusPill, useAction } from './parts.jsx';

const STEPS = [['DRAFT', 'Draft'], ['PENDING', 'Submitted'], ['CONFIRMED', 'Confirmed'], ['PARTIALLY_FULFILLED', 'Shipping'], ['DISPATCHED', 'Dispatched'], ['DELIVERED', 'Delivered']];
const stepOf = (s) => ({ DRAFT: 0, PENDING: 1, CONFIRMED: 2, PACKED: 2, PARTIALLY_FULFILLED: 3, FULFILLED: 4, DISPATCHED: 4, DELIVERED: 5 }[s] ?? 0);

const Progress = ({ status }) => {
  if (status === 'REJECTED') return <p className="text-small text-danger">This order was rejected.</p>;
  if (status === 'CANCELLED') return <p className="text-small text-ink-500">This order was cancelled.</p>;
  const at = stepOf(status);
  return (
    <ol className="flex items-center gap-1 overflow-x-auto text-caption" aria-label="Order progress">
      {STEPS.map(([k, label], i) => (
        <li key={k} className="flex items-center gap-1">
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${i < at ? 'bg-success/10 text-success' : i === at ? 'bg-brand-500 text-white' : 'bg-surface-3 text-ink-400'}`}>{label}</span>
          {i < STEPS.length - 1 && <span aria-hidden="true" className="h-px w-4 bg-line-strong" />}
        </li>
      ))}
    </ol>
  );
};

const CancelModal = ({ order, onClose, onDone }) => {
  const [reason, setReason] = useState('');
  const [busy, run] = useAction();
  return (
    <Modal title={`Cancel ${order.order_number}?`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-small text-ink-500">Reserved stock goes back on the shelf. The customer is not charged.</p>
        <Field id="cancel-reason" label="Reason"><Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={200} /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Keep order</Button>
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 3 && order.status !== 'DRAFT'} onClick={async () => { const o = await run(() => api(`/wholesale/orders/${order.order_id}/cancel`, { method: 'POST', body: { reason } }), 'Order cancelled'); if (o) onDone(o); }}>Cancel order</Button></div>
      </div>
    </Modal>
  );
};

const OrderDetail = () => {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const { data: o, loading, error, setData, reload } = useLoad(`/wholesale/orders/${id}`);
  const [busy, run] = useAction();
  const [cancelling, setCancelling] = useState(false);
  const [creditStop, setCreditStop] = useState(null);

  if (error) return <div><PageHeader title="Order" /><Alert>{error}</Alert><Button to="/app/wholesale/orders" variant="secondary">Back to orders</Button></div>;
  if (loading && !o) return <div className="space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-48" /></div>;
  if (!o) return null;

  const act = (path, success, body) => run(async () => { const next = await api(`/wholesale/orders/${o.order_id}/${path}`, { method: 'POST', body: body || {} }); setData((cur) => ({ ...cur, ...next })); await reload(); return next; }, success);
  const confirm = async (override) => {
    try { const r = await act('confirm', 'Order confirmed', override ? { credit_override: true, reason: override } : undefined); if (r?.warnings?.length) toast.success(r.warnings.join(' · ')); }
    catch { /* shown by act */ }
  };
  const tryConfirm = async () => {
    try {
      const next = await api(`/wholesale/orders/${o.order_id}/confirm`, { method: 'POST', body: {} });
      toast.success('Order confirmed'); if (next.warnings?.length) toast.success(next.warnings.join(' · ')); await reload();
    } catch (e) { if (e.code === 'CREDIT_BLOCK') setCreditStop(e.data?.reasons || [e.message]); else toast.error(e.message); }
  };
  const overrideConfirm = async () => {
    const reason = await dialog.prompt({ title: 'Allow this order over the credit limit?', body: 'Say why. It is kept with the order.', label: 'Reason', confirmLabel: 'Confirm anyway' });
    if (reason == null) return;
    setCreditStop(null); await confirm(reason || 'Approved');
  };
  const reserveAgain = () => act('reserve', 'Stock reserved');
  const closeRest = async () => {
    const reason = await dialog.prompt({ title: 'Close the rest of this order?', body: 'What has not shipped is cancelled. The customer will not receive it.', label: 'Reason', confirmLabel: 'Close it' });
    if (reason) act('close', 'Order closed', { reason });
  };
  const rejectOrder = async () => {
    const reason = await dialog.prompt({ title: `Reject ${o.order_number}?`, body: 'Any stock held for it is released. The customer is not invoiced.', label: 'Reason', confirmLabel: 'Reject order' });
    if (reason) act('reject', 'Order rejected', { reason });
  };
  const makePick = async () => {
    const out = await run(() => api(`/wholesale/orders/${o.order_id}/pick-lists`, { method: 'POST', body: {} }), 'Pick list created');
    if (out) navigate(`/app/wholesale/fulfilment?tab=picks&open=${out.pick_id}`);
  };

  const editable = ['DRAFT', 'PENDING', 'CONFIRMED'].includes(o.status) && can('sales_orders');
  const open = o.items.reduce((s, i) => s + i.open, 0);
  const backorder = o.items.reduce((s, i) => s + i.backorder, 0);
  const canPick = ['CONFIRMED', 'PARTIALLY_FULFILLED', 'PACKED'].includes(o.status) && can('fulfilment') && o.items.some((i) => i.reserved - (i.picked - i.shipped) > 0);
  const confirmed = ['CONFIRMED', 'PARTIALLY_FULFILLED', 'PACKED'].includes(o.status);

  return (
    <div>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3">{o.order_number}<StatusPill map={ORDER_STATUS} status={o.status} /></span>} lead={`${o.customer} · ${longDate(o.order_date)}`}
                  action={<>
                    <Button variant="secondary" to={`/app/wholesale/orders/${o.order_id}/print`}><Printer aria-hidden="true" className="h-4 w-4" />Print</Button>
                    {editable && <Button variant="secondary" to={`/app/wholesale/orders/${o.order_id}/edit`}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</Button>}
                    {o.status === 'DRAFT' && can('sales_orders') && <Button variant="secondary" loading={busy} onClick={() => act('submit', 'Submitted for approval')}>Submit</Button>}
                    {['DRAFT', 'PENDING'].includes(o.status) && can('sales_orders') && <Button loading={busy} onClick={tryConfirm}>Confirm order</Button>}
                    {canPick && <Button loading={busy} onClick={makePick}>Create pick list</Button>}
                    {confirmed && backorder > 0 && <Button variant="secondary" loading={busy} onClick={reserveAgain}>Reserve available stock</Button>}
                    {o.status === 'PARTIALLY_FULFILLED' && can('sales_cancel') && <Button variant="secondary" onClick={closeRest}>Close the rest</Button>}
                    {['PENDING', 'CONFIRMED'].includes(o.status) && can('sales_cancel') && !o.items.some((i) => i.shipped > 0) && <Button variant="ghost" onClick={rejectOrder}>Reject</Button>}
                    {['DRAFT', 'PENDING', 'CONFIRMED', 'PACKED'].includes(o.status) && (o.status === 'DRAFT' || can('sales_cancel')) && !o.items.some((i) => i.shipped > 0) && <Button variant="ghost" onClick={() => setCancelling(true)}>Cancel order</Button>}
                  </>} />
      <div className="mb-5"><Progress status={o.status} /></div>
      {o.approval_needed && ['DRAFT', 'PENDING'].includes(o.status) && <p className="mb-4 rounded-lg bg-warning/10 px-4 py-2.5 text-small text-warning">This order is over the approval limit{can('sales_cancel') ? ': you can approve it by confirming.' : '. A sales manager has to confirm it.'}</p>}
      {o.credit_note && <p className="mb-4 rounded-lg bg-surface-2 px-4 py-2.5 text-small text-ink-700">Credit note on this order: {o.credit_note}</p>}
      {o.credit?.reasons?.length > 0 && ['DRAFT', 'PENDING'].includes(o.status) && <p className={`mb-4 rounded-lg px-4 py-2.5 text-small ${o.credit.level === 'BLOCK' ? 'bg-danger/5 text-danger' : 'bg-warning/10 text-warning'}`}>{o.credit.reasons.join('. ')}.</p>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Panel title="Items">
            <Table>
              <Thead><Th>Product</Th><Th className="text-right">Ordered</Th><Th className="text-right">Price</Th><Th className="text-right">Reserved</Th><Th className="text-right">Picked</Th><Th className="text-right">Shipped</Th><Th className="text-right">Back-order</Th></Thead>
              <tbody>
                {o.items.map((i) => (
                  <Tr key={i.item_id}>
                    <Td><span className="font-medium">{i.product}</span>{i.is_free && <span className="ml-2"><Badge tone="success">Free</Badge></span>}{i.sku && <span className="ml-2 text-caption text-ink-500">{i.sku}</span>}<span className="block text-caption text-ink-500">{priceSourceText(i.price_source)}{i.discount_pct ? ` · ${i.discount_pct}% off` : ''}{i.tax_rate ? ` · GST ${i.tax_rate}%` : ''}</span></Td>
                    <Td className="text-right tabular">{qty(i.quantity)} {i.unit_name}{i.unit_factor !== 1 && <span className="block text-caption text-ink-500">{qty(i.base_qty)} {i.base_unit}</span>}</Td>
                    <Td className="text-right tabular">{money(i.price)}<span className="block text-caption text-ink-500">per {i.unit_name}</span></Td>
                    <Td className="text-right tabular">{qty(i.reserved)}</Td><Td className="text-right tabular">{qty(i.picked)}</Td><Td className="text-right tabular">{qty(i.shipped)}</Td>
                    <Td className={`text-right tabular ${i.backorder > 0 ? 'font-semibold text-warning' : 'text-ink-400'}`}>{i.backorder > 0 ? qty(i.backorder) : '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-caption text-ink-500">Reserved, picked, shipped and back-order are in the product’s base unit.</p>
          </Panel>

          <Panel title="Shipments and invoices" lead={open > 0 && o.shipments.length ? 'The rest of the order is still to ship.' : undefined}>
            {o.shipments.length === 0 && o.pick_lists.length === 0 && <p className="py-6 text-center text-small text-ink-400">Nothing has been picked or shipped yet.</p>}
            {o.pick_lists.filter((p) => !['DISPATCHED', 'CANCELLED'].includes(p.status)).map((p) => (
              <Link key={p.pick_id} to={`/app/wholesale/fulfilment?tab=picks&open=${p.pick_id}`} className="mb-2 flex items-center justify-between rounded-lg border border-line px-4 py-2.5 text-small hover:border-line-strong">
                <span><span className="font-medium text-ink-900">{p.pick_number}</span><span className="ml-2 text-ink-500">pick list{p.picker_name ? ` · ${p.picker_name}` : ''}</span></span><StatusPill map={PICK_STATUS} status={p.status} />
              </Link>
            ))}
            {o.shipments.length > 0 && (
              <Table>
                <Thead><Th>Challan</Th><Th>Dispatched</Th><Th>Status</Th><Th>Invoice</Th><Th className="text-right">Invoice total</Th><Th className="text-right">Balance</Th></Thead>
                <tbody>
                  {o.shipments.map((s) => (
                    <Tr key={s.delivery_id}>
                      <Td><Link to={`/app/wholesale/deliveries/${s.delivery_id}/print`} className="font-medium text-brand-700">{s.challan_number}</Link></Td>
                      <Td>{s.dispatch_date ? dateText(s.dispatch_date) : '—'}{s.vehicle_no && <span className="block text-caption text-ink-500">{s.vehicle_no}{s.driver_name ? ` · ${s.driver_name}` : ''}</span>}</Td>
                      <Td><StatusPill map={DELIVERY_STATUS} status={s.status} /></Td>
                      <Td>{s.invoice_id ? <Link to={`/app/billing/invoices/${s.invoice_id}`} className="font-medium text-brand-700">{s.invoice_number}</Link> : '—'}</Td>
                      <Td className="text-right tabular">{s.invoice_total != null ? money(s.invoice_total) : '—'}</Td>
                      <Td className={`text-right tabular ${s.invoice_balance > 0 ? 'font-semibold text-warning' : ''}`}>{s.invoice_balance != null ? money(s.invoice_balance) : '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel title="Customer">
            <Link to={`/app/wholesale/customers/${o.customer_id}`} className="block text-small font-semibold text-brand-700 hover:underline">{o.customer}</Link>
            <p className="text-caption text-ink-500">{[o.customer_phone, o.customer_gstin].filter(Boolean).join(' · ')}</p>
            <dl className="mt-3 space-y-1.5 text-small">
              {o.customer_po && <div className="flex justify-between"><dt className="text-ink-500">Their PO</dt><dd>{o.customer_po}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink-500">Salesperson</dt><dd>{o.salesperson || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Payment terms</dt><dd>{o.payment_terms_days} days</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Ship from</dt><dd>{o.warehouse}</dd></div>
              {o.expected_delivery && <div className="flex justify-between"><dt className="text-ink-500">Expected</dt><dd>{dateText(o.expected_delivery)}</dd></div>}
            </dl>
            {o.shipping_address && <p className="mt-3 whitespace-pre-line border-t border-line pt-3 text-caption text-ink-500">{o.shipping_address}</p>}
          </Panel>
          <Panel title="Totals">
            <dl className="space-y-1.5 text-small">
              <div className="flex justify-between"><dt className="text-ink-500">Before GST</dt><dd className="tabular">{money(o.subtotal)}</dd></div>
              {o.shipping_charge > 0 && <div className="flex justify-between"><dt className="text-ink-500">Shipping</dt><dd className="tabular">{money(o.shipping_charge)}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink-500">GST</dt><dd className="tabular">{money(o.tax)}</dd></div>
              {o.scheme_discount > 0 && <div className="flex justify-between"><dt className="text-ink-500">Scheme discount</dt><dd className="tabular">−{money(o.scheme_discount)}</dd></div>}
              {o.discount > 0 && <div className="flex justify-between"><dt className="text-ink-500">Discount</dt><dd className="tabular">−{money(o.discount)}</dd></div>}
              <div className="flex justify-between border-t border-line pt-2 text-body font-semibold"><dt>Total</dt><dd className="tabular">{money(o.total)}</dd></div>
            </dl>
            <p className="mt-2 text-caption text-ink-500">An estimate at order prices. Each shipment is invoiced when it is dispatched.</p>
          </Panel>
          {o.notes && <Panel title="Notes"><p className="whitespace-pre-line text-small text-ink-700">{o.notes}</p></Panel>}
          <p className="px-1 text-caption text-ink-500">Created by {o.created_by || '—'} on {longDate(o.created_at)}{o.confirmed_at ? ` · confirmed ${longDate(o.confirmed_at)}` : ''}{o.cancelled_at ? ` · cancelled ${longDate(o.cancelled_at)}${o.cancel_reason ? ` (${o.cancel_reason})` : ''}` : ''}</p>
        </aside>
      </div>
      {cancelling && <CancelModal order={o} onClose={() => setCancelling(false)} onDone={() => { setCancelling(false); reload(); }} />}
      {creditStop && (
        <Modal title="Credit limit reached" onClose={() => setCreditStop(null)}>
          <ul className="mb-4 space-y-1 text-small text-ink-900">{creditStop.map((r) => <li key={r}>• {r}</li>)}</ul>
          {can('sales_cancel') ? <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={() => setCreditStop(null)}>Not now</Button><Button variant="danger" onClick={overrideConfirm}>Override and confirm</Button></div>
            : <><p className="text-small text-ink-500">Ask a sales manager to confirm this order, or collect a payment first.</p><div className="mt-4 flex justify-end border-t border-line pt-4"><Button variant="secondary" onClick={() => setCreditStop(null)}>OK</Button></div></>}
        </Modal>
      )}
    </div>
  );
};

export default OrderDetail;
