/*
 * Every bill raised, for a chosen period: exact totals from GET
 * /invoices/summary (the list is capped at 200), a tab for what is still owed,
 * and the list grouped by day. Each bill opens InvoiceDetail.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bike, Plus, Search, ShoppingBag, Store, UtensilsCrossed } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { localISO } from '../../lib/dates.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { platformName } from '../../lib/business.js';
import { Alert, Button, Input } from '../../components/ui.jsx';

const d0 = (iso) => new Date(`${iso}T00:00`);
const plusDays = (iso, n) => { const d = d0(iso); d.setDate(d.getDate() + n); return localISO(d); };
const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['month', 'This month'], ['all', 'All time'], ['custom', 'Pick dates']];
const periodFor = (key, custom) => {
  const today = localISO(); const now = new Date();
  if (key === 'today') return { from: today, to: today, label: 'today' };
  if (key === 'yesterday') { const y = plusDays(today, -1); return { from: y, to: y, label: 'yesterday' }; }
  if (key === '7d') return { from: plusDays(today, -6), to: today, label: 'in the last 7 days' };
  if (key === 'month') return { from: localISO(new Date(now.getFullYear(), now.getMonth(), 1)), to: today, label: `in ${now.toLocaleDateString([], { month: 'long' })}` };
  if (key === 'all') return { from: null, to: null, label: 'so far' };
  const from = custom.from || today; const to = custom.to && custom.to >= from ? custom.to : from;
  return { from, to, label: 'in these dates' };
};
const TABS = [['all', 'All'], ['owing', 'Still owed'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];
const dayLabel = (iso) => {
  const today = localISO();
  if (iso === today) return 'Today';
  if (iso === plusDays(today, -1)) return 'Yesterday';
  return d0(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d0(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};
const time = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

/* Where the sale came from: the counter, or an order and its table. */
const Source = ({ inv }) => {
  const [Icon, text] = inv.order_type === 'DINE_IN' ? [UtensilsCrossed, inv.table_name ? `Table ${inv.table_name}` : 'Dine-in']
    : inv.order_type === 'TAKEAWAY' ? [ShoppingBag, 'Takeaway']
    : inv.order_type === 'DELIVERY' ? [Bike, inv.platform ? platformName(inv.platform) : 'Delivery']
    : [Store, 'Counter'];
  return <span className="inline-flex items-center gap-1"><Icon aria-hidden="true" className="h-3 w-3" />{text}</span>;
};

const StateChip = ({ inv }) => {
  if (inv.status === 'CANCELLED') return <span className="rounded bg-surface-2 px-1.5 py-0.5 text-caption font-semibold text-ink-500">Cancelled</span>;
  if (inv.payment_status === 'PAID') return <span className="rounded bg-success/10 px-1.5 py-0.5 text-caption font-semibold text-success">{inv.refunded > 0 ? 'Paid · refunded' : 'Paid'}</span>;
  return <span className="rounded bg-warning/10 px-1.5 py-0.5 text-caption font-semibold text-warning">{inv.payment_status === 'PARTIAL' ? 'Part paid' : 'Unpaid'}</span>;
};

const Tile = ({ label, value, note, tone, onClick, pressed }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} aria-pressed={onClick ? pressed : undefined}
         className={`rounded-(--radius-card) border bg-surface p-4 text-left ${pressed ? 'border-brand-500 ring-1 ring-brand-500' : 'border-line'} ${onClick ? 'transition-colors duration-(--duration-fast) hover:border-ink-400' : ''}`}>
      <p className="text-caption text-ink-500">{label}</p>
      <p className={`tabular mt-1 text-title font-semibold ${tone || 'text-ink-900'}`}>{value}</p>
      {note && <p className="mt-0.5 text-caption text-ink-500">{note}</p>}
    </Tag>
  );
};

