/*
 * A stock count, counted by scanning. Each scan counts one more of that product (or type the number you found). Nothing
 * about the stock changes until "Apply": the screen shows what differs from the system as you go, and applying turns
 * each difference into a stock movement of its own, so the history says what the count found.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ScanLine, Search } from 'lucide-react';
import BarcodeScanner from '../components/BarcodeScanner.jsx';
import QuickProductModal from '../components/QuickProductModal.jsx';
import { api, formatCurrency } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { localSearch } from '../lib/posCatalog.js';
import { usePosCatalog } from '../lib/usePosCatalog.js';
import { lookupCode, qty } from '../lib/retailStock.js';
import { Alert, Badge, Button, Input, ListState, Modal, SkeletonRows, StatCard, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../components/ui.jsx';

const STATUS = { OPEN: ['In progress', 'brand'], APPLIED: ['Applied', 'success'], CANCELLED: ['Cancelled', 'neutral'] };
const num = (v) => (v === '' || v == null ? NaN : Number(v));

const Variance = ({ value }) => (value === 0
  ? <span className="text-ink-400">Matches</span>
  : <Badge tone={value < 0 ? 'danger' : 'warning'}>{value > 0 ? '+' : ''}{qty(value)}</Badge>);

const ApplyModal = ({ count, onClose, onApplied }) => {
  const [zero, setZero] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = count.totals;
  const go = async () => {
    setBusy(true); setError('');
    try { await api(`/retail/counts/${count.count_id}/apply`, { method: 'POST', body: { zero_uncounted: zero }, idempotencyKey: crypto.randomUUID() }); onApplied(); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title="Apply this count?" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-small text-ink-700">
          {t.variance_lines === 0 ? 'Everything you counted matches the system, so nothing will change.'
            : <>The stock of <strong className="font-semibold">{t.variance_lines} product{t.variance_lines === 1 ? '' : 's'}</strong> will be corrected: {qty(t.short_units)} units short, {qty(t.extra_units)} extra, {formatCurrency(Math.abs(t.net_value))} {t.net_value < 0 ? 'less' : 'more'} stock at cost. Each difference is recorded as a “Stock count” movement.</>}
        </p>
        {count.uncounted > 0 && (
          <label className="flex items-start gap-3 rounded-(--radius-card) border border-line p-3 text-small">
            <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} className="mt-0.5 h-4 w-4 accent-(--color-brand-500)" />
            <span><span className="font-medium text-ink-900">Set the {count.uncounted.toLocaleString('en-IN')} products I did not count to zero.</span>
              <span className="block text-ink-500">Only tick this if the whole {count.scope === 'CATEGORY' ? 'category' : 'store'} was counted and anything not scanned is truly gone.</span></span>
          </label>
        )}
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Keep counting</Button><Button onClick={go} loading={busy} variant={zero ? 'danger' : 'primary'}>Apply count</Button></div>
      </div>
    </Modal>
  );
};

const StockCountPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { business, outletId, can } = useAuth();
  const dialog = useDialog(); const toast = useToast();
  const catalog = usePosCatalog(`${business?.business_id}-${outletId}`);
  const [count, setCount] = useState(null);
  const [error, setError] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState(null);
  const [justMade, setJustMade] = useState(null);
  const [cats, setCats] = useState([]);
  const [applying, setApplying] = useState(false);
  const search = useRef(null);

  const load = useCallback(() => api(`/retail/counts/${id}?limit=500${onlyDiff ? '&variance=true' : ''}`).then((c) => { setCount(c); setError(''); }).catch((e) => setError(e.message)), [id, onlyDiff]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/categories').then(setCats).catch(() => {}); }, []);

  const open = count?.status === 'OPEN';
  const canWrite = can('inventory');

  const record = (entry) => api(`/retail/counts/${id}/items`, { method: 'POST', body: { items: [entry] }, idempotencyKey: crypto.randomUUID() });

  const onScan = async (raw) => {
    let product;
    try { product = await lookupCode(raw); } catch (e) { return { status: 'error', label: e.message }; }
    if (!product) return { status: 'unknown' };
    try {
      const [done] = await record({ product_id: product.product_id, add: 1 });
      return { status: 'ok', label: product.name, detail: `counted ${qty(done.counted_qty)}${done.variance ? ` · ${done.variance > 0 ? '+' : ''}${qty(done.variance)}` : ''}` };
    } catch (e) { return { status: 'blocked', label: e.message }; }
  };

  const setCounted = async (item) => {
    const value = num(drafts[item.product_id]);
    setDrafts((d) => { const { [item.product_id]: _gone, ...rest } = d; return rest; });
    if (!Number.isFinite(value) || value < 0 || value === item.counted_qty) return;
    try { await record({ product_id: item.product_id, counted: value }); await load(); } catch (e) { toast.error(e.message); }
  };

  /* The number found on the shelf: editable while the count is open (committed on leaving the field or Enter). */
  const countedField = (it) => (open && canWrite
    ? <input aria-label={`Counted ${it.name}`} inputMode="decimal" value={drafts[it.product_id] ?? qty(it.counted_qty).replace(/,/g, '')} onChange={(e) => setDrafts((d) => ({ ...d, [it.product_id]: e.target.value }))}
             onBlur={() => setCounted(it)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
             className="tabular h-11 w-24 rounded-lg border border-line-strong bg-surface text-right text-sm font-medium focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/15 sm:h-10 pointer-coarse:h-11" />
    : <span className="tabular font-medium">{qty(it.counted_qty)}</span>);

  const matches = query.trim().length >= 2 ? localSearch(query, 8) : [];
  const countOne = async (product) => {
    try { await record({ product_id: product.product_id, add: 1 }); setQuery(''); await load(); search.current?.focus(); } catch (e) { toast.error(e.message); }
  };

  const cancel = async () => {
    const ok = await dialog.confirm({ title: 'Cancel this count?', body: 'Your counts are discarded. Stock is not changed.', confirmLabel: 'Cancel the count', cancelLabel: 'Keep it', danger: true });
    if (!ok) return;
    try { await api(`/retail/counts/${id}/cancel`, { method: 'POST', body: {} }); toast.success('Count cancelled'); navigate('/app/stock?tab=counts'); } catch (e) { toast.error(e.message); }
  };

  if (error && !count) return <><Link to="/app/stock?tab=counts" className="mb-3 inline-flex items-center gap-1.5 text-small text-ink-500"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Counts</Link><Alert>{error}</Alert></>;
  const [label, tone] = STATUS[count?.status] || ['', 'neutral'];

  return (
    <div>
      <Link to="/app/stock?tab=counts" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-900"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Counts</Link>
      {!count ? <SkeletonRows rows={4} columns={4} /> : (
        <>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-ink-900">{count.name} <Badge tone={tone}>{label}</Badge></h1>
              <p className="mt-1 text-sm text-ink-500">{count.category ? `Counting only ${count.category}` : 'Counting the whole store'}{count.outlet ? ` · ${count.outlet}` : ''}</p>
            </div>
            {open && canWrite && (
              <div className="flex flex-wrap gap-2">
                <Button size="lg" className="min-h-12" onClick={() => setScanning(true)}><ScanLine aria-hidden="true" className="h-5 w-5" />Scan items</Button>
                <Button size="lg" className="min-h-12" variant="secondary" onClick={() => setApplying(true)} disabled={!count.totals.lines}>Finish and apply</Button>
              </div>
            )}
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="Products counted" value={count.totals.lines.toLocaleString('en-IN')} />
            <StatCard label="With a difference" value={count.totals.variance_lines} tone={count.totals.variance_lines ? 'warning' : undefined} />
            <StatCard label="Units short" value={qty(count.totals.short_units)} tone={count.totals.short_units ? 'danger' : undefined} />
            <StatCard label="Units extra" value={qty(count.totals.extra_units)} />
            <StatCard label="Not counted yet" value={count.uncounted.toLocaleString('en-IN')} note={count.status === 'OPEN' ? 'In this count’s scope' : undefined} />
          </div>

          {open && canWrite && (
            <div className="relative mb-4 max-w-xl">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input ref={search} aria-label="Find a product to count" className="min-h-12 pl-10" placeholder="Search a product to count it (+1)" value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) { e.preventDefault(); lookupCode(query).then((p) => (p || matches[0]) && countOne(p || matches[0])).catch(() => {}); } if (e.key === 'Escape') setQuery(''); }} />
              {matches.length > 0 && (
                <ul role="listbox" aria-label="Matching products" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-(--radius-card) border border-line bg-surface p-1 shadow-lg">
                  {matches.map((p) => <li key={p.product_id} role="option"><button type="button" onClick={() => countOne(p)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-small hover:bg-surface-2"><span className="truncate font-medium text-ink-900">{p.name}</span><span className="shrink-0 text-caption text-ink-500">{p.sku}</span></button></li>)}
                </ul>
              )}
            </div>
          )}

          <label className="mb-3 inline-flex min-h-11 items-center gap-2 text-small text-ink-700">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} className="h-4 w-4 accent-(--color-brand-500)" />Only products with a difference
          </label>

          <ListState empty={!count.items.length} emptyLabel={onlyDiff ? 'No differences so far.' : 'Nothing counted yet.'} emptyBody={open ? 'Press Scan items and scan each product on the shelf, once per unit. Or search above.' : undefined} />
          {count.items.length > 0 && (
            <>
            <div className="hidden sm:block">
            <Table>
              <Thead><Th>Product</Th><Th className="text-right">System said</Th><Th className="text-right">You counted</Th><Th className="text-right">Difference</Th></Thead>
              <tbody>
                {count.items.map((it) => (
                  <Tr key={it.product_id}>
                    <Td><span className="font-medium text-ink-900">{it.name}</span><span className="block text-caption text-ink-500">{[it.sku, it.barcode].filter(Boolean).join(' · ')}</span></Td>
                    <Td className="tabular text-right text-ink-500">{qty(it.system_qty)}</Td>
                    <Td className="text-right">{countedField(it)}</Td>
                    <Td className="text-right"><Variance value={it.variance} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            </div>
            <ul className="space-y-2 sm:hidden" aria-label="Counted products">
              {count.items.map((it) => (
                <li key={it.product_id} className="rounded-(--radius-card) border border-line bg-surface p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="font-medium text-ink-900">{it.name}</p><p className="truncate text-caption text-ink-500">{[it.sku, it.barcode].filter(Boolean).join(' · ')}</p></div>
                    <Variance value={it.variance} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-small text-ink-500">
                    <span>System said <span className="tabular font-medium text-ink-700">{qty(it.system_qty)}</span></span>
                    <span className="flex items-center gap-2">You counted {countedField(it)}</span>
                  </div>
                </li>
              ))}
            </ul>
            </>
          )}

          {count.status === 'APPLIED' && <p className="mt-5 text-small text-ink-500">Applied: {count.lines_adjusted} product{count.lines_adjusted === 1 ? '' : 's'} corrected, {count.net_units > 0 ? '+' : ''}{qty(count.net_units)} units ({formatCurrency(count.net_value)} at cost). See the Movements tab in the Stock center.</p>}
          {open && canWrite && <div className="mt-8"><Button variant="ghost" onClick={cancel}>Cancel this count</Button></div>}
        </>
      )}

      {applying && count && <ApplyModal count={count} onClose={() => setApplying(false)} onApplied={() => { setApplying(false); toast.success('Count applied'); load(); }} />}
      {scanning && (
        <BarcodeScanner
          onScan={onScan} skipCode={justMade} canCreate={can('product_quick_add')}
          onClose={() => { setScanning(false); setJustMade(null); load(); }}
          onSearch={() => { setScanning(false); load(); setTimeout(() => search.current?.focus(), 0); }}
          onCreate={(code) => { setScanning(false); setCreating({ barcode: code }); }}
        />
      )}
      {creating && (
        <QuickProductModal
          barcode={creating.barcode} categories={cats}
          onCancel={() => { setCreating(null); setScanning(true); }}
          onCreated={async (product) => { try { await record({ product_id: product.product_id, add: 1 }); } catch (e) { toast.error(e.message); } setJustMade(creating.barcode); setCreating(null); setScanning(true); }}
          onUseExisting={() => { setCreating(null); setScanning(true); }}
        />
      )}
      <span className="sr-only" aria-live="polite">{catalog.ready ? '' : 'Loading the catalogue'}</span>
    </div>
  );
};

export default StockCountPage;
