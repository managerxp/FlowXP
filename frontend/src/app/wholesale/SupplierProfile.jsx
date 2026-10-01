/*
 * One supplier: what you owe, their statement (purchases, payments, debit notes), and their purchase orders.
 */
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Download, Pencil, Plus, Printer } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { PO_STATUS, addDays, dateText, money, qs, saveCsv, todayIn, useLoad } from '../../lib/wholesale.js';
import { Alert, Badge, Button, Field, Input, ListState, PageHeader, Skeleton, StatCard, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Panel, StatusPill, Tabs } from './parts.jsx';
import { SupplierForm } from './WholesaleSuppliers.jsx';

const TYPE_LABEL = { PURCHASE: 'Purchase', PAYMENT: 'Payment', DEBIT_NOTE: 'Debit note', ADJUSTMENT: 'Adjustment' };

const Ledger = ({ supplier }) => {
  const [from, setFrom] = useState(addDays(todayIn(), -180));
  const [to, setTo] = useState(todayIn());
  const { data: l, loading, error } = useLoad(`/wholesale/suppliers/${supplier.supplier_id}/ledger${qs({ from, to })}`);
  const csv = () => saveCsv(`supplier-ledger-${supplier.name.replace(/\W+/g, '-')}.csv`, [{ key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'ref', label: 'Reference' }, { key: 'description', label: 'Description' }, { key: 'debit', label: 'Purchases' }, { key: 'credit', label: 'Paid / returned' }, { key: 'balance', label: 'We owe' }], [{ date: from, type: 'Opening', balance: l.opening }, ...l.lines.map((x) => ({ ...x, type: TYPE_LABEL[x.type] || x.type }))]);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div className="flex items-end gap-2"><Field id="sl-from" label="From"><Input id="sl-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field><Field id="sl-to" label="To"><Input id="sl-to" type="date" value={to} min={from} max={todayIn()} onChange={(e) => setTo(e.target.value)} /></Field></div>
        <div className="flex gap-2">{l && <Button variant="secondary" onClick={csv}><Download aria-hidden="true" className="h-4 w-4" />CSV</Button>}<Button variant="secondary" onClick={() => window.print()}><Printer aria-hidden="true" className="h-4 w-4" />Print</Button></div></div>
      <ListState loading={loading && !l} error={error} />
      {l && <Table><Thead><Th>Date</Th><Th>Type</Th><Th>Reference</Th><Th>Details</Th><Th className="text-right">Purchases</Th><Th className="text-right">Paid / returned</Th><Th className="text-right">We owe</Th></Thead>
        <tbody><Tr><Td className="text-ink-500">{dateText(from)}</Td><Td colSpan={5} className="font-medium text-ink-700">Opening balance</Td><Td className="text-right tabular font-medium">{money(l.opening)}</Td></Tr>
          {l.lines.map((x, i) => <Tr key={i}><Td>{dateText(x.date)}</Td><Td><Badge tone={x.type === 'PURCHASE' ? 'brand' : 'success'}>{TYPE_LABEL[x.type] || x.type}</Badge></Td><Td className="font-medium">{x.type === 'PURCHASE' && x.ref_id ? <Link to={`/app/wholesale/purchasing/${x.ref_id}`} className="text-brand-700">{x.ref}</Link> : x.ref || '—'}</Td><Td className="text-ink-500">{x.description}</Td><Td className="text-right tabular">{x.debit ? money(x.debit) : ''}</Td><Td className="text-right tabular">{x.credit ? money(x.credit) : ''}</Td><Td className="text-right tabular font-medium">{money(x.balance)}</Td></Tr>)}</tbody></Table>}
    </div>
  );
};

