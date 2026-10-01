/*
 * Warehouse inventory: stock by warehouse (on hand, reserved, available, expired, damaged, in transit), batches and
 * expiry windows, adjustments (opening stock, counts, damage, write-offs), the stock ledger, damaged goods, and
 * warehouses with their bin locations. Stock is always in the product’s base unit.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Plus, Warehouse as WarehouseIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { dateText, fetchAll, longDate, money, qs, qty, saveCsv, useDebounced, useLoad, useWarehouses } from '../../lib/wholesale.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, StatCard, Table, Td, Textarea, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Chips, NumberField, Pager, Panel, ProductPicker, Segmented, Tabs, Toolbar, WarehouseSelect, useAction } from './parts.jsx';
import TransfersTab from './InventoryTransfers.jsx';

const STATE_TONE = { OK: 'neutral', LOW: 'warning', OUT: 'danger', OVER: 'brand' };

/* ── adjust stock ─────────────────────────────────────────────────────────────────────────────── */

const MODES = [['ADD', 'Add stock (found / received)'], ['OPENING', 'Opening stock'], ['REMOVE', 'Remove stock (lost)'], ['COUNT', 'Set to a counted quantity'], ['DAMAGE', 'Damaged (hold aside)'], ['EXPIRED', 'Expired (write off)']];

