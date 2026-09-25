/*
 * Stock levels and manual adjustments. Sales and purchases move stock on
 * their own (see BillingPage / PurchasesPage) — this page is for the
 * movements nothing else causes: a count, a damage write-off, a correction.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { daysAgoISO } from '../lib/dates.js';
import { useAuth } from '../context/AuthContext.jsx';
import { RESTAURANT_TYPES } from '../lib/business.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useToast } from '../components/ui.jsx';

const AdjustForm = ({ products, onSaved, onClose }) => {
  const [productId, setProductId] = useState('');
  const [direction, setDirection] = useState('IN');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const idem = useIdempotencyKey();

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const qty = Number(quantity) * (direction === 'OUT' ? -1 : 1);
      await api('/inventory/adjust', { method: 'POST', idempotencyKey: idem.get(), body: { product_id: Number(productId), quantity: qty, reason } });
      idem.settle();
      onSaved();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Adjust stock" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="product" label="Product">
          <Select id="product" value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="" disabled>Choose a product…</option>
            {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name} ({p.current_stock} {p.unit})</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="direction" label="Direction">
            <Select id="direction" value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="IN">Add to stock</option>
              <option value="OUT">Remove from stock</option>
            </Select>
          </Field>
          <Field id="quantity" label="Quantity">
            <Input id="quantity" type="number" min="0.001" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </Field>
        </div>
        <Field id="reason" label="Reason" hint="e.g. stock count, damage, transfer">
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Adjust stock'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* Move stock from one outlet to another. The business total doesn't change; each outlet's history shows its side. */
const TransferForm = ({ products, outlets, fixedFrom, onSaved, onClose }) => {
  const toast = useToast();
  const idem = useIdempotencyKey();
  const [form, setForm] = useState({ product_id: '', from: fixedFrom ?? '', to: '', quantity: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/inventory/transfer', {
        method: 'POST', idempotencyKey: idem.get(),
        body: { product_id: Number(form.product_id), from_branch_id: Number(form.from), to_branch_id: Number(form.to), quantity: Number(form.quantity), notes: form.notes || undefined }
      });
      idem.settle();
      toast.success('Stock transferred');
      onSaved();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Transfer stock" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid grid-cols-2 gap-4">
          <Field id="t-from" label="From outlet">
            <Select id="t-from" value={form.from} onChange={set('from')} required disabled={fixedFrom != null}>
              <option value="" disabled>Choose…</option>
              {outlets.map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name}</option>)}
            </Select>
          </Field>
          <Field id="t-to" label="To outlet">
            <Select id="t-to" value={form.to} onChange={set('to')} required>
              <option value="" disabled>Choose…</option>
              {outlets.filter((o) => String(o.branch_id) !== String(form.from)).map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field id="t-product" label="Item">
          <Select id="t-product" value={form.product_id} onChange={set('product_id')} required>
            <option value="" disabled>Choose an item…</option>
            {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="t-qty" label="Quantity"><Input id="t-qty" type="number" min="0.001" step="0.001" value={form.quantity} onChange={set('quantity')} required /></Field>
          <Field id="t-notes" label="Note" hint="Optional"><Input id="t-notes" value={form.notes} onChange={set('notes')} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Moving…' : 'Transfer'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const Transfers = ({ refreshKey }) => {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/inventory/transfers').then(setRows).catch(() => setRows([])); }, [refreshKey]);
  if (!rows?.length) return null;
  return (
    <div className="mt-8">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-400">Recent transfers</h2>
      <Table>
        <Thead><Th>Date</Th><Th>Item</Th><Th className="text-right">Quantity</Th><Th>From</Th><Th>To</Th></Thead>
        <tbody>
          {rows.slice(0, 10).map((t) => (
            <Tr key={t.transfer_id}>
              <Td className="text-ink-500">{new Date(t.created_at).toLocaleString()}</Td>
              <Td className="font-medium">{t.product}</Td>
              <Td className="text-right">{t.quantity} {t.unit}</Td>
              <Td>{t.from_outlet}</Td><Td>{t.to_outlet}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
};

/* A new tracked product, not a new endpoint — POST /products already accepts
   opening_stock/min_stock/unit at creation (see products.controller.js), so
   an "add stock item" form is just that endpoint with track_inventory
   forced on, not a parallel ingredients table. */
const AddItemForm = ({ isRestaurant, onSaved, onClose }) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('INGREDIENT');
  const [cost, setCost] = useState('');
  const [unit, setUnit] = useState('pc');
  const [openingStock, setOpeningStock] = useState('0');
  const [minStock, setMinStock] = useState('5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/products', {
        method: 'POST',
        body: {
          name,
          unit,
          ...(isRestaurant ? { kind } : {}),
          purchase_price: Number(cost) || 0,
          track_inventory: true,
          opening_stock: Number(openingStock) || 0,
          min_stock: Number(minStock) || 0
        }
      });
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Add stock item" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="item-name" label="Name">
          <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Whole Milk" required autoFocus />
        </Field>
        {isRestaurant && (
          <Field id="item-kind" label="Type" hint="Ingredients and packaging are used in recipes; they are not sold on their own.">
            <Select id="item-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="INGREDIENT">Ingredient</option>
              <option value="PACKAGING">Packaging</option>
              <option value="DISH">Something I sell</option>
            </Select>
          </Field>
        )}
        <Field id="item-cost" label="Cost per unit (₹)" hint="What you pay for one unit — used for recipe cost and wastage value.">
          <Input id="item-cost" type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field id="item-unit" label="Unit">
            <Input id="item-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs" required />
          </Field>
          <Field id="item-stock" label="Opening stock">
            <Input id="item-stock" type="number" min="0" step="0.001" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} />
          </Field>
          <Field id="item-min" label="Low-stock alert">
            <Input id="item-min" type="number" min="0" step="0.001" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add stock item'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* The transaction-level detail behind a product's current_stock — every
   sale, purchase, and adjustment that produced the number in the table
   above. GET /inventory/:productId/history has existed since inventory's
   first pass; nothing in the frontend called it until now. */
const Ledger = ({ products }) => {
  const [search, setSearch] = useState('');
  const [productId, setProductId] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const matches = search
    ? products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : products;

  const selected = products.find((p) => String(p.product_id) === productId);

  useEffect(() => {
    if (!productId) { setRows(null); return; }
    api(`/inventory/${productId}/history`).then(setRows).catch((e) => setError(e.message));
  }, [productId]);

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-400">Stock ledger</h2>
      <div className="relative mb-4 max-w-sm">
        <Input
          placeholder="Search ingredient by name…"
          value={selected ? selected.name : search}
          onChange={(e) => { setSearch(e.target.value); setProductId(''); }}
        />
        {search && !productId && matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
            {matches.slice(0, 8).map((p) => (
              <button key={p.product_id} type="button" onClick={() => { setProductId(String(p.product_id)); setSearch(''); }}
                      className="block w-full px-3.5 py-2.5 text-left text-sm hover:bg-surface-2">
                {p.name} <span className="text-ink-400">· {p.current_stock} {p.unit}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Alert>{error}</Alert>

      {!productId ? (
        <p className="rounded-[--radius-card] border border-dashed border-line-strong py-10 text-center text-sm text-ink-400">
          Search for a product above to see every stock movement behind its current number.
        </p>
      ) : !rows ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-[--radius-card] border border-dashed border-line-strong py-10 text-center text-sm text-ink-400">
          No stock movements recorded yet for {selected?.name}.
        </p>
      ) : (
        <Table>
          <Thead><Th>Date</Th><Th>Type</Th><Th className="text-right">Quantity</Th><Th>Reference</Th><Th>Notes</Th></Thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.txn_id}>
                <Td className="text-ink-500">{new Date(r.created_at).toLocaleString()}</Td>
                <Td><Badge tone={r.transaction_type === 'SALE' || r.transaction_type === 'WASTAGE' ? 'danger' : r.transaction_type === 'PURCHASE' ? 'success' : 'neutral'}>{r.transaction_type}</Badge></Td>
                <Td className={`text-right font-medium ${r.quantity < 0 ? 'text-danger' : 'text-success'}`}>{r.quantity > 0 ? '+' : ''}{r.quantity}</Td>
                <Td className="text-ink-500">{r.reference_type || '—'}</Td>
                <Td className="text-ink-500">{r.notes || '—'}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

const WASTAGE_REASONS = {
  SPOILAGE: 'Spoiled', EXPIRED: 'Expired', DAMAGED: 'Damaged', PREPARATION: 'Preparation waste', OVERPRODUCTION: 'Over-production', OTHER: 'Other'
};

/* Stock that was thrown away. A ledger movement with a reason, so "why is
   tomato wastage rising" has an answer that isn't a guess. */
const WastageForm = ({ products, onSaved, onClose }) => {
  const toast = useToast();
  const idem = useIdempotencyKey();
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('SPOILAGE');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const result = await api('/inventory/wastage', {
        method: 'POST', idempotencyKey: idem.get(),
        body: { product_id: Number(productId), quantity: Number(quantity), reason_code: reason, notes: notes || undefined }
      });
      idem.settle();
      toast.success(`Logged — about ${formatCurrency(result.estimated_cost)} of stock`);
      onSaved();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Log wastage" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="w-product" label="Item">
          <Select id="w-product" value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="" disabled>Choose an item…</option>
            {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name} ({p.current_stock} {p.unit})</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="w-qty" label="Quantity wasted"><Input id="w-qty" type="number" min="0.001" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} required /></Field>
          <Field id="w-reason" label="Reason">
            <Select id="w-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(WASTAGE_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
        </div>
        <Field id="w-notes" label="Note" hint="Optional"><Input id="w-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Log wastage'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const WastageSummary = ({ refreshKey }) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    const from = daysAgoISO(30);
    api(`/inventory/wastage?from=${from}`).then(setData).catch(() => setData(null));
  }, [refreshKey]);
  if (!data || data.lines.length === 0) return null;
  return (
    <div className="glass mb-6 rounded-[--radius-card] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Wastage — last 30 days</p>
        <p className="text-lg font-bold text-ink-900">{formatCurrency(data.total_cost)}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {Object.entries(data.by_reason).map(([reason, cost]) => <Badge key={reason} tone="neutral">{WASTAGE_REASONS[reason] || reason} · {formatCurrency(cost)}</Badge>)}
      </div>
      <ul className="mt-3 space-y-1 text-sm text-ink-600">
        {data.lines.slice(0, 5).map((l) => (
          <li key={`${l.reason_code}-${l.product_id}`} className="flex justify-between">
            <span>{l.name} <span className="text-xs text-ink-400">· {WASTAGE_REASONS[l.reason_code] || l.reason_code} · {l.quantity} {l.unit}</span></span>
            <span className="text-ink-900">{formatCurrency(l.cost)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const InventoryPage = () => {
  const [items, setItems] = useState(null);
  const [valuation, setValuation] = useState(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [error, setError] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [wasting, setWasting] = useState(false);
  const [wastageKey, setWastageKey] = useState(0);
  const [transferring, setTransferring] = useState(false);
  const { business, outlets, outletId, activeOutlet, pinned } = useAuth();
  const isRestaurant = RESTAURANT_TYPES.includes(business?.business_type);

  const load = async () => {
    try {
      const params = new URLSearchParams(); if (lowOnly) params.set('low_stock', 'true');
      const [levels, val, all] = await Promise.all([api(`/inventory?${params}`), api('/inventory/valuation'), api('/products')]);
      setItems(levels); setValuation(val); setAllProducts(all);
    } catch (caught) { setError(caught.message); }
  };
  useEffect(() => { load(); }, [lowOnly]);

  return (
    <div>
      <PageHeader
        title="Inventory"
        lead={outlets.length > 1 ? (outletId === 'all' ? 'Stock across every outlet. Pick an outlet to adjust its stock.' : `Stock at ${activeOutlet?.name}.`) : "What's on the shelf, and what's running low."}
        action={
          <div className="flex gap-2">
            {outlets.length > 1 && <Button variant="secondary" onClick={() => setTransferring(true)}>Transfer stock</Button>}
            <Button variant="secondary" onClick={() => setAddingItem(true)}>Add stock item</Button>
            <Button variant="secondary" onClick={() => setWasting(true)}>Log wastage</Button>
            <Button onClick={() => setAdjusting(true)}>Adjust stock</Button>
          </div>
        }
      />

      {valuation && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="glass rounded-[--radius-card] p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Stock value</p>
            <p className="mt-1 text-2xl font-bold text-ink-900">{formatCurrency(valuation.total_value)}</p>
            <p className="mt-1 text-xs text-ink-400">at purchase cost, across {valuation.product_count} products</p>
          </div>
          <div className="glass rounded-[--radius-card] p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Low stock</p>
            <p className="mt-1 text-2xl font-bold text-ink-900">{items?.filter((i) => i.low_stock).length ?? '—'}</p>
            <p className="mt-1 text-xs text-ink-400">products at or below their reorder point</p>
          </div>
        </div>
      )}

      <WastageSummary refreshKey={wastageKey} />

      <label className="mb-4 flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
        Show only low stock
      </label>

      <ListState loading={!items && !error} error={error} empty={items?.length === 0} emptyLabel="No tracked products yet." />

      {items?.length > 0 && (
        <Table>
          <Thead><Th>Product</Th><Th className="text-right">Current stock</Th><Th className="text-right">Reorder at</Th><Th className="text-right">Stock value</Th><Th></Th></Thead>
          <tbody>
            {items.map((i) => (
              <Tr key={i.product_id}>
                <Td className="font-medium">{i.name}</Td>
                <Td className={`text-right ${i.low_stock ? 'font-semibold text-warning' : ''}`}>{i.current_stock} {i.unit}</Td>
                <Td className="text-right text-ink-500">{i.min_stock} {i.unit}</Td>
                <Td className="text-right">{formatCurrency(i.stock_value)}</Td>
                <Td className="text-right">{i.low_stock && <Badge tone="warning">Low</Badge>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {outlets.length > 1 && <Transfers refreshKey={wastageKey} />}

      <Ledger products={allProducts.filter((p) => p.track_inventory)} />

      {adjusting && (
        <AdjustForm products={allProducts.filter((p) => p.track_inventory)} onClose={() => setAdjusting(false)} onSaved={() => { setAdjusting(false); load(); }} />
      )}
      {wasting && (
        <WastageForm products={allProducts.filter((p) => p.track_inventory)} onClose={() => setWasting(false)} onSaved={() => { setWasting(false); setWastageKey((k) => k + 1); load(); }} />
      )}
      {transferring && (
        <TransferForm products={allProducts.filter((p) => p.track_inventory)} outlets={outlets} fixedFrom={pinned ? outletId : (outletId !== 'all' ? outletId : null)} onClose={() => setTransferring(false)} onSaved={() => { setTransferring(false); setWastageKey((k) => k + 1); load(); }} />
      )}
      {addingItem && (
        <AddItemForm isRestaurant={isRestaurant} onClose={() => setAddingItem(false)} onSaved={() => { setAddingItem(false); load(); }} />
      )}
    </div>
  );
};

export default InventoryPage;
