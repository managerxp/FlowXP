/*
 * Pieces the pharmacy screens share: a product picker (scan a barcode or search), a batch picker (FEFO-first),
 * and supplier/customer pickers against the generic /suppliers and /customers endpoints — pharmacy has no
 * vertical-specific party records, unlike wholesale's. Everything else comes from components/ui.jsx and the
 * salon parts (Tabs, Panel, Toolbar, Chips...), re-exported below so pharmacy screens import from one place.
 */
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, qty, useDebounced } from '../../lib/pharmacy.js';
import { Field, Input, Select } from '../../components/ui.jsx';

export { Chips, Money, NumberField, Pager, Panel, Pill, Segmented, SelectField, Tabs, Toggle, Toolbar, useAction } from '../salon/parts.jsx';

/* Searches the server as you type; Enter picks an exact barcode/SKU match (a scanner "types" the code). */
const SearchPicker = ({ id, placeholder, search, render, onPick, onEnter, minChars = 1, autoFocus, inputRef, disabled }) => {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 180);
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    let live = true;
    if (term.length < minChars) { setRows([]); return undefined; }
    setBusy(true);
    Promise.resolve(search(term)).then((r) => { if (live) setRows(r || []); }).catch(() => { if (live) setRows([]); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (row) => { onPick(row); setQ(''); setOpen(false); };
  const onKey = async (e) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Enter') {
      e.preventDefault();
      const typed = q.trim();
      if (!typed) return;
      if (onEnter) { const handled = await onEnter(typed, rows); if (handled) { setQ(''); setOpen(false); return; } }
      if (rows[0]) pick(rows[0]);
    }
  };

  return (
    <div className="relative" ref={box}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <Input id={id} ref={inputRef} type="search" autoComplete="off" value={q} disabled={disabled} autoFocus={autoFocus} placeholder={placeholder} aria-label={placeholder} className="pl-9"
             onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} />
      {open && q.trim().length >= minChars && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-(--radius-card) border border-line bg-surface p-1 shadow-lg">
          {busy && rows.length === 0 && <p className="px-3 py-2 text-small text-ink-500">Searching…</p>}
          {!busy && rows.length === 0 && <p className="px-3 py-2 text-small text-ink-500">No match.</p>}
          {rows.map((r, i) => <button key={r.product_id ?? r.supplier_id ?? r.customer_id ?? i} type="button" onClick={() => pick(r)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-2">{render(r)}</button>)}
        </div>
      )}
    </div>
  );
};

/** Pick a product by name, SKU or barcode. onPick gets the full product (with product_type, batch_tracking, available...). */
export const ProductPicker = ({ onPick, placeholder = 'Scan a barcode or search products', inputRef, autoFocus, disabled }) => (
  <SearchPicker id="pharmacy-product-picker" placeholder={placeholder} inputRef={inputRef} autoFocus={autoFocus} disabled={disabled}
                search={(t) => api(`/pharmacy/products/lookup?q=${encodeURIComponent(t)}`)} onPick={onPick}
                onEnter={async (typed, rows) => { const exact = rows.find((r) => r.barcode === typed || r.sku === typed); if (exact) { onPick(exact); return true; } return false; }}
                render={(p) => (
                  <>
                    <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium text-ink-900">{p.name}</span><span className="block truncate text-caption text-ink-500">{[p.sku, p.manufacturer, p.strength].filter(Boolean).join(' · ')}</span></span>
                    <span className="shrink-0 text-right"><span className="tabular block text-small text-ink-900">{money(p.selling_price)}</span>{p.available != null && <span className={`block text-caption ${p.available <= 0 ? 'text-danger' : 'text-ink-500'}`}>{qty(p.available)} {p.unit}</span>}</span>
                  </>
                )} />
);

/** Shows the chosen party with a change button. */
const Chosen = ({ title, sub, onClear }) => (
  <div className="flex items-center gap-3 rounded-(--radius-control) border border-line bg-surface-2 px-3 py-2">
    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-caption font-semibold text-brand-700">{String(title).slice(0, 1).toUpperCase()}</span>
    <span className="min-w-0 flex-1"><span className="block truncate text-small font-semibold text-ink-900">{title}</span>{sub && <span className="block truncate text-caption text-ink-500">{sub}</span>}</span>
    {onClear && <button type="button" onClick={onClear} aria-label="Change" className="rounded-lg p-1.5 text-ink-400 hover:bg-surface hover:text-ink-900"><X className="h-4 w-4" /></button>}
  </div>
);

export const SupplierPicker = ({ value, onChange, placeholder = 'Find a supplier', disabled, id = 'pharmacy-supplier-picker' }) => {
  if (value) return <Chosen title={value.name} sub={[value.phone, value.gstin].filter(Boolean).join(' · ')} onClear={disabled ? null : () => onChange(null)} />;
  return (
    <SearchPicker id={id} placeholder={placeholder} disabled={disabled}
                  search={(t) => api(`/suppliers?search=${encodeURIComponent(t)}`)} onPick={onChange}
                  render={(s) => <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium text-ink-900">{s.name}</span><span className="block truncate text-caption text-ink-500">{[s.phone, s.gstin].filter(Boolean).join(' · ')}</span></span>} />
  );
};

export const CustomerPicker = ({ value, onChange, placeholder = 'Find a customer by name or phone', disabled, id = 'pharmacy-customer-picker' }) => {
  if (value) return <Chosen title={value.name} sub={value.phone} onClear={disabled ? null : () => onChange(null)} />;
  return (
    <SearchPicker id={id} placeholder={placeholder} disabled={disabled}
                  search={(t) => api(`/customers?search=${encodeURIComponent(t)}`)} onPick={onChange}
                  render={(c) => <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium text-ink-900">{c.name}</span><span className="block truncate text-caption text-ink-500">{c.phone}</span></span>} />
  );
};

/** Which batch of this product to sell from: FEFO order, earliest expiry first. Renders nothing for an untracked product. */
export const BatchSelect = ({ productId, value, onChange, branchless, id = 'batch-select' }) => {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true; setRows(null);
    api(`/pharmacy/inventory/batches?product_id=${productId}&state=active`).then((r) => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [productId]);
  if (!rows) return <Field id={id} label="Batch"><Select id={id} disabled><option>Loading…</option></Select></Field>;
  if (!rows.length) return <p className="text-small text-danger">No active batch in stock for this product{branchless ? '' : ' at this outlet'}.</p>;
  return (
    <Field id={id} label="Batch" hint="Soonest-expiring first">
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Earliest expiry (automatic)</option>
        {rows.map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_no} · {qty(b.qty_on_hand)} left{b.expiry_date ? ` · expires ${b.expiry_date}` : ''}</option>)}
      </Select>
    </Field>
  );
};
