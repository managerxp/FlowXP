/*
 * Stock: what is on the shelf at this outlet, what is running low, and the
 * movements behind every number. The list on the left, the chosen item on the
 * right (?item=ID) with its count / wastage / transfer actions and its ledger.
 *
 * Sales and purchases move stock on their own (billing.js, purchases); this
 * screen records only what nothing else causes: a count, a correction,
 * wastage, a transfer. Writes need a real outlet, so the all-outlets view is
 * read-only here.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownLeft, ArrowLeft, ArrowRightLeft, ArrowUpRight, ClipboardCheck, PackagePlus, Search, Trash2 } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { useIdempotencyKey } from '../lib/idempotency.js';
import { daysAgoISO } from '../lib/dates.js';
import { useAuth } from '../context/AuthContext.jsx';
import { RESTAURANT_TYPES } from '../lib/business.js';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '../components/ui.jsx';

const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const when = (iso) => {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return days === 0 ? `Today, ${time}` : days === 1 ? `Yesterday, ${time}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
};
const stateOf = (i) => (i.current_stock <= 0 ? 'out' : i.low_stock ? 'low' : 'ok');
const KINDS = { INGREDIENT: 'Ingredients', PACKAGING: 'Packaging', DISH: 'Sold items' };
const WASTAGE_REASONS = { SPOILAGE: 'Spoiled', EXPIRED: 'Expired', DAMAGED: 'Damaged', PREPARATION: 'Preparation waste', OVERPRODUCTION: 'Made too much', OTHER: 'Other' };
const SORTS = {
  urgent: ['Lowest first', (a, b) => ({ out: 0, low: 1, ok: 2 }[stateOf(a)] - { out: 0, low: 1, ok: 2 }[stateOf(b)]) || a.name.localeCompare(b.name)],
  name: ['Name A–Z', (a, b) => a.name.localeCompare(b.name)],
  value: ['Most value', (a, b) => b.stock_value - a.stock_value]
};

/* How full the shelf is against the reorder level (full bar = twice the level). */
const Meter = ({ item }) => {
  if (!(item.min_stock > 0)) return null;
  const s = stateOf(item);
  const pct = Math.max(0, Math.min(100, (item.current_stock / (item.min_stock * 2)) * 100));
  return (
    <span aria-hidden="true" className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <span className={`block h-full rounded-full ${s === 'out' ? 'bg-danger' : s === 'low' ? 'bg-warning' : 'bg-brand-500'}`} style={{ width: `${Math.max(pct, s === 'out' ? 0 : 4)}%` }} />
    </span>
  );
};

const StateLabel = ({ item }) => {
  const s = stateOf(item);
  if (s === 'ok') return null;
  return <span className={`rounded px-1.5 py-0.5 text-caption font-semibold ${s === 'out' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>{s === 'out' ? 'Out' : 'Low'}</span>;
};

/* ── Forms ─────────────────────────────────────────────────────────────── */

const Segmented = ({ value, onChange, options, label }) => (
  <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-line bg-surface-2 p-1">
    {options.map(([v, text]) => (
      <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
              className={`rounded-md py-1.5 text-small font-medium ${value === v ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'}`}>{text}</button>
    ))}
  </div>
);

