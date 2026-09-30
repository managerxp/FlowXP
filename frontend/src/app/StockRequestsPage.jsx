/*
 * Stock requests between outlets: ask another outlet to send stock, send what another outlet asked for,
 * in full or in parts. Needs a business with more than one outlet.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Button, Card, Field, Input, ListState, Modal, PageHeader, Select, useToast } from '../components/ui.jsx';

const TONE = { PENDING: 'brand', PARTIAL: 'warning', FULFILLED: 'success', REJECTED: 'danger', CANCELLED: 'neutral', CLOSED: 'neutral' };
const when = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });

const NewRequest = ({ outlets, outletId, onDone, onClose }) => {
  const [from, setFrom] = useState('');
  const [products, setProducts] = useState([]);
  const [rows, setRows] = useState([{ product_id: '', quantity: '' }]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/products').then((p) => setProducts(p.filter((x) => x.track_inventory))).catch(() => {}); }, []);
  const setRow = (i, field, value) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  const send = async () => {
    setBusy(true); setError('');
    try {
      await api('/transfer-requests', { method: 'POST', body: { from_branch_id: Number(from), notes: notes || undefined, items: rows.filter((r) => r.product_id && Number(r.quantity) > 0).map((r) => ({ product_id: Number(r.product_id), quantity: Number(r.quantity) })) } });
      onDone();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Ask another outlet for stock" onClose={onClose} wide>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="sr-from" label="Ask which outlet?"><Select id="sr-from" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">Choose an outlet…</option>{outlets.filter((o) => o.branch_id !== outletId).map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name}</option>)}
        </Select></Field>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <Select className="col-span-7" aria-label="Item" value={r.product_id} onChange={(e) => setRow(i, 'product_id', e.target.value)}>
                <option value="">Choose item…</option>{products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}{p.unit ? ` (${p.unit})` : ''}</option>)}
              </Select>
              <Input className="col-span-4" type="number" min="0" step="0.001" placeholder="How much" value={r.quantity} onChange={(e) => setRow(i, 'quantity', e.target.value)} aria-label="Quantity" />
              <button type="button" className="col-span-1 text-ink-400 hover:text-danger" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, { product_id: '', quantity: '' }])}>Add item</Button>
        </div>
        <Field id="sr-notes" label="Note" hint="Optional"><Input id="sr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !from} onClick={send}>{busy ? 'Sending…' : 'Send request'}</Button></div>
      </div>
    </Modal>
  );
};

const RequestCard = ({ r, mine, onChanged }) => {
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [qty, setQty] = useState({});
  const [error, setError] = useState('');
  const open = ['PENDING', 'PARTIAL'].includes(r.status);
  const asked = mine === 'incoming';        // this outlet was asked, so it sends

  const act = async (fn) => { setError(''); try { await fn(); onChanged(); } catch (caught) { setError(caught.message); } };
  const fulfil = () => act(async () => {
    const items = r.items.map((i) => ({ item_id: i.item_id, quantity: Number(qty[i.item_id] ?? i.remaining) })).filter((i) => i.quantity > 0);
    await api(`/transfer-requests/${r.request_id}/fulfil`, { method: 'POST', body: { items } });
    toast.success('Stock sent'); setSending(false);
  });
  const reject = () => { const reason = window.prompt('Why can’t you send it? The other outlet will see this.'); if (reason) act(() => api(`/transfer-requests/${r.request_id}/reject`, { method: 'POST', body: { reason } })); };
  const cancel = () => { if (window.confirm('Call off what has not been sent yet?')) act(() => api(`/transfer-requests/${r.request_id}/cancel`, { method: 'POST' })); };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink-900">{r.to_name} asked {r.from_name} <span className="font-normal text-ink-400">· {when(r.created_at)}</span></p>
        <Badge tone={TONE[r.status]}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge>
      </div>
      {r.notes && <p className="mt-1 text-xs text-ink-500">“{r.notes}”</p>}
      {r.decision_note && <p className="mt-1 text-xs text-danger">{r.decision_note}</p>}
      <ul className="mt-3 space-y-1 text-sm">
        {r.items.map((i) => (
          <li key={i.item_id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-ink-800">{i.name}</span>
            <span className="flex items-center gap-2 text-ink-500">
              {i.sent}/{i.requested}{i.unit ? ` ${i.unit}` : ''}
              {sending && asked && i.remaining > 0 && <Input className="!w-24 !py-1" type="number" min="0" max={i.remaining} step="0.001" value={qty[i.item_id] ?? i.remaining} onChange={(e) => setQty((q) => ({ ...q, [i.item_id]: e.target.value }))} aria-label={`Send ${i.name}`} />}
            </span>
          </li>
        ))}
      </ul>
      <Alert>{error}</Alert>
      {open && (
        <div className="mt-3 flex flex-wrap gap-2">
          {asked && !sending && <Button size="sm" onClick={() => setSending(true)}>Send stock…</Button>}
          {asked && sending && <><Button size="sm" onClick={fulfil}>Send these quantities</Button><Button size="sm" variant="ghost" onClick={() => setSending(false)}>Back</Button></>}
          {asked && r.status === 'PENDING' && !sending && <Button size="sm" variant="ghost" onClick={reject}>Turn down</Button>}
          {!asked && <Button size="sm" variant="ghost" onClick={cancel}>Call off</Button>}
        </div>
      )}
    </Card>
  );
};

const StockRequestsPage = () => {
  const { outlets, outletId } = useAuth();
  const [box, setBox] = useState('incoming');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const viewingAll = outletId === 'all';
  const load = () => api(`/transfer-requests?box=${box}`).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { setRows(null); load(); }, [box, outletId]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (outlets.length < 2) return <div><PageHeader title="Stock requests" lead="Ask another outlet for stock." /><p className="text-sm text-ink-500">Stock requests are for businesses with more than one outlet.</p></div>;

  return (
    <div>
      <PageHeader title="Stock requests" lead="Ask another outlet to send stock, or send what an outlet asked you for." action={!viewingAll && <Button onClick={() => setAsking(true)}>Ask for stock</Button>} />
      {viewingAll && <p className="mb-4 text-sm text-ink-500">Pick one outlet at the top to ask for stock. Showing every request below.</p>}
      <div className="mb-5 flex gap-2" role="tablist">
        {[['incoming', 'Asked of this outlet'], ['outgoing', 'Asked by this outlet']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={box === id} onClick={() => setBox(id)} className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${box === id ? 'bg-brand-50 text-brand-600' : 'text-ink-600 hover:bg-surface-2'}`}>{label}</button>
        ))}
      </div>
      <ListState loading={!rows && !error} error={error} empty={rows?.length === 0} emptyLabel={box === 'incoming' ? 'No other outlet is asking you for stock.' : 'You have not asked any outlet for stock.'} />
      <div className="space-y-3">{rows?.map((r) => <RequestCard key={r.request_id} r={r} mine={box} onChanged={load} />)}</div>
      {asking && <NewRequest outlets={outlets} outletId={outletId} onClose={() => setAsking(false)} onDone={() => { setAsking(false); setBox('outgoing'); load(); }} />}
    </div>
  );
};

export default StockRequestsPage;
