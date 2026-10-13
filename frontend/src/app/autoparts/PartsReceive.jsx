/* Receiving parts (goods receipt): what arrived = accepted + damaged + rejected. Only the accepted part becomes stock; damaged goes to the damaged list; rejected goes back to the supplier.
   A line can name the bin it goes to (put away on the spot); otherwise it waits on the Put away tab. */
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { n3, qs, rsPaise, useDebounced, useLoad } from '../../lib/autoparts.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { Pager, Panel, useAction } from '../salon/parts.jsx';

const key = () => (crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random()}`);

const NewReceipt = ({ onClose, onSaved }) => {
  const [suppliers, setSuppliers] = useState([]);
  const bins = useLoad('/autoparts/locations');
  const [supplier, setSupplier] = useState(''); const [invoice, setInvoice] = useState(''); const [date, setDate] = useState('');
  const [lines, setLines] = useState([]);
  const [term, setTerm] = useState(''); const q = useDebounced(term, 250);
  const found = useLoad(q.trim().length >= 2 ? `/autoparts/parts/lookup${qs({ q, limit: 6 })}` : null);
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const idem = useRef(key());
  useEffect(() => { api('/suppliers').then(setSuppliers).catch(() => {}); }, []);
  const storing = (bins.data || []).filter((l) => l.can_store && l.is_active);
  const add = (p) => { setLines((ls) => (ls.some((l) => l.product_id === p.product_id) ? ls : [...ls, { product_id: p.product_id, name: p.name, sku: p.sku, received: '', damaged: '', rejected: '', unit_cost: String((p.purchase_price_paise || 0) / 100), bin_id: '' }])); setTerm(''); };
  const set = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const accepted = (l) => Math.max(0, Number(l.received || 0) - Number(l.damaged || 0) - Number(l.rejected || 0));
  const save = () => run(async () => {
    setError('');
    const items = lines.filter((l) => Number(l.received) > 0).map((l) => ({ product_id: l.product_id, received: Number(l.received), damaged: Number(l.damaged || 0), rejected: Number(l.rejected || 0), unit_cost: Number(l.unit_cost || 0), bin_id: l.bin_id ? Number(l.bin_id) : undefined }));
    try {
      const out = await api('/autoparts/grns', { method: 'POST', idempotencyKey: idem.current, body: { supplier_id: Number(supplier), supplier_invoice_no: invoice || undefined, grn_date: date || undefined, items } });
      onSaved(out);
    } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal wide title="Receive parts" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!supplier || !lines.some((l) => Number(l.received) > 0)}>Post receipt</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="rc-sup" label="Supplier"><Select id="rc-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">Choose</option>{suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}</Select></Field>
          <Field id="rc-inv" label="Supplier invoice no." hint="The same invoice cannot be booked twice"><Input id="rc-inv" value={invoice} onChange={(e) => setInvoice(e.target.value)} /></Field>
          <Field id="rc-date" label="Date received"><Input id="rc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <div>
          <Field id="rc-find" label="Add a part" hint="Scan, or type a name, SKU or part number"><Input id="rc-find" value={term} onChange={(e) => setTerm(e.target.value)} /></Field>
          {found.data?.length > 0 && <ul className="mt-1 rounded-lg border border-line">{found.data.map((p) => <li key={p.product_id}><button type="button" className="block w-full px-4 py-2 text-left text-small hover:bg-surface-2" onClick={() => add(p)}>{p.name} <span className="text-ink-400">{p.sku}</span></button></li>)}</ul>}
        </div>
        {lines.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <Thead><Th>Part</Th><Th>Arrived</Th><Th>Damaged</Th><Th>Rejected</Th><Th>Accepted</Th><Th>Cost</Th><Th>Bin</Th><Th /></Thead>
              <tbody>
                {lines.map((l, i) => (
                  <Tr key={l.product_id}>
                    <Td>{l.name}<span className="block text-caption text-ink-500">{l.sku}</span></Td>
                    {['received', 'damaged', 'rejected'].map((k) => <Td key={k}><div className="w-20"><Input aria-label={`${k} ${l.name}`} type="number" min="0" step="any" value={l[k]} onChange={(e) => set(i, k, e.target.value)} /></div></Td>)}
                    <Td className="tabular font-medium">{n3(accepted(l))}</Td>
                    <Td><div className="w-24"><Input aria-label={`Cost ${l.name}`} type="number" min="0" step="any" value={l.unit_cost} onChange={(e) => set(i, 'unit_cost', e.target.value)} /></div></Td>
                    <Td><Select aria-label={`Bin ${l.name}`} className="w-40" value={l.bin_id} onChange={(e) => set(i, 'bin_id', e.target.value)}><option value="">Put away later</option>{storing.map((b) => <option key={b.location_id} value={b.location_id}>{b.code}</option>)}</Select></Td>
                    <Td><Button size="sm" variant="ghost" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 aria-hidden="true" className="h-4 w-4" /></Button></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </Modal>
  );
};

const Detail = ({ id, onClose, onChanged, canCancel }) => {
  const g = useLoad(`/autoparts/grns/${id}`);
  const toast = useToast();
  const [reason, setReason] = useState(''); const [asking, setAsking] = useState(false);
  const [busy, run] = useAction();
  const x = g.data;
  const cancel = () => run(async () => { await api(`/autoparts/grns/${id}/cancel`, { method: 'POST', body: { reason } }); toast.success('Receipt cancelled'); onChanged(); onClose(); }, null);
  return (
    <Modal wide title={x ? `${x.grn_number}${x.supplier ? ` · ${x.supplier}` : ''}` : 'Receipt'} onClose={onClose}>
      <ListState loading={g.loading && !x} error={g.error} />
      {x && (
        <div className="space-y-4">
          <p className="text-small text-ink-700">{x.grn_date}{x.supplier_invoice_no ? ` · invoice ${x.supplier_invoice_no}` : ''} · <Badge tone={x.status === 'POSTED' ? 'success' : 'danger'}>{x.status === 'POSTED' ? 'Posted' : 'Cancelled'}</Badge></p>
          <Table>
            <Thead><Th>Part</Th><Th className="text-right">Arrived</Th><Th className="text-right">Accepted</Th><Th className="text-right">Damaged</Th><Th className="text-right">Rejected</Th><Th>Bin</Th></Thead>
            <tbody>{(x.items || []).map((i) => (<Tr key={i.grn_item_id}><Td>{i.product}<span className="block text-caption text-ink-500">{i.sku}</span></Td><Td className="tabular text-right">{n3(i.received)}</Td><Td className="tabular text-right">{n3(i.accepted)}</Td><Td className="tabular text-right">{n3(i.damaged)}</Td><Td className="tabular text-right">{n3(i.rejected)}</Td><Td>{i.bin_code || 'waiting'}</Td></Tr>))}</tbody>
          </Table>
          {canCancel && x.status === 'POSTED' && (asking ? (
            <div className="flex flex-wrap items-end gap-2"><Field id="gc-why" label="Why is it being cancelled?"><Input id="gc-why" value={reason} onChange={(e) => setReason(e.target.value)} /></Field><Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={cancel}>Cancel the receipt</Button></div>
          ) : <Button variant="secondary" onClick={() => setAsking(true)}>Cancel this receipt</Button>)}
        </div>
      )}
    </Modal>
  );
};

export default function PartsReceive() {
  const { can } = useAuth();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const list = useLoad(`/autoparts/grns${qs({ limit: 25, offset })}`, { paged: true });
  const [adding, setAdding] = useState(false); const [open, setOpen] = useState(null);
  const rows = list.data || [];
  return (
    <div>
      <PageHeader title="Receive parts" lead="Book a delivery against a supplier invoice. Damaged and rejected parts are kept apart from stock you can sell."
        action={can('grn') && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" /> New receipt</Button>} />
      <ListState loading={list.loading && !list.data} error={list.error} empty={list.data && rows.length === 0} emptyLabel="No receipts yet." />
      {rows.length > 0 && (
        <Panel className="!p-0">
          <Table>
            <Thead><Th>Receipt</Th><Th>Supplier</Th><Th>Invoice</Th><Th>Date</Th><Th className="text-right">Value</Th><Th>Status</Th></Thead>
            <tbody>{rows.map((g) => (<Tr key={g.grn_id} onClick={() => setOpen(g.grn_id)}><Td className="font-medium">{g.grn_number}</Td><Td>{g.supplier || '-'}</Td><Td>{g.supplier_invoice_no || '-'}</Td><Td>{g.grn_date}</Td><Td className="tabular text-right">{g.total_cost != null ? rsPaise(g.total_cost * 100) : ''}</Td><Td><Badge tone={g.status === 'POSTED' ? 'success' : 'danger'}>{g.status === 'POSTED' ? 'Posted' : 'Cancelled'}</Badge></Td></Tr>))}</tbody>
          </Table>
        </Panel>
      )}
      <Pager meta={list.meta} onPage={setOffset} />
      {adding && <NewReceipt onClose={() => setAdding(false)} onSaved={(g) => { setAdding(false); list.reload(); toast.success(g.putaway_tasks?.length ? `Receipt posted. ${g.putaway_tasks.length} line(s) wait for a bin.` : 'Receipt posted'); }} />}
      {open && <Detail id={open} onClose={() => setOpen(null)} onChanged={list.reload} canCancel={can('stock_approve')} />}
    </div>
  );
}
