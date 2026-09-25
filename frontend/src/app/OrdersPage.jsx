/*
 * Running tabs — dine-in, takeaway and delivery orders that haven't been
 * billed yet. A tab here is not a sale: nothing is charged, no stock moves,
 * and no GST is computed until "Bill" turns it into a real invoice through
 * the exact same modules/billing.js transaction the POS screen uses (see
 * orders.controller.js's bill()). Everything before that is just staging —
 * adding items, sending them to the kitchen, marking things ready — which is
 * why this screen looks nothing like BillingPage even though both end at an
 * invoice.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatCurrency } from '../lib/api.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { LoyaltyCard, MobileLookup } from '../components/LoyaltyCard.jsx';
import { getDevicePrefs, openPrint, setDevicePref } from '../lib/printing.js';
import ModifierPicker, { needsChoices, useModifierGroups } from '../components/ModifierPicker.jsx';
import {
  PageHeader, Button, Card, Badge, StatusBadge, Modal, Field, Input, Select,
  Alert, ListState, SkeletonCards
} from '../components/ui.jsx';

const TYPE_LABEL = { DINE_IN: 'Dine-in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery' };

/* ── New order ─────────────────────────────────────────────────────────── */
const NewOrderModal = ({ onClose, onCreated }) => {
  const [orderType, setOrderType] = useState('DINE_IN');
  const [tables, setTables] = useState([]);
  const [tableId, setTableId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/tables').then((rows) => setTables(rows.filter((t) => !t.open_order_id && t.status === 'FREE'))).catch(() => {});
  }, []);

  const create = async () => {
    if (orderType === 'DINE_IN' && !tableId) { setError('Choose a table'); return; }
    setBusy(true);
    setError('');
    try {
      const order = await api('/orders', { method: 'POST', body: { order_type: orderType, table_id: tableId || undefined } });
      onCreated(order);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New order" onClose={onClose}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="order-type" label="Type">
          <Select id="order-type" value={orderType} onChange={(e) => { setOrderType(e.target.value); setTableId(''); }}>
            <option value="DINE_IN">Dine-in</option>
            <option value="TAKEAWAY">Takeaway</option>
          </Select>
        </Field>
        {orderType === 'DINE_IN' && (
          <Field id="order-table" label="Table" hint={!tables.length ? 'No free tables — add one on the Tables page.' : undefined}>
            <Select id="order-table" value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">Choose a table…</option>
              {tables.map((t) => <option key={t.table_id} value={t.table_id}>{t.name}{t.zone ? ` · ${t.zone}` : ''}</option>)}
            </Select>
          </Field>
        )}
        <Button onClick={create} disabled={busy} className="w-full">{busy ? 'Opening…' : 'Open order'}</Button>
      </div>
    </Modal>
  );
};

/* ── Floor operations: move, merge, split ─────────────────────────────── */

