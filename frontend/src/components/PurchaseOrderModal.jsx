/*
 * One purchase order, before the goods arrive: edit it, send it to the supplier,
 * then receive what actually came (quantity and price) or cancel it. Nothing
 * here moves stock until "Receive". A new order starts as a draft.
 */
import { useEffect, useRef, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { Alert, Badge, Button, Field, Input, Modal, Select, useToast } from './ui.jsx';

const emptyLine = () => ({ item_id: null, product_id: '', description: '', quantity: '1', unit_cost: '', tax_rate: '0' });

const lineTotal = (l) => {
  const gross = Number(l.quantity || 0) * Number(l.unit_cost || 0);
  return gross + gross * (Number(l.tax_rate || 0) / 100);
};

const STATUS = { DRAFT: ['Draft', 'neutral'], ORDERED: ['Ordered', 'brand'], RECEIVED: ['Received', 'success'], CANCELLED: ['Cancelled', 'neutral'] };

const PurchaseOrderModal = ({ poId, products, suppliers, prefill, onClose, onChanged }) => {
  const toast = useToast();
  const receiveKey = useIdempotencyKey();
  const [po, setPo] = useState(null);                 // the saved order, when there is one
  const [supplierId, setSupplierId] = useState(prefill?.supplier_id ? String(prefill.supplier_id) : '');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState(() => (prefill?.items?.length
    ? prefill.items.map((i) => ({ ...emptyLine(), product_id: String(i.product_id), description: i.name, quantity: String(i.quantity), unit_cost: String(i.unit_cost ?? '') }))
    : [emptyLine()]));
  const [mode, setMode] = useState('edit');           // edit | sent | receive
  const [sent, setSent] = useState(null);
  const [recv, setRecv] = useState([]);
  const [paid, setPaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const savedId = useRef(poId ?? null);              // the order's id once it exists (a new one gets it on first save)

  const open = po && ['DRAFT', 'ORDERED'].includes(po.status);
  const locked = po && !open;

  const fill = (d) => {
    savedId.current = d.po_id;
    setPo(d); setSupplierId(d.supplier_id ? String(d.supplier_id) : ''); setExpected(d.expected_date || ''); setNotes(d.notes || '');
    setLines(d.items.map((i) => ({ item_id: i.item_id, product_id: i.product_id ? String(i.product_id) : '', description: i.description, quantity: String(i.quantity), unit_cost: String(i.unit_cost), tax_rate: String(i.tax_rate) })));
    setRecv(d.items.map((i) => ({ item_id: i.item_id, description: i.description, ordered: i.quantity, quantity: String(i.received_quantity ?? i.quantity), unit_cost: String(i.unit_cost) })));
  };
  useEffect(() => { if (poId) api(`/purchases/${poId}`).then(fill).catch((e) => setError(e.message)); }, [poId]);

  const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const pick = (i, productId) => {
    const p = products.find((x) => String(x.product_id) === productId);
    setLine(i, { product_id: productId, description: p?.name || '', unit_cost: String(p?.purchase_price ?? ''), tax_rate: '0' });
  };

  const payload = () => ({
    supplier_id: supplierId || null, notes: notes || null, expected_date: expected || null,
    items: lines.filter((l) => l.quantity && l.unit_cost !== '').map((l) => ({ product_id: l.product_id ? Number(l.product_id) : null, description: l.description || undefined, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost), tax_rate: Number(l.tax_rate) || 0 }))
  });

  const run = async (fn) => { setError(''); setBusy(true); try { return await fn(); } catch (caught) { setError(caught.message); return null; } finally { setBusy(false); } };

  const save = () => run(async () => {
    const body = payload();
    if (!body.items.length) throw new Error('Add at least one item');
    if (savedId.current) await api(`/purchases/${savedId.current}`, { method: 'PUT', body });
    else savedId.current = (await api('/purchases/orders', { method: 'POST', body })).po_id;
    fill(await api(`/purchases/${savedId.current}`));
    toast.success('Saved');
    onChanged();
    return true;
  });

  const send = () => run(async () => {
    if (await save() === null) return;
    const result = await api(`/purchases/${savedId.current}/send`, { method: 'POST', body: {} });
    setSent(result); setMode('sent'); onChanged();
    fill(await api(`/purchases/${savedId.current}`));
  });

  const cancel = () => {
    if (!window.confirm('Cancel this order? Nothing has been received, so stock is unaffected.')) return;
    run(async () => { await api(`/purchases/${savedId.current}/cancel`, { method: 'POST' }); toast.success('Order cancelled'); onChanged(); onClose(); });
  };

  const receive = () => run(async () => {
    try {
      const result = await api(`/purchases/${savedId.current}/receive`, {
        method: 'POST', idempotencyKey: receiveKey.get(),
        body: { items: recv.map((r) => ({ item_id: r.item_id, received_quantity: Number(r.quantity), unit_cost: Number(r.unit_cost) })), payment: paid ? { amount: Number(paid), method: 'CASH' } : undefined }
      });
      receiveKey.settle();
      toast.success(result.short_delivered?.length ? `Received. Short on: ${result.short_delivered.join(', ')}` : 'Received into stock');
      onChanged(); onClose();
    } catch (caught) { receiveKey.settle(caught); throw caught; }
  });

  const orderedTotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const receivedTotal = recv.reduce((s, r) => {
    const line = lines.find((l) => l.item_id === r.item_id);
    const gross = Number(r.quantity || 0) * Number(r.unit_cost || 0);
    return s + gross + gross * (Number(line?.tax_rate || 0) / 100);
  }, 0);
  const [statusLabel, statusTone] = STATUS[po?.status ?? 'DRAFT'];
  const overdue = po?.status === 'ORDERED' && po.expected_date && po.expected_date < new Date().toISOString().slice(0, 10);

  return (
    <Modal title={po ? `${po.po_number}` : 'New purchase order'} onClose={onClose} wide>
      <div className="space-y-4">
        {po && <div className="flex flex-wrap items-center gap-2"><Badge tone={statusTone}>{statusLabel}</Badge>{overdue && <Badge tone="danger">Overdue</Badge>}{po.source === 'FORECAST' && <Badge tone="neutral">From forecast</Badge>}</div>}
        <Alert>{error}</Alert>

        {mode === 'sent' && sent && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-ink-900">{sent.po_number} is marked as ordered{sent.emailed ? ` and was emailed to ${sent.supplier_email}` : ''}.</p>
            <textarea readOnly value={sent.message} rows={9} className="w-full rounded-lg border border-line-strong bg-surface-2 p-3 text-sm text-ink-800" />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(sent.message).then(() => toast.success('Copied'))}>Copy message</Button>
              {sent.whatsapp_url && <a href={sent.whatsapp_url} target="_blank" rel="noreferrer"><Button as="span" variant="secondary">Open in WhatsApp</Button></a>}
              <Button onClick={() => setMode('edit')}>Done</Button>
            </div>
          </div>
        )}

        {mode === 'edit' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="po-supplier" label="Supplier"><Select id="po-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={locked}>
                <option value="">Choose a supplier…</option>{suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
              </Select></Field>
              <Field id="po-expected" label="Expected by" hint="Blank: worked out from the items’ lead times when you send it."><Input id="po-expected" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} disabled={locked} /></Field>
            </div>

            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 items-center gap-2">
                  <Select className="col-span-4" value={l.product_id} onChange={(e) => pick(i, e.target.value)} disabled={locked}>
                    <option value="">Custom line…</option>{products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
                  </Select>
                  {!l.product_id && <Input className="col-span-3" placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} disabled={locked} />}
                  <Input className={l.product_id ? 'col-span-3' : 'col-span-2'} type="number" min="0.001" step="0.001" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} disabled={locked} />
                  <Input className="col-span-2" type="number" min="0" step="0.01" placeholder="Cost ₹" value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} disabled={locked} />
                  <Input className="col-span-2" type="number" min="0" step="0.01" placeholder="Tax %" value={l.tax_rate} onChange={(e) => setLine(i, { tax_rate: e.target.value })} disabled={locked} />
                  {!locked && <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="col-span-1 text-ink-400 hover:text-danger" aria-label="Remove line">✕</button>}
                </div>
              ))}
              {!locked && <Button type="button" variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>Add line</Button>}
            </div>
            <Field id="po-notes" label="Note for the supplier" hint="Optional"><Input id="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked} /></Field>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-lg font-bold text-ink-900">Total {formatCurrency(locked ? po.total : orderedTotal)}</p>
              {!locked && (
                <div className="flex flex-wrap gap-2">
                  {po && <Button variant="ghost" onClick={cancel} disabled={busy}>Cancel order</Button>}
                  <Button variant="secondary" onClick={save} disabled={busy}>{po ? 'Save changes' : 'Save draft'}</Button>
                  <Button variant="secondary" onClick={send} disabled={busy}>{po?.status === 'ORDERED' ? 'Send again' : 'Send to supplier'}</Button>
                  {po && <Button onClick={() => setMode('receive')} disabled={busy}>Receive…</Button>}
                </div>
              )}
            </div>
            {!po && <p className="text-xs text-ink-400">A draft doesn’t order anything or change stock. Send it when you’re ready.</p>}
          </>
        )}

        {mode === 'receive' && po && (
          <div className="space-y-3">
            <p className="text-sm text-ink-600">Enter what actually arrived and what the supplier charged. Stock goes up by the quantity received.</p>
            {recv.map((r, i) => (
              <div key={r.item_id} className="grid grid-cols-12 items-center gap-2">
                <span className="col-span-5 text-sm text-ink-900">{r.description} <span className="text-xs text-ink-400">ordered {r.ordered}</span></span>
                <Input className="col-span-3" type="number" min="0" step="0.001" value={r.quantity} onChange={(e) => setRecv((rs) => rs.map((x, idx) => (idx === i ? { ...x, quantity: e.target.value } : x)))} aria-label={`Received ${r.description}`} />
                <Input className="col-span-3" type="number" min="0" step="0.01" value={r.unit_cost} onChange={(e) => setRecv((rs) => rs.map((x, idx) => (idx === i ? { ...x, unit_cost: e.target.value } : x)))} aria-label={`Cost ${r.description}`} />
              </div>
            ))}
            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
              <div className="w-44"><Field id="po-paid" label="Paid now (₹)" hint="Blank = on credit"><Input id="po-paid" type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field></div>
              <p className="text-lg font-bold text-ink-900">Total {formatCurrency(receivedTotal)}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setMode('edit')}>Back</Button>
              <Button onClick={receive} disabled={busy}>{busy ? 'Receiving…' : 'Receive into stock'}</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default PurchaseOrderModal;
