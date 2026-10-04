/*
 * Stock center (supermarket / retail): what is on the shelf, what is about to expire, stock counts, and every movement.
 * The work that has a screen of its own is one click away: receiving a delivery (scan it in), counting a shelf (scan it),
 * and importing a spreadsheet. Single-item changes (adjust, wastage, transfer) stay in Inventory, linked from each row.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardCheck, FileSpreadsheet, PackagePlus, Search } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { IMPORTS, expiryText, expiryTone, qty, shortDate } from '../lib/retailStock.js';
import { CsvImportModal } from './wholesale/parts.jsx';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, SkeletonRows, StatCard, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../components/ui.jsx';

const STATUS = [['all', 'All products'], ['out', 'Out of stock'], ['low', 'Low stock'], ['expiring', 'Expiring soon'], ['expired', 'Has expired stock']];
const TYPES = { SALE: 'Sale', PURCHASE: 'Received', ADJUSTMENT: 'Adjustment', RETURN: 'Returned', OPENING: 'Opening stock', WASTAGE: 'Wastage', TRANSFER: 'Transfer', PURCHASE_RETURN: 'Sent back', COUNT: 'Stock count' };
const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const useDebounced = (value, ms = 250) => {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
};

/* ── Stock ──────────────────────────────────────────────────────────────────────────────── */

const StockTab = ({ status, setStatus, refreshKey }) => {
  const [search, setSearch] = useState('');
  const term = useDebounced(search);
  const [category, setCategory] = useState('');
  const [cats, setCats] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState({ loading: true, error: '' });
  const [more, setMore] = useState(0);
  useEffect(() => { api('/categories').then(setCats).catch(() => {}); }, []);

  const query = useMemo(() => {
    const p = new URLSearchParams({ status, limit: '50' });
    if (term.trim()) p.set('search', term.trim());
    if (category) p.set('category_id', category);
    return p.toString();
  }, [status, term, category]);

  useEffect(() => {
    let live = true;
    setState({ loading: true, error: '' });
    api(`/retail/stock?${query}&offset=${more * 50}`).then((d) => {
      if (!live) return;
      setRows((r) => (more === 0 ? d.rows : [...r, ...d.rows]));
      setTotal(d.meta.total); setState({ loading: false, error: '' });
    }).catch((e) => live && setState({ loading: false, error: e.message }));
    return () => { live = false; };
  }, [query, more, refreshKey]);
  useEffect(() => { setMore(0); }, [query, refreshKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input aria-label="Search stock" className="pl-10" placeholder="Name, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-44"><Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</Select></div>
        <div className="w-48"><Select aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>
      </div>
      <ListState loading={state.loading && !rows.length} error={state.error} empty={!state.loading && !rows.length} emptyLabel={term || category || status !== 'all' ? 'No products match.' : 'No products yet. Add products or import a spreadsheet.'} skeleton={<SkeletonRows rows={6} columns={6} />} />
      {rows.length > 0 && (
        <>
          <Table>
            <Thead>
              <Th>Product</Th><Th className="text-right">On hand</Th><Th className="text-right">Min</Th><Th className="text-right">Value at cost</Th><Th>Next expiry</Th><Th><span className="sr-only">Actions</span></Th>
            </Thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.product_id}>
                  <Td>
                    <Link to={`/app/products?p=${r.product_id}`} className="font-medium text-ink-900 hover:text-brand-600">{r.name}</Link>
                    <span className="block text-caption text-ink-500">{[r.sku, r.barcode, r.category].filter(Boolean).join(' · ')}</span>
                  </Td>
                  <Td className="text-right"><span className="tabular font-medium">{qty(r.qty)}</span> <span className="text-caption text-ink-500">{r.unit}</span>
                    {r.state !== 'ok' && <span className="ml-2 align-middle"><Badge tone={r.state === 'out' ? 'danger' : 'warning'}>{r.state === 'out' ? 'Out' : 'Low'}</Badge></span>}</Td>
                  <Td className="tabular text-right text-ink-500">{qty(r.min_stock)}</Td>
                  <Td className="tabular text-right">{formatCurrency(r.cost_value)}</Td>
                  <Td>{r.next_expiry ? <Badge tone={expiryTone(Math.round((new Date(`${r.next_expiry}T00:00`) - new Date().setHours(0, 0, 0, 0)) / 86400000))}>{shortDate(r.next_expiry)}</Badge> : <span className="text-ink-400">{r.track_expiry ? 'No batches' : '—'}</span>}
                    {r.expired_qty > 0 && <span className="mt-1 block text-caption text-danger">{qty(r.expired_qty)} expired</span>}</Td>
                  <Td className="text-right text-small"><Link to={`/app/inventory?item=${r.product_id}`} className="font-medium text-brand-600 hover:underline">Adjust</Link></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between text-small text-ink-500">
            <span>Showing {rows.length} of {total.toLocaleString('en-IN')}</span>
            {rows.length < total && <Button variant="secondary" size="sm" loading={state.loading} onClick={() => setMore((m) => m + 1)}>Show more</Button>}
          </div>
        </>
      )}
    </div>
  );
};

