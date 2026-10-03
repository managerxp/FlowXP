/*
 * Pieces the wholesale screens share, so they look and behave alike: status pills, small charts drawn with plain
 * elements (no chart library for a few pictures), pickers that search the server as you type (customer, supplier,
 * product — scan a barcode into the product picker and it jumps straight to the match), a warehouse chooser, a date
 * range, and the CSV import dialog. Everything else comes from components/ui.jsx and the salon parts (Tabs, Panel...).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Plus, Search, Upload, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { CSV_TEMPLATES, addDays, downloadTemplate, money, todayIn, useDebounced, useWarehouses } from '../../lib/wholesale.js';
import { readTable } from '../../lib/spreadsheet.js';
import { Alert, Badge, Button, Field, Input, Modal, Select, useToast } from '../../components/ui.jsx';

export { Chips, Money, NumberField, Pager, Panel, Pill, Segmented, SelectField, Tabs, Toggle, Toolbar, useAction } from '../salon/parts.jsx';

/* ── status ───────────────────────────────────────────────────────────────── */

export const StatusPill = ({ map, status }) => {
  const s = map[status] || { label: String(status || '').replace(/_/g, ' ').toLowerCase(), tone: 'neutral' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
};

/* ── charts ───────────────────────────────────────────────────────────────── */

/* Vertical bars, one per item; `format` shapes the tooltip. */
export const Bars = ({ data, valueKey = 'value', labelKey = 'label', format = money, height = 'h-36', tone = 'bg-brand-500', label = 'Chart', every = 1 }) => {
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0));
  return (
    <figure>
      <div className={`flex ${height} items-end gap-1`} role="img" aria-label={label}>
        {data.map((d, i) => {
          const v = Number(d[valueKey]) || 0;
          return (
            <div key={`${d[labelKey]}-${i}`} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d[labelKey]}: ${format(v)}`}>
              <div className={`${tone} rounded-t ${v === 0 ? 'opacity-30' : ''}`} style={{ height: `${Math.max(v === 0 ? 1 : 3, (v / max) * 100)}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-ink-400">
        {data.map((d, i) => <span key={`${d[labelKey]}-${i}`} className="min-w-0 flex-1 truncate text-center">{i % every === 0 ? String(d[labelKey]).slice(-2) : ''}</span>)}
      </div>
    </figure>
  );
};

/* A ranked list with a proportional bar behind each row (top customers, top products, ageing buckets). */
export const RankBars = ({ rows, valueKey = 'value', labelKey = 'label', sub, format = money, tone = 'bg-brand-100', empty = 'Nothing yet.', onClick }) => {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  if (!rows.length) return <p className="py-4 text-center text-small text-ink-400">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={`${r[labelKey]}-${i}`}>
          <button type="button" disabled={!onClick} onClick={() => onClick?.(r)} className="relative block w-full overflow-hidden rounded-lg text-left enabled:hover:bg-surface-2">
            <span aria-hidden="true" className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${((Number(r[valueKey]) || 0) / max) * 100}%` }} />
            <span className="relative flex items-center justify-between gap-3 px-2.5 py-1.5 text-small">
              <span className="min-w-0 truncate font-medium text-ink-900">{r[labelKey]}{sub && <span className="ml-2 text-caption font-normal text-ink-500">{sub(r)}</span>}</span>
              <span className="tabular shrink-0 font-semibold text-ink-900">{format(Number(r[valueKey]) || 0)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
};

/* A single proportional strip: how a total splits (ageing). */
export const StackStrip = ({ parts, format = money }) => {
  const total = parts.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={parts.map((p) => `${p.label} ${format(p.value)}`).join(', ')}>
        {total > 0 && parts.map((p) => Number(p.value) > 0 && <div key={p.label} className={p.tone} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label}: ${format(p.value)}`} />)}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-caption sm:grid-cols-5">
        {parts.map((p) => <li key={p.label}><span className="flex items-center gap-1.5 text-ink-500"><span className={`h-2.5 w-2.5 rounded-sm ${p.tone}`} />{p.label}</span><span className="tabular text-small font-semibold text-ink-900">{format(p.value)}</span></li>)}
      </ul>
    </div>
  );
};

