/*
 * Stock & alerts for a salon: what needs attention (low, out, expiring, expired, negative, unusual use), which
 * batches are on the shelf and when they expire, and adding stock with a batch number and expiry date.
 *
 * Levels, counts, wastage, transfers and purchase orders are FlowXP's ordinary inventory and buying screens —
 * this page links to them rather than duplicating them. Service consumption comes off stock automatically when a
 * service is billed (see Services → consumables).
 */
import { useEffect, useState } from 'react';
import { Boxes, PackagePlus, Search } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { longDate, qs, useDebounced, useLoad } from '../../lib/salon.js';
import { Alert, Badge, Button, EmptyState, Field, Input, ListState, Modal, PageHeader, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Chips, NumberField, SelectField, Tabs, useAction } from './parts.jsx';

/* ── alerts ───────────────────────────────────────────────────────────────── */

const Section = ({ title, tone, items, render, empty }) => (
  <section className="rounded-(--radius-card) border border-line bg-surface">
    <header className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="text-body font-semibold text-ink-900">{title}</h2><Badge tone={items.length ? tone : 'neutral'}>{items.length}</Badge></header>
    {items.length === 0 ? <p className="px-5 py-4 text-small text-ink-500">{empty}</p> : <ul className="divide-y divide-line">{items.map(render)}</ul>}
  </section>
);