/* ── Expiry ─────────────────────────────────────────────────────────────────────────────── */

const WINDOWS = [['expired', 'Expired'], ['expiring:7', 'Next 7 days'], ['expiring:30', 'Next 30 days'], ['expiring:60', 'Next 60 days'], ['all', 'All batches']];

const ExpiryTab = ({ refreshKey, onChanged, canWrite }) => {
  const dialog = useDialog(); const toast = useToast();
  const [window_, setWindow] = useState('expired');
  const [search, setSearch] = useState('');
  const term = useDebounced(search);
  const [data, setData] = useState(null);
  const [state, setState] = useState({ loading: true, error: '' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const [st, days] = window_.split(':');
    const p = new URLSearchParams({ state: st, ...(days ? { days } : {}), ...(term.trim() ? { search: term.trim() } : {}) });
    setState({ loading: true, error: '' });
    api(`/retail/expiry?${p}`).then((d) => { if (live) { setData(d); setState({ loading: false, error: '' }); } }).catch((e) => live && setState({ loading: false, error: e.message }));
    return () => { live = false; };
  }, [window_, term, refreshKey, tick]);

  const writeOff = async (row) => {
    const ok = await dialog.confirm({ title: `Write off ${qty(row.qty_on_hand)} × ${row.name}?`, body: `Batch ${row.batch_no} (${row.days_left < 0 ? 'expired' : 'expires'} ${shortDate(row.expiry_date)}) leaves the shelf and is recorded as expired wastage, worth ${formatCurrency(row.value)} at cost. This can’t be undone.`, confirmLabel: 'Write off', cancelLabel: 'Keep it', danger: true });
    if (!ok) return;
    try { await api(`/retail/expiry/${row.batch_id}/write-off`, { method: 'POST', body: {}, idempotencyKey: crypto.randomUUID() }); toast.success(`${row.name} written off`); setTick((t) => t + 1); onChanged(); }
    catch (e) { toast.error(e.message); }
  };

  const s = data?.summary;
  return (
    <div className="space-y-4">
      {s && (s.expired > 0 || s.expiring > 0) && (
        <p className="text-small text-ink-700">
          {s.expired > 0 && <><strong className="font-semibold text-danger">{s.expired} expired batch{s.expired === 1 ? '' : 'es'}</strong> worth {formatCurrency(s.expired_value)} at cost still on the shelf. </>}
          {s.expiring > 0 && <>{s.expiring} more expire within 30 days.</>}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input aria-label="Search batches" className="pl-10" placeholder="Product or batch number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-48"><Select aria-label="Show" value={window_} onChange={(e) => setWindow(e.target.value)}>{WINDOWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>
      </div>
      <ListState loading={state.loading && !data} error={state.error} empty={!state.loading && data && !data.rows.length} emptyLabel={window_ === 'expired' ? 'Nothing has expired. Good.' : 'No batches in that window.'} emptyBody="Only products set to track expiry have batches. Turn it on in the product, and give the expiry date when receiving stock." skeleton={<SkeletonRows rows={5} columns={5} />} />
      {data?.rows.length > 0 && (
        <Table>
          <Thead><Th>Product</Th><Th>Batch</Th><Th>Expires</Th><Th className="text-right">Quantity</Th><Th className="text-right">Value at cost</Th><Th><span className="sr-only">Actions</span></Th></Thead>
          <tbody>
            {data.rows.map((r) => (
              <Tr key={r.batch_id}>
                <Td><Link to={`/app/products?p=${r.product_id}`} className="font-medium hover:text-brand-600">{r.name}</Link></Td>
                <Td className="tabular text-ink-500">{r.batch_no}</Td>
                <Td><Badge tone={expiryTone(r.days_left)}>{shortDate(r.expiry_date)}</Badge> <span className="ml-1 text-caption text-ink-500">{expiryText(r.days_left)}</span></Td>
                <Td className="tabular text-right">{qty(r.qty_on_hand)} <span className="text-caption text-ink-500">{r.unit}</span></Td>
                <Td className="tabular text-right">{formatCurrency(r.value)}</Td>
                <Td className="text-right">{canWrite && r.days_left < 0 && <Button size="sm" variant="secondary" onClick={() => writeOff(r)}>Write off</Button>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

/* ── Counts ─────────────────────────────────────────────────────────────────────────────── */

const COUNT_TONE = { OPEN: 'brand', APPLIED: 'success', CANCELLED: 'neutral' };
const COUNT_LABEL = { OPEN: 'In progress', APPLIED: 'Applied', CANCELLED: 'Cancelled' };

const CountsTab = ({ refreshKey }) => {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/retail/counts').then(setRows).catch((e) => setError(e.message)); }, [refreshKey]);
  return (
    <div className="space-y-3">
      <ListState loading={!rows && !error} error={error} empty={rows && !rows.length} emptyLabel="No stock counts yet." emptyBody="Start a count, scan the shelf, and FlowXP shows what differs from the system before anything changes." skeleton={<SkeletonRows rows={3} columns={4} />} />
      {rows?.length > 0 && (
        <Table>
          <Thead><Th>Count</Th><Th>Started</Th><Th className="text-right">Items counted</Th><Th>Result</Th></Thead>
          <tbody>
            {rows.map((c) => (
              <Tr key={c.count_id}>
                <Td><Link to={`/app/stock/counts/${c.count_id}`} className="font-medium hover:text-brand-600">{c.name}</Link><span className="block text-caption text-ink-500">{c.category ? `Category: ${c.category}` : 'Whole store'}{c.outlet ? ` · ${c.outlet}` : ''}</span></Td>
                <Td className="text-ink-500">{when(c.created_at)}</Td>
                <Td className="tabular text-right">{c.lines}</Td>
                <Td><Badge tone={COUNT_TONE[c.status]}>{COUNT_LABEL[c.status]}</Badge>
                  {c.status === 'APPLIED' && <span className="ml-2 text-caption text-ink-500">{c.lines_adjusted} adjusted · {c.net_units > 0 ? '+' : ''}{qty(c.net_units)} units · {formatCurrency(c.net_value)}</span>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

const StartCount = ({ onClose }) => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api('/categories').then(setCats).catch(() => {}); }, []);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const c = await api('/retail/counts', { method: 'POST', body: { name, category_id: category || undefined } }); navigate(`/app/stock/counts/${c.count_id}`); }
    catch (caught) { setError(caught.message); setBusy(false); }
  };
  return (
    <Modal title="Start a stock count" onClose={onClose}>
      <form onSubmit={go} className="space-y-4">
        <Field id="count-name" label="Name" hint="So you can tell counts apart later, like “Aisle 3” or “Month end”."><Input id="count-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={80} /></Field>
        <Field id="count-cat" label="What are you counting?"><Select id="count-cat" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">The whole store</option>{cats.map((c) => <option key={c.category_id} value={c.category_id}>Only {c.name}</option>)}</Select></Field>
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Start counting</Button></div>
      </form>
    </Modal>
  );
};

/* ── Movements ──────────────────────────────────────────────────────────────────────────── */

const MovementsTab = ({ refreshKey }) => {
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [more, setMore] = useState(0);
  const query = useMemo(() => new URLSearchParams({ ...(type ? { type } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), limit: '100' }).toString(), [type, from, to]);
  useEffect(() => { setMore(0); }, [query, refreshKey]);
  useEffect(() => {
    let live = true; setError('');
    api(`/retail/stock/movements?${query}&offset=${more * 100}`).then((d) => live && setRows((r) => (more === 0 || !r ? d : [...r, ...d]))).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [query, more, refreshKey]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44"><Field id="mv-type" label="Type"><Select id="mv-type" value={type} onChange={(e) => setType(e.target.value)}><option value="">All movements</option>{Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field></div>
        <div className="w-40"><Field id="mv-from" label="From"><Input id="mv-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field></div>
        <div className="w-40"><Field id="mv-to" label="To"><Input id="mv-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      </div>
      <ListState loading={!rows && !error} error={error} empty={rows && !rows.length} emptyLabel="No movements match." skeleton={<SkeletonRows rows={6} columns={5} />} />
      {rows?.length > 0 && (
        <>
          <Table>
            <Thead><Th>When</Th><Th>Product</Th><Th>What</Th><Th className="text-right">Quantity</Th><Th>By</Th></Thead>
            <tbody>
              {rows.map((m) => (
                <Tr key={m.txn_id}>
                  <Td className="whitespace-nowrap text-ink-500">{when(m.created_at)}</Td>
                  <Td><span className="font-medium">{m.name}</span>{m.notes && <span className="block text-caption text-ink-500">{m.notes}</span>}</Td>
                  <Td><Badge tone={m.quantity < 0 ? 'neutral' : 'brand'}>{TYPES[m.transaction_type] || m.transaction_type}</Badge>{m.reason_code && <span className="ml-1.5 text-caption text-ink-500">{m.reason_code.toLowerCase()}</span>}</Td>
                  <Td className={`tabular text-right font-medium ${m.quantity < 0 ? 'text-ink-900' : 'text-success'}`}>{m.quantity > 0 ? '+' : ''}{qty(m.quantity)} <span className="text-caption font-normal text-ink-500">{m.unit}</span></Td>
                  <Td className="text-ink-500">{m.by || '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {rows.length >= (more + 1) * 100 && <div className="text-center"><Button variant="secondary" size="sm" onClick={() => setMore((m) => m + 1)}>Show older</Button></div>}
        </>
      )}
    </div>
  );
};

/* ── Page ───────────────────────────────────────────────────────────────────────────────── */

const TABS = [['stock', 'Stock'], ['expiry', 'Expiry'], ['counts', 'Counts'], ['movements', 'Movements']];

const RetailStockPage = () => {
  const { can, outletId } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'stock';
  const [status, setStatus] = useState('all');
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState(null);
  const canWrite = can('inventory');
  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => { api('/retail/stock?limit=1').then((d) => setSummary(d.summary)).catch((e) => setError(e.message)); }, [refreshKey, outletId]);

  const show = (t, s) => { setParams(t === 'stock' ? {} : { tab: t }); if (s) setStatus(s); };

  return (
    <div>
      <PageHeader
        title="Stock center"
        lead="Everything on the shelf in one place: what is low, what is about to expire, and what the last count found."
        action={canWrite && (
          <>
            <Button to="/app/stock/receive"><PackagePlus aria-hidden="true" className="h-4 w-4" />Receive stock</Button>
            <Button variant="secondary" onClick={() => setDialog('count')}><ClipboardCheck aria-hidden="true" className="h-4 w-4" />Count stock</Button>
            <Button variant="secondary" onClick={() => setDialog('import')}><FileSpreadsheet aria-hidden="true" className="h-4 w-4" />Import</Button>
          </>
        )}
      />
      <Alert>{error}</Alert>
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          <StatCard label="Products" value={summary.products.toLocaleString('en-IN')} />
          <StatCard label="Units on hand" value={qty(summary.units)} />
          <StatCard label="Stock value" value={formatCurrency(summary.cost_value)} note={`At cost. ${formatCurrency(summary.retail_value)} at MRP.`} />
          <StatCard label="Out of stock" value={summary.out} tone={summary.out ? 'danger' : undefined} onClick={() => show('stock', 'out')} pressed={tab === 'stock' && status === 'out'} />
          <StatCard label="Low stock" value={summary.low} tone={summary.low ? 'warning' : undefined} onClick={() => show('stock', 'low')} pressed={tab === 'stock' && status === 'low'} />
          <StatCard label="Expiring in 30 days" value={summary.expiring} tone={summary.expiring ? 'warning' : undefined} onClick={() => show('expiry')} />
          <StatCard label="Expired" value={summary.expired} tone={summary.expired ? 'danger' : undefined} onClick={() => show('expiry')} />
        </div>
      )}

      <div role="tablist" aria-label="Stock views" className="mb-5 flex gap-1 border-b border-line">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => show(key)}
                  className={`-mb-px min-h-11 border-b-2 px-4 text-small font-medium transition-colors ${tab === key ? 'border-brand-500 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>{label}</button>
        ))}
      </div>

      {tab === 'stock' && <StockTab status={status} setStatus={setStatus} refreshKey={refreshKey} />}
      {tab === 'expiry' && <ExpiryTab refreshKey={refreshKey} onChanged={refresh} canWrite={canWrite} />}
      {tab === 'counts' && <CountsTab refreshKey={refreshKey} />}
      {tab === 'movements' && <MovementsTab refreshKey={refreshKey} />}

      {dialog === 'count' && <StartCount onClose={() => setDialog(null)} />}
      {dialog === 'import' && (
        <Modal title="Import from a spreadsheet" onClose={() => setDialog(null)}>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(IMPORTS).map(([key, imp]) => (
              <button key={key} type="button" onClick={() => setDialog(key)} className="rounded-(--radius-card) border border-line p-4 text-left transition-colors hover:border-brand-500 hover:bg-surface-2">
                <span className="block font-semibold text-ink-900">{key === 'products' ? 'Products' : 'Stock levels'}</span>
                <span className="mt-1 block text-small text-ink-500">{key === 'products' ? 'Add or update products, with prices, barcodes, categories and opening stock.' : 'Set what is on the shelf now, or add a delivery, by barcode or SKU.'}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {(dialog === 'products' || dialog === 'stock') && (
        <CsvImportModal
          kind={dialog} title={IMPORTS[dialog].title} endpoint={IMPORTS[dialog].endpoint} allowUpdate={false} modes={IMPORTS[dialog].modes} initialMode={IMPORTS[dialog].modes[0].value}
          template={IMPORTS[dialog]} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }}
        >
          <p className="text-caption text-ink-500">{IMPORTS[dialog].hint}</p>
        </CsvImportModal>
      )}
    </div>
  );
};

export default RetailStockPage;