/* ── pickers ──────────────────────────────────────────────────────────────── */

/*
 * Generic "search the server as you type" box. `search(term)` resolves to rows; `render(row)` draws one; `onPick(row)`
 * receives the choice. With `onEnter(term, rows)` the Enter key can short-circuit (a scanned barcode).
 */
export const SearchPicker = ({ id, placeholder, search, render, onPick, onEnter, footer, minChars = 2, autoFocus, inputRef, clearOnPick = true, disabled }) => {
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

  const pick = (row) => { onPick(row); if (clearOnPick) setQ(''); setOpen(false); };
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
          {rows.map((r, i) => <button key={r.customer_id ?? r.supplier_id ?? r.product_id ?? i} type="button" onClick={() => pick(r)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-2">{render(r)}</button>)}
          {footer}
        </div>
      )}
    </div>
  );
};

/** Shows the chosen party with a change button; `value` is { id, name, ... } or null. */
const Chosen = ({ title, sub, onClear }) => (
  <div className="flex items-center gap-3 rounded-(--radius-control) border border-line bg-surface-2 px-3 py-2">
    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-caption font-semibold text-brand-700">{String(title).slice(0, 1).toUpperCase()}</span>
    <span className="min-w-0 flex-1"><span className="block truncate text-small font-semibold text-ink-900">{title}</span>{sub && <span className="block truncate text-caption text-ink-500">{sub}</span>}</span>
    {onClear && <button type="button" onClick={onClear} aria-label="Change" className="rounded-lg p-1.5 text-ink-400 hover:bg-surface hover:text-ink-900"><X className="h-4 w-4" /></button>}
  </div>
);

