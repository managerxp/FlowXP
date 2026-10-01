/*
 * The warehouse floor: orders waiting to be picked, pick lists (pick → pack → dispatch), and deliveries (driver,
 * vehicle, proof of delivery). Dispatching raises the delivery challan and the tax invoice in one step; stock leaves the
 * shelf, batches are consumed (soonest expiry first), and the order's progress moves on.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Printer, Truck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { DELIVERY_STATUS, ORDER_STATUS, PAYMENT_METHODS, PICK_STATUS, dateText, longDate, money, qs, qty, todayIn, useLoad } from '../../lib/wholesale.js';
import { Alert, Button, Field, Input, ListState, Modal, PageHeader, Select, StatCard, Table, Td, Textarea, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { Chips, NumberField, Pager, StatusPill, Tabs, useAction } from './parts.jsx';

/* ── pick list dialog: one component, the step follows the status ─────────────────────────────── */

const PickStep = ({ pick, onChanged }) => {
  const [picked, setPicked] = useState(() => Object.fromEntries(pick.items.map((i) => [i.pick_item_id, String(i.qty_base)])));
  const [serials, setSerials] = useState({});
  const [busy, run] = useAction();
  const short = pick.items.some((i) => Number(picked[i.pick_item_id]) < i.qty_base);
  const submit = async () => {
    const items = pick.items.map((i) => ({ pick_item_id: i.pick_item_id, picked_base: Number(picked[i.pick_item_id]) || 0, ...(serials[i.pick_item_id] ? { serials: serials[i.pick_item_id].split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) } : {}) }));
    const out = await run(() => api(`/wholesale/pick-lists/${pick.pick_id}/pick`, { method: 'POST', body: { items } }), 'Picking recorded');
    if (out) onChanged(out);
  };
  return (
    <div className="space-y-4">
      <p className="text-small text-ink-500">Enter what was really taken from the shelf. Anything short goes back to the order as a back-order.</p>
      <Table>
        <Thead><Th>Bin</Th><Th>Item</Th><Th>Batches</Th><Th className="text-right">Asked</Th><Th className="text-right">Picked</Th></Thead>
        <tbody>
          {pick.items.map((i) => (
            <Tr key={i.pick_item_id}>
              <Td className="font-semibold">{i.location || '—'}</Td>
              <Td><span className="font-medium">{i.product}</span>{i.unit_factor !== 1 && <span className="block text-caption text-ink-500">{qty(i.qty_base / i.unit_factor)} {i.unit_name}</span>}
                <button type="button" className="text-caption font-medium text-brand-600 hover:underline" onClick={() => setSerials((s) => ({ ...s, [i.pick_item_id]: s[i.pick_item_id] ?? '' }))}>{serials[i.pick_item_id] !== undefined ? '' : 'Serial numbers…'}</button>
                {serials[i.pick_item_id] !== undefined && <Textarea aria-label={`Serial numbers for ${i.product}`} rows={2} placeholder="One per line" value={serials[i.pick_item_id]} onChange={(e) => setSerials((s) => ({ ...s, [i.pick_item_id]: e.target.value }))} className="mt-1" />}</Td>
              <Td className="text-caption">{i.batches.length ? i.batches.map((b) => <span key={b.batch_id} className="block">{b.batch_no} × {qty(b.qty_base)}{b.expiry_date ? <span className="text-ink-500"> · exp {dateText(b.expiry_date, { day: 'numeric', month: 'short', year: '2-digit' })}</span> : ''}</span>) : <span className="text-ink-400">—</span>}</Td>
              <Td className="text-right tabular">{qty(i.qty_base)} {i.base_unit}</Td>
              <Td className="text-right"><div className="ml-auto w-24"><Input aria-label={`Picked ${i.product}`} type="number" min="0" max={i.qty_base} step="any" value={picked[i.pick_item_id]} onChange={(e) => setPicked((p) => ({ ...p, [i.pick_item_id]: e.target.value }))} className="text-right" /></div></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {short && <p className="rounded-lg bg-warning/10 px-3 py-2 text-caption text-warning">Some items are short. The difference stays reserved on the order to pick again.</p>}
      <div className="flex justify-end"><Button onClick={submit} loading={busy}>Finish picking</Button></div>
    </div>
  );
};

const PackStep = ({ pick, onChanged }) => {
  const picked = pick.items.filter((i) => i.picked_base > 0);
  const [pkgs, setPkgs] = useState(() => [{ weight_kg: '', qty: Object.fromEntries(picked.map((i) => [i.pick_item_id, String(i.picked_base)])) }]);
  const [busy, run] = useAction();
  const left = (i) => Math.round((i.picked_base - pkgs.reduce((s, p) => s + (Number(p.qty[i.pick_item_id]) || 0), 0)) * 1000) / 1000;
  const balanced = picked.every((i) => Math.abs(left(i)) < 1e-9);
  const addPackage = () => setPkgs((p) => [...p, { weight_kg: '', qty: {} }]);
  const submit = async () => {
    const packages = pkgs.map((p) => ({ weight_kg: p.weight_kg === '' ? undefined : Number(p.weight_kg), items: picked.filter((i) => Number(p.qty[i.pick_item_id]) > 0).map((i) => ({ pick_item_id: i.pick_item_id, qty_base: Number(p.qty[i.pick_item_id]) })) })).filter((p) => p.items.length);
    const out = await run(() => api(`/wholesale/pick-lists/${pick.pick_id}/pack`, { method: 'POST', body: { packages } }), 'Packed');
    if (out) onChanged(out);
  };
  return (
    <div className="space-y-4">
      <p className="text-small text-ink-500">Put the picked goods into packages. One package with everything is fine; add more to split a big order across cartons or pallets.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-small">
          <thead className="text-left text-caption font-semibold uppercase tracking-wide text-ink-500"><tr><th className="pb-2 pr-3">Item</th>{pkgs.map((_, k) => <th key={k} className="pb-2 pr-3 text-right">Package {k + 1}</th>)}<th className="pb-2 text-right">Left</th></tr></thead>
          <tbody className="divide-y divide-line">
            {picked.map((i) => (
              <tr key={i.pick_item_id}>
                <td className="py-2 pr-3 font-medium">{i.product}<span className="block text-caption font-normal text-ink-500">{qty(i.picked_base)} {i.base_unit} picked</span></td>
                {pkgs.map((p, k) => <td key={k} className="py-2 pr-3"><div className="ml-auto w-24"><Input aria-label={`${i.product} in package ${k + 1}`} type="number" min="0" step="any" value={p.qty[i.pick_item_id] ?? ''} onChange={(e) => setPkgs((all) => all.map((x, j) => (j === k ? { ...x, qty: { ...x.qty, [i.pick_item_id]: e.target.value } } : x)))} className="text-right" /></div></td>)}
                <td className={`py-2 text-right tabular ${Math.abs(left(i)) > 1e-9 ? 'font-semibold text-danger' : 'text-ink-400'}`}>{qty(left(i))}</td>
              </tr>
            ))}
            <tr><td className="py-2 pr-3 text-ink-500">Weight (kg)</td>{pkgs.map((p, k) => <td key={k} className="py-2 pr-3"><div className="ml-auto w-24"><Input aria-label={`Weight of package ${k + 1}`} type="number" min="0" step="any" value={p.weight_kg} onChange={(e) => setPkgs((all) => all.map((x, j) => (j === k ? { ...x, weight_kg: e.target.value } : x)))} className="text-right" /></div></td>)}<td /></tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-2"><Button variant="ghost" size="sm" onClick={addPackage}>Add a package</Button><Button onClick={submit} loading={busy} disabled={!balanced}>Mark as packed</Button></div>
    </div>
  );
};

const DispatchStep = ({ pick, onDone }) => {
  const toast = useToast();
  const [f, setF] = useState({ driver_name: '', driver_phone: '', vehicle_no: '', delivery_address: '', expected_date: '', invoice_kind: 'TAX', pay: '', method: 'CASH', reference: '' });
  const [busy, run] = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: typeof v === 'string' ? v : v.target.value }));
  const submit = async () => {
    const body = { driver_name: f.driver_name || undefined, driver_phone: f.driver_phone || undefined, vehicle_no: f.vehicle_no || undefined, delivery_address: f.delivery_address || undefined, expected_date: f.expected_date || undefined, invoice_kind: f.invoice_kind,
      ...(Number(f.pay) > 0 ? { payment: { amount: Number(f.pay), method: f.method, reference_number: f.reference || undefined } } : {}) };
    const out = await run(() => api(`/wholesale/pick-lists/${pick.pick_id}/dispatch`, { method: 'POST', body, idempotencyKey: `dispatch-${pick.pick_id}` }));   // one dispatch per pick list, however many times it is pressed
    if (out) { toast.success(`Dispatched: invoice ${out.invoice_number} for ${money(out.invoice_total)}`); onDone(out); }
  };
  return (
    <div className="space-y-4">
      <p className="text-small text-ink-500">Dispatching raises the delivery challan and the invoice for the picked quantities at the order’s prices. Stock leaves the warehouse now.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="d-driver" label="Driver"><Input id="d-driver" value={f.driver_name} onChange={set('driver_name')} /></Field>
        <Field id="d-phone" label="Driver phone"><Input id="d-phone" type="tel" value={f.driver_phone} onChange={set('driver_phone')} /></Field>
        <Field id="d-veh" label="Vehicle number"><Input id="d-veh" value={f.vehicle_no} onChange={set('vehicle_no')} placeholder="TS 09 AB 1234" /></Field>
        <Field id="d-exp" label="Expected delivery"><Input id="d-exp" type="date" min={todayIn()} value={f.expected_date} onChange={set('expected_date')} /></Field>
        <div className="sm:col-span-2"><Field id="d-addr" label="Delivery address" hint="Leave blank to use the order’s shipping address"><Textarea id="d-addr" rows={2} value={f.delivery_address} onChange={set('delivery_address')} /></Field></div>
        <Field id="d-kind" label="Invoice type"><Select id="d-kind" value={f.invoice_kind} onChange={set('invoice_kind')}><option value="TAX">Tax invoice (on credit terms)</option><option value="CREDIT">Credit invoice</option><option value="CASH">Cash invoice (paid now)</option></Select></Field>
        <NumberField id="d-pay" label="Payment received now" prefix="₹" hint="Optional" value={f.pay} onChange={set('pay')} />
        {Number(f.pay) > 0 && <><Field id="d-method" label="Method"><Select id="d-method" value={f.method} onChange={set('method')}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field id="d-ref" label="Reference"><Input id="d-ref" value={f.reference} onChange={set('reference')} /></Field></>}
      </div>
      <div className="flex justify-end"><Button onClick={submit} loading={busy}>Dispatch and invoice</Button></div>
    </div>
  );
};

