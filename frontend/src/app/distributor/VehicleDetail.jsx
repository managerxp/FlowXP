/*
 * One van: what it carries (by product and batch, with expiry), what it sold today, and the four things you do with it —
 * load it from the warehouse, sell from it, count it at the end of the day, send the unsold stock back.
 * Selling from a van invoices through the normal billing and takes the goods off the van, never off the warehouse.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClipboardCheck, Pencil, Plus, Trash } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { PAYMENT_METHODS, dateText, money, qty, useLoad } from '../../lib/distributor.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Skeleton, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, Toggle, useAction } from '../wholesale/parts.jsx';
import { CustomerPicker, ProductPicker } from '../wholesale/parts.jsx';
import { VehicleForm } from './Vehicles.jsx';

/** Lines of product + unit + quantity. `onPick` fetches the product so its units can be chosen. */
const LinesEditor = ({ lines, setLines, stockOf }) => {
  const add = async (p) => {
    const full = await api(`/wholesale/products/${p.product_id}`);
    setLines((l) => (l.some((x) => x.product_id === p.product_id) ? l : [...l, { product_id: p.product_id, name: p.name, base: full.unit, units: [full.unit, ...(full.units || []).map((u) => u.unit_name)].filter((v, i, a) => a.indexOf(v) === i), unit_name: p.matched_unit || '', quantity: '' }]));
  };
  const patch = (id, k, v) => setLines((l) => l.map((x) => (x.product_id === id ? { ...x, [k]: v } : x)));
  return (
    <div className="space-y-3">
      <ProductPicker onPick={add} autoFocus />
      {lines.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {lines.map((l) => (
            <li key={l.product_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-small font-medium">{l.name}{stockOf && <span className="ml-2 text-caption font-normal text-ink-500">{stockOf(l.product_id)}</span>}</span>
              <input aria-label={`Quantity of ${l.name}`} inputMode="decimal" value={l.quantity} onChange={(e) => patch(l.product_id, 'quantity', e.target.value)} className="h-9 w-24 rounded-lg border border-line px-2 text-right text-small tabular" />
              <select aria-label={`Unit for ${l.name}`} value={l.unit_name} onChange={(e) => patch(l.product_id, 'unit_name', e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-small">{l.units.map((u) => <option key={u} value={u === l.base ? '' : u}>{u}</option>)}</select>
              <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((x) => x.filter((y) => y.product_id !== l.product_id))} className="rounded p-1 text-ink-400 hover:text-danger"><Trash aria-hidden="true" className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
const bodyLines = (lines) => lines.filter((l) => Number(l.quantity) > 0).map((l) => ({ product_id: l.product_id, unit_name: l.unit_name || undefined, quantity: Number(l.quantity) }));

const LoadModal = ({ van, onClose, onDone }) => {
  const [lines, setLines] = useState([]);
  const [busy, run] = useAction();
  const key = useIdempotencyKey();
  const save = async () => { try { const r = await run(() => api(`/distributor/vehicles/${van.vehicle_id}/load`, { method: 'POST', body: { items: bodyLines(lines) }, idempotencyKey: key.get() }), 'Loaded'); if (r) onDone(r); } finally { key.settle(); } };
  return (
    <Modal title={`Load ${van.vehicle_no}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-small text-ink-500">Stock comes out of {van.warehouse}, soonest-expiring batches first. Stock already promised to orders cannot be loaded.</p>
        <LinesEditor lines={lines} setLines={setLines} />
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!bodyLines(lines).length}>Load onto van</Button></div>
      </div>
    </Modal>
  );
};

const SellModal = ({ van, stock, onClose, onDone }) => {
  const toast = useToast();
  const [customer, setCustomer] = useState(null);
  const [lines, setLines] = useState([]);
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState('CASH');
  const [full, setFull] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, run] = useAction();
  const key = useIdempotencyKey();
  const onVan = (id) => { const q = stock.filter((s) => s.product_id === id).reduce((t, s) => t + s.qty, 0); return `${qty(q)} on van`; };
  const check = async () => { const r = await run(() => api('/wholesale/orders/preview', { method: 'POST', body: { customer_id: customer.customer_id, lines: bodyLines(lines) } })); if (r) setPreview(r); };
  const sell = async () => {
    const payment = full ? { amount: 'FULL', method, ...(method !== 'CASH' ? { reference_number: 'van' } : {}) } : Number(paid) > 0 ? { amount: Number(paid), method, ...(method !== 'CASH' ? { reference_number: 'van' } : {}) } : undefined;
    try {
      const r = await run(() => api(`/distributor/vehicles/${van.vehicle_id}/sell`, { method: 'POST', body: { customer_id: customer.customer_id, lines: bodyLines(lines), ...(payment ? { payment } : {}) }, idempotencyKey: key.get() }), null);
      if (r) { toast.success(`Invoice ${r.invoice_number} · ${money(r.invoice_total)}`); onDone(r); }
    } finally { key.settle(); }
  };
  return (
    <Modal title={`Sell from ${van.vehicle_no}`} onClose={onClose} wide>
      <div className="space-y-4">
        <Field id="sv-cust" label="Retailer"><CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setPreview(null); }} /></Field>
        <LinesEditor lines={lines} setLines={(l) => { setLines(l); setPreview(null); }} stockOf={onVan} />
        {preview && <div className="rounded-lg bg-surface-2 p-3 text-small"><ul className="space-y-1">{preview.lines.map((l) => <li key={l.line_no} className="flex justify-between gap-3"><span>{l.product} × {qty(l.quantity)} {l.unit_name}{l.is_free && <Badge tone="success">free</Badge>}</span><span className="tabular">{l.is_free ? 'Free' : money(l.line_total)}</span></li>)}</ul>
          <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold"><span>Total with GST</span><span className="tabular">{money(preview.total)}</span></div>
          {preview.credit?.level && preview.credit.level !== 'OK' && <p className="mt-2 text-warning">{preview.credit.reasons.join('. ')}</p>}
          {preview.scheme_hints?.map((h) => <p key={h.scheme_id} className="mt-1 text-caption text-brand-700">{h.message}</p>)}</div>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Toggle id="sv-full" checked={full} onChange={setFull} label="Paid in full now" />
          {!full && <NumberField id="sv-paid" label="Paid now" prefix="₹" hint="The rest stays on credit" value={paid} onChange={(e) => setPaid(e.target.value)} />}
          <Field id="sv-method" label="Paid by"><Select id="sv-method" value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(PAYMENT_METHODS).filter(([k]) => k !== 'CHEQUE').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="secondary" onClick={check} loading={busy} disabled={!customer || !bodyLines(lines).length}>Check price</Button><Button onClick={sell} loading={busy} disabled={!customer || !bodyLines(lines).length}>Sell and invoice</Button></div>
      </div>
    </Modal>
  );
};

const CountModal = ({ van, stock, onClose, onDone }) => {
  const [counts, setCounts] = useState(() => Object.fromEntries(stock.map((s) => [s.stock_id, String(s.qty)])));
  const [back, setBack] = useState(true);
  const [note, setNote] = useState('');
  const [result, setResult] = useState(null);
  const [busy, run] = useAction();
  const key = useIdempotencyKey();
  const diff = (s) => Number(counts[s.stock_id] ?? s.qty) - s.qty;
  const submit = async () => {
    try { const r = await run(() => api(`/distributor/vehicles/${van.vehicle_id}/reconcile`, { method: 'POST', body: { counts: stock.map((s) => ({ stock_id: s.stock_id, counted: Number(counts[s.stock_id] ?? s.qty) })), return_to_warehouse: back, note: note || undefined }, idempotencyKey: key.get() }), 'Counted'); if (r) setResult(r); } finally { key.settle(); }
  };
  if (result) return (
    <Modal title="Count recorded" onClose={() => onDone(result)}>
      <div className="space-y-3 text-small">
        <p>{result.shortage > 0 ? <>Shortage written off: <strong>{money(result.shortage)}</strong>. </> : 'No shortage. '}{result.surplus > 0 ? <>Surplus found: <strong>{money(result.surplus)}</strong>. </> : ''}{result.returned ? 'The rest went back to the warehouse.' : 'The counted stock stays on the van.'}</p>
        {result.lines.some((l) => l.variance !== 0) && <Table><Thead><Th>Product</Th><Th className="text-right">Should be</Th><Th className="text-right">Counted</Th><Th className="text-right">Difference</Th></Thead><tbody>{result.lines.filter((l) => l.variance !== 0).map((l, i) => <Tr key={i}><Td>{l.product}{l.batch_no && <span className="ml-1 text-caption text-ink-500">· {l.batch_no}</span>}</Td><Td className="text-right tabular">{qty(l.system)}</Td><Td className="text-right tabular">{qty(l.counted)}</Td><Td className={`text-right tabular ${l.variance < 0 ? 'text-danger' : 'text-success'}`}>{l.variance > 0 ? '+' : ''}{qty(l.variance)}</Td></Tr>)}</tbody></Table>}
        <div className="flex justify-end"><Button onClick={() => onDone(result)}>Done</Button></div>
      </div>
    </Modal>
  );
  return (
    <Modal title={`Count ${van.vehicle_no}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-small text-ink-500">Count what is physically on the van. Anything missing is written off; anything extra is added. Every line must be counted.</p>
        <Table><Thead><Th>Product</Th><Th>Batch</Th><Th className="text-right">Should be</Th><Th className="text-right">Counted</Th><Th className="text-right">Difference</Th></Thead>
          <tbody>{stock.map((s) => <Tr key={s.stock_id}><Td className="font-medium">{s.product}</Td><Td className="text-ink-500">{s.batch_no || '—'}</Td><Td className="text-right tabular">{qty(s.qty)} {s.unit}</Td>
            <Td className="text-right"><input aria-label={`Counted ${s.product}`} inputMode="decimal" value={counts[s.stock_id] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [s.stock_id]: e.target.value }))} className="h-9 w-24 rounded-lg border border-line px-2 text-right text-small tabular" /></Td>
            <Td className={`text-right tabular ${diff(s) < 0 ? 'text-danger' : diff(s) > 0 ? 'text-success' : 'text-ink-400'}`}>{diff(s) === 0 ? '—' : `${diff(s) > 0 ? '+' : ''}${qty(diff(s))}`}</Td></Tr>)}</tbody></Table>
        <Toggle id="cnt-back" checked={back} onChange={setBack} label="Send everything back to the warehouse" hint="End of day: the counted stock goes back into its batches. Leave off to keep it on the van for tomorrow." />
        <Field id="cnt-note" label="Note"><Input id="cnt-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={stock.some((s) => counts[s.stock_id] === '' || !(Number(counts[s.stock_id]) >= 0))}>Record count</Button></div>
      </div>
    </Modal>
  );
};

const VehicleDetail = () => {
  const { id } = useParams();
  const { can, business } = useAuth();
  const dialog = useDialog();
  const [stamp, setStamp] = useState(0);
  const { data: v, loading, error } = useLoad(`/distributor/vehicles/${id}?k=${stamp}`);
  const [modal, setModal] = useState(null);
  const [busy, run] = useAction();
  const refresh = () => setStamp((n) => n + 1);
  if (error) return <div><PageHeader title="Vehicle" /><Alert>{error}</Alert><Button to="/app/distributor/vehicles" variant="secondary">Back</Button></div>;
  if (loading && !v) return <Skeleton className="h-64" />;
  if (!v) return null;
  const manage = can('vehicles');
  const sellOk = manage || can('field_sales');
  const sendBack = async () => { if (await dialog.confirm({ title: 'Take everything off the van?', body: 'All of it goes back to the warehouse, into the batches it came from.', confirmLabel: 'Return it all' })) { const r = await run(() => api(`/distributor/vehicles/${id}/return`, { method: 'POST', body: { all: true }, idempotencyKey: `return-${id}-${Date.now()}` }), 'Back in the warehouse'); if (r) refresh(); } };
  const soon = (d) => d && new Date(d) < new Date(Date.now() + 30 * 86400000);
  void business;
  return (
    <div>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3">{v.vehicle_no}{v.status === 'INACTIVE' && <Badge tone="warning">Inactive</Badge>}</span>} lead={[v.driver_name && `Driver ${v.driver_name}`, v.salesperson && `Salesperson ${v.salesperson}`, `Loads from ${v.warehouse}`, v.route].filter(Boolean).join(' · ')}
                  action={<>
                    {manage && <Button variant="secondary" onClick={() => setModal('edit')}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</Button>}
                    {manage && v.status === 'ACTIVE' && <Button variant="secondary" onClick={() => setModal('load')}><Plus aria-hidden="true" className="h-4 w-4" />Load</Button>}
                    {sellOk && v.status === 'ACTIVE' && v.stock.length > 0 && <Button onClick={() => setModal('sell')}>Sell from van</Button>}
                    {manage && v.stock.length > 0 && <Button variant="secondary" onClick={() => setModal('count')}><ClipboardCheck aria-hidden="true" className="h-4 w-4" />Count &amp; close</Button>}
                    {manage && v.stock.length > 0 && <Button variant="ghost" loading={busy} onClick={sendBack}>Return all</Button>}
                  </>} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Panel title="On the van" lead={v.items ? `${v.items} line${v.items === 1 ? '' : 's'} · ${money(v.stock_value)} at cost` : undefined}>
            <ListState empty={v.stock.length === 0} emptyLabel="The van is empty" emptyBody={manage ? 'Load it from the warehouse to start selling.' : 'Nothing is loaded.'} />
            {v.stock.length > 0 && <Table><Thead><Th>Product</Th><Th>Batch</Th><Th>Expiry</Th><Th className="text-right">Quantity</Th><Th className="text-right">Value</Th></Thead>
              <tbody>{v.stock.map((s) => <Tr key={s.stock_id}><Td className="font-medium">{s.product}<span className="block text-caption text-ink-500">{s.sku}</span></Td><Td>{s.batch_no || '—'}</Td><Td className={soon(s.expiry_date) ? 'font-semibold text-warning' : ''}>{s.expiry_date ? dateText(s.expiry_date) : '—'}</Td><Td className="text-right tabular">{qty(s.qty)} {s.unit}</Td><Td className="text-right tabular">{money(s.value)}</Td></Tr>)}</tbody></Table>}
          </Panel>
          <Panel title="Movements" lead="The last 30 loads, sales, returns and counts">
            {v.moves.length === 0 ? <p className="text-small text-ink-500">Nothing yet.</p> : <Table><Thead><Th>When</Th><Th>What</Th><Th>Product</Th><Th className="text-right">Quantity</Th></Thead>
              <tbody>{v.moves.map((m) => <Tr key={m.move_id}><Td className="text-ink-500">{new Date(m.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Td><Td>{{ LOAD: 'Loaded', SALE: 'Sold', RETURN: 'Returned', COUNT_ADJUST: m.qty < 0 ? 'Shortage' : 'Surplus' }[m.kind]}{m.ref_type === 'invoice' && m.ref_id && <Link to={`/app/billing/invoices/${m.ref_id}`} className="ml-2 text-caption text-brand-600">invoice</Link>}</Td><Td>{m.product}{m.batch_no && <span className="ml-1 text-caption text-ink-500">· {m.batch_no}</span>}</Td><Td className={`text-right tabular ${m.qty < 0 ? 'text-ink-700' : 'text-success'}`}>{m.qty > 0 ? '+' : ''}{qty(m.qty)}</Td></Tr>)}</tbody></Table>}
          </Panel>
        </div>
        <aside className="space-y-4">
          <Panel title="Today"><dl className="space-y-1.5 text-small"><div className="flex justify-between"><dt className="text-ink-500">Sales from this van</dt><dd className="tabular">{v.today.sales}</dd></div><div className="flex justify-between"><dt className="text-ink-500">Sold value</dt><dd className="tabular">{money(v.today.value)}</dd></div></dl></Panel>
          <Panel title="Counts">{v.reconciliations.length === 0 ? <p className="text-small text-ink-500">Not counted yet.</p> : <ul className="space-y-2 text-small">{v.reconciliations.map((r) => <li key={r.recon_id}><span className="block text-ink-900">{new Date(r.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{r.returned ? ' · returned' : ''}</span><span className="text-caption text-ink-500">{r.shortage > 0 ? `Short ${money(r.shortage)}` : 'No shortage'}{r.surplus > 0 ? ` · extra ${money(r.surplus)}` : ''}</span></li>)}</ul>}</Panel>
        </aside>
      </div>
      {modal === 'edit' && <VehicleForm vehicle={v} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
      {modal === 'load' && <LoadModal van={v} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === 'sell' && <SellModal van={v} stock={v.stock} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === 'count' && <CountModal van={v} stock={v.stock} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </div>
  );
};

export default VehicleDetail;
