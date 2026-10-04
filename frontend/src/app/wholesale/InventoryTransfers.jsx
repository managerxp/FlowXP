/*
 * Warehouse-to-warehouse transfers with an in-transit stage: stock leaves the sender when the transfer is dispatched
 * and joins the receiver only when it is received (with anything damaged or missing recorded), so the goods on the road
 * are never counted in either warehouse. Batches travel with the goods.
 */
import { useState } from 'react';
import { ArrowRight, Plus, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { TRANSFER_STATUS, longDate, qs, qty, useLoad, useWarehouses } from '../../lib/wholesale.js';
import { Alert, Button, Field, Input, ListState, Modal, Select, Table, Td, Th, Thead, Tr, useToast, PageLoader } from '../../components/ui.jsx';
import { Chips, NumberField, Pager, ProductPicker, StatusPill, useAction } from './parts.jsx';

const NewTransfer = ({ onClose, onDone }) => {
  const whs = useWarehouses();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [busy, run] = useAction();
  const add = (p) => setLines((ls) => (ls.some((l) => l.product_id === p.product_id) ? ls : [...ls, { product_id: p.product_id, name: p.name, unit: p.unit, units: p.units || [], unit_name: '', quantity: '1' }]));
  const set = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const save = async (dispatch) => {
    const r = await run(() => api('/wholesale/transfers', { method: 'POST', body: { from_branch_id: Number(from), to_branch_id: Number(to), notes: notes || undefined, vehicle_no: vehicle || undefined, dispatch, items: lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), unit_name: l.unit_name || undefined })) } }), dispatch ? 'Transfer dispatched' : 'Transfer saved');
    if (r) onDone();
  };
  return (
    <Modal title="New transfer" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="tr-from" label="From warehouse"><Select id="tr-from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose…</option>{(whs || []).map((w) => <option key={w.branch_id} value={w.branch_id}>{w.name}</option>)}</Select></Field>
          <Field id="tr-to" label="To warehouse"><Select id="tr-to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{(whs || []).filter((w) => String(w.branch_id) !== from).map((w) => <option key={w.branch_id} value={w.branch_id}>{w.name}</option>)}</Select></Field>
        </div>
        <ProductPicker onPick={add} />
        {lines.length > 0 && <ul className="divide-y divide-line rounded-(--radius-card) border border-line">{lines.map((l, i) => (
          <li key={l.product_id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-small"><span className="min-w-0 flex-1 font-medium">{l.name}</span>
            <div className="w-28"><Select aria-label={`Unit for ${l.name}`} value={l.unit_name} onChange={(e) => set(i, { unit_name: e.target.value })}><option value="">{l.unit}</option>{l.units.map((u) => <option key={u.unit_name} value={u.unit_name}>{u.unit_name}</option>)}</Select></div>
            <div className="w-28"><Input aria-label={`Quantity of ${l.name}`} type="number" min="0.001" step="any" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} className="text-right" /></div>
            <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-danger"><X className="h-4 w-4" /></button></li>))}</ul>}
        <div className="grid gap-4 sm:grid-cols-2"><Field id="tr-veh" label="Vehicle"><Input id="tr-veh" value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></Field><Field id="tr-notes" label="Notes"><Input id="tr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="secondary" loading={busy} disabled={!from || !to || !lines.length} onClick={() => save(false)}>Save draft</Button><Button loading={busy} disabled={!from || !to || !lines.length} onClick={() => save(true)}>Dispatch now</Button></div>
      </div>
    </Modal>
  );
};

const TransferDialog = ({ id, onClose, onChanged }) => {
  const { can } = useAuth();
  const { data: t, loading, error, setData } = useLoad(`/wholesale/transfers/${id}`);
  const [recv, setRecv] = useState(null);
  const [busy, run] = useAction();
  const act = async (path, body, msg) => { const r = await run(() => api(`/wholesale/transfers/${id}/${path}`, { method: 'POST', body: body || {} }), msg); if (r) { setData(r); setRecv(null); onChanged(); } };
  const startReceive = () => setRecv(Object.fromEntries(t.items.map((i) => [i.item_id, { received: String(i.qty_base), damaged: '' }])));
  const receive = () => act('receive', { items: t.items.map((i) => ({ item_id: i.item_id, received_base: Number(recv[i.item_id].received) || 0, damaged_base: Number(recv[i.item_id].damaged) || 0 })) }, 'Transfer received');
  return (
    <Modal title={t ? `${t.transfer_number}` : 'Transfer'} onClose={onClose} wide>
      <Alert>{error}</Alert>
      {loading && !t && <PageLoader compact />}
      {t && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-small"><StatusPill map={TRANSFER_STATUS} status={t.status} /><span className="flex items-center gap-2 font-medium">{t.from_warehouse}<ArrowRight aria-hidden="true" className="h-4 w-4 text-ink-400" />{t.to_warehouse}</span>{t.vehicle_no && <span className="text-ink-500">{t.vehicle_no}</span>}{t.dispatched_at && <span className="text-ink-500">sent {longDate(t.dispatched_at)}</span>}{t.received_at && <span className="text-ink-500">received {longDate(t.received_at)}</span>}</div>
          <Table><Thead><Th>Product</Th><Th>Batches</Th><Th className="text-right">Sent</Th>{(t.status === 'RECEIVED' || recv) && <><Th className="text-right">Received</Th><Th className="text-right">Damaged</Th></>}{t.status === 'RECEIVED' && <Th className="text-right">Missing</Th>}</Thead>
            <tbody>{t.items.map((i) => <Tr key={i.item_id}><Td className="font-medium">{i.product}</Td><Td className="text-caption text-ink-500">{i.batches.map((b) => `${b.batch_no} × ${qty(b.qty_base)}`).join(', ') || '—'}</Td><Td className="text-right tabular">{qty(i.qty_base)} {i.unit}</Td>
              {recv ? <><Td className="text-right"><div className="ml-auto w-24"><Input aria-label={`Received ${i.product}`} type="number" min="0" step="any" value={recv[i.item_id].received} onChange={(e) => setRecv({ ...recv, [i.item_id]: { ...recv[i.item_id], received: e.target.value } })} className="text-right" /></div></Td><Td className="text-right"><div className="ml-auto w-24"><Input aria-label={`Damaged ${i.product}`} type="number" min="0" step="any" value={recv[i.item_id].damaged} onChange={(e) => setRecv({ ...recv, [i.item_id]: { ...recv[i.item_id], damaged: e.target.value } })} className="text-right" /></div></Td></>
                : t.status === 'RECEIVED' ? <><Td className="text-right tabular">{qty(i.received_base)}</Td><Td className="text-right tabular">{i.damaged_base ? qty(i.damaged_base) : '—'}</Td><Td className={`text-right tabular ${i.short_base > 0 ? 'font-semibold text-danger' : 'text-ink-400'}`}>{i.short_base > 0 ? qty(i.short_base) : '—'}</Td></> : null}</Tr>)}</tbody></Table>
          {t.notes && <p className="text-small text-ink-500">{t.notes}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {t.status === 'DRAFT' && can('inventory') && <><Button variant="ghost" loading={busy} onClick={() => act('cancel', {}, 'Transfer cancelled')}>Cancel</Button><Button loading={busy} onClick={() => act('dispatch', {}, 'Transfer dispatched')}>Dispatch</Button></>}
            {t.status === 'IN_TRANSIT' && !recv && <>{can('inventory') && <Button variant="ghost" loading={busy} onClick={() => act('cancel', {}, 'Transfer cancelled: stock returned to the sender')}>Cancel and return stock</Button>}<Button onClick={startReceive}>Receive…</Button></>}
            {recv && <><Button variant="ghost" onClick={() => setRecv(null)}>Back</Button><Button loading={busy} onClick={receive}>Confirm receipt</Button></>}
          </div>
        </div>
      )}
    </Modal>
  );
};

const TransfersTab = () => {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const [stamp, setStamp] = useState(0);
  const { data, meta, loading, error } = useLoad(`/wholesale/transfers${qs({ status: status || undefined, limit: 50, offset, k: stamp })}`, { paged: true });
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><Chips label="Transfer status" value={status} onChange={(v) => { setStatus(v); setOffset(0); }} options={[{ value: '', label: 'All' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'IN_TRANSIT', label: 'In transit' }, { value: 'RECEIVED', label: 'Received' }, { value: 'CANCELLED', label: 'Cancelled' }]} />{can('inventory') && <Button onClick={() => setCreating(true)}><Plus aria-hidden="true" className="h-4 w-4" />New transfer</Button>}</div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyLabel="No transfers" emptyBody="Move stock between your warehouses with a transfer." />
      {data?.length > 0 && <><Table><Thead><Th>Transfer</Th><Th>From</Th><Th>To</Th><Th>Status</Th><Th className="text-right">Lines</Th><Th className="text-right">Units</Th><Th>Created</Th></Thead>
        <tbody>{data.map((t) => <Tr key={t.transfer_id} onClick={() => setOpen(t.transfer_id)}><Td className="font-medium text-brand-700">{t.transfer_number}</Td><Td>{t.from_warehouse}</Td><Td>{t.to_warehouse}</Td><Td><StatusPill map={TRANSFER_STATUS} status={t.status} /></Td><Td className="text-right tabular">{t.lines}</Td><Td className="text-right tabular">{qty(t.units)}</Td><Td>{longDate(t.created_at)}</Td></Tr>)}</tbody></Table><Pager meta={meta} onPage={setOffset} /></>}
      {creating && <NewTransfer onClose={() => setCreating(false)} onDone={() => { setCreating(false); setStamp((n) => n + 1); }} />}
      {open && <TransferDialog id={open} onClose={() => setOpen(null)} onChanged={() => setStamp((n) => n + 1)} />}
    </div>
  );
};

export default TransfersTab;