const PickDialog = ({ id, onClose, onChanged }) => {
  const { can } = useAuth();
  const { data: pick, loading, error, setData, reload } = useLoad(`/wholesale/pick-lists/${id}`);
  const [busy, run] = useAction();
  const changed = (next) => { setData(next); onChanged(); };
  const startPick = async () => { const out = await run(() => api(`/wholesale/pick-lists/${id}/start`, { method: 'POST', body: {} })); if (out) changed(out); };
  const cancel = async () => { const out = await run(() => api(`/wholesale/pick-lists/${id}/cancel`, { method: 'POST', body: {} }), 'Pick list cancelled'); if (out) { onChanged(); onClose(); } };
  return (
    <Modal title={pick ? `${pick.pick_number} · ${pick.customer}` : 'Pick list'} onClose={onClose} wide>
      <Alert>{error}</Alert>
      {loading && !pick && <p className="py-8 text-center text-small text-ink-500">Loading…</p>}
      {pick && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-small"><StatusPill map={PICK_STATUS} status={pick.status} /><Link to={`/app/wholesale/orders/${pick.order_id}`} className="font-medium text-brand-700 hover:underline">{pick.order_number}</Link><span className="text-ink-500">{pick.warehouse}</span>
            <Link to={`/app/wholesale/pick-lists/${pick.pick_id}/print`} className="ml-auto inline-flex items-center gap-1.5 text-brand-600 hover:underline"><Printer aria-hidden="true" className="h-4 w-4" />Print pick sheet</Link></div>
          {pick.status === 'PENDING' && <div className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3 text-small"><span>{pick.items.length} item{pick.items.length === 1 ? '' : 's'} to pick.</span><Button size="sm" loading={busy} onClick={startPick}>Start picking</Button></div>}
          {['PENDING', 'PICKING'].includes(pick.status) && <PickStep pick={pick} onChanged={changed} />}
          {pick.status === 'PICKED' || pick.status === 'PACKING' ? <PackStep pick={pick} onChanged={changed} /> : null}
          {pick.status === 'PACKED' && (can('fulfilment') ? <DispatchStep pick={pick} onDone={() => { onChanged(); onClose(); }} /> : null)}
          {['DISPATCHED', 'CANCELLED'].includes(pick.status) && <p className="text-small text-ink-500">This pick list is {pick.status.toLowerCase()}.</p>}
          {pick.packages.length > 0 && pick.status === 'PACKED' && <p className="text-caption text-ink-500">{pick.packages.length} package{pick.packages.length === 1 ? '' : 's'}: {pick.packages.map((p) => `${p.package_no}${p.weight_kg ? ` (${p.weight_kg} kg)` : ''}`).join(', ')}</p>}
          {!['DISPATCHED', 'CANCELLED'].includes(pick.status) && <div className="border-t border-line pt-3"><Button variant="ghost" size="sm" loading={busy} onClick={cancel}>Cancel this pick list</Button></div>}
        </div>
      )}
    </Modal>
  );
};