const AlertsTab = () => {
  const { data, loading, error } = useLoad('/salon/alerts');
  if (loading && !data) return <ListState loading />;
  if (error) return <Alert>{error}</Alert>;
  const c = data.counts;
  const row = (p, detail) => <li key={`${p.product_id}-${p.batch_id || ''}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-small"><span className="min-w-0"><span className="block truncate font-medium text-ink-900">{p.name}</span>{p.batch_no && <span className="text-caption text-ink-500">Batch {p.batch_no}</span>}</span><span className="shrink-0 text-ink-700">{detail}</span></li>;
  const all = c.low_stock + c.out_of_stock + c.expiring_soon + c.expired + c.negative_stock + c.unusual_consumption;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Low on stock" value={c.low_stock} tone={c.low_stock ? 'warning' : undefined} />
        <StatCard label="Out of stock" value={c.out_of_stock} tone={c.out_of_stock ? 'danger' : undefined} />
        <StatCard label="Expiring soon" value={c.expiring_soon} tone={c.expiring_soon ? 'warning' : undefined} note={`within ${data.settings.expiry_alert_days} days`} />
        <StatCard label="Expired" value={c.expired} tone={c.expired ? 'danger' : undefined} />
        <StatCard label="Negative stock" value={c.negative_stock} tone={c.negative_stock ? 'danger' : undefined} />
        <StatCard label="Unusual use" value={c.unusual_consumption} tone={c.unusual_consumption ? 'warning' : undefined} />
      </div>
      {all === 0 && <EmptyState icon={Boxes} title="Stock looks healthy" body="Nothing is low, expiring or out of the ordinary." />}
      <div className="grid gap-5 lg:grid-cols-2">
        {data.expired.length > 0 && <Section title="Expired — take off the shelf" tone="danger" items={data.expired} render={(b) => row(b, `${b.remaining} ${b.unit} · expired ${longDate(b.expiry_date)}`)} />}
        {data.expiring_soon.length > 0 && <Section title="Expiring soon" tone="warning" items={data.expiring_soon} render={(b) => row(b, `${b.remaining} ${b.unit} · ${b.days_to_expiry === 0 ? 'today' : `${b.days_to_expiry} day${b.days_to_expiry === 1 ? '' : 's'}`}`)} />}
        {data.out_of_stock.length > 0 && <Section title="Out of stock" tone="danger" items={data.out_of_stock} render={(p) => row(p, p.kind === 'CONSUMABLE' ? 'Consumable' : 'Retail')} />}
        {data.low_stock.length > 0 && <Section title="Low on stock" tone="warning" items={data.low_stock} render={(p) => row(p, `${p.stock} ${p.unit} left · reorder at ${p.min_stock}`)} />}
        {data.negative_stock.length > 0 && <Section title="Negative stock — check the counts" tone="danger" items={data.negative_stock} render={(p) => row(p, `${p.stock} ${p.unit}`)} />}
        {data.unusual_consumption.length > 0 && <Section title="Using more than usual" tone="warning" items={data.unusual_consumption} render={(p) => row(p, `${p.last_7_days} ${p.unit} this week vs ${p.usual_week} usual (${p.times_usual}×)`)} />}
      </div>
      <div className="flex flex-wrap gap-2 text-small">
        <Button to="/app/purchases" variant="secondary" size="sm">Order more</Button>
        <Button to="/app/inventory" variant="secondary" size="sm">Count, adjust or log wastage</Button>
      </div>
    </div>
  );
};

/* ── batches ──────────────────────────────────────────────────────────────── */

const BatchesTab = () => {
  const [showAll, setShowAll] = useState(false);
  const list = useLoad(`/salon/stock/batches${qs({ include_empty: showAll ? 1 : '' })}`);
  const rows = list.data || [];
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Chips label="Show" value={showAll ? 'all' : 'left'} onChange={(v) => setShowAll(v === 'all')} options={[{ value: 'left', label: 'Still on the shelf' }, { value: 'all', label: 'Including used up' }]} />
        <p className="hidden text-caption text-ink-500 sm:block">Soonest-to-expire batches are assumed to be used first.</p>
      </div>
      <ListState loading={list.loading && !list.data} error={list.error} empty={!list.loading && rows.length === 0} emptyIcon={Boxes} emptyLabel="No batches recorded." emptyBody="Add stock with a batch number and expiry date — from here or when you receive a purchase order." />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>Item</Th><Th>Batch</Th><Th className="text-right">Left</Th><Th className="text-right">Received</Th><Th>Expires</Th><Th>Received on</Th></Thead>
          <tbody>
            {rows.map((b) => (
              <Tr key={b.batch_id}>
                <Td className="font-medium">{b.product}{b.branch && <span className="block text-caption text-ink-500">{b.branch}</span>}</Td>
                <Td>{b.batch_no || <span className="text-ink-400">—</span>}</Td>
                <Td className="text-right tabular">{b.remaining} {b.unit}</Td><Td className="text-right tabular text-ink-500">{b.received}</Td>
                <Td className="whitespace-nowrap">{b.expiry_date ? <>{longDate(b.expiry_date)} <Badge tone={b.status === 'EXPIRED' ? 'danger' : b.days_to_expiry <= 30 ? 'warning' : 'neutral'}>{b.status === 'EXPIRED' ? 'Expired' : `${b.days_to_expiry}d`}</Badge></> : <span className="text-ink-400">No expiry</span>}</Td>
                <Td className="whitespace-nowrap text-ink-500">{b.received_on ? longDate(String(b.received_on).slice(0, 10)) : '—'}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

/* ── stock in ─────────────────────────────────────────────────────────────── */

const ProductSearch = ({ value, onChange }) => {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let live = true;
    if (term.length < 2) { setRows([]); return undefined; }
    Promise.all([api(`/salon/products${qs({ type: 'PRODUCT', q: term, limit: 8 })}`), api(`/salon/products${qs({ type: 'CONSUMABLE', q: term, limit: 8 })}`)])
      .then(([a, b]) => { if (live) setRows([...a, ...b]); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [term]);
  if (value) return <div className="flex items-center justify-between rounded-(--radius-control) border border-line bg-surface-2 px-3 py-2 text-small"><span className="font-medium text-ink-900">{value.name}</span><button type="button" onClick={() => onChange(null)} className="text-caption font-semibold text-brand-600">Change</button></div>;
  return (
    <div className="relative">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <Input id="si-product" type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a product or consumable" className="pl-9" aria-label="Product" />
      {term.length >= 2 && <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-(--radius-card) border border-line bg-surface p-1 shadow-lg">
        {rows.length === 0 ? <p className="px-3 py-2 text-caption text-ink-500">Nothing matches “{term}”. Add it under Products first.</p> : rows.map((p) => <button key={p.product_id} type="button" onClick={() => { onChange(p); setQ(''); }} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-small hover:bg-surface-2"><span className="font-medium text-ink-900">{p.name}</span><span className="text-caption text-ink-500">{p.kind === 'DISH' ? 'Retail' : 'Consumable'} · {p.stock} {p.unit}</span></button>)}
      </div>}
    </div>
  );
};

const StockInModal = ({ onSaved, onClose }) => {
  const [product, setProduct] = useState(null);
  const [form, setForm] = useState({ quantity: '', batch_no: '', expiry_date: '', unit_cost: '', reason: 'OPENING', note: '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (!product) { setError('Choose what you are adding'); return; }
    const body = { product_id: product.product_id, quantity: Number(form.quantity), batch_no: form.batch_no || null, expiry_date: form.expiry_date || null, unit_cost: form.unit_cost === '' ? null : Number(form.unit_cost), reason: form.reason, note: form.note || null };
    const out = await run(() => api('/salon/stock/in', { method: 'POST', body, idempotencyKey: crypto.randomUUID() }).catch((c) => { setError(c.message); throw c; }), `${product.name} added to stock`);
    if (out) onSaved();
  };
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal title="Add stock" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-caption text-ink-500">For opening balances and corrections. Stock you buy from a supplier is best received through a purchase order, which records the batch too.</p>
        <Alert>{error}</Alert>
        <Field id="si-product" label="Item"><ProductSearch value={product} onChange={setProduct} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField id="si-qty" label="Quantity" suffix={product?.unit} min={0} value={form.quantity} onChange={set('quantity')} required />
          <NumberField id="si-cost" label="Cost each" prefix="₹" value={form.unit_cost} onChange={set('unit_cost')} />
          <Field id="si-batch" label="Batch number"><Input id="si-batch" value={form.batch_no} onChange={(e) => set('batch_no')(e.target.value)} /></Field>
          <Field id="si-exp" label="Expiry date"><Input id="si-exp" type="date" value={form.expiry_date} onChange={(e) => set('expiry_date')(e.target.value)} /></Field>
          <SelectField id="si-reason" label="Why" value={form.reason} onChange={set('reason')}><option value="OPENING">Opening stock</option><option value="ADJUSTMENT">Count correction</option></SelectField>
          <Field id="si-note" label="Note"><Input id="si-note" value={form.note} onChange={(e) => set('note')(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Add stock</Button></div>
      </form>
    </Modal>
  );
};

/* ── the page ─────────────────────────────────────────────────────────────── */

const SalonStock = () => {
  const { can } = useAuth();
  const [tab, setTab] = useState(can('inventory') ? 'alerts' : 'alerts');
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  return (
    <div>
      <PageHeader title="Stock & alerts" lead="What is running low, what is about to expire, and what is on the shelf."
                  action={can('inventory') && <><Button to="/app/inventory" variant="secondary">Inventory</Button><Button onClick={() => setAdding(true)}><PackagePlus aria-hidden="true" className="h-4 w-4" />Add stock</Button></>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'alerts', label: 'Alerts' }, ...(can('inventory') ? [{ key: 'batches', label: 'Batches & expiry' }] : [])]} />
      {tab === 'alerts' && <AlertsTab key={version} />}
      {tab === 'batches' && <BatchesTab key={version} />}
      {adding && <StockInModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setVersion((v) => v + 1); }} />}
    </div>
  );
};

export default SalonStock;