const SupplierProfile = () => {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const [stamp, setStamp] = useState(0);
  const [editing, setEditing] = useState(false);
  const { data: s, loading, error } = useLoad(`/wholesale/suppliers/${id}?k=${stamp}`);
  const orders = useLoad(tab === 'orders' ? `/wholesale/purchase-orders${qs({ supplier_id: id, limit: 25 })}` : null, { paged: true });
  if (error) return <div><PageHeader title="Supplier" /><Alert>{error}</Alert><Button to="/app/wholesale/suppliers" variant="secondary">Back to suppliers</Button></div>;
  if (loading && !s) return <div className="space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-40" /></div>;
  if (!s) return null;
  const archive = async () => {
    const restore = s.status === 'ARCHIVED';
    if (!(await dialog.confirm({ title: restore ? 'Restore this supplier?' : 'Archive this supplier?', body: restore ? 'They can be used on purchase orders again.' : 'They disappear from pickers. Their history is kept.', confirmLabel: restore ? 'Restore' : 'Archive', danger: !restore }))) return;
    try { await api(`/wholesale/suppliers/${id}/${restore ? 'restore' : 'archive'}`, { method: 'POST', body: {} }); toast.success(restore ? 'Supplier restored' : 'Supplier archived'); setStamp((n) => n + 1); } catch (e) { toast.error(e.message); }
  };
  return (
    <div>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3">{s.name}{s.status === 'ARCHIVED' && <Badge tone="warning">Archived</Badge>}</span>} lead={[s.phone, s.email, s.gstin && `GSTIN ${s.gstin}`].filter(Boolean).join(' · ') || 'No contact details yet'}
                  action={<>{can('purchases') && s.status === 'ACTIVE' && <Button to={`/app/wholesale/purchasing/new?supplier=${s.supplier_id}`}><Plus aria-hidden="true" className="h-4 w-4" />New purchase order</Button>}{can('suppliers') && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</Button>}{can('suppliers') && <Button variant="ghost" onClick={archive}>{s.status === 'ARCHIVED' ? 'Restore' : 'Archive'}</Button>}</>} />
      <section aria-label="Position" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard size="lg" label="We owe" value={money(s.outstanding)} tone={s.outstanding > 0 ? 'warning' : undefined} /><StatCard size="lg" label="Purchased" value={money(s.total_purchased)} note={`${s.stats.orders} orders`} /><StatCard size="lg" label="Paid" value={money(s.total_paid)} />
        <StatCard size="lg" label="Terms" value={s.payment_terms_days != null ? `${s.payment_terms_days} days` : '—'} note={s.stats.last_order ? `Last order ${dateText(s.stats.last_order)}` : 'No orders yet'} />
      </section>
      <Tabs tabs={[{ key: 'overview', label: 'Overview' }, { key: 'ledger', label: 'Ledger' }, { key: 'orders', label: 'Purchase orders' }]} value={tab} onChange={(k) => setParams(k === 'overview' ? {} : { tab: k }, { replace: true })} />
      {tab === 'overview' && <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Panel title="Details"><dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-small">{[['Contact person', s.contact_person], ['Phone', s.phone], ['Email', s.email], ['GSTIN', s.gstin], ['PAN', s.pan], ['Opening balance', money(s.opening_balance)]].map(([k, v]) => <div key={k}><dt className="text-caption text-ink-500">{k}</dt><dd className="font-medium text-ink-900">{v || '—'}</dd></div>)}</dl></Panel>
        <Panel title="Address and bank"><p className="whitespace-pre-line text-small text-ink-900">{s.address || '—'}</p><p className="text-small text-ink-500">{[s.city, s.state, s.pincode].filter(Boolean).join(', ')}</p>{s.bank_details && <p className="mt-3 border-t border-line pt-3 text-small text-ink-700">{s.bank_details}</p>}</Panel>
      </div>}
      {tab === 'ledger' && <Ledger supplier={s} />}
      {tab === 'orders' && <div><ListState loading={orders.loading && !orders.data} error={orders.error} empty={orders.data?.length === 0} emptyLabel="No purchase orders yet" />{orders.data?.length > 0 && <Table><Thead><Th>Order</Th><Th>Date</Th><Th>Status</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th></Thead><tbody>{orders.data.map((o) => <Tr key={o.po_id}><Td><Link to={`/app/wholesale/purchasing/${o.po_id}`} className="font-medium text-brand-700">{o.po_number}</Link></Td><Td>{dateText(o.po_date)}</Td><Td><StatusPill map={PO_STATUS} status={o.status} /></Td><Td className="text-right tabular">{money(o.total)}</Td><Td className="text-right tabular">{o.balance > 0 ? money(o.balance) : '—'}</Td></Tr>)}</tbody></Table>}</div>}
      {editing && <SupplierForm supplier={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setStamp((n) => n + 1); }} />}
    </div>
  );
};

export default SupplierProfile;