/* ── tabs ─────────────────────────────────────────────────────────────────────────────────────── */

const ToPick = ({ reloadKey, onCreated }) => {
  const { data, loading, error } = useLoad(`/wholesale/orders${qs({ pickable: 1, limit: 100 })}`, { paged: true });
  const [busy, run] = useAction();
  const create = async (o) => { const out = await run(() => api(`/wholesale/orders/${o.order_id}/pick-lists`, { method: 'POST', body: {} }), 'Pick list created'); if (out) onCreated(out.pick_id); };
  return (
    <div key={reloadKey}>
      <p className="mb-4 max-w-2xl text-small text-ink-500">Confirmed orders with stock reserved. Create a pick list to send the picker to the shelves.</p>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={Truck} emptyLabel="Nothing to pick" emptyBody="No confirmed orders are waiting for the warehouse." />
      {data?.length > 0 && (
        <Table>
          <Thead><Th>Order</Th><Th>Customer</Th><Th>Date</Th><Th>Status</Th><Th className="text-right">Lines</Th><Th className="text-right">Value</Th><Th><span className="sr-only">Action</span></Th></Thead>
          <tbody>{data.map((o) => (
            <Tr key={o.order_id}><Td><Link to={`/app/wholesale/orders/${o.order_id}`} className="font-medium text-brand-700">{o.order_number}</Link></Td><Td>{o.customer}</Td><Td>{dateText(o.order_date)}</Td><Td><StatusPill map={ORDER_STATUS} status={o.status} /></Td>
              <Td className="text-right tabular">{o.lines}</Td><Td className="text-right tabular">{money(o.total)}</Td><Td className="text-right"><Button size="sm" variant="secondary" loading={busy} onClick={() => create(o)}>Pick list</Button></Td></Tr>
          ))}</tbody>
        </Table>
      )}
    </div>
  );
};