/* A stock count ("I counted 10") or a plain add/remove. The count works out the correction itself. */
const AdjustForm = ({ item, outletName, onSaved, onClose }) => {
  const idem = useIdempotencyKey();
  const toast = useToast();
  const [mode, setMode] = useState('count');
  const [counted, setCounted] = useState('');
  const [direction, setDirection] = useState('IN');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const delta = mode === 'count'
    ? (counted === '' ? null : Math.round((Number(counted) - item.current_stock) * 1000) / 1000)
    : (amount === '' ? null : Number(amount) * (direction === 'OUT' ? -1 : 1));

  const submit = async (e) => {
    e.preventDefault();
    if (!delta) return;
    setError(''); setBusy(true);
    try {
      const why = mode === 'count' ? (reason.trim() ? `Stock count: ${reason.trim()}` : 'Stock count') : reason.trim();
      await api('/inventory/adjust', { method: 'POST', idempotencyKey: idem.get(), body: { product_id: item.product_id, quantity: delta, reason: why } });
      idem.settle();
      toast.success(`${item.name}: ${delta > 0 ? '+' : ''}${qty(delta)} ${item.unit}`);
      onSaved();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Correct ${item.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Segmented label="How" value={mode} onChange={(m) => { setMode(m); setError(''); }} options={[['count', 'I counted it'], ['change', 'Add or remove']]} />
        <p className="text-small text-ink-500">FlowXP says <strong className="tabular text-ink-900">{qty(item.current_stock)} {item.unit}</strong>{outletName ? ` at ${outletName}` : ''}.</p>
        {mode === 'count' ? (
          <Field id="a-counted" label={`How much is there? (${item.unit})`}>
            <Input id="a-counted" type="number" min="0" step="0.001" value={counted} onChange={(e) => setCounted(e.target.value)} required autoFocus />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field id="a-dir" label="Change">
              <Select id="a-dir" value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="IN">Add to stock</option>
                <option value="OUT">Remove from stock</option>
              </Select>
            </Field>
            <Field id="a-qty" label={`Quantity (${item.unit})`}><Input id="a-qty" type="number" min="0.001" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></Field>
          </div>
        )}
        {delta != null && (
          <p className={`tabular rounded-lg px-3 py-2 text-small font-medium ${delta === 0 ? 'bg-success/10 text-success' : 'bg-surface-2 text-ink-700'}`}>
            {delta === 0 ? 'That matches. Nothing to change.' : <>Stock goes {delta > 0 ? 'up' : 'down'} by {qty(Math.abs(delta))} {item.unit}, to {qty(item.current_stock + delta)} {item.unit}{item.unit_cost > 0 && <> ({delta > 0 ? '+' : '−'}{formatCurrency(Math.abs(delta) * item.unit_cost)} at cost)</>}.</>}
          </p>
        )}
        <Field id="a-reason" label={mode === 'count' ? 'Note (optional)' : 'Why?'} hint={mode === 'count' ? undefined : 'e.g. found extra, gave to staff, counted wrong before'}>
          <Input id="a-reason" value={reason} onChange={(e) => setReason(e.target.value)} required={mode === 'change'} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !delta}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const WastageForm = ({ item, onSaved, onClose }) => {
  const toast = useToast();
  const idem = useIdempotencyKey();
  const [amount, setAmount] = useState('');
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
        body: { product_id: item.product_id, quantity: Number(amount), reason_code: reason, notes: notes || undefined }
      });
      idem.settle();
      toast.success(`Wastage logged: about ${formatCurrency(result.estimated_cost)} of ${item.name}`);
      onSaved();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Log wastage: ${item.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="w-qty" label={`How much was thrown away? (${item.unit})`}>
          <Input id="w-qty" type="number" min="0.001" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        </Field>
        <fieldset>
          <legend className="text-small font-medium text-ink-700">Why</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(WASTAGE_REASONS).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={reason === v} onClick={() => setReason(v)}
                      className={`rounded-lg border px-3 py-1.5 text-small ${reason === v ? 'border-brand-500 bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-500' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>{label}</button>
            ))}
          </div>
        </fieldset>
        <Field id="w-notes" label="Note (optional)"><Input id="w-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {Number(amount) > 0 && item.unit_cost > 0 && <p className="tabular rounded-lg bg-surface-2 px-3 py-2 text-small text-ink-700">About <strong className="text-ink-900">{formatCurrency(Number(amount) * item.unit_cost)}</strong> of stock, at what you pay for it.</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Log wastage'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* Move stock to another outlet. The business total doesn't change; each outlet's history shows its side. */
const TransferForm = ({ item, outlets, fromId, onSaved, onClose }) => {
  const toast = useToast();
  const idem = useIdempotencyKey();
  const [from, setFrom] = useState(fromId ?? '');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/inventory/transfer', {
        method: 'POST', idempotencyKey: idem.get(),
        body: { product_id: item.product_id, from_branch_id: Number(from), to_branch_id: Number(to), quantity: Number(amount), notes: notes || undefined }
      });
      idem.settle();
      toast.success(`${qty(amount)} ${item.unit} of ${item.name} sent to ${outlets.find((o) => String(o.branch_id) === String(to))?.name}`);
      onSaved();
    } catch (caught) { idem.settle(caught); setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Transfer ${item.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid grid-cols-2 gap-3">
          <Field id="t-from" label="From">
            <Select id="t-from" value={from} onChange={(e) => setFrom(e.target.value)} required disabled={fromId != null}>
              <option value="" disabled>Choose…</option>
              {outlets.map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name}</option>)}
            </Select>
          </Field>
          <Field id="t-to" label="To">
            <Select id="t-to" value={to} onChange={(e) => setTo(e.target.value)} required>
              <option value="" disabled>Choose…</option>
              {outlets.filter((o) => String(o.branch_id) !== String(from)).map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="t-qty" label={`Quantity (${item.unit})`}><Input id="t-qty" type="number" min="0.001" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
          <Field id="t-notes" label="Note (optional)"><Input id="t-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Moving…' : 'Transfer'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* A new tracked product: POST /products with track_inventory on (no separate ingredients table). */
const AddItemForm = ({ isRestaurant, onSaved, onClose }) => {
  const [form, setForm] = useState({ name: '', kind: 'INGREDIENT', cost: '', unit: 'kg', opening: '', min: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const product = await api('/products', {
        method: 'POST',
        body: {
          name: form.name, unit: form.unit, ...(isRestaurant ? { kind: form.kind } : {}),
          purchase_price: Number(form.cost) || 0, track_inventory: true,
          opening_stock: Number(form.opening) || 0, min_stock: Number(form.min) || 0
        }
      });
      onSaved(product);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Add a stock item" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="i-name" label="Name"><Input id="i-name" value={form.name} onChange={set('name')} placeholder="e.g. Whole milk" required autoFocus /></Field>
        {isRestaurant && (
          <Field id="i-kind" label="What is it?" hint="Ingredients and packaging are used up by recipes and are not sold on their own.">
            <Select id="i-kind" value={form.kind} onChange={set('kind')}>
              <option value="INGREDIENT">An ingredient</option>
              <option value="PACKAGING">Packaging</option>
              <option value="DISH">Something I sell as it is</option>
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field id="i-unit" label="Counted in" hint="kg, litre, pc, box…"><Input id="i-unit" value={form.unit} onChange={set('unit')} required /></Field>
          <Field id="i-cost" label={`Cost per ${form.unit || 'unit'} (₹)`} hint="For stock value and wastage"><Input id="i-cost" type="number" min="0" step="0.01" value={form.cost} onChange={set('cost')} /></Field>
          <Field id="i-open" label="In stock now"><Input id="i-open" type="number" min="0" step="0.001" value={form.opening} onChange={set('opening')} placeholder="0" /></Field>
          <Field id="i-min" label="Warn me below" hint="Leave blank for no warning"><Input id="i-min" type="number" min="0" step="0.001" value={form.min} onChange={set('min')} /></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add item'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* ── Reports (wastage, transfers) ─────────────────────────────────────── */

const WastageReport = ({ data, onClose }) => {
  const reasons = Object.entries(data.by_reason).sort((a, b) => b[1] - a[1]);
  const top = reasons[0]?.[1] || 1;
  return (
    <Modal title="Wastage, last 30 days" onClose={onClose} wide>
      <p className="tabular -mt-2 text-small text-ink-500"><strong className="text-ink-900">{formatCurrency(data.total_cost)}</strong> of stock thrown away, valued at what you pay for it.</p>
      {data.lines.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-line-strong p-6 text-center text-small text-ink-500">Nothing logged in the last 30 days.</p> : (
        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <section aria-label="By reason">
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">By reason</h3>
            <ul className="space-y-2.5">
              {reasons.map(([r, cost]) => (
                <li key={r} className="text-small">
                  <span className="flex justify-between"><span className="text-ink-700">{WASTAGE_REASONS[r] || r}</span><span className="tabular font-medium text-ink-900">{formatCurrency(cost)}</span></span>
                  <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${(cost / top) * 100}%` }} /></span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Items">
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Items</h3>
            <ul className="divide-y divide-line text-small">
              {data.lines.slice(0, 10).map((l) => (
                <li key={`${l.reason_code}-${l.product_id}`} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0"><span className="block truncate text-ink-900">{l.name}</span><span className="tabular block text-caption text-ink-500">{qty(l.quantity)} {l.unit} · {WASTAGE_REASONS[l.reason_code] || l.reason_code}</span></span>
                  <span className="tabular shrink-0 font-medium text-ink-900">{formatCurrency(l.cost)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
};

const TransfersReport = ({ onClose }) => {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/inventory/transfers').then(setRows).catch(() => setRows([])); }, []);
  return (
    <Modal title="Recent transfers" onClose={onClose} wide>
      {!rows ? <div className="h-40 animate-pulse rounded-lg bg-surface-3" /> : rows.length === 0 ? <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-small text-ink-500">No transfers yet.</p> : (
        <ul className="divide-y divide-line text-small">
          {rows.slice(0, 30).map((t) => (
            <li key={t.transfer_id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0"><span className="block truncate font-medium text-ink-900">{t.product}</span><span className="block text-caption text-ink-500">{t.from_outlet} → {t.to_outlet} · {when(t.created_at)}</span></span>
              <span className="tabular shrink-0 font-medium text-ink-900">{qty(t.quantity)} {t.unit}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};

/* ── One item ─────────────────────────────────────────────────────────── */

/* How a ledger movement reads to someone running the place. */
const describe = (m, kind) => {
  const used = kind === 'INGREDIENT' || kind === 'PACKAGING';
  switch (m.transaction_type) {
    case 'SALE': return used ? 'Used in sales' : 'Sold';
    case 'PURCHASE': return 'Bought';
    case 'OPENING': return 'Opening stock';
    case 'RETURN': return m.reference_type === 'credit_note' ? 'Returned by customer' : 'Bill cancelled, put back';
    case 'PURCHASE_RETURN': return 'Returned to supplier';
    case 'WASTAGE': return `Wasted · ${WASTAGE_REASONS[m.reason_code] || 'other'}`;
    case 'TRANSFER': return m.quantity < 0 ? 'Sent to another outlet' : 'Received from another outlet';
    case 'ADJUSTMENT': return /^stock count/i.test(m.notes || '') ? 'Stock count' : 'Correction';
    default: return m.transaction_type;
  }
};

const ReorderLevel = ({ item, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(item.min_stock || ''));
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault(); setError('');
    try { await api(`/products/${item.product_id}`, { method: 'PATCH', body: { min_stock: Number(value) || 0 } }); setEditing(false); onSaved(); }
    catch (caught) { setError(caught.message); }
  };
  if (!editing) {
    return (
      <p className="text-small text-ink-500">
        {item.min_stock > 0 ? <>Warns below <span className="tabular font-medium text-ink-700">{qty(item.min_stock)} {item.unit}</span></> : 'No low-stock warning set'}
        {' · '}<button type="button" onClick={() => setEditing(true)} className="font-medium text-brand-700 hover:underline">Change</button>
      </p>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      <label htmlFor="min-edit" className="text-small text-ink-500">Warn below</label>
      <Input id="min-edit" type="number" min="0" step="0.001" value={value} onChange={(e) => setValue(e.target.value)} className="!h-8 !w-24 !py-1" autoFocus />
      <span className="text-small text-ink-500">{item.unit}</span>
      <Button size="sm" type="submit">Save</Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>Cancel</Button>
      {error && <p className="w-full text-caption text-danger">{error}</p>}
    </form>
  );
};

const ItemPanel = ({ item, refreshKey, canWrite, multiOutlet, allView, onAction, onChanged, onBack }) => {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setRows(null); setError('');
    api(`/inventory/${item.product_id}/history`).then(setRows).catch((e) => setError(e.message));
  }, [item.product_id, refreshKey]);

  // stock after each movement, worked back from today's number (the ledger is newest first)
  const balances = useMemo(() => {
    let after = item.current_stock;
    return (rows || []).map((m) => { const b = after; after = Math.round((after - m.quantity) * 1000) / 1000; return b; });
  }, [rows, item.current_stock]);
  const s = stateOf(item);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-4 sm:p-6">
        <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-900 xl:hidden"><ArrowLeft className="h-4 w-4" />All items</button>
        <p className="text-caption font-medium text-ink-500">{KINDS[item.kind] ? KINDS[item.kind].replace(/s$/, '') : 'Stock item'}</p>
        <h2 className="mt-0.5 text-title font-semibold text-ink-900">{item.name}</h2>
        <div className="mt-3 flex items-end justify-between gap-4">
          <p>
            <span className={`tabular text-[32px] font-semibold leading-none tracking-tight ${s === 'out' ? 'text-danger' : s === 'low' ? 'text-warning' : 'text-ink-900'}`}>{qty(item.current_stock)}</span>
            <span className="ml-1.5 text-body text-ink-500">{item.unit}</span>
          </p>
          <p className="tabular text-right text-small text-ink-500"><span className="block font-semibold text-ink-900">{formatCurrency(item.stock_value)}</span>{item.unit_cost > 0 ? `at ${formatCurrency(item.unit_cost)} a ${item.unit}` : 'no cost set'}</p>
        </div>
        <Meter item={item} />
        <div className="mt-2.5"><ReorderLevel item={item} onSaved={onChanged} /></div>
        {s !== 'ok' && <p className={`mt-3 rounded-lg px-3 py-2 text-small font-medium ${s === 'out' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>{s === 'out' ? 'Out of stock.' : 'Running low.'} <Link to="/app/purchases" className="underline">Record a purchase</Link> or see the <Link to="/app/forecast" className="underline">stock forecast</Link>.</p>}
        {canWrite ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onAction('adjust')}><ClipboardCheck aria-hidden="true" className="h-4 w-4" />Count or correct</Button>
            <Button size="sm" variant="secondary" onClick={() => onAction('waste')}><Trash2 aria-hidden="true" className="h-4 w-4" />Log wastage</Button>
            {multiOutlet && <Button size="sm" variant="secondary" onClick={() => onAction('transfer')}><ArrowRightLeft aria-hidden="true" className="h-4 w-4" />Transfer</Button>}
          </div>
        ) : allView && <p className="mt-4 text-caption text-ink-500">This is the total across every outlet. Pick an outlet at the top to count or change its stock.</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">History {rows && <span className="tabular font-normal">· {rows.length === 200 ? 'last 200' : rows.length}</span>}</h3>
        <Alert>{error}</Alert>
        {!rows && !error && <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" />}
        {rows?.length === 0 && <p className="rounded-(--radius-card) border border-dashed border-line-strong p-6 text-center text-small text-ink-500">Nothing has moved yet. Sales, purchases, counts and wastage will show here.</p>}
        {rows?.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
            {rows.map((m, i) => {
              const inflow = m.quantity > 0;
              const Icon = inflow ? ArrowDownLeft : ArrowUpRight;
              const ref = m.invoice_number || m.po_number || (m.reference_type === 'credit_note' && m.notes) || null;
              const note = m.transaction_type === 'ADJUSTMENT' ? String(m.notes || '').replace(/^stock count:?\s*/i, '') || null : m.transaction_type === 'WASTAGE' || m.transaction_type === 'TRANSFER' ? m.notes : null;
              return (
                <li key={m.txn_id} className="flex items-start gap-3 px-4 py-3">
                  <span aria-hidden="true" className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${inflow ? 'bg-success/10 text-success' : m.transaction_type === 'WASTAGE' ? 'bg-danger/10 text-danger' : 'bg-surface-2 text-ink-500'}`}><Icon className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-small font-medium text-ink-900">{describe(m, item.kind)}</span>
                    <span className="block text-caption text-ink-500">
                      {[when(m.created_at), allView && m.outlet].filter(Boolean).join(' · ')}
                      {ref && <> · {m.invoice_number ? <Link to={`/app/billing/invoices/${m.reference_id}`} className="font-medium text-brand-700 hover:underline">{ref}</Link> : ref}</>}
                    </span>
                    {note && <span className="mt-0.5 block text-caption text-ink-700">“{note}”</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`tabular block text-small font-semibold ${inflow ? 'text-success' : 'text-ink-900'}`}>{inflow ? '+' : '−'}{qty(Math.abs(m.quantity))}</span>
                    <span className="tabular block text-caption text-ink-400">{qty(balances[i])} left</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

/* ── The screen ───────────────────────────────────────────────────────── */

const Tile = ({ label, value, note, tone, onClick, pressed }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} aria-pressed={onClick && pressed != null ? pressed : undefined}
         className={`rounded-(--radius-card) border bg-surface p-4 text-left ${pressed ? 'border-brand-500 ring-1 ring-brand-500' : 'border-line'} ${onClick ? 'transition-colors duration-(--duration-fast) hover:border-ink-400' : ''}`}>
      <p className="text-caption text-ink-500">{label}</p>
      <p className={`tabular mt-1 text-title font-semibold ${tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-ink-900'}`}>{value}</p>
      {note && <p className="mt-0.5 text-caption text-ink-500">{note}</p>}
    </Tag>
  );
};

const ItemRow = ({ item, active, onOpen }) => (
  <li>
    <button type="button" onClick={onOpen} aria-current={active ? 'true' : undefined}
            className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 text-left transition-colors duration-(--duration-fast) ${active ? 'bg-brand-50' : 'hover:bg-surface-2'}`}>
      <span className="min-w-0">
        <span className="flex items-center gap-2"><span className="truncate text-small font-semibold text-ink-900">{item.name}</span><StateLabel item={item} /></span>
        <span className="block max-w-[14rem]"><Meter item={item} /></span>
      </span>
      <span className="text-right">
        <span className={`tabular block text-small font-semibold ${stateOf(item) === 'out' ? 'text-danger' : stateOf(item) === 'low' ? 'text-warning' : 'text-ink-900'}`}>{qty(item.current_stock)} {item.unit}</span>
        <span className="tabular block text-caption text-ink-500">{formatCurrency(item.stock_value)}</span>
      </span>
    </button>
  </li>
);

const InventoryPage = () => {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('item') ? Number(params.get('item')) : null;
  const { business, outlets, outletId, activeOutlet, pinned } = useAuth();
  const isRestaurant = RESTAURANT_TYPES.includes(business?.business_type);
  const multiOutlet = outlets.length > 1;
  const allView = outletId === 'all';

  const [items, setItems] = useState(null);
  const [valuation, setValuation] = useState(null);
  const [wastage, setWastage] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');   // all | low | out
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('urgent');
  const [action, setAction] = useState(null);    // adjust | waste | transfer | add | wastage-report | transfers
  const [historyKey, setHistoryKey] = useState(0);

  const load = async () => {
    try {
      const [levels, val] = await Promise.all([api('/inventory'), api('/inventory/valuation')]);
      setItems(levels); setValuation(val); setError('');
    } catch (caught) { setError(caught.message); }
    api(`/inventory/wastage?from=${daysAgoISO(30)}`).then(setWastage).catch(() => setWastage(null));
  };
  useEffect(() => { setItems(null); load(); }, [outletId]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { setAction(null); setHistoryKey((k) => k + 1); load(); };

  const open = (id) => setParams(id ? { item: String(id) } : {});
  const all = items || [];
  const kinds = [...new Set(all.map((i) => i.kind).filter(Boolean))];
  const lowCount = all.filter((i) => stateOf(i) === 'low').length;
  const outCount = all.filter((i) => stateOf(i) === 'out').length;
  const q = search.trim().toLowerCase();
  const shown = useMemo(() => all
    .filter((i) => (filter === 'all' || stateOf(i) === filter) && (kind === 'all' || i.kind === kind) && (!q || i.name.toLowerCase().includes(q)))
    .sort(SORTS[sort][1]), [items, filter, kind, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = all.find((i) => i.product_id === selectedId);
  const where = activeOutlet?.name;

  return (
    <div className="-m-4 grid grid-cols-1 sm:-m-6 lg:-m-8 xl:h-[calc(100vh-3.5rem)] xl:grid-cols-[minmax(0,1fr)_460px]">
      <section aria-label="Stock list" className={`min-w-0 p-4 sm:p-6 lg:p-8 xl:block xl:overflow-y-auto ${selectedId ? 'hidden' : 'block'}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-h3 font-semibold text-ink-900">Inventory</h1>
            <p className="mt-1 text-small text-ink-500">{multiOutlet ? (allView ? 'Stock across every outlet.' : `Stock at ${where}.`) : "What's on the shelf, and what's running low."}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {multiOutlet && <Button variant="secondary" onClick={() => setAction('transfers')}>Transfers</Button>}
            <Button onClick={() => setAction('add')}><PackagePlus aria-hidden="true" className="h-4 w-4" />Add stock item</Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Tile label="Stock value" value={valuation ? formatCurrency(valuation.total_value) : '—'} note="at what you paid" />
          <Tile label="Running low" value={items ? lowCount : '—'} tone={lowCount ? 'warning' : undefined} note="below their warning level" onClick={() => setFilter(filter === 'low' ? 'all' : 'low')} pressed={filter === 'low'} />
          <Tile label="Out of stock" value={items ? outCount : '—'} tone={outCount ? 'danger' : undefined} note="nothing left" onClick={() => setFilter(filter === 'out' ? 'all' : 'out')} pressed={filter === 'out'} />
          <Tile label="Wasted, 30 days" value={wastage ? formatCurrency(wastage.total_cost) : '—'} note="see what and why" onClick={wastage ? () => setAction('wastage-report') : undefined} />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <label className="relative min-w-[14rem] flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <span className="sr-only">Search stock</span>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items" className="!pl-9" />
          </label>
          <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} className="!w-auto">
            {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </Select>
        </div>
        {kinds.length > 1 && (
          <div role="group" aria-label="Type" className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {[['all', 'All types'], ...kinds.map((k) => [k, KINDS[k] || k])].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                      className={`shrink-0 rounded-lg border px-3 py-1.5 text-small font-medium ${kind === k ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>
                {label} <span className={`tabular ml-1 ${kind === k ? 'text-white/70' : 'text-ink-400'}`}>{k === 'all' ? all.length : all.filter((i) => i.kind === k).length}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-4">
          <Alert>{error}</Alert>
          {filter !== 'all' && <p className="mb-2 text-small text-ink-500">Showing {filter === 'low' ? 'items running low' : 'items that are out'} · <button type="button" onClick={() => setFilter('all')} className="font-medium text-brand-700">Show all</button></p>}
          {!items && !error && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-3" />)}</div>}
          {items?.length === 0 && (
            <div className="rounded-(--radius-card) border border-dashed border-line-strong p-10 text-center">
              <p className="text-body font-medium text-ink-900">No stock tracked yet</p>
              <p className="mt-1 text-small text-ink-500">Add the items you want to count. Turn on stock tracking for a product on the Products page, or add an ingredient here.</p>
              <Button className="mt-4" onClick={() => setAction('add')}>Add a stock item</Button>
            </div>
          )}
          {items?.length > 0 && shown.length === 0 && <p className="rounded-(--radius-card) border border-dashed border-line-strong p-8 text-center text-small text-ink-500">{filter === 'out' ? 'Nothing is out of stock.' : filter === 'low' ? 'Nothing is running low.' : 'No items match.'}</p>}
          {shown.length > 0 && (
            <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
              {shown.map((i) => <ItemRow key={i.product_id} item={i} active={i.product_id === selectedId} onOpen={() => open(i.product_id)} />)}
            </ul>
          )}
        </div>
      </section>

      <section aria-label="Selected item" className={`min-h-0 min-w-0 flex-col border-line bg-surface xl:flex xl:border-l ${selectedId ? 'flex min-h-[calc(100vh-3.5rem)] xl:min-h-0' : 'hidden'}`}>
        {selected ? (
          <ItemPanel key={selected.product_id} item={selected} refreshKey={historyKey} canWrite={!allView} multiOutlet={multiOutlet} allView={allView}
                     onAction={setAction} onChanged={load} onBack={() => open(null)} />
        ) : selectedId && items ? (
          <div className="p-8 text-center text-small text-ink-500">That item isn't tracked here. <button type="button" onClick={() => open(null)} className="font-medium text-brand-700">Back to all</button></div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <p className="text-small font-medium text-ink-700">Pick an item to count it, log wastage, or see every movement behind its number</p>
          </div>
        )}
      </section>

      {action === 'adjust' && selected && <AdjustForm item={selected} outletName={multiOutlet ? activeOutlet?.name : null} onClose={() => setAction(null)} onSaved={changed} />}
      {action === 'waste' && selected && <WastageForm item={selected} onClose={() => setAction(null)} onSaved={changed} />}
      {action === 'transfer' && selected && <TransferForm item={selected} outlets={outlets} fromId={pinned || !allView ? outletId : null} onClose={() => setAction(null)} onSaved={changed} />}
      {action === 'add' && <AddItemForm isRestaurant={isRestaurant} onClose={() => setAction(null)} onSaved={(p) => { changed(); toast.success(`${p.name} added`); open(p.product_id); }} />}
      {action === 'wastage-report' && wastage && <WastageReport data={wastage} onClose={() => setAction(null)} />}
      {action === 'transfers' && <TransfersReport onClose={() => setAction(null)} />}
    </div>
  );
};

export default InventoryPage;