const AdjustModal = ({ product: start = null, warehouse: wh = '', onClose, onDone }) => {
  const [product, setProduct] = useState(start);
  const [full, setFull] = useState(null);
  const [warehouse, setWarehouse] = useState(wh);
  const [f, setF] = useState({ mode: 'ADD', quantity: '', unit_name: '', batch_no: '', mfg_date: '', expiry_date: '', cost: '', serials: '', reason: '' });
  const [busy, run] = useAction();
  const choose = async (p) => { setProduct(p); setF((x) => ({ ...x, unit_name: '' })); try { setFull(await api(`/wholesale/inventory/product/${p.product_id}`)); } catch { setFull(null); } };
  useEffect(() => { if (start) choose(start); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const tracked = full?.product;
  const isBatch = tracked?.batch_tracking || tracked?.expiry_tracking;
  const batches = (full?.batches || []).filter((b) => !warehouse || String(b.branch_id) === String(warehouse));
  const adding = ['ADD', 'OPENING'].includes(f.mode);
  const units = [{ unit_name: tracked?.unit || product?.unit }, ...((full?.product.units || []).filter((u) => u.factor !== 1))];
  const submit = async () => {
    const body = { branch_id: warehouse ? Number(warehouse) : undefined, product_id: product.product_id, mode: f.mode, quantity: Number(f.quantity), unit_name: f.unit_name || undefined, reason: f.reason || undefined,
      batch_no: f.batch_no || undefined, mfg_date: f.mfg_date || undefined, expiry_date: f.expiry_date || undefined, cost: f.cost === '' ? undefined : Number(f.cost), serials: f.serials ? f.serials.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : undefined };
    const r = await run(() => api('/wholesale/inventory/adjust', { method: 'POST', body }), 'Stock updated');
    if (r) onDone(r);
  };
  return (
    <Modal title="Adjust stock" onClose={onClose} wide>
      <div className="space-y-4">
        {product ? <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-small"><span className="font-medium">{product.name}</span>{!start && <button type="button" className="text-brand-600" onClick={() => { setProduct(null); setFull(null); }}>Change</button>}</div> : <ProductPicker onPick={choose} autoFocus />}
        {product && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <WarehouseSelect value={warehouse} onChange={setWarehouse} id="adj-wh" />
              <Field id="adj-mode" label="What happened"><Select id="adj-mode" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{MODES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <NumberField id="adj-qty" label={f.mode === 'COUNT' ? 'Counted quantity' : 'Quantity'} min={f.mode === 'COUNT' ? 0 : 0.001} value={f.quantity} onChange={(v) => setF({ ...f, quantity: v })} />
              <Field id="adj-unit" label="Unit"><Select id="adj-unit" value={f.unit_name} onChange={(e) => setF({ ...f, unit_name: e.target.value })}>{units.map((u, i) => <option key={u.unit_name} value={i === 0 ? '' : u.unit_name}>{u.unit_name}{i === 0 ? ' (base)' : ` (${u.factor})`}</option>)}</Select></Field>
            </div>
            {isBatch && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="adj-batch" label="Batch number" hint={adding ? undefined : 'Leave blank to take soonest-expiry first'}><Input id="adj-batch" value={f.batch_no} onChange={(e) => setF({ ...f, batch_no: e.target.value })} list="adj-batches" maxLength={40} /></Field>
                <datalist id="adj-batches">{batches.map((b) => <option key={b.batch_id} value={b.batch_no}>{qty(b.qty_on_hand)} on hand</option>)}</datalist>
                {adding && tracked.expiry_tracking && <Field id="adj-exp" label="Expiry date"><Input id="adj-exp" type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></Field>}
                {adding && <Field id="adj-mfg" label="Manufactured"><Input id="adj-mfg" type="date" value={f.mfg_date} onChange={(e) => setF({ ...f, mfg_date: e.target.value })} /></Field>}
                {adding && <NumberField id="adj-cost" label="Cost per unit" prefix="₹" value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />}
              </div>
            )}
            {tracked?.serial_tracking && <Field id="adj-serials" label="Serial numbers" hint="One per line, one for each unit"><Textarea id="adj-serials" rows={3} value={f.serials} onChange={(e) => setF({ ...f, serials: e.target.value })} /></Field>}
            <Field id="adj-reason" label="Reason" hint={f.mode === 'OPENING' ? 'Optional' : 'Kept in the stock ledger'}><Input id="adj-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={200} /></Field>
          </>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!product || f.quantity === '' || (f.mode !== 'OPENING' && f.reason.trim().length < 3)}>Save adjustment</Button></div>
      </div>
    </Modal>
  );
};

/* ── one product's stock ──────────────────────────────────────────────────────────────────────── */

const ProductStock = ({ id, onClose, onAdjust }) => {
  const { can } = useAuth();
  const { data, loading, error, reload } = useLoad(`/wholesale/inventory/product/${id}`);
  const locs = useLoad(data ? `/wholesale/warehouses/${data.warehouses[0]?.branch_id}/locations` : null);
  const [busy, run] = useAction();
  const setBin = async (w, locationId) => { await run(() => api(`/wholesale/products/${id}/bin`, { method: 'PUT', body: { branch_id: w.branch_id, location_id: locationId ? Number(locationId) : null } }), 'Bin saved'); reload(); };
  return (
    <Modal title={data?.product.name || 'Stock'} onClose={onClose} wide>
      <Alert>{error}</Alert>
      {loading && !data && <p className="py-8 text-center text-small text-ink-500">Loading…</p>}
      {data && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 text-small text-ink-500"><span>{[data.product.sku, `base unit ${data.product.unit}`, data.product.units.filter((u) => u.factor !== 1).map((u) => `${u.unit_name} = ${u.factor}`).join(', ')].filter(Boolean).join(' · ')}</span>{can('inventory') && <Button size="sm" onClick={() => onAdjust({ product_id: id, name: data.product.name, unit: data.product.unit })}>Adjust stock</Button>}</div>
          <Table><Thead><Th>Warehouse</Th><Th>Bin</Th><Th className="text-right">On hand</Th><Th className="text-right">Reserved</Th><Th className="text-right">Expired</Th><Th className="text-right">Damaged</Th><Th className="text-right">Available</Th></Thead>
            <tbody>{data.warehouses.map((w) => <Tr key={w.branch_id}><Td className="font-medium">{w.warehouse}</Td>
              <Td>{can('inventory') && (locs.data || []).length ? <div className="w-28"><Select aria-label={`Bin in ${w.warehouse}`} value={w.location_id ?? ''} disabled={busy} onChange={(e) => setBin(w, e.target.value)}><option value="">—</option>{locs.data.map((l) => <option key={l.location_id} value={l.location_id}>{l.code}</option>)}</Select></div> : w.bin || '—'}</Td>
              <Td className="text-right tabular">{qty(w.quantity)}</Td><Td className="text-right tabular">{qty(w.reserved)}</Td><Td className={`text-right tabular ${w.expired ? 'text-danger' : ''}`}>{qty(w.expired)}</Td><Td className="text-right tabular">{qty(w.damaged)}</Td><Td className="text-right tabular font-semibold">{qty(w.available)}</Td></Tr>)}</tbody></Table>
          {data.batches.length > 0 && <div><h3 className="mb-2 text-small font-semibold text-ink-900">Batches</h3><Table><Thead><Th>Batch</Th><Th>Warehouse</Th><Th>Expiry</Th><Th className="text-right">On hand</Th><Th className="text-right">Cost</Th></Thead>
            <tbody>{data.batches.map((b) => <Tr key={b.batch_id}><Td className="font-medium">{b.batch_no}</Td><Td className="text-ink-500">{data.warehouses.find((w) => w.branch_id === b.branch_id)?.warehouse}</Td><Td className={b.days_left != null && b.days_left < 0 ? 'font-semibold text-danger' : b.days_left != null && b.days_left <= 30 ? 'text-warning' : ''}>{b.expiry_date ? `${dateText(b.expiry_date, { day: 'numeric', month: 'short', year: 'numeric' })}${b.days_left != null ? ` (${b.days_left < 0 ? 'expired' : `${b.days_left} d`})` : ''}` : '—'}</Td><Td className="text-right tabular">{qty(b.qty_on_hand)}</Td><Td className="text-right tabular">{b.cost != null ? money(b.cost) : '—'}</Td></Tr>)}</tbody></Table></div>}
          <div><h3 className="mb-2 text-small font-semibold text-ink-900">Recent movements</h3>
            {data.movements.length === 0 ? <p className="text-small text-ink-400">No movements yet.</p> : <Table><Thead><Th>When</Th><Th>Type</Th><Th className="text-right">Quantity</Th><Th>Note</Th></Thead>
              <tbody>{data.movements.map((m) => <Tr key={m.txn_id}><Td>{longDate(m.created_at)}</Td><Td><Badge tone="neutral">{m.transaction_type.replace(/_/g, ' ').toLowerCase()}</Badge></Td><Td className={`text-right tabular ${m.quantity < 0 ? 'text-danger' : 'text-success'}`}>{m.quantity > 0 ? '+' : ''}{qty(m.quantity)}</Td><Td className="text-ink-500">{m.notes || m.by || ''}</Td></Tr>)}</tbody></Table>}</div>
        </div>
      )}
    </Modal>
  );
};

/* ── tabs ─────────────────────────────────────────────────────────────────────────────────────── */

const StockTab = ({ onAdjust }) => {
  const { can } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [state, setState] = useState(params.get('state') || '');
  const [warehouse, setWarehouse] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(null);
  const term = useDebounced(q.trim(), 250);
  const alerts = useLoad(`/wholesale/inventory/alerts${qs({ branch_id: warehouse })}`);
  const { data, meta, loading, error } = useLoad(`/wholesale/inventory${qs({ q: term, state, branch_id: warehouse, limit: 50, offset })}`, { paged: true });
  const a = alerts.data;
  const exportCsv = async () => {
    try { const res = await fetchAll(`/wholesale/inventory${qs({ q: term, state, branch_id: warehouse })}`); saveCsv('stock.csv', [{ key: 'name', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'unit', label: 'Unit' }, { key: 'on_hand', label: 'On hand' }, { key: 'reserved', label: 'Reserved' }, { key: 'available', label: 'Available' }, { key: 'expired', label: 'Expired' }, { key: 'damaged', label: 'Damaged' }, { key: 'in_transit', label: 'In transit' }, { key: 'reorder_level', label: 'Reorder level' }, { key: 'value', label: 'Value (cost)' }], res); }
    catch (e) { toast.error(e.message); }
  };
  return (
    <div>
      {a && <section aria-label="Alerts" className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Low stock" value={a.low_stock} tone={a.low_stock ? 'warning' : undefined} onClick={() => { setState('low'); setOffset(0); }} pressed={state === 'low'} />
        <StatCard label="Out of stock" value={a.out_of_stock} tone={a.out_of_stock ? 'danger' : undefined} onClick={() => { setState('out'); setOffset(0); }} pressed={state === 'out'} />
        <StatCard label="Overstock" value={a.overstock} onClick={() => { setState('over'); setOffset(0); }} pressed={state === 'over'} />
        <StatCard label="Expiring soon" value={a.expiring} tone={a.expiring ? 'warning' : undefined} onClick={() => { setState('expiring'); setOffset(0); }} pressed={state === 'expiring'} />
        <StatCard label="Expired" value={a.expired} tone={a.expired ? 'danger' : undefined} onClick={() => { setState('expired'); setOffset(0); }} pressed={state === 'expired'} />
        <StatCard label="Slow / dead stock" value={`${a.slow_moving} / ${a.dead_stock}`} note="Not sold lately" />
      </section>}
      <Toolbar>
        <div className="w-full sm:w-72"><Input type="search" placeholder="Product, SKU or barcode" aria-label="Search stock" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div>
        <WarehouseSelect allowAll value={warehouse} onChange={(v) => { setWarehouse(v); setOffset(0); }} label="" id="stock-wh" />
        <Chips label="State" value={state} onChange={(v) => { setState(v); setOffset(0); }} options={[{ value: '', label: 'All' }, { value: 'low', label: 'Low' }, { value: 'out', label: 'Out' }, { value: 'over', label: 'Over' }, { value: 'expiring', label: 'Expiring' }, { value: 'expired', label: 'Expired' }, { value: 'damaged', label: 'Damaged' }]} />
        <div className="ml-auto flex gap-2">{can('export') && <Button variant="secondary" onClick={exportCsv}><Download aria-hidden="true" className="h-4 w-4" />Export</Button>}{can('inventory') && <Button onClick={() => onAdjust(null)}><Plus aria-hidden="true" className="h-4 w-4" />Adjust stock</Button>}</div>
      </Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={WarehouseIcon} emptyLabel="No stock here" emptyBody={term || state ? 'Nothing matches those filters.' : 'Add products, then receive goods or enter opening stock.'} />
      {data?.length > 0 && (
        <>
          {meta?.stock_value != null && <p className="mb-2 text-small text-ink-500">Stock value at cost for this view: <strong className="tabular text-ink-900">{money(meta.stock_value)}</strong></p>}
          <Table>
            <Thead><Th>Product</Th><Th className="text-right">On hand</Th><Th className="text-right">Reserved</Th><Th className="text-right">Available</Th><Th className="text-right">In transit</Th><Th className="text-right">Expired</Th><Th className="text-right">Damaged</Th><Th className="text-right">Reorder at</Th><Th className="text-right">Value</Th></Thead>
            <tbody>{data.map((p) => <Tr key={p.product_id} onClick={() => setOpen(p.product_id)}>
              <Td><span className="font-medium">{p.name}</span><span className="block text-caption text-ink-500">{[p.sku, p.unit].filter(Boolean).join(' · ')}</span></Td>
              <Td className="text-right tabular">{qty(p.on_hand)}</Td><Td className="text-right tabular text-ink-500">{p.reserved ? qty(p.reserved) : '—'}</Td>
              <Td className="text-right tabular"><span className="inline-flex items-center gap-2">{p.state !== 'OK' && <Badge tone={STATE_TONE[p.state]}>{p.state.toLowerCase()}</Badge>}<strong>{qty(p.available)}</strong></span></Td>
              <Td className="text-right tabular text-ink-500">{p.in_transit ? qty(p.in_transit) : '—'}</Td><Td className={`text-right tabular ${p.expired ? 'font-semibold text-danger' : 'text-ink-400'}`}>{p.expired ? qty(p.expired) : '—'}</Td><Td className="text-right tabular text-ink-500">{p.damaged ? qty(p.damaged) : '—'}</Td>
              <Td className="text-right tabular text-ink-500">{p.reorder_level ? qty(p.reorder_level) : '—'}</Td><Td className="text-right tabular">{money(p.value)}</Td></Tr>)}</tbody>
          </Table>
          <Pager meta={meta} onPage={setOffset} />
        </>
      )}
      {open && <ProductStock id={open} onClose={() => setOpen(null)} onAdjust={onAdjust} />}
    </div>
  );
};

const ExpiryTab = () => {
  const [warehouse, setWarehouse] = useState('');
  const [state, setState] = useState('');
  const [offset, setOffset] = useState(0);
  const win = useLoad(`/wholesale/inventory/expiry${qs({ branch_id: warehouse })}`);
  const { data, meta, loading, error } = useLoad(`/wholesale/inventory/batches${qs({ branch_id: warehouse, state: state || undefined, limit: 50, offset })}`, { paged: true });
  return (
    <div>
      {win.data && <section aria-label="Expiry windows" className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {win.data.windows.map((w) => <StatCard key={w.key} label={w.label} value={`${w.batches} batch${w.batches === 1 ? '' : 'es'}`} note={`${qty(w.units)} units · ${money(w.value)} at cost`} tone={w.key === 'expired' && w.batches ? 'danger' : w.batches ? 'warning' : undefined} />)}
      </section>}
      <Toolbar><WarehouseSelect allowAll value={warehouse} onChange={(v) => { setWarehouse(v); setOffset(0); }} label="" id="exp-wh" /><Chips label="Batch state" value={state} onChange={(v) => { setState(v); setOffset(0); }} options={[{ value: '', label: 'All batches' }, { value: 'expired', label: 'Expired' }, { value: 'expiring', label: 'Expiring' }, { value: 'ok', label: 'Fresh' }]} /></Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="No batches here" emptyBody="Batches appear when batch-tracked goods are received." />
      {data?.length > 0 && <><Table><Thead><Th>Product</Th><Th>Batch</Th><Th>Warehouse</Th><Th>Received</Th><Th>Expiry</Th><Th className="text-right">On hand</Th><Th className="text-right">Value</Th></Thead>
        <tbody>{data.map((b) => <Tr key={b.batch_id}><Td className="font-medium">{b.product}</Td><Td>{b.batch_no}</Td><Td className="text-ink-500">{b.warehouse}</Td><Td>{b.received_on ? dateText(b.received_on, { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}</Td>
          <Td>{b.expiry_date ? <span className={b.state === 'EXPIRED' ? 'font-semibold text-danger' : b.state === 'EXPIRING' ? 'text-warning' : ''}>{dateText(b.expiry_date, { day: 'numeric', month: 'short', year: 'numeric' })} · {b.days_left < 0 ? 'expired' : `${b.days_left} d`}</span> : '—'}</Td><Td className="text-right tabular">{qty(b.qty_on_hand)} {b.unit}</Td><Td className="text-right tabular">{b.value != null ? money(b.value) : '—'}</Td></Tr>)}</tbody></Table><Pager meta={meta} onPage={setOffset} /></>}
    </div>
  );
};

const DamagedTab = () => {
  const { can } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad('/wholesale/inventory/damaged');
  const writeOff = async (r) => {
    const v = await dialog.prompt({ title: `Write off ${r.product}`, body: `${qty(r.qty)} ${r.unit} held as damaged at ${r.warehouse}. How many are being thrown away?`, label: 'Quantity', defaultValue: String(r.qty), type: 'number', confirmLabel: 'Write off', danger: true });
    if (!v) return;
    try { await api('/wholesale/inventory/write-off-damaged', { method: 'POST', body: { branch_id: r.branch_id, product_id: r.product_id, quantity: Number(v) } }); toast.success('Written off'); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div>
      <p className="mb-4 max-w-2xl text-small text-ink-500">Goods found damaged on receipt, in transit or on return are held here, outside your sellable stock, until you claim them back from the supplier or write them off.</p>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="Nothing damaged" emptyBody="No damaged goods are being held." />
      {data?.length > 0 && <Table><Thead><Th>Product</Th><Th>Warehouse</Th><Th className="text-right">Quantity</Th><Th className="text-right">Value (cost)</Th><Th><span className="sr-only">Action</span></Th></Thead>
        <tbody>{data.map((r) => <Tr key={`${r.branch_id}-${r.product_id}`}><Td className="font-medium">{r.product}</Td><Td className="text-ink-500">{r.warehouse}</Td><Td className="text-right tabular">{qty(r.qty)} {r.unit}</Td><Td className="text-right tabular">{money(r.value)}</Td><Td className="text-right">{can('inventory') && <Button size="sm" variant="ghost" onClick={() => writeOff(r)}>Write off…</Button>}</Td></Tr>)}</tbody></Table>}
    </div>
  );
};

const MovementsTab = () => {
  const [q, setQ] = useState({ type: '', from: '', to: '', warehouse: '' });
  const [offset, setOffset] = useState(0);
  const { data, meta, loading, error } = useLoad(`/wholesale/inventory/movements${qs({ type: q.type, from: q.from, to: q.to, branch_id: q.warehouse, limit: 50, offset })}`, { paged: true });
  return (
    <div>
      <Toolbar>
        <div className="w-44"><Select aria-label="Movement type" value={q.type} onChange={(e) => { setQ({ ...q, type: e.target.value }); setOffset(0); }}><option value="">All movements</option>{['SALE', 'PURCHASE', 'ADJUSTMENT', 'RETURN', 'OPENING', 'WASTAGE', 'TRANSFER', 'PURCHASE_RETURN'].map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</option>)}</Select></div>
        <Input type="date" aria-label="From" value={q.from} onChange={(e) => { setQ({ ...q, from: e.target.value }); setOffset(0); }} className="w-auto" /><Input type="date" aria-label="To" value={q.to} onChange={(e) => { setQ({ ...q, to: e.target.value }); setOffset(0); }} className="w-auto" />
        <WarehouseSelect allowAll value={q.warehouse} onChange={(v) => { setQ({ ...q, warehouse: v }); setOffset(0); }} label="" id="mv-wh" />
      </Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="No movements" />
      {data?.length > 0 && <><Table><Thead><Th>When</Th><Th>Product</Th><Th>Warehouse</Th><Th>Type</Th><Th className="text-right">Quantity</Th><Th>Note</Th><Th>By</Th></Thead>
        <tbody>{data.map((m) => <Tr key={m.txn_id}><Td>{longDate(m.created_at)}</Td><Td className="font-medium">{m.product}</Td><Td className="text-ink-500">{m.warehouse}</Td><Td><Badge tone="neutral">{m.transaction_type.replace(/_/g, ' ').toLowerCase()}</Badge></Td><Td className={`text-right tabular ${m.quantity < 0 ? 'text-danger' : 'text-success'}`}>{m.quantity > 0 ? '+' : ''}{qty(m.quantity)} {m.unit}</Td><Td className="text-ink-500">{m.notes || m.reason_code || ''}</Td><Td className="text-ink-500">{m.by || ''}</Td></Tr>)}</tbody></Table><Pager meta={meta} onPage={setOffset} /></>}
    </div>
  );
};

const WarehousesTab = () => {
  const { can } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad('/wholesale/warehouses');
  const [open, setOpen] = useState(null);
  const [edit, setEdit] = useState(null);
  return (
    <div>
      <p className="mb-4 max-w-2xl text-small text-ink-500">Each warehouse is an outlet. Add a new one under Team → Outlets; set its manager and bin locations here.</p>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="No warehouses" />
      {data?.length > 0 && <Table><Thead><Th>Warehouse</Th><Th>Manager</Th><Th className="text-right">Products</Th><Th className="text-right">Units</Th><Th className="text-right">Reserved</Th><Th className="text-right">Incoming</Th><Th className="text-right">Stock value</Th><Th className="text-right">Bins</Th></Thead>
        <tbody>{data.map((w) => <Tr key={w.branch_id} onClick={() => setOpen(w)}><Td><span className="font-medium">{w.name}</span>{w.is_primary && <span className="ml-2"><Badge tone="brand">main</Badge></span>}<span className="block text-caption text-ink-500">{[w.city, w.state].filter(Boolean).join(', ')}</span></Td><Td className="text-ink-500">{[w.manager_name, w.phone].filter(Boolean).join(' · ') || '—'}</Td><Td className="text-right tabular">{w.skus}</Td><Td className="text-right tabular">{qty(w.units)}</Td><Td className="text-right tabular">{qty(w.reserved)}</Td><Td className="text-right tabular">{w.incoming ? qty(w.incoming) : '—'}</Td><Td className="text-right tabular">{money(w.value)}</Td><Td className="text-right tabular">{w.locations}</Td></Tr>)}</tbody></Table>}
      {open && <Locations warehouse={open} canEdit={can('inventory')} onClose={() => { setOpen(null); reload(); }} onEdit={() => { setEdit(open); setOpen(null); }} />}
      {edit && <WarehouseEdit warehouse={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); toast.success('Warehouse saved'); }} />}
    </div>
  );
};

const Locations = ({ warehouse, canEdit, onClose, onEdit }) => {
  const dialog = useDialog();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(`/wholesale/warehouses/${warehouse.branch_id}/locations`);
  const add = async () => {
    const code = await dialog.prompt({ title: 'New bin location', body: 'A short code for a shelf, rack or bin, like A-01-3.', label: 'Code', confirmLabel: 'Add' });
    if (!code) return;
    try { await api(`/wholesale/warehouses/${warehouse.branch_id}/locations`, { method: 'POST', body: { code } }); reload(); } catch (e) { toast.error(e.message); }
  };
  const toggle = async (l) => { try { await api(`/wholesale/locations/${l.location_id}`, { method: 'PUT', body: { status: l.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } }); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <Modal title={`${warehouse.name} · bin locations`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between"><p className="text-small text-ink-500">Pickers are sent to a product’s bin. Assign bins from a product’s stock screen.</p>{canEdit && <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={onEdit}>Details</Button><Button size="sm" onClick={add}>Add bin</Button></div>}</div>
        <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="No bins yet" />
        {data?.length > 0 && <ul className="divide-y divide-line rounded-(--radius-card) border border-line">{data.map((l) => <li key={l.location_id} className="flex items-center justify-between px-4 py-2 text-small"><span className={l.status === 'ACTIVE' ? 'font-medium' : 'text-ink-400 line-through'}>{l.code}<span className="ml-2 text-caption font-normal text-ink-500">{l.products} product{l.products === 1 ? '' : 's'}</span></span>{canEdit && <button type="button" className="text-caption text-brand-600" onClick={() => toggle(l)}>{l.status === 'ACTIVE' ? 'Retire' : 'Restore'}</button>}</li>)}</ul>}
      </div>
    </Modal>
  );
};

const WarehouseEdit = ({ warehouse, onClose, onSaved }) => {
  const [f, setF] = useState({ manager_name: warehouse.manager_name || '', phone: warehouse.phone || '', notes: warehouse.notes || '', is_dispatch: warehouse.is_dispatch !== false });
  const [busy, run] = useAction();
  return (
    <Modal title={warehouse.name} onClose={onClose}>
      <div className="space-y-4">
        <Field id="we-m" label="Manager"><Input id="we-m" value={f.manager_name} onChange={(e) => setF({ ...f, manager_name: e.target.value })} /></Field>
        <Field id="we-p" label="Phone"><Input id="we-p" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field id="we-n" label="Notes"><Input id="we-n" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-small"><input type="checkbox" checked={f.is_dispatch} onChange={(e) => setF({ ...f, is_dispatch: e.target.checked })} className="h-4 w-4 accent-(--color-brand-500)" />Ships orders to customers</label>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { const r = await run(() => api(`/wholesale/warehouses/${warehouse.branch_id}`, { method: 'PUT', body: f })); if (r) onSaved(); }}>Save</Button></div>
      </div>
    </Modal>
  );
};

const WholesaleInventory = () => {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'stock';
  const [adjust, setAdjust] = useState(undefined);   // undefined = closed, null = open with no product, object = product
  const [stamp, setStamp] = useState(0);
  const tabs = [{ key: 'stock', label: 'Stock' }, { key: 'expiry', label: 'Batches & expiry' }, { key: 'transfers', label: 'Transfers' }, { key: 'damaged', label: 'Damaged' }, { key: 'movements', label: 'Stock ledger' }, { key: 'warehouses', label: 'Warehouses & bins' }];
  return (
    <div>
      <PageHeader title="Inventory" lead="What is in each warehouse, what is promised to orders, what is about to expire." />
      <Tabs tabs={tabs} value={tab} onChange={(k) => setParams(k === 'stock' ? {} : { tab: k }, { replace: true })} />
      <div key={stamp}>
        {tab === 'stock' && <StockTab onAdjust={setAdjust} />}
        {tab === 'expiry' && <ExpiryTab />}
        {tab === 'transfers' && <TransfersTab />}
        {tab === 'damaged' && <DamagedTab />}
        {tab === 'movements' && <MovementsTab />}
        {tab === 'warehouses' && <WarehousesTab />}
      </div>
      {adjust !== undefined && can('inventory') && <AdjustModal product={adjust} onClose={() => setAdjust(undefined)} onDone={() => { setAdjust(undefined); setStamp((n) => n + 1); }} />}
    </div>
  );
};

export default WholesaleInventory;