export const CustomerPicker = ({ value, onChange, placeholder = 'Find a customer by name, phone or GSTIN', disabled, id = 'customer-picker', onAdd }) => {
  if (value) {
    return <Chosen title={value.name} sub={[value.customer_type, value.phone, value.gstin].filter(Boolean).join(' · ')} onClear={disabled ? null : () => onChange(null)} />;
  }
  return (
    <SearchPicker id={id} placeholder={placeholder} minChars={1} disabled={disabled}
                  search={(t) => api(`/wholesale/customers?q=${encodeURIComponent(t)}&limit=8`)}
                  onPick={onChange}
                  render={(c) => <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium text-ink-900">{c.name}</span><span className="block truncate text-caption text-ink-500">{[c.customer_type, c.phone, c.gstin].filter(Boolean).join(' · ')}</span></span>}
                  footer={onAdd && <button type="button" onClick={onAdd} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-small font-medium text-brand-700 hover:bg-brand-50"><Plus className="h-4 w-4" />Add a new customer</button>} />
  );
};

export const SupplierPicker = ({ value, onChange, placeholder = 'Find a supplier', disabled, id = 'supplier-picker' }) => {
  if (value) return <Chosen title={value.name} sub={[value.phone, value.gstin].filter(Boolean).join(' · ')} onClear={disabled ? null : () => onChange(null)} />;
  return (
    <SearchPicker id={id} placeholder={placeholder} minChars={1} disabled={disabled}
                  search={(t) => api(`/wholesale/suppliers?q=${encodeURIComponent(t)}&limit=8`)} onPick={onChange}
                  render={(s) => <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium text-ink-900">{s.name}</span><span className="block truncate text-caption text-ink-500">{[s.phone, s.gstin].filter(Boolean).join(' · ')}</span></span>} />
  );
};

/** Pick a product by name, SKU or barcode (a scanner "types" the code and presses Enter). onPick gets the product, plus matched_unit when a carton barcode was scanned. */
export const ProductPicker = ({ onPick, placeholder = 'Scan a barcode or search products', inputRef, autoFocus, disabled }) => (
  <SearchPicker id="product-picker" placeholder={placeholder} minChars={1} inputRef={inputRef} autoFocus={autoFocus} disabled={disabled}
                search={(t) => api(`/wholesale/products/lookup?q=${encodeURIComponent(t)}`)} onPick={onPick}
                onEnter={async (typed, rows) => { const exact = rows.find((r) => r.barcode === typed || r.sku === typed || r.matched_unit); if (exact) { onPick(exact); return true; } return false; }}
                render={(p) => (
                  <>
                    <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium text-ink-900">{p.name}</span><span className="block truncate text-caption text-ink-500">{[p.sku, p.brand, p.category].filter(Boolean).join(' · ')}</span></span>
                    <span className="shrink-0 text-right"><span className="tabular block text-small text-ink-900">{money(p.wholesale_price ?? p.selling_price)}</span>{p.available != null && <span className={`block text-caption ${p.available <= 0 ? 'text-danger' : 'text-ink-500'}`}>{p.available} {p.unit}</span>}</span>
                  </>
                )} />
);

/** A warehouse chooser; with a single warehouse it renders nothing but still reports it. */
export const WarehouseSelect = ({ value, onChange, allowAll = false, label = 'Warehouse', id = 'warehouse', required, className = '' }) => {
  const rows = useWarehouses();
  useEffect(() => { if (rows?.length && !allowAll && !value) onChange(String(rows[0].branch_id)); }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows || (rows.length <= 1 && !allowAll)) return null;
  return (
    <Field id={id} label={label}>
      <Select id={id} value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)} className={className}>
        {allowAll && <option value="">All warehouses</option>}
        {rows.map((w) => <option key={w.branch_id} value={w.branch_id}>{w.name}</option>)}
      </Select>
    </Field>
  );
};

/* ── dates ────────────────────────────────────────────────────────────────── */

const PRESETS = [
  ['today', 'Today', (t) => [t, t]], ['week', 'Last 7 days', (t) => [addDays(t, -6), t]], ['month', 'This month', (t) => [`${t.slice(0, 8)}01`, t]],
  ['30', 'Last 30 days', (t) => [addDays(t, -29), t]], ['quarter', 'Last 90 days', (t) => [addDays(t, -89), t]], ['year', 'This year', (t) => [`${t.slice(0, 4)}-01-01`, t]]
];

export const DateRange = ({ from, to, onChange }) => {
  const today = todayIn();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field id="dr-from" label="From"><Input id="dr-from" type="date" value={from} max={to} onChange={(e) => onChange(e.target.value, to)} /></Field>
      <Field id="dr-to" label="To"><Input id="dr-to" type="date" value={to} min={from} max={today} onChange={(e) => onChange(from, e.target.value)} /></Field>
      <div className="flex flex-wrap gap-1.5 pb-1">
        {PRESETS.map(([k, label, fn]) => <button key={k} type="button" onClick={() => onChange(...fn(today))} className="rounded-full border border-line bg-surface px-2.5 py-1 text-caption font-medium text-ink-700 hover:border-line-strong">{label}</button>)}
      </div>
    </div>
  );
};

/* ── CSV import ───────────────────────────────────────────────────────────── */

/*
 * Choose a CSV, see what the server makes of it (a dry run — nothing is saved), fix the file if rows have problems,
 * then import. `kind` is products | customers | suppliers.
 */