const PickLists = ({ open, setOpen, reloadKey, onChanged }) => {
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const query = qs({ status: status || undefined, limit: 50, offset, k: reloadKey });
  const { data, meta, loading, error } = useLoad(`/wholesale/pick-lists${query}`, { paged: true });
  return (
    <div>
      <div className="mb-4"><Chips label="Pick list status" value={status} onChange={(v) => { setStatus(v); setOffset(0); }} options={[{ value: '', label: 'Open' }, { value: 'PENDING', label: 'To pick' }, { value: 'PICKING', label: 'Picking' }, { value: 'PICKED,PACKING', label: 'To pack' }, { value: 'PACKED', label: 'Ready to dispatch' }, { value: 'DISPATCHED', label: 'Dispatched' }, { value: 'CANCELLED', label: 'Cancelled' }]} /></div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="No pick lists here" emptyBody="Create one from an order that is ready to ship." />
      {data?.length > 0 && (
        <>
          <Table>
            <Thead><Th>Pick list</Th><Th>Order</Th><Th>Customer</Th><Th>Warehouse</Th><Th>Status</Th><Th className="text-right">Items</Th><Th>Picker</Th></Thead>
            <tbody>{data.map((p) => <Tr key={p.pick_id} onClick={() => setOpen(p.pick_id)}><Td className="font-medium text-brand-700">{p.pick_number}</Td><Td>{p.order_number}</Td><Td>{p.customer}</Td><Td className="text-ink-500">{p.warehouse}</Td><Td><StatusPill map={PICK_STATUS} status={p.status} /></Td><Td className="text-right tabular">{p.items}</Td><Td className="text-ink-500">{p.picker_name || '—'}</Td></Tr>)}</tbody>
          </Table>
          <Pager meta={meta} onPage={setOffset} />
        </>
      )}
      {open && <PickDialog id={open} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </div>
  );
};

const DeliveryDialog = ({ delivery, onClose, onChanged }) => {
  const toast = useToast();
  const [mode, setMode] = useState(null);   // null | 'edit' | 'delivered' | 'failed' | 'returned'
  const [f, setF] = useState({ driver_name: delivery.driver_name || '', driver_phone: delivery.driver_phone || '', vehicle_no: delivery.vehicle_no || '', delivery_address: delivery.delivery_address || '', expected_date: delivery.expected_date ? String(delivery.expected_date).slice(0, 10) : '', received_by: '', note: '', reason: '', photo: '' });
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const status = async (to, body) => { const out = await run(() => api(`/wholesale/deliveries/${delivery.delivery_id}/status`, { method: 'POST', body: { status: to, ...body } }), 'Updated'); if (out) { if (out.hint) toast.success(out.hint); onChanged(); onClose(); } };
  const saveEdit = async () => { const out = await run(() => api(`/wholesale/deliveries/${delivery.delivery_id}`, { method: 'PUT', body: { driver_name: f.driver_name, driver_phone: f.driver_phone, vehicle_no: f.vehicle_no, delivery_address: f.delivery_address, expected_date: f.expected_date || null } }), 'Saved'); if (out) { onChanged(); onClose(); } };
  const onPhoto = (file) => { if (!file) return; if (file.size > 1_500_000) { toast.error('That photo is too large. Use one under 1.5 MB.'); return; } const r = new FileReader(); r.onload = () => setF((x) => ({ ...x, photo: String(r.result) })); r.readAsDataURL(file); };
  const next = { PENDING: [['OUT_FOR_DELIVERY', 'Out for delivery']], ASSIGNED: [['OUT_FOR_DELIVERY', 'Out for delivery']], OUT_FOR_DELIVERY: [], FAILED: [['OUT_FOR_DELIVERY', 'Try again']], DELIVERED: [], RETURNED: [] }[delivery.status] || [];
  return (
    <Modal title={`${delivery.challan_number} · ${delivery.customer}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-small"><StatusPill map={DELIVERY_STATUS} status={delivery.status} /><Link to={`/app/wholesale/orders/${delivery.order_id}`} className="font-medium text-brand-700">{delivery.order_number}</Link>
          {delivery.invoice_id && <Link to={`/app/billing/invoices/${delivery.invoice_id}`} className="font-medium text-brand-700">{delivery.invoice_number}</Link>}<Link to={`/app/wholesale/deliveries/${delivery.delivery_id}/print`} className="ml-auto inline-flex items-center gap-1.5 text-brand-600"><Printer aria-hidden="true" className="h-4 w-4" />Challan</Link></div>
        <dl className="grid grid-cols-2 gap-3 text-small">
          <div><dt className="text-caption text-ink-500">Driver</dt><dd>{delivery.driver_name || '—'}{delivery.driver_phone ? ` · ${delivery.driver_phone}` : ''}</dd></div><div><dt className="text-caption text-ink-500">Vehicle</dt><dd>{delivery.vehicle_no || '—'}</dd></div>
          <div><dt className="text-caption text-ink-500">Dispatched</dt><dd>{delivery.dispatch_date ? dateText(delivery.dispatch_date) : '—'}</dd></div><div><dt className="text-caption text-ink-500">Expected</dt><dd>{delivery.expected_date ? dateText(delivery.expected_date) : '—'}</dd></div>
          <div className="col-span-2"><dt className="text-caption text-ink-500">Address</dt><dd className="whitespace-pre-line">{delivery.delivery_address || '—'}</dd></div>
          {delivery.status === 'DELIVERED' && <div className="col-span-2"><dt className="text-caption text-ink-500">Received by</dt><dd>{delivery.pod_received_by}{delivery.pod_note ? ` — ${delivery.pod_note}` : ''}{delivery.delivered_at ? ` · ${longDate(delivery.delivered_at)}` : ''}</dd></div>}
          {delivery.failure_reason && <div className="col-span-2"><dt className="text-caption text-ink-500">Reason</dt><dd>{delivery.failure_reason}</dd></div>}
        </dl>
        {!mode && !['DELIVERED', 'RETURNED'].includes(delivery.status) && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {next.map(([to, label]) => <Button key={to} loading={busy} onClick={() => status(to)}>{label}</Button>)}
            {delivery.status === 'OUT_FOR_DELIVERY' && <><Button onClick={() => setMode('delivered')}>Delivered…</Button>{delivery.invoice_id && <Button variant="secondary" onClick={() => setMode('partial')}>Part delivered…</Button>}<Button variant="secondary" onClick={() => setMode('failed')}>Could not deliver…</Button></>}
            {delivery.status === 'FAILED' && <Button variant="secondary" onClick={() => setMode('returned')}>Goods came back…</Button>}
            <Button variant="ghost" onClick={() => setMode('edit')}>Driver and vehicle…</Button>
          </div>
        )}
        {mode === 'edit' && <div className="space-y-3 border-t border-line pt-4"><div className="grid gap-3 sm:grid-cols-2"><Field id="e-d" label="Driver"><Input id="e-d" value={f.driver_name} onChange={set('driver_name')} /></Field><Field id="e-p" label="Phone"><Input id="e-p" value={f.driver_phone} onChange={set('driver_phone')} /></Field><Field id="e-v" label="Vehicle"><Input id="e-v" value={f.vehicle_no} onChange={set('vehicle_no')} /></Field><Field id="e-x" label="Expected"><Input id="e-x" type="date" value={f.expected_date} onChange={set('expected_date')} /></Field></div><Field id="e-a" label="Address"><Textarea id="e-a" rows={2} value={f.delivery_address} onChange={set('delivery_address')} /></Field><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setMode(null)}>Back</Button><Button loading={busy} onClick={saveEdit}>Save</Button></div></div>}
        {mode === 'delivered' && <div className="space-y-3 border-t border-line pt-4"><Field id="p-by" label="Received by" hint="Name of the person who took the goods"><Input id="p-by" value={f.received_by} onChange={set('received_by')} autoFocus /></Field><Field id="p-note" label="Note"><Input id="p-note" value={f.note} onChange={set('note')} /></Field>
          <Field id="p-photo" label="Photo of the signed challan" hint="Optional"><Input id="p-photo" type="file" accept="image/*" capture="environment" onChange={(e) => onPhoto(e.target.files?.[0])} /></Field>{f.photo && <img src={f.photo} alt="Proof of delivery" className="max-h-40 rounded-lg border border-line" />}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setMode(null)}>Back</Button><Button loading={busy} disabled={!f.received_by.trim()} onClick={() => status('DELIVERED', { pod_received_by: f.received_by, pod_note: f.note || undefined, pod_image_url: f.photo || undefined })}>Mark delivered</Button></div></div>}
        {mode === 'partial' && <PartDelivery delivery={delivery} f={f} set={set} busy={busy} onBack={() => setMode(null)} onSubmit={(items) => status('PARTIAL', { pod_received_by: f.received_by, failure_reason: f.reason, returned_items: items })} />}
        {(mode === 'failed' || mode === 'returned') && <div className="space-y-3 border-t border-line pt-4"><Field id="f-r" label={mode === 'failed' ? 'Why could it not be delivered?' : 'What happened?'}><Input id="f-r" value={f.reason} onChange={set('reason')} autoFocus maxLength={200} /></Field><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setMode(null)}>Back</Button><Button variant="danger" loading={busy} disabled={f.reason.trim().length < 3} onClick={() => status(mode === 'failed' ? 'FAILED' : 'RETURNED', { failure_reason: f.reason })}>{mode === 'failed' ? 'Mark failed' : 'Mark returned'}</Button></div></div>}
      </div>
    </Modal>
  );
};

/** The customer took some of the load and refused the rest: say how much of each line came back. */
const PartDelivery = ({ delivery, f, set, busy, onBack, onSubmit }) => {
  const { data, loading, error } = useLoad(`/wholesale/invoices/${delivery.invoice_id}/returnable`);
  const [rows, setRows] = useState({});
  const lines = (data?.items || data?.lines || []).filter((i) => i.returnable > 0);
  const items = lines.map((i) => ({ invoice_item_id: i.item_id, quantity: Number(rows[i.item_id] || 0) })).filter((x) => x.quantity > 0);
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <p className="text-small text-ink-500">Enter what the customer refused. They are credited for it and it goes back into stock; the rest stays billed.</p>
      <ListState loading={loading} error={error} />
      <ul className="divide-y divide-line rounded-lg border border-line">
        {lines.map((i) => <li key={i.item_id} className="flex items-center gap-3 px-3 py-2 text-small"><span className="min-w-0 flex-1 truncate">{i.description}<span className="ml-2 text-caption text-ink-500">of {qty(i.returnable)} {i.unit_name}</span></span><Input aria-label={`Refused quantity of ${i.description}`} type="number" min="0" max={i.returnable} step="any" value={rows[i.item_id] ?? ''} onChange={(e) => setRows({ ...rows, [i.item_id]: e.target.value })} className="w-24 text-right" /></li>)}
      </ul>
      <Field id="pd-by" label="Received by"><Input id="pd-by" value={f.received_by} onChange={set('received_by')} /></Field>
      <Field id="pd-r" label="Why was it refused?"><Input id="pd-r" value={f.reason} onChange={set('reason')} maxLength={200} /></Field>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onBack}>Back</Button><Button loading={busy} disabled={!items.length || !f.received_by.trim() || f.reason.trim().length < 3} onClick={() => onSubmit(items)}>Record part delivery</Button></div>
    </div>
  );
};

const Deliveries = ({ reloadKey, onChanged }) => {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(null);
  const [params] = useSearchParams();
  const initial = params.get('status');
  const effective = status || initial || '';
  const query = qs({ status: effective || undefined, open: effective ? undefined : '1', q: q.trim() || undefined, limit: 50, offset, k: reloadKey });
  const { data, meta, loading, error } = useLoad(`/wholesale/deliveries${query}`, { paged: true });
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3"><div className="w-full sm:w-64"><Input type="search" aria-label="Search deliveries" placeholder="Challan, order, customer or vehicle" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div>
        <Chips label="Delivery status" value={effective} onChange={(v) => { setStatus(v); setOffset(0); }} options={[{ value: '', label: 'Open' }, { value: 'ASSIGNED,PENDING', label: 'To send' }, { value: 'OUT_FOR_DELIVERY', label: 'Out now' }, { value: 'FAILED', label: 'Failed' }, { value: 'DELIVERED,PARTIAL', label: 'Delivered' }, { value: 'RETURNED', label: 'Returned' }]} /></div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={Truck} emptyLabel="No deliveries here" emptyBody="Deliveries appear when an order is dispatched." />
      {data?.length > 0 && (
        <>
          <Table>
            <Thead><Th>Challan</Th><Th>Customer</Th><Th>Order</Th><Th>Status</Th><Th>Driver / vehicle</Th><Th>Dispatched</Th><Th className="text-right">Invoice</Th></Thead>
            <tbody>{data.map((d) => <Tr key={d.delivery_id} onClick={() => setOpen(d)}><Td className="font-medium text-brand-700">{d.challan_number}</Td><Td>{d.customer}</Td><Td>{d.order_number}</Td><Td><StatusPill map={DELIVERY_STATUS} status={d.status} /></Td><Td className="text-ink-500">{[d.driver_name, d.vehicle_no].filter(Boolean).join(' · ') || '—'}</Td><Td>{d.dispatch_date ? dateText(d.dispatch_date) : '—'}</Td><Td className="text-right tabular">{d.invoice_total != null ? money(d.invoice_total) : '—'}</Td></Tr>)}</tbody>
          </Table>
          <Pager meta={meta} onPage={setOffset} />
        </>
      )}
      {open && <DeliveryDialog delivery={open} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </div>
  );
};

const WholesaleFulfilment = () => {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || (can('fulfilment') ? 'topick' : 'deliveries');
  const open = Number(params.get('open')) || null;
  const [stamp, setStamp] = useState(0);
  const summary = useLoad(`/wholesale/fulfilment/summary?k=${stamp}`);
  const s = summary.data;
  const setTab = (k) => { const next = new URLSearchParams(); next.set('tab', k); setParams(next, { replace: true }); };
  const setOpen = (id) => { const next = new URLSearchParams(params); next.set('tab', 'picks'); id ? next.set('open', id) : next.delete('open'); setParams(next, { replace: true }); };
  const changed = () => setStamp((n) => n + 1);

  return (
    <div>
      <PageHeader title="Warehouse & delivery" lead="Pick, pack and dispatch orders, and follow each delivery to the customer’s door." />
      {s && (
        <section aria-label="Warehouse counts" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Orders to pick" value={s.orders_to_pick} tone={s.orders_to_pick ? 'warning' : undefined} onClick={() => setTab('topick')} pressed={tab === 'topick'} />
          <StatCard label="Being picked" value={(s.pick_lists.PENDING || 0) + (s.pick_lists.PICKING || 0)} onClick={() => setTab('picks')} />
          <StatCard label="Ready to dispatch" value={(s.pick_lists.PICKED || 0) + (s.pick_lists.PACKING || 0) + (s.pick_lists.PACKED || 0)} onClick={() => setTab('picks')} />
          <StatCard label="Out for delivery" value={s.deliveries.OUT_FOR_DELIVERY || 0} onClick={() => setTab('deliveries')} />
          <StatCard label="Failed deliveries" value={s.deliveries.FAILED || 0} tone={s.deliveries.FAILED ? 'danger' : undefined} onClick={() => navigate('/app/wholesale/fulfilment?tab=deliveries&status=FAILED')} />
        </section>
      )}
      <Tabs tabs={[...(can('fulfilment') ? [{ key: 'topick', label: 'Orders to pick', count: s?.orders_to_pick }, { key: 'picks', label: 'Pick lists' }] : []), { key: 'deliveries', label: 'Deliveries' }]} value={tab} onChange={setTab} />
      {tab === 'topick' && <ToPick reloadKey={stamp} onCreated={(id) => { changed(); setOpen(id); }} />}
      {tab === 'picks' && <PickLists open={open} setOpen={setOpen} reloadKey={stamp} onChanged={changed} />}
      {tab === 'deliveries' && <Deliveries reloadKey={stamp} onChanged={changed} />}
    </div>
  );
};

export default WholesaleFulfilment;