const InvoicesPage = () => {
  const navigate = useNavigate();
  const { outletId } = useAuth();
  const [periodKey, setPeriodKey] = useState('today');
  const [custom, setCustom] = useState({ from: plusDays(localISO(), -6), to: localISO() });
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');   // the search, once typing pauses
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const period = useMemo(() => periodFor(periodKey, custom), [periodKey, custom]);

  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => {
    const range = new URLSearchParams();
    if (period.from) range.set('from', period.from);
    if (period.to) range.set('to', period.to);
    const list = new URLSearchParams(range);
    if (tab === 'owing') list.set('owing', 'true');
    if (tab === 'paid') { list.set('status', 'ISSUED'); list.set('payment_status', 'PAID'); }
    if (tab === 'cancelled') list.set('status', 'CANCELLED');
    if (query) list.set('search', query);
    let live = true;
    setRows(null);
    Promise.all([api(`/invoices/summary?${range}`), api(`/invoices?${list}`)])
      .then(([s, r]) => { if (live) { setSummary(s); setRows(r); setError(''); } })
      .catch((caught) => live && setError(caught.message));
    return () => { live = false; };
  }, [period, tab, query, outletId]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const inv of rows || []) { const k = String(inv.invoice_date).slice(0, 10); if (!map.has(k)) map.set(k, []); map.get(k).push(inv); }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h3 font-semibold text-ink-900">Invoices</h1>
          <p className="mt-1 text-small text-ink-500">Every bill raised, what has been paid, and what is still owed.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" to="/app/billing/credit-notes">Credit notes</Button>
          <Button to="/app/billing"><Plus aria-hidden="true" className="h-4 w-4" />New sale</Button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Period" className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface-2 p-1">
          {PERIODS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={periodKey === k} onClick={() => setPeriodKey(k)}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-small font-medium ${periodKey === k ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'}`}>{label}</button>
          ))}
        </div>
        {periodKey === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From" value={custom.from} max={localISO()} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="!w-auto" />
            <span className="text-small text-ink-500">to</span>
            <Input type="date" aria-label="To" value={custom.to} min={custom.from} max={localISO()} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="!w-auto" />
          </div>
        )}
      </div>

      <Alert>{error}</Alert>

      <div className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label="Billed" value={summary ? formatCurrency(summary.billed) : '—'} note={summary ? `${summary.bills} bill${summary.bills === 1 ? '' : 's'} ${period.label}${summary.bills ? ` · ${formatCurrency(summary.average)} each` : ''}` : undefined} onClick={() => setTab('all')} pressed={tab === 'all'} />
        <Tile label="Paid so far" value={summary ? formatCurrency(summary.paid) : '—'} note={summary?.refunded > 0 ? `${formatCurrency(summary.refunded)} refunded` : summary ? `${summary.paid_bills} paid in full` : undefined} onClick={() => setTab('paid')} pressed={tab === 'paid'} />
        <Tile label="Still owed" value={summary ? formatCurrency(summary.due) : '—'} tone={summary?.due > 0 ? 'text-warning' : undefined} note={summary ? `on ${summary.owing} bill${summary.owing === 1 ? '' : 's'}` : undefined} onClick={() => setTab('owing')} pressed={tab === 'owing'} />
        <Tile label="Cancelled" value={summary ? summary.cancelled : '—'} note={summary?.cancelled ? `${formatCurrency(summary.cancelled_value)}, not counted` : 'none'} onClick={() => setTab('cancelled')} pressed={tab === 'cancelled'} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Show" className="flex gap-1 border-b border-line">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                    className={`-mb-px border-b-2 px-3 py-2 text-small font-medium ${tab === k ? 'border-brand-500 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>{label}</button>
          ))}
        </div>
        <label className="relative min-w-[14rem] flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <span className="sr-only">Search bills</span>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill number, customer or mobile" className="!pl-9" />
        </label>
      </div>

      {!rows && !error && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-3" />)}</div>}
      {rows?.length === 0 && (
        <div className="rounded-(--radius-card) border border-dashed border-line-strong p-10 text-center">
          <p className="text-body font-medium text-ink-900">
            {query ? 'No bills match.' : tab === 'owing' ? `Nothing is owed on bills raised ${period.label}.` : tab === 'cancelled' ? `No bills cancelled ${period.label}.` : tab === 'paid' ? `No paid bills ${period.label}.` : `No bills ${period.label}.`}
          </p>
          {tab === 'owing' && periodKey !== 'all' && !query && <button type="button" onClick={() => setPeriodKey('all')} className="mt-2 text-small font-medium text-brand-700">Check every bill, any date</button>}
          {tab === 'all' && !query && <p className="mt-1 text-small text-ink-500"><Link to="/app/billing" className="font-medium text-brand-700">Start a sale</Link> and it shows here.</p>}
        </div>
      )}
      <div className="space-y-5">
        {byDay.map(([date, list]) => (
          <div key={date}>
            <p className="mb-1.5 flex justify-between text-caption font-medium text-ink-500">
              <span>{dayLabel(date)}</span>
              <span className="tabular">{formatCurrency(list.filter((i) => i.status !== 'CANCELLED').reduce((t, i) => t + i.total, 0))}</span>
            </p>
            <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
              {list.map((inv) => {
                const cancelled = inv.status === 'CANCELLED';
                return (
                  <li key={inv.invoice_id}>
                    <button type="button" onClick={() => navigate(`/app/billing/invoices/${inv.invoice_id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className={`text-small font-semibold ${cancelled ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{inv.invoice_number}</span>
                          <StateChip inv={inv} />
                        </span>
                        <span className="flex flex-wrap gap-x-2 text-caption text-ink-500">
                          <span className="truncate">{inv.customer_name || 'Walk-in customer'}</span>
                          <span aria-hidden="true">·</span><Source inv={inv} />
                          {time(inv.created_at) && <><span aria-hidden="true">·</span><span>{time(inv.created_at)}</span></>}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={`tabular block text-small font-semibold ${cancelled ? 'text-ink-400' : 'text-ink-900'}`}>{formatCurrency(inv.total)}</span>
                        {!cancelled && inv.balance_due > 0 && <span className="tabular block text-caption font-medium text-warning">{formatCurrency(inv.balance_due)} due</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {rows?.length === 200 && <p className="mt-3 text-caption text-ink-500">Showing the latest 200. The figures above count every bill in the period.</p>}
    </div>
  );
};

export default InvoicesPage;