const OpenItemsPicker = ({ items, selected, setSelected }) => {
  const toggle = (item) => setSelected((cur) => {
    const next = { ...cur };
    if (next[item.order_item_id]) delete next[item.order_item_id]; else next[item.order_item_id] = item.quantity;
    return next;
  });
  const setQty = (item, q) => setSelected((cur) => ({ ...cur, [item.order_item_id]: Math.min(item.quantity, Math.max(1, q)) }));
  return (
    <ul className="space-y-1.5">
      {items.map((item) => {
        const on = selected[item.order_item_id] != null;
        return (
          <li key={item.order_item_id} className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-sm ${on ? 'border-brand-500 bg-brand-50' : 'border-line'}`}>
            <label className="flex min-w-0 flex-1 items-center gap-3">
              <input type="checkbox" checked={on} onChange={() => toggle(item)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
              <span className="min-w-0">
                <span className="font-medium text-ink-900">{item.description}</span>
                {item.modifiers?.length > 0 && <span className="block truncate text-xs text-ink-500">{item.modifiers.map((m) => m.name).join(', ')}</span>}
              </span>
            </label>
            {on && item.quantity > 1 ? (
              <span className="flex items-center gap-2">
                <button type="button" aria-label="Fewer" onClick={() => setQty(item, selected[item.order_item_id] - 1)} className="h-7 w-7 rounded-full border border-line-strong">−</button>
                <span className="w-8 text-center font-semibold">{selected[item.order_item_id]} / {item.quantity}</span>
                <button type="button" aria-label="More" onClick={() => setQty(item, selected[item.order_item_id] + 1)} className="h-7 w-7 rounded-full border border-line-strong">+</button>
              </span>
            ) : <span className="text-ink-500">× {item.quantity}</span>}
            <span className="w-20 text-right font-semibold text-ink-900">{formatCurrency(item.unit_price * (on ? selected[item.order_item_id] : item.quantity))}</span>
          </li>
        );
      })}
    </ul>
  );
};

const selection = (selected) => Object.entries(selected).map(([id, quantity]) => ({ order_item_id: Number(id), quantity }));

/* Split the bill (a separate invoice for the chosen items) or move those items to another table. */
const SplitModal = ({ order, onDone, onClose }) => {
  const navigate = useNavigate();
  const idem = useIdempotencyKey();
  const [mode, setMode] = useState('bill');
  const [selected, setSelected] = useState({});
  const [pay, setPay] = useState('');
  const [tables, setTables] = useState([]);
  const [tableId, setTableId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState([]);
  const isDineIn = order.order_type === 'DINE_IN';
  const open = order.items.filter((i) => i.status !== 'CANCELLED' && !i.billed);

  useEffect(() => { if (isDineIn) api('/tables').then((rows) => setTables(rows.filter((t) => t.table_id !== order.table_id && (t.open_order_id || t.status === 'FREE')))).catch(() => {}); }, [isDineIn, order.table_id]);

  const chosen = selection(selected);
  const run = async () => {
    setBusy(true); setError('');
    try {
      if (mode === 'bill') {
        const invoice = await api(`/orders/${order.order_id}/bill`, {
          method: 'POST', idempotencyKey: idem.get(),
          body: { items: chosen, payment: pay ? { method: pay, amount: 'FULL' } : undefined }
        });
        idem.settle();
        setMade((m) => [...m, invoice]);
        setSelected({});
        if (invoice.order_closed) { onDone(); navigate(`/app/billing/invoices/${invoice.invoice_id}`); return; }
      } else {
        await api(`/orders/${order.order_id}/split`, { method: 'POST', idempotencyKey: idem.get(), body: { items: chosen, table_id: Number(tableId) } });
        idem.settle();
        setSelected({});
      }
      onDone();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Split this order" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex gap-2">
          {[['bill', 'Bill separately'], ...(isDineIn ? [['move', 'Move to another table']] : [])].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setMode(key)} aria-pressed={mode === key}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${mode === key ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-line-strong bg-surface text-ink-700'}`}>{label}</button>
          ))}
        </div>
        <p className="text-sm text-ink-500">
          {mode === 'bill' ? 'Tick what one guest is paying for. They get their own invoice; the rest stays open.' : 'Tick what is moving. If that table already has an order, the items join it; otherwise a new order opens there.'}
        </p>
        <Alert>{error}</Alert>
        {made.length > 0 && (
          <p className="rounded-lg bg-success/10 p-3 text-sm text-success">
            Billed: {made.map((m) => `${m.invoice_number} (${formatCurrency(m.total)}${m.payment_status === 'PAID' ? ', paid' : ''})`).join(' · ')}
          </p>
        )}
        {open.length === 0 ? <p className="text-sm text-ink-400">Everything on this order has been billed.</p> : <OpenItemsPicker items={open} selected={selected} setSelected={setSelected} />}

        {open.length > 0 && (
          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
            {mode === 'bill' ? (
              <Field id="split-pay" label="Payment">
                <Select id="split-pay" value={pay} onChange={(e) => setPay(e.target.value)}>
                  <option value="">Not paid yet</option><option value="CASH">Paid in cash</option><option value="UPI">Paid by UPI</option><option value="CARD">Paid by card</option>
                </Select>
              </Field>
            ) : (
              <Field id="split-table" label="Move to">
                <Select id="split-table" value={tableId} onChange={(e) => setTableId(e.target.value)}>
                  <option value="">Choose a table…</option>
                  {tables.map((t) => <option key={t.table_id} value={t.table_id}>{t.name}{t.open_order_id ? ` · has ${t.open_order_number}` : ' · free'}</option>)}
                </Select>
              </Field>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              <Button onClick={run} disabled={busy || !chosen.length || (mode === 'move' && !tableId)}>
                {busy ? 'Working…' : mode === 'bill' ? `Bill ${chosen.length || ''} selected`.trim() : 'Move selected'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

const MoveTableModal = ({ order, onDone, onClose }) => {
  const idem = useIdempotencyKey();
  const [tables, setTables] = useState([]);
  const [tableId, setTableId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api('/tables').then((rows) => setTables(rows.filter((t) => !t.open_order_id && t.status === 'FREE'))).catch(() => {}); }, []);

  const go = async () => {
    setBusy(true); setError('');
    try { await api(`/orders/${order.order_id}/transfer`, { method: 'POST', idempotencyKey: idem.get(), body: { table_id: Number(tableId) } }); idem.settle(); onDone(); }
    catch (caught) { idem.settle(caught); setError(caught.message); setBusy(false); }
  };
  return (
    <Modal title={`Move ${order.table_name || 'order'} to another table`} onClose={onClose}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="move-table" label="New table" hint={!tables.length ? 'No free tables right now.' : 'Only free tables are listed. To join two tables, use Merge.'}>
          <Select id="move-table" value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">Choose a table…</option>
            {tables.map((t) => <option key={t.table_id} value={t.table_id}>{t.name}{t.zone ? ` · ${t.zone}` : ''}</option>)}
          </Select>
        </Field>
        <Button onClick={go} disabled={busy || !tableId} className="w-full">{busy ? 'Moving…' : 'Move order'}</Button>
      </div>
    </Modal>
  );
};

const MergeModal = ({ order, onDone, onClose }) => {
  const idem = useIdempotencyKey();
  const [candidates, setCandidates] = useState([]);
  const [fromId, setFromId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/orders?open_only=true').then((rows) => setCandidates(rows.filter((o) => o.order_type === 'DINE_IN' && o.order_id !== order.order_id))).catch(() => {});
  }, [order.order_id]);

  const go = async () => {
    setBusy(true); setError('');
    try { await api(`/orders/${order.order_id}/merge`, { method: 'POST', idempotencyKey: idem.get(), body: { from_order_id: Number(fromId) } }); idem.settle(); onDone(); }
    catch (caught) { idem.settle(caught); setError(caught.message); setBusy(false); }
  };
  const picked = candidates.find((o) => String(o.order_id) === fromId);
  return (
    <Modal title={`Merge another table into ${order.table_name || order.order_number}`} onClose={onClose}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="merge-from" label="Merge in" hint={!candidates.length ? 'There is no other open dine-in order.' : undefined}>
          <Select id="merge-from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">Choose an order…</option>
            {candidates.map((o) => <option key={o.order_id} value={o.order_id}>{o.table_name} · {o.order_number}</option>)}
          </Select>
        </Field>
        {picked && <p className="rounded-lg bg-surface-2 p-3 text-sm text-ink-600">Everything on {picked.table_name} moves onto this order and {picked.table_name} becomes free. This can't be undone, but you can split items back out.</p>}
        <Button onClick={go} disabled={busy || !fromId} className="w-full">{busy ? 'Merging…' : 'Merge orders'}</Button>
      </div>
    </Modal>
  );
};

/* ── Order detail: add items, send to kitchen, bill ──────────────────────── */
const OrderDetail = ({ orderId, onClose, onChanged }) => {
  const billKey = useIdempotencyKey();
  const withGroups = useModifierGroups();
  const [picking, setPicking] = useState(null);
  const [floorOp, setFloorOp] = useState(null);   // 'split' | 'move' | 'merge'
  const [rush, setRush] = useState(false);
  const [printKot, setPrintKot] = useState(() => getDevicePrefs().autoPrintKot);
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [changingCustomer, setChangingCustomer] = useState(false);
  const [card, setCard] = useState(null);
  const [waiters, setWaiters] = useState([]);
  useEffect(() => { api('/tables/waiters').then(setWaiters).catch(() => {}); }, []);
  const setWaiter = async (id) => {
    setError('');
    try { await api(`/orders/${orderId}/waiter`, { method: 'PATCH', body: { waiter_user_id: id ? Number(id) : null } }); load(); onChanged(); }
    catch (caught) { setError(caught.message); }
  };

  const load = () => api(`/orders/${orderId}`).then(setOrder).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where the tab's customer stands on their visit card.
  useEffect(() => {
    if (!order?.customer_id) { setCard(null); return; }
    api(`/loyalty/customers/${order.customer_id}`).then((d) => setCard(d.loyalty)).catch(() => setCard(null));
  }, [order?.customer_id]);

  const attachCustomer = async (customer) => {
    setError('');
    try { await api(`/orders/${orderId}/customer`, { method: 'PATCH', body: { customer_id: customer?.customer_id ?? null } }); setChangingCustomer(false); load(); }
    catch (caught) { setError(caught.message); }
  };

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const handle = setTimeout(() => api(`/products?kind=DISH&search=${encodeURIComponent(query)}`).then(setResults).catch(() => {}), 200);
    return () => clearTimeout(handle);
  }, [query]);

  const addItem = async (product, modifierIds = []) => {
    setQuery(''); setResults([]); setPicking(null);
    try {
      await api(`/orders/${orderId}/items`, { method: 'POST', body: { items: [{ product_id: product.product_id, quantity: 1, modifier_ids: modifierIds }] } });
      load(); onChanged();
    } catch (caught) { setError(caught.message); }
  };

  const pendingCount = order?.items.filter((i) => i.status === 'PENDING').length || 0;

  const sendKot = async () => {
    setBusy(true); setError('');
    try {
      const kot = await api(`/orders/${orderId}/kot`, { method: 'POST', body: { priority: rush ? 'RUSH' : 'NORMAL' } });
      setRush(false); load(); onChanged();
      if (printKot) openPrint('kot', kot.kot_id);
    }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const billOrder = async () => {
    setBusy(true); setError('');
    try {
      const invoice = await api(`/orders/${orderId}/bill`, { method: 'POST', idempotencyKey: billKey.get(), body: couponCode.trim() ? { coupon_code: couponCode.trim() } : undefined });
      billKey.settle();
      if (getDevicePrefs().autoPrintReceipt) openPrint('receipt', invoice.invoice_id);
      onChanged();
      navigate(`/app/billing/invoices/${invoice.invoice_id}`);
    } catch (caught) { billKey.settle(caught); setError(caught.message); setBusy(false); }
  };

  if (!order) return <Modal title="Order" onClose={onClose}><p className="text-sm text-ink-400">Loading…</p></Modal>;

  const total = order.items.filter((i) => i.status !== 'CANCELLED' && !i.billed).reduce((sum, i) => sum + i.line_total, 0);
  const billedCount = order.items.filter((i) => i.billed).length;
  const isDineIn = order.order_type === 'DINE_IN';

  return (
    <Modal title={`${order.order_number} · ${TYPE_LABEL[order.order_type]}${order.table_name ? ` · ${order.table_name}` : ''}`} onClose={onClose} wide>
      <div className="space-y-4">
        <Alert>{error}</Alert>

        <div className="relative">
          <Input placeholder="Search product to add…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
              {results.map((p) => (
                <button key={p.product_id} type="button" onClick={() => { const full = withGroups(p); if (needsChoices(full)) { setResults([]); setPicking(full); } else addItem(p); }}
                        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm hover:bg-surface-2">
                  <span className="font-medium text-ink-900">{p.name}</span>
                  <span className="font-semibold text-ink-900">{formatCurrency(p.selling_price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {order.items.length === 0 ? (
          <p className="rounded-[--radius-card] border border-dashed border-line-strong py-10 text-center text-sm text-ink-400">
            No items yet — search above to add the first one.
          </p>
        ) : (
          <div className="space-y-1.5">
            {order.items.map((item) => (
              <div key={item.order_item_id} className="flex items-center justify-between rounded-lg border border-line px-3.5 py-2.5 text-sm">
                <div>
                  <span className={item.status === 'CANCELLED' ? 'text-ink-400 line-through' : 'font-medium text-ink-900'}>
                    {item.quantity} × {item.description}
                  </span>
                  {item.modifiers?.length > 0 && <span className="ml-2 text-xs text-ink-500">{item.modifiers.map((m) => m.name).join(', ')}</span>}
                  {item.kitchen_notes && <span className="ml-2 text-xs text-ink-400">“{item.kitchen_notes}”</span>}
                </div>
                <div className="flex items-center gap-3">
                  {item.billed && <Badge tone="success">Billed</Badge>}
                  <Badge tone={item.status === 'PENDING' ? 'warning' : item.status === 'CANCELLED' ? 'neutral' : 'brand'}>{item.status}</Badge>
                  <span className="w-20 text-right font-semibold text-ink-900">{formatCurrency(item.line_total)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {picking && <ModifierPicker product={picking} onClose={() => setPicking(null)} onConfirm={(ids) => addItem(picking, ids)} />}
        {floorOp === 'split' && <SplitModal order={order} onClose={() => setFloorOp(null)} onDone={() => { load(); onChanged(); }} />}
        {floorOp === 'move' && <MoveTableModal order={order} onClose={() => setFloorOp(null)} onDone={() => { setFloorOp(null); load(); onChanged(); }} />}
        {floorOp === 'merge' && <MergeModal order={order} onClose={() => setFloorOp(null)} onDone={() => { setFloorOp(null); load(); onChanged(); }} />}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setFloorOp('split')} disabled={total === 0}>Split…</Button>
          {isDineIn && order.table_id && <Button size="sm" variant="secondary" onClick={() => setFloorOp('move')}>Move table</Button>}
          {isDineIn && <Button size="sm" variant="secondary" onClick={() => setFloorOp('merge')}>Merge…</Button>}
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          {order.order_type === 'DINE_IN' && !['BILLED', 'CANCELLED', 'MERGED'].includes(order.status) && (
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-ink-700">Waiter</p>
              <Select aria-label="Waiter" className="!w-auto !py-1.5 text-sm" value={order.waiter_user_id || ''} onChange={(e) => setWaiter(e.target.value)}>
                <option value="">Not assigned</option>
                {waiters.map((w) => <option key={w.user_id} value={w.user_id}>{w.name}</option>)}
              </Select>
            </div>
          )}
          <div>
            <p className="mb-1 text-sm font-medium text-ink-700">Customer</p>
            {order.customer_id && !changingCustomer ? (
              <div className="space-y-2">
                <p className="text-sm text-ink-900">{order.customer_name} <button type="button" onClick={() => setChangingCustomer(true)} className="ml-2 text-xs font-semibold text-brand-600">Change</button></p>
                <LoyaltyCard card={card} compact />
              </div>
            ) : (
              <MobileLookup onPick={(customer) => attachCustomer(customer)} placeholder="Mobile number — for loyalty and coupons" />
            )}
          </div>
          <Input placeholder="Coupon code (optional)" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} />
        </div>

        {order.kots?.length > 0 && (
          <p className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-ink-500">
            Sent to the kitchen:
            {order.kots.map((k) => <button key={k.kot_id} type="button" onClick={() => openPrint('kot', k.kot_id)} className="rounded-full border border-line-strong px-2.5 py-1 font-semibold text-brand-600 hover:bg-surface-2">{k.kot_number} · Reprint</button>)}
          </p>
        )}

        <div className="flex items-center justify-between border-t border-line pt-4">
          <span className="text-base font-bold text-ink-900">{billedCount ? 'Left to bill' : 'Total'} (est.) {formatCurrency(total)}</span>
          <div className="flex gap-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink-600"><input type="checkbox" checked={printKot} onChange={(e) => { setPrintKot(e.target.checked); setDevicePref('autoPrintKot', e.target.checked); }} className="h-4 w-4 accent-[var(--color-brand-500)]" /> Print KOT</label>
            {pendingCount > 0 && <label className="flex items-center gap-1.5 text-xs font-medium text-ink-600"><input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} className="h-4 w-4 accent-[var(--color-danger)]" /> Rush</label>}
            <Button variant="secondary" onClick={sendKot} disabled={busy || !pendingCount}>
              {pendingCount ? `Send ${pendingCount} to kitchen` : 'Nothing new to send'}
            </Button>
            <Button onClick={billOrder} disabled={busy || total === 0}>{billedCount ? 'Bill the rest' : 'Bill'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

/* ── List ─────────────────────────────────────────────────────────────── */
const OrdersPage = () => {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = () => api('/orders?open_only=true').then(setOrders).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const groups = ['DINE_IN', 'TAKEAWAY', 'DELIVERY']
    .map((type) => ({ type, rows: (orders || []).filter((o) => o.order_type === type) }))
    .filter((g) => g.rows.length);

  return (
    <div>
      <PageHeader title="Orders" lead="Running tabs, before they're billed." action={<Button onClick={() => setShowNew(true)}>New order</Button>} />

      <ListState
        loading={!orders && !error}
        error={error}
        empty={orders?.length === 0}
        emptyLabel="No open orders — start one above, or wait for a delivery-platform order to arrive."
        skeleton={<SkeletonCards count={3} />}
      />

      <div className="space-y-8">
        {groups.map((g) => (
          <div key={g.type}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">{TYPE_LABEL[g.type]}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.rows.map((o) => (
                <Card key={o.order_id} className="cursor-pointer" onClick={() => setOpenId(o.order_id)}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink-900">{o.order_number}</span>
                    <StatusBadge status={o.status} />
                  </div>
                  <p className="mt-1 text-sm text-ink-500">
                    {o.table_name || (o.platform ? `${o.platform} · ${o.external_order_number || ''}` : 'Walk-in')}
                    {o.waiter_name && <span className="text-ink-400"> · {o.waiter_name}</span>}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showNew && (
        <NewOrderModal
          onClose={() => setShowNew(false)}
          onCreated={(order) => { setShowNew(false); load(); setOpenId(order.order_id); }}
        />
      )}
      {openId != null && (
        <OrderDetail orderId={openId} onClose={() => { setOpenId(null); load(); }} onChanged={load} />
      )}
    </div>
  );
};

export default OrdersPage;
