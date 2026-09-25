/*
 * Purchases: orders on their way (draft, sent to the supplier, received) and
 * the history of what has come in. Record purchase is the shortcut for goods
 * that are already here.
 *
 * (Original note:) record stock coming in from a supplier. Simpler than billing's
 * cart — no discount step, no product lookup during a live queue — so this
 * gets its own compact form rather than reusing BillingPage's cart machinery.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import PurchaseOrderModal from '../components/PurchaseOrderModal.jsx';
import { api, formatCurrency } from '../lib/api.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import {
  Alert, Badge, Button, Card, Field, Input, ListState, Modal,
  PageHeader, Select, StatusBadge, Table, Td, Th, Thead, Tr
} from '../components/ui.jsx';

const emptyLine = () => ({ product_id: '', description: '', quantity: '1', unit_cost: '', tax_rate: '0' });

const PurchaseForm = ({ products, suppliers, prefill, onSaved, onClose }) => {
  const [supplierId, setSupplierId] = useState(prefill?.supplier_id ? String(prefill.supplier_id) : '');
  const [lines, setLines] = useState(() => (prefill?.items?.length
    ? prefill.items.map((i) => ({ product_id: String(i.product_id), description: i.name, quantity: String(i.quantity), unit_cost: String(i.unit_cost ?? ''), tax_rate: String(products.find((p) => p.product_id === i.product_id)?.tax_rate ?? 0) }))
    : [emptyLine()]));
  const [paidNow, setPaidNow] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const idem = useIdempotencyKey();

  const setLine = (i, field, value) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));

  const pickProduct = (i, productId) => {
    const product = products.find((p) => String(p.product_id) === productId);
    setLines((ls) => ls.map((l, idx) => idx === i
      ? { ...l, product_id: productId, description: product?.name || '', unit_cost: String(product?.purchase_price ?? ''), tax_rate: String(product?.tax_rate ?? 0) }
      : l));
  };

  const total = lines.reduce((sum, l) => {
    const gross = Number(l.quantity || 0) * Number(l.unit_cost || 0);
    return sum + gross + gross * (Number(l.tax_rate || 0) / 100);
  }, 0);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const items = lines.filter((l) => l.quantity && l.unit_cost !== '').map((l) => ({
        product_id: l.product_id ? Number(l.product_id) : null,
        description: l.description || undefined,
        quantity: Number(l.quantity), unit_cost: Number(l.unit_cost), tax_rate: Number(l.tax_rate) || 0
      }));
      if (!items.length) throw new Error('Add at least one item');
      await api('/purchases', {
        method: 'POST',
        idempotencyKey: idem.get(),
        body: {
          supplier_id: supplierId || null, items,
          payment: paidNow ? { amount: Number(paidNow), method: 'CASH' } : undefined
        }
      });
      idem.settle();
      onSaved();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Record a purchase" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>

        <Field id="supplier" label="Supplier" hint="Optional">
          <Select id="supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">No supplier on file</option>
            {suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
          </Select>
        </Field>

        <div className="space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <Select className="col-span-4" value={line.product_id} onChange={(e) => pickProduct(i, e.target.value)}>
                <option value="">Custom line…</option>
                {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
              </Select>
              {!line.product_id && (
                <Input className="col-span-3" placeholder="Description" value={line.description} onChange={(e) => setLine(i, 'description', e.target.value)} />
              )}
              <Input className={line.product_id ? 'col-span-3' : 'col-span-2'} type="number" min="0.001" step="0.001" placeholder="Qty"
                     value={line.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} />
              <Input className="col-span-2" type="number" min="0" step="0.01" placeholder="Unit cost ₹"
                     value={line.unit_cost} onChange={(e) => setLine(i, 'unit_cost', e.target.value)} />
              <Input className="col-span-2" type="number" min="0" step="0.01" placeholder="Tax %"
                     value={line.tax_rate} onChange={(e) => setLine(i, 'tax_rate', e.target.value)} />
              <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                      className="col-span-1 text-ink-400 hover:text-danger" aria-label="Remove line">✕</button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>Add line</Button>
        </div>

        <div className="flex items-center justify-between border-t border-line pt-4">
          <div className="w-40">
            <Field id="paidNow" label="Paid now (₹)" hint="Leave blank if unpaid / on credit">
              <Input id="paidNow" type="number" min="0" step="0.01" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} />
            </Field>
          </div>
          <p className="text-lg font-bold text-ink-900">Total: {formatCurrency(total)}</p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record purchase'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const today = () => new Date().toISOString().slice(0, 10);

const OrderStatus = ({ po }) => {
  const overdue = po.status === 'ORDERED' && po.expected_date && po.expected_date < today();
  return (
    <span className="flex flex-wrap gap-1.5">
      <Badge tone={po.status === 'ORDERED' ? 'brand' : 'neutral'}>{po.status === 'ORDERED' ? 'Ordered' : 'Draft'}</Badge>
      {overdue && <Badge tone="danger">Overdue</Badge>}
      {po.source === 'FORECAST' && <Badge tone="neutral">Forecast</Badge>}
    </span>
  );
};

const PurchasesPage = () => {
  const [tab, setTab] = useState('open');
  const [open, setOpen] = useState(null);
  const [history, setHistory] = useState(null);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [error, setError] = useState('');
  const location = useLocation();
  const prefill = location.state?.prefill;
  const [adding, setAdding] = useState(false);          // record a purchase that has already arrived
  const [order, setOrder] = useState(prefill ? {} : null);   // {} = new order, { id } = an existing one

  const load = async () => {
    try {
      const [o, h, prods, sups] = await Promise.all([api('/purchases?status=DRAFT,ORDERED'), api('/purchases?status=RECEIVED,CANCELLED'), api('/products'), api('/suppliers')]);
      setOpen(o); setHistory(h); setProducts(prods); setSuppliers(sups);
    } catch (caught) { setError(caught.message); }
  };
  useEffect(() => { load(); }, []);

  const rows = tab === 'open' ? open : history;
  const late = open?.filter((p) => p.status === 'ORDERED' && p.expected_date && p.expected_date < today()).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Purchases"
        lead="Orders on their way, and what has come in."
        action={<div className="flex gap-2"><Button variant="secondary" onClick={() => setAdding(true)}>Record purchase</Button><Button onClick={() => setOrder({})}>New order</Button></div>}
      />

      <div className="mb-5 flex gap-2" role="tablist">
        {[['open', `Open orders${open ? ` (${open.length})` : ''}`], ['history', 'History']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${tab === id ? 'bg-brand-50 text-brand-600' : 'text-ink-600 hover:bg-surface-2'}`}>{label}</button>
        ))}
        {late > 0 && <Badge tone="danger">{late} overdue</Badge>}
      </div>

      <ListState loading={!rows && !error} error={error} empty={rows?.length === 0}
                 emptyLabel={tab === 'open' ? 'No open orders. Create one, or draft them from the stock forecast.' : 'Nothing received yet.'} />
      {rows?.length > 0 && (
        <Table>
          <Thead><Th>PO #</Th><Th>{tab === 'open' ? 'Expected' : 'Date'}</Th><Th>Supplier</Th><Th className="text-right">Total</Th>{tab === 'open' ? <Th>Status</Th> : <><Th className="text-right">Balance</Th><Th>Status</Th></>}</Thead>
          <tbody>
            {rows.map((po) => (
              <Tr key={po.po_id} onClick={tab === 'open' ? () => setOrder({ id: po.po_id }) : undefined}>
                <Td className="font-medium">{po.po_number}</Td>
                <Td className="text-ink-500">{tab === 'open' ? (po.expected_date || '—') : po.po_date}</Td>
                <Td>{po.supplier_name || '—'}</Td>
                <Td className="text-right">{formatCurrency(po.total)}</Td>
                {tab === 'open' ? <Td><OrderStatus po={po} /></Td> : (
                  <>
                    <Td className={`text-right ${po.balance_due > 0 ? 'font-semibold text-warning' : 'text-ink-400'}`}>{formatCurrency(po.balance_due)}</Td>
                    <Td>{po.status === 'CANCELLED' ? <Badge tone="neutral">Cancelled</Badge> : <StatusBadge status={po.payment_status} />}</Td>
                  </>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {adding && <PurchaseForm products={products} suppliers={suppliers} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {/* A pre-filled draft needs the product and supplier lists to resolve its ids, so wait for them. */}
      {order && (!prefill || products.length > 0) && (
        <PurchaseOrderModal poId={order.id} products={products} suppliers={suppliers} prefill={order.id ? undefined : prefill}
                            onClose={() => { setOrder(null); load(); }} onChanged={load} />
      )}
    </div>
  );
};

export default PurchasesPage;