export const CsvImportModal = ({ kind, title, onClose, onDone, allowUpdate = true, endpoint, template, extra, modes, initialMode, children }) => {
  const toast = useToast();
  const tpl = template || CSV_TEMPLATES[kind];
  const url = endpoint || `/wholesale/import/${kind}`;
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState(initialMode || 'create');
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const known = useMemo(() => new Set([...tpl.columns, ...(tpl.accepts || [])].map((c) => c.toLowerCase().replace(/\s+/g, '_'))), [tpl]);
  const unknown = useMemo(() => (rows?.length ? Object.keys(rows[0]).filter((k) => !known.has(k.toLowerCase().replace(/[\s-]+/g, '_'))) : []), [rows, known]);

  const dryRun = async (r, m) => {
    setBusy(true); setError(''); setCheck(null);
    try { setCheck(await api(url, { method: 'POST', body: { ...extra, rows: r, mode: m } })); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const onFile = async (file) => {
    if (!file) return;
    setFileName(file.name); setRows(null); setCheck(null); setError('');
    try {
      const parsed = await readTable(file);
      if (!parsed.length) { setError('That file has no rows. The first line must be the column names.'); return; }
      setRows(parsed); await dryRun(parsed, mode);
    } catch { setError('Could not read that file. Use a CSV (comma separated) or an Excel .xlsx file, with the column names in the first row.'); }
  };

  const apply = async () => {
    setBusy(true); setError('');
    try {
      const out = await api(url, { method: 'POST', body: { ...extra, rows, mode, apply: true } });
      toast.success(out.changed != null ? `Stock updated for ${out.changed} product${out.changed === 1 ? '' : 's'}` : `Imported: ${out.created ?? 0} added${out.updated ? `, ${out.updated} updated` : ''}`);
      onDone?.(out);
    } catch (e) { setError(e.message); if (e.data?.errors) setCheck({ ...check, errors: e.data.errors, total_errors: e.data.total_errors }); }
    finally { setBusy(false); }
  };

  const bad = check?.total_errors > 0;
  return (
    <Modal title={title} onClose={onClose} wide footer={null}>
      <div className="space-y-4">
        <p className="text-small text-ink-500">Use a CSV or Excel (.xlsx) file whose first row is the column names. <button type="button" onClick={() => downloadTemplate(template || kind)} className="font-semibold text-brand-600 hover:underline"><Download aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />Download a template</button></p>
        {children}
        {modes && <Field id="imp-mode" label="What the file means"><Select id="imp-mode" value={mode} onChange={(e) => { setMode(e.target.value); if (rows) dryRun(rows, e.target.value); }}>{modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></Field>}
        <label className="flex cursor-pointer items-center gap-3 rounded-(--radius-card) border border-dashed border-line-strong bg-surface-2 px-4 py-5 hover:border-brand-500">
          <Upload aria-hidden="true" className="h-5 w-5 text-ink-400" />
          <span className="text-small text-ink-700">{fileName ? <><strong className="font-semibold text-ink-900">{fileName}</strong> · {rows?.length ?? 0} rows</> : 'Choose a CSV or Excel file'}</span>
          <input type="file" accept=".csv,text/csv,.xlsx" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {allowUpdate && (
          <label className="flex items-center gap-2 text-small text-ink-700">
            <input type="checkbox" checked={mode === 'upsert'} onChange={(e) => { const m = e.target.checked ? 'upsert' : 'create'; setMode(m); if (rows) dryRun(rows, m); }} className="h-4 w-4 accent-(--color-brand-500)" />
            Update items that already exist (matched by SKU)
          </label>
        )}
        <Alert>{error}</Alert>
        {unknown.length > 0 && <p className="rounded-lg bg-warning/10 px-3 py-2 text-caption text-warning">These columns are not recognised and will be ignored: {unknown.join(', ')}</p>}
        {check && (
          <div className={`rounded-(--radius-card) border px-4 py-3 text-small ${bad ? 'border-danger/30 bg-danger/5' : 'border-success/30 bg-success/5'}`}>
            {bad ? <p className="font-semibold text-danger">{check.total_errors} row{check.total_errors === 1 ? ' has' : 's have'} a problem. Fix them in the file and choose it again.</p>
              : <p className="flex items-center gap-2 font-semibold text-success"><Check aria-hidden="true" className="h-4 w-4" />Ready: {[check.to_create && `${check.to_create} to add`, check.to_update && `${check.to_update} to ${check.to_create === undefined ? 'change' : 'update'}`].filter(Boolean).join(', ') || 'nothing to change'}.</p>}
            {bad && (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-caption text-ink-700">
                {check.errors.map((e, i) => <li key={i}><strong className="font-semibold">Row {e.row}:</strong> {e.message}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={apply} loading={busy} disabled={!rows || !check || bad}>Import {rows ? `${rows.length} rows` : ''}</Button>
        </div>
      </div>
    </Modal>
  );
};
