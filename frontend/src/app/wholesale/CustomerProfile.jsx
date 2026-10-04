/*
 * One customer: terms and credit position at a glance, their statement (ledger), invoices, special prices and orders.
 * What a customer owes is computed from the documents (invoices, receipts, credit notes, refunds, adjustments), the same
 * figure every other screen uses.
 */
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Download, Pencil, Plus, Printer, Trash } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { BUCKETS, BUCKET_TONES } from './constants.js';
import { CUSTOMER_TYPES, ORDER_STATUS, PAY_STATUS, PRICE_SOURCE, addDays, dateText, longDate, money, pct, qs, saveCsv, todayIn, useLoad } from '../../lib/wholesale.js';
import { Alert, Badge, Button, EmptyState, Field, Input, ListState, Modal, PageHeader, Select, Skeleton, StatCard, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { NumberField, Pager, Panel, ProductPicker, Segmented, StackStrip, StatusPill, Tabs, useAction } from './parts.jsx';
import { CustomerForm } from './CustomerForms.jsx';
import ReceiptModal from './ReceiptModal.jsx';

/* ── ledger ───────────────────────────────────────────────────────────────── */

const TYPE_LABEL = { INVOICE: 'Invoice', CANCELLED: 'Invoice cancelled', PAYMENT: 'Payment', ADVANCE: 'Advance', RECEIPT: 'Receipt', REFUND: 'Refund paid', REVERSAL: 'Receipt reversed', CREDIT_NOTE: 'Credit note', ADJUSTMENT: 'Adjustment' };

const AdjustModal = ({ customerId, onClose, onDone }) => {
  const [f, setF] = useState({ amount: '', kind: 'WRITE_OFF', reason: '', date: todayIn() });
  const [busy, run] = useAction();
  const sign = f.kind === 'WRITE_OFF' ? -1 : 1;
  return (
    <Modal title="Adjust the balance" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-small text-ink-500">For a write-off, a rounding difference or a correction. It is recorded on the ledger with your reason and cannot be edited later.</p>
        <Field id="adj-kind" label="Type"><Select id="adj-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="WRITE_OFF">Write off (they owe less)</option><option value="CHARGE">Extra charge (they owe more)</option></Select></Field>
        <NumberField id="adj-amount" label="Amount" prefix="₹" min={0.01} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        <Field id="adj-date" label="Date"><Input id="adj-date" type="date" value={f.date} max={todayIn()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field id="adj-reason" label="Reason"><Input id="adj-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={200} /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!(Number(f.amount) > 0) || f.reason.trim().length < 3} onClick={async () => { const r = await run(() => api('/wholesale/ledger-adjustments', { method: 'POST', body: { party_type: 'CUSTOMER', party_id: customerId, amount: sign * Number(f.amount), reason: f.reason, date: f.date } }), 'Balance adjusted'); if (r) onDone(); }}>Save adjustment</Button></div>
      </div>
    </Modal>
  );
};

const Ledger = ({ customer, reloadKey, onChanged }) => {
  const { can } = useAuth();
  const [from, setFrom] = useState(addDays(todayIn(), -90));
  const [to, setTo] = useState(todayIn());
  const [adjusting, setAdjusting] = useState(false);
  const { data: l, loading, error, reload } = useLoad(`/wholesale/customers/${customer.customer_id}/ledger${qs({ from, to, k: reloadKey })}`);
  const csv = () => saveCsv(`ledger-${customer.name.replace(/\W+/g, '-')}.csv`, [{ key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'ref', label: 'Reference' }, { key: 'description', label: 'Description' }, { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' }, { key: 'balance', label: 'Balance' }], [{ date: from, type: 'Opening', balance: l.opening }, ...l.lines.map((x) => ({ ...x, type: TYPE_LABEL[x.type] || x.type }))]);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2"><Field id="l-from" label="From"><Input id="l-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field><Field id="l-to" label="To"><Input id="l-to" type="date" value={to} min={from} max={todayIn()} onChange={(e) => setTo(e.target.value)} /></Field></div>
        <div className="flex gap-2">{l && <Button variant="secondary" onClick={csv}><Download aria-hidden="true" className="h-4 w-4" />CSV</Button>}<Button variant="secondary" onClick={() => window.print()}><Printer aria-hidden="true" className="h-4 w-4" />Print</Button>{can('payments') && <Button variant="secondary" onClick={() => setAdjusting(true)}>Adjust balance</Button>}</div>
      </div>
      <ListState loading={loading && !l} error={error} />
      {l && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Opening" value={money(l.opening)} /><StatCard label="Debits" value={money(l.total_debit)} /><StatCard label="Credits" value={money(l.total_credit)} /><StatCard label="Closing" value={money(l.closing)} tone={l.closing > 0 ? 'warning' : undefined} />
          </div>
          <Table>
            <Thead><Th>Date</Th><Th>Type</Th><Th>Reference</Th><Th>Details</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th><Th className="text-right">Balance</Th></Thead>
            <tbody>
              <Tr><Td className="text-ink-500">{dateText(from)}</Td><Td colSpan={5} className="font-medium text-ink-700">Opening balance</Td><Td className="text-right tabular font-medium">{money(l.opening)}</Td></Tr>
              {l.lines.map((x, i) => (
                <Tr key={i}>
                  <Td>{dateText(x.date)}</Td><Td><Badge tone={x.type === 'INVOICE' ? 'brand' : ['RECEIPT', 'PAYMENT', 'ADVANCE', 'CREDIT_NOTE'].includes(x.type) ? 'success' : 'neutral'}>{TYPE_LABEL[x.type] || x.type}</Badge></Td>
                  <Td className="font-medium">{x.type === 'INVOICE' && x.ref_id ? <Link to={`/app/billing/invoices/${x.ref_id}`} className="text-brand-700">{x.ref}</Link> : x.ref || '—'}</Td><Td className="text-ink-500">{x.description}</Td>
                  <Td className="text-right tabular">{x.debit ? money(x.debit) : ''}</Td><Td className="text-right tabular">{x.credit ? money(x.credit) : ''}</Td><Td className="text-right tabular font-medium">{money(x.balance)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {l.lines.length === 0 && <p className="py-6 text-center text-small text-ink-400">No activity in this period.</p>}
        </>
      )}
      {adjusting && <AdjustModal customerId={customer.customer_id} onClose={() => setAdjusting(false)} onDone={() => { setAdjusting(false); reload(); onChanged(); }} />}
    </div>
  );
};

/* ── special prices ───────────────────────────────────────────────────────── */

const PriceRule = ({ customerId, onSaved, onClose }) => {
  const [product, setProduct] = useState(null);
  const [f, setF] = useState({ unit_name: '', min_qty: '1', kind: 'PRICE', value: '', starts_on: '', ends_on: '' });
  const [busy, run] = useAction();
  const save = async () => {
    const r = await run(() => api(`/wholesale/customers/${customerId}/prices`, { method: 'PUT', body: { items: [{ product_id: product.product_id, unit_name: f.unit_name || undefined, min_qty: Number(f.min_qty) || 1, ...(f.kind === 'PRICE' ? { price: Number(f.value) } : { discount_pct: Number(f.value) }), starts_on: f.starts_on || undefined, ends_on: f.ends_on || undefined }] } }), 'Price saved');
    if (r) onSaved();
  };
  return (
    <Modal title="Special price for this customer" onClose={onClose}>
      <div className="space-y-4">
        {product ? <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-small"><span className="font-medium">{product.name}<span className="ml-2 text-caption text-ink-500">list {money(product.wholesale_price ?? product.selling_price)} / {product.unit}</span></span><button type="button" className="text-brand-600" onClick={() => setProduct(null)}>Change</button></div> : <ProductPicker onPick={(p) => { setProduct(p); setF((x) => ({ ...x, unit_name: '' })); }} autoFocus />}
        {product && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pr-unit" label="Unit"><Select id="pr-unit" value={f.unit_name} onChange={(e) => setF({ ...f, unit_name: e.target.value })}><option value="">{product.unit} (base)</option>{(product.units || []).map((u) => <option key={u.unit_name} value={u.unit_name}>{u.unit_name} ({u.factor} {product.unit})</option>)}</Select></Field>
            <NumberField id="pr-min" label="From quantity" hint="A quantity break: this price applies at or above it" min={0.001} value={f.min_qty} onChange={(v) => setF({ ...f, min_qty: v })} />
            <div className="sm:col-span-2"><Segmented label="Kind" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'PRICE', label: 'Fixed price' }, { value: 'DISCOUNT', label: '% off list price' }]} /></div>
            <NumberField id="pr-val" label={f.kind === 'PRICE' ? 'Price per unit' : 'Discount'} prefix={f.kind === 'PRICE' ? '₹' : undefined} suffix={f.kind === 'DISCOUNT' ? '%' : undefined} value={f.value} onChange={(v) => setF({ ...f, value: v })} />
            <div />
            <Field id="pr-from" label="Valid from"><Input id="pr-from" type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} /></Field>
            <Field id="pr-to" label="Valid until"><Input id="pr-to" type="date" value={f.ends_on} min={f.starts_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} /></Field>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!product || !(Number(f.value) >= 0) || f.value === ''} onClick={save}>Save price</Button></div>
      </div>
    </Modal>
  );
};

const Prices = ({ customerId }) => {
  const { can } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(`/wholesale/customers/${customerId}/prices`);
  const [adding, setAdding] = useState(false);
  const remove = async (r) => { if (!(await dialog.confirm({ title: 'Remove this price?', body: 'The customer goes back to the normal price for that product.', confirmLabel: 'Remove', danger: true }))) return; try { await api(`/wholesale/customers/${customerId}/prices/${r.price_id}`, { method: 'DELETE' }); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-small text-ink-500">A price agreed with this customer beats every price list and promotion. Add quantity breaks by adding the same product at a higher “from quantity”.</p>{can('pricing') && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />Add a price</Button>}</div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="No special prices" emptyBody="This customer pays the standard price for their type or list." />
      {data?.length > 0 && (
        <Table><Thead><Th>Product / category</Th><Th>Unit</Th><Th className="text-right">From qty</Th><Th className="text-right">Price</Th><Th>Valid</Th><Th><span className="sr-only">Remove</span></Th></Thead>
          <tbody>{data.map((r) => <Tr key={r.price_id}><Td className="font-medium">{r.product || r.category}{r.category && !r.product && <Badge tone="neutral">category</Badge>}</Td><Td>{r.unit_name || 'base'}</Td><Td className="text-right tabular">{r.min_qty}</Td>
            <Td className="text-right tabular font-medium">{r.price != null ? money(r.price) : `${r.discount_pct}% off`}</Td><Td className="text-caption text-ink-500">{r.starts_on || r.ends_on ? `${r.starts_on ? dateText(r.starts_on) : 'now'} → ${r.ends_on ? dateText(r.ends_on) : 'open'}` : 'Always'}</Td>
            <Td className="text-right">{can('pricing') && <button type="button" aria-label="Remove price" onClick={() => remove(r)} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><Trash className="h-4 w-4" /></button>}</Td></Tr>)}</tbody></Table>
      )}
      {adding && <PriceRule customerId={customerId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
};

/* ── invoices and orders ──────────────────────────────────────────────────── */

const Invoices = ({ customerId }) => {
  const [offset, setOffset] = useState(0);
  const { data, meta, loading, error } = useLoad(`/wholesale/customers/${customerId}/invoices${qs({ limit: 25, offset })}`, { paged: true });
  return (
    <div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="No invoices yet" emptyBody="Invoices appear here when an order is dispatched." />
      {data?.length > 0 && <><Table><Thead><Th>Invoice</Th><Th>Date</Th><Th>Due</Th><Th>Status</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th></Thead>
        <tbody>{data.map((i) => <Tr key={i.invoice_id}><Td><Link to={`/app/billing/invoices/${i.invoice_id}`} className="font-medium text-brand-700">{i.invoice_number}</Link></Td><Td>{dateText(i.invoice_date)}</Td><Td>{i.due_date ? dateText(i.due_date) : '—'}</Td>
          <Td>{i.status === 'CANCELLED' ? <Badge tone="neutral">Cancelled</Badge> : <StatusPill map={PAY_STATUS} status={i.payment_status} />}</Td><Td className="text-right tabular">{money(i.total)}</Td><Td className={`text-right tabular ${i.balance_due > 0 ? 'font-semibold' : 'text-ink-400'}`}>{i.balance_due > 0 ? money(i.balance_due) : '—'}</Td></Tr>)}</tbody></Table><Pager meta={meta} onPage={setOffset} /></>}
    </div>
  );
};

const CustomerOrders = ({ customerId }) => {
  const { data, loading, error } = useLoad(`/wholesale/orders${qs({ customer_id: customerId, limit: 25 })}`, { paged: true });
  return (
    <div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="No orders yet" />
      {data?.length > 0 && <Table><Thead><Th>Order</Th><Th>Date</Th><Th>Status</Th><Th className="text-right">Total</Th></Thead><tbody>{data.map((o) => <Tr key={o.order_id}><Td><Link to={`/app/wholesale/orders/${o.order_id}`} className="font-medium text-brand-700">{o.order_number}</Link></Td><Td>{dateText(o.order_date)}</Td><Td><StatusPill map={ORDER_STATUS} status={o.status} /></Td><Td className="text-right tabular">{money(o.total)}</Td></Tr>)}</tbody></Table>}
    </div>
  );
};

/* ── the page ─────────────────────────────────────────────────────────────── */

const CustomerProfile = () => {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const [stamp, setStamp] = useState(0);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const { data: c, loading, error, reload } = useLoad(`/wholesale/customers/${id}?k=${stamp}`);
  const ageing = useLoad(`/wholesale/customers/${id}/ageing?k=${stamp}`);
  const refresh = () => { setStamp((n) => n + 1); };
  const setTab = (k) => setParams(k === 'overview' ? {} : { tab: k }, { replace: true });

  if (error) return <div><PageHeader title="Customer" /><Alert>{error}</Alert><Button to="/app/wholesale/customers" variant="secondary">Back to customers</Button></div>;
  if (loading && !c) return <div className="space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-40" /></div>;
  if (!c) return null;
  const cr = c.credit;
  const archive = async () => {
    const restore = c.status === 'ARCHIVED';
    if (!(await dialog.confirm({ title: restore ? 'Restore this customer?' : 'Archive this customer?', body: restore ? 'They can be used on orders again.' : 'They disappear from pickers and lists. Their history is kept.', confirmLabel: restore ? 'Restore' : 'Archive', danger: !restore }))) return;
    try { await api(`/wholesale/customers/${id}/${restore ? 'restore' : 'archive'}`, { method: 'POST', body: {} }); toast.success(restore ? 'Customer restored' : 'Customer archived'); reload(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3">{c.name}<Badge tone="neutral">{CUSTOMER_TYPES[c.customer_type] || c.customer_type}</Badge>{c.status === 'ARCHIVED' && <Badge tone="warning">Archived</Badge>}</span>}
                  lead={[c.phone, c.email, c.gstin && `GSTIN ${c.gstin}`].filter(Boolean).join(' · ') || 'No contact details yet'}
                  action={<>
                    {can('payments') && <Button onClick={() => setPaying(true)}>Record payment</Button>}
                    {can('sales_orders') && c.status === 'ACTIVE' && <Button variant="secondary" to={`/app/wholesale/orders/new?customer=${c.customer_id}`}><Plus aria-hidden="true" className="h-4 w-4" />New order</Button>}
                    {can('customers') && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</Button>}
                    {can('customers') && <Button variant="ghost" onClick={archive}>{c.status === 'ARCHIVED' ? 'Restore' : 'Archive'}</Button>}
                  </>} />
      <section aria-label="Position" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard size="lg" label="Owes now" value={money(c.outstanding)} tone={c.outstanding > 0 ? 'warning' : c.outstanding < 0 ? 'success' : undefined} note={c.outstanding < 0 ? 'In advance' : c.overdue > 0 ? `${money(c.overdue)} overdue` : 'Nothing overdue'} />
        <StatCard size="lg" label="Credit limit" value={cr.limit ? money(cr.limit) : 'None'} note={cr.limit ? `${pct(cr.utilization_pct)} used${cr.promised ? ` · ${money(cr.promised)} on open orders` : ''}` : 'No limit set'} tone={cr.utilization_pct > 100 ? 'danger' : cr.utilization_pct > 80 ? 'warning' : undefined} />
        <StatCard size="lg" label="Available credit" value={cr.available != null ? money(cr.available) : '—'} tone={cr.available != null && cr.available < 0 ? 'danger' : undefined} note={`Policy: ${cr.policy === 'BLOCK' ? 'block' : cr.policy === 'WARN' ? 'warn' : 'allow'}`} />
        <StatCard size="lg" label="Invoiced to date" value={money(c.total_invoiced)} note={`${c.stats.invoices} invoices · ${c.stats.open_orders} open orders`} />
      </section>
      <Tabs tabs={[{ key: 'overview', label: 'Overview' }, { key: 'ledger', label: 'Ledger' }, { key: 'invoices', label: 'Invoices' }, { key: 'orders', label: 'Orders' }, ...(can('pricing') || can('sales_orders') ? [{ key: 'prices', label: 'Special prices' }] : [])]} value={tab} onChange={setTab} />
      {tab === 'overview' && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
          <Panel title="Details">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-small">
              {[['Contact person', c.contact_person], ['PAN', c.pan], ['Payment terms', c.payment_terms_days != null ? `${c.payment_terms_days} days` : 'Business default'], ['Salesperson', c.salesperson], ['Price list', c.price_list || 'Default'],
                ['Standing discount', c.default_discount_pct ? `${c.default_discount_pct}%` : '—'], ['Opening balance', money(c.opening_balance)], ['Last invoice', c.stats.last_invoice ? longDate(c.stats.last_invoice) : '—'], ['Average invoice', c.stats.average_invoice ? money(c.stats.average_invoice) : '—']].map(([k, v]) => <div key={k}><dt className="text-caption text-ink-500">{k}</dt><dd className="font-medium text-ink-900">{v || '—'}</dd></div>)}
            </dl>
            {c.notes && <p className="mt-4 whitespace-pre-line border-t border-line pt-3 text-small text-ink-700">{c.notes}</p>}
          </Panel>
          <Panel title="Addresses">
            <div className="grid gap-4 text-small sm:grid-cols-2">
              <div><p className="text-caption text-ink-500">Billing</p><p className="whitespace-pre-line text-ink-900">{c.billing_address || '—'}</p><p className="text-ink-500">{[c.city, c.state, c.pincode].filter(Boolean).join(', ')}</p></div>
              <div><p className="text-caption text-ink-500">Shipping</p><p className="whitespace-pre-line text-ink-900">{c.shipping_address || 'Same as billing'}</p><p className="text-ink-500">{[c.shipping_city, c.shipping_state, c.shipping_pincode].filter(Boolean).join(', ')}</p></div>
            </div>
          </Panel>
          <Panel title="What they owe, by age" lead="Days past the due date" className="lg:col-span-2">
            {ageing.data ? (ageing.data.invoices.length ? <><StackStrip parts={BUCKETS.map(([k, label]) => ({ label, value: ageing.data.buckets[k], tone: BUCKET_TONES[k] }))} />
              <div className="mt-4"><Table><Thead><Th>Invoice</Th><Th>Due</Th><Th className="text-right">Days late</Th><Th className="text-right">Balance</Th></Thead><tbody>{ageing.data.invoices.map((i) => <Tr key={i.invoice_id}><Td><Link to={`/app/billing/invoices/${i.invoice_id}`} className="font-medium text-brand-700">{i.invoice_number}</Link></Td><Td>{dateText(i.due_date)}</Td><Td className={`text-right tabular ${i.days_overdue > 0 ? 'text-danger' : 'text-ink-400'}`}>{i.days_overdue > 0 ? i.days_overdue : '—'}</Td><Td className="text-right tabular font-medium">{money(i.balance)}</Td></Tr>)}</tbody></Table></div></>
              : <EmptyState compact title="Nothing owed" body="All invoices are paid." />) : <Skeleton className="h-20" />}
          </Panel>
        </div>
      )}
      {tab === 'ledger' && <Ledger customer={c} reloadKey={stamp} onChanged={refresh} />}
      {tab === 'invoices' && <Invoices customerId={c.customer_id} />}
      {tab === 'orders' && <CustomerOrders customerId={c.customer_id} />}
      {tab === 'prices' && <Prices customerId={c.customer_id} />}
      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />}
      {paying && <ReceiptModal customer={{ customer_id: c.customer_id, name: c.name, customer_type: c.customer_type, phone: c.phone, gstin: c.gstin }} onClose={() => setPaying(false)} onDone={() => { setPaying(false); refresh(); }} />}
    </div>
  );
};

export default CustomerProfile;
