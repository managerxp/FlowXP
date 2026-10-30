/*
 * Reports: one period, a list of reports, each a thin renderer over the
 * aggregate its endpoint already worked out (reports.controller.js). This file
 * formats and draws; it calculates nothing the backend has not. The one extra
 * fetch is the sales report for the period before, to compare against.
 *
 * Charts are plain bars in the brand blue (one series each), with a hover
 * label and a table for screen readers. Every table can be downloaded as CSV.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download, Send } from 'lucide-react';
import { api, downloadFile, shareFile, formatCurrency } from '../lib/api.js';
import { localISO } from '../lib/dates.js';
import { formatDate } from '../lib/display.js';
import { useAuth } from '../context/AuthContext.jsx';
import { stateTaxName } from '../lib/gstNames.js';
import { RESTAURANT_TYPES, platformName } from '../lib/business.js';
import { Alert, Button, Input, Modal, StatCard } from '../components/ui.jsx';
import { useT, T } from '../i18n/useT.js';

/* ── Periods ───────────────────────────────────────────────────────────── */

const d0 = (iso) => new Date(`${iso}T00:00`);
const plusDays = (iso, n) => { const d = d0(iso); d.setDate(d.getDate() + n); return localISO(d); };
const daysBetween = (a, b) => Math.round((d0(b) - d0(a)) / 86400000) + 1;
const short = (iso) => d0(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
const PERIODS = [['today', T('Today')], ['yesterday', T('Yesterday')], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', T('This month')], ['last-month', T('Last month')], ['custom', T('Pick dates')]];
const periodFor = (key, custom) => {
  const today = localISO(); const now = new Date();
  const r = key === 'today' ? { from: today, to: today, label: T('Today') }
    : key === 'yesterday' ? { from: plusDays(today, -1), to: plusDays(today, -1), label: T('Yesterday') }
    : key === '7d' ? { from: plusDays(today, -6), to: today, label: T('Last 7 days') }
    : key === '30d' ? { from: plusDays(today, -29), to: today, label: T('Last 30 days') }
    : key === 'month' ? { from: localISO(new Date(now.getFullYear(), now.getMonth(), 1)), to: today, label: `${now.toLocaleDateString([], { month: 'long' })} so far` }
    : key === 'last-month' ? { from: localISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: localISO(new Date(now.getFullYear(), now.getMonth(), 0)), label: new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' }) }
    : (() => { const from = custom.from || today; const to = custom.to && custom.to >= from ? custom.to : from; return { from, to, label: from === to ? short(from) : `${short(from)} – ${short(to)}` }; })();
  const days = daysBetween(r.from, r.to);
  // the period just before, the same length, to compare with
  return { ...r, days, prevFrom: plusDays(r.from, -days), prevTo: plusDays(r.from, -1), vs: days === 1 ? 'the day before' : `the ${days} days before` };
};

/* ── Small parts ───────────────────────────────────────────────────────── */

const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+@\t\r-]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const saveCsv = (name, head, rows) => {
  const blob = new Blob([[head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
/* A real button, not a text link: outlined, lifts to the brand colour on hover, and says "Saved" for a moment after the file is made. */
const CsvButton = ({ name, head, rows }) => {
  const tr = useT();
  const [saved, setSaved] = useState(false);
  const click = () => { saveCsv(name, head, rows); setSaved(true); setTimeout(() => setSaved(false), 1800); };
  return (
    <button type="button" onClick={click} disabled={!rows.length} title={rows.length ? `Download ${rows.length} row${rows.length === 1 ? '' : 's'} as a spreadsheet file` : tr('Nothing to download yet')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-caption font-semibold transition-[color,background-color,border-color,transform] duration-(--duration-fast) active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:h-10 pointer-coarse:px-3 ${saved ? 'border-success/40 bg-success/10 text-success' : 'border-line-strong bg-surface text-ink-700 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700 disabled:hover:border-line-strong disabled:hover:bg-surface disabled:hover:text-ink-700'}`}>
      {saved ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : <Download aria-hidden="true" className="h-3.5 w-3.5" />}
      {saved ? tr('Saved') : <><span className="max-sm:hidden">{tr('Download')} </span>{tr('CSV')}</>}
    </button>
  );
};

const Tile = ({ change, ...props }) => <StatCard {...props}>{change}</StatCard>;

/* "12% up on the 7 days before": spending more is the thing to notice on costs, earning more on sales. */
const Change = ({ now, before, vs, goodWhenUp = true }) => {
  const tr = useT();
  if (before == null) return null;
  if (!before) return <p className="mt-0.5 text-caption text-ink-500">{now ? `nothing in ${vs}` : ' '}</p>;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <p className="mt-0.5 text-caption text-ink-500">{tr('the same as {{vs}}', { vs })}</p>;
  const good = (pct > 0) === goodWhenUp;
  return <p className="tabular mt-0.5 text-caption"><span className={`font-semibold ${good ? 'text-success' : 'text-warning'}`}>{pct > 0 ? '↑' : '↓'} {Math.abs(pct)}%</span> <span className="text-ink-500">{tr('on {{vs}}', { vs })}</span></p>;
};

const Section = ({ title, action, children, note }) => {
  const tr = useT();
  return (
  <section className="rounded-(--radius-card) border border-line bg-surface p-5">
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-body font-semibold text-ink-900">{tr(title)}</h3>
      {action}
    </div>
    {children}
    {note && <p className="mt-3 text-caption text-ink-500">{note}</p>}
  </section>
);
};

/* Vertical bars (days, hours). One series, brand blue; the tallest is labelled. */
const Columns = ({ points, label, valueText }) => {
  const tr = useT();
  const [hover, setHover] = useState(null);
  const max = Math.max(...points.map((p) => p.value), 0);
  if (!max) return <p className="py-6 text-center text-small text-ink-500">{tr('No sales in this period.')}</p>;
  const shown = hover != null ? points[hover] : points.reduce((a, b) => (b.value > a.value ? b : a));
  return (
    <div>
      <p className="tabular mb-2 h-5 text-small text-ink-700"><span className="font-semibold text-ink-900">{tr(shown.label)}</span> · {valueText(shown)}{hover == null && <span className="text-ink-500"> {tr('(the most)')}</span>}</p>
      <div className="relative h-40" onMouseLeave={() => setHover(null)}>
        {[25, 50, 75].map((y) => <span key={y} aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${y}%` }} />)}
        <div className="relative flex h-full items-end gap-[3px]">
          {points.map((p, i) => (
            <button key={p.key} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${p.label}: ${valueText(p)}`}
                    className="group flex h-full min-w-0 flex-1 items-end focus:outline-none">
              <span className={`block w-full rounded-t-[4px] transition-colors duration-(--duration-fast) ${p === shown ? 'bg-brand-500' : 'bg-brand-200 group-hover:bg-brand-400'} group-focus-visible:ring-2 group-focus-visible:ring-brand-700`}
                    style={{ height: `${p.value ? Math.max(2, (p.value / max) * 100) : 0}%` }} />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-caption text-ink-500"><span>{points[0].axis}</span><span>{points[points.length - 1].axis}</span></div>
      <table className="sr-only"><caption>{tr(label)}</caption><tbody>{points.map((p) => <tr key={p.key}><th>{tr(p.label)}</th><td>{valueText(p)}</td></tr>)}</tbody></table>
    </div>
  );
};

/* Horizontal bars for a ranked breakdown (category, channel, method…). */
const Bars = ({ rows, empty = 'Nothing in this period.' }) => {
  const tr = useT();
  const max = Math.max(...rows.map((r) => r.value), 0);
  const total = rows.reduce((t, r) => t + r.value, 0);
  if (!rows.length) return <p className="text-small text-ink-500">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="text-small">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-ink-900">{r.to ? <Link to={r.to} className="hover:text-brand-700">{tr(r.label)}</Link> : r.label}{r.note && <span className="text-ink-500"> · {r.note}</span>}</span>
            <span className="tabular shrink-0 font-medium text-ink-900">{formatCurrency(r.value)}{total > 0 && <span className="ml-1.5 font-normal text-ink-500">{Math.round((r.value / total) * 100)}%</span>}</span>
          </span>
          <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${max ? Math.max(1.5, (r.value / max) * 100) : 0}%` }} /></span>
        </li>
      ))}
    </ul>
  );
};

const METHOD = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank', CREDIT: 'Credit', OTHER: 'Other' };
const CHANNEL = { COUNTER: 'Counter sales', DINE_IN: 'Dine-in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery' };
const channelName = (c) => (c.platform ? `${CHANNEL[c.channel] || c.channel} · ${platformName(c.platform)}` : CHANNEL[c.channel] || c.channel);
const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });

/* ── Reports ──────────────────────────────────────────────────────────── */

const SalesReport = ({ d, prev, period }) => {
  const tr = useT();
  const avg = d.invoice_count ? d.total_sales / d.invoice_count : 0;
  const prevAvg = prev?.invoice_count ? prev.total_sales / prev.invoice_count : prev ? 0 : null;
  const byDate = new Map(d.by_day.map((r) => [String(r.date).slice(0, 10), r]));
  const days = period.days > 1 && period.days <= 92 ? Array.from({ length: period.days }, (_, i) => plusDays(period.from, i)) : [];
  const dayPoints = days.map((iso) => ({ key: iso, label: d0(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }), axis: short(iso), value: byDate.get(iso)?.total || 0, bills: byDate.get(iso)?.invoice_count || 0 }));
  const byHour = new Map(d.by_hour.map((r) => [r.hour, r]));
  const hours = d.by_hour.length ? Array.from({ length: Math.max(...d.by_hour.map((h) => h.hour)) - Math.min(...d.by_hour.map((h) => h.hour)) + 1 }, (_, i) => Math.min(...d.by_hour.map((h) => h.hour)) + i) : [];
  const hourPoints = hours.map((h) => ({ key: h, label: `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`, axis: hourLabel(h), value: byHour.get(h)?.total || 0, bills: byHour.get(h)?.invoice_count || 0 }));
  const billsText = (p) => `${formatCurrency(p.value)} · ${p.bills} bill${p.bills === 1 ? '' : 's'}`;
  const name = `sales-${period.from}-to-${period.to}`;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label={tr('Sales')} value={formatCurrency(d.total_sales)} change={<Change now={d.total_sales} before={prev?.total_sales} vs={period.vs} />} note="incl. GST" />
        <Tile label={tr('Bills')} value={d.invoice_count} change={<Change now={d.invoice_count} before={prev?.invoice_count} vs={period.vs} />} />
        <Tile label={tr('Average bill')} value={formatCurrency(avg)} change={<Change now={avg} before={prevAvg} vs={period.vs} />} />
        <Tile label={tr('GST collected')} value={formatCurrency(d.total_tax)} note={d.outstanding > 0 ? `${formatCurrency(d.outstanding)} of these bills still unpaid` : 'all bills paid'} />
      </div>

      {dayPoints.length > 0 && (
        <Section title={tr('Day by day')} action={<CsvButton name={`${name}-by-day`} head={['Date', 'Bills', 'Sales']} rows={dayPoints.map((p) => [p.key, p.bills, p.value.toFixed(2)])} />}>
          <Columns points={dayPoints} label={tr('Sales by day')} valueText={billsText} />
        </Section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={tr('Busiest hours')} action={<CsvButton name={`${name}-by-hour`} head={['Hour', 'Bills', 'Sales']} rows={hourPoints.map((p) => [p.label, p.bills, p.value.toFixed(2)])} />} note={period.days > 1 ? 'All days in the period added together.' : undefined}>
          {hourPoints.length ? <Columns points={hourPoints} label={tr('Sales by hour')} valueText={billsText} /> : <p className="text-small text-ink-500">{tr('No sales in this period.')}</p>}
        </Section>
        <Section title={tr('Where sales came from')} action={<CsvButton name={`${name}-by-channel`} head={['Channel', 'Bills', 'Sales']} rows={d.by_channel.map((c) => [channelName(c), c.invoice_count, c.total.toFixed(2)])} />}>
          <Bars rows={d.by_channel.map((c) => ({ key: `${c.channel}-${c.platform}`, label: channelName(c), note: `${c.invoice_count} bill${c.invoice_count === 1 ? '' : 's'}`, value: c.total }))} />
        </Section>
        <Section title={tr('By category')} action={<CsvButton name={`${name}-by-category`} head={['Category', 'Quantity', 'Sales']} rows={d.by_category.map((c) => [c.category, c.quantity, c.revenue.toFixed(2)])} />}>
          <Bars rows={d.by_category.map((c) => ({ key: c.category, label: c.category, value: c.revenue }))} />
        </Section>
        <Section title={tr('How customers paid')} action={<CsvButton name={`${name}-by-method`} head={['Method', 'Amount']} rows={d.by_payment_method.map((m) => [METHOD[m.method] || m.method, m.amount.toFixed(2)])} />} note="Money taken in the period, including payments on older bills.">
          <Bars rows={d.by_payment_method.map((m) => ({ key: m.method, label: METHOD[m.method] || m.method, value: m.amount }))} empty="No payments taken in this period." />
        </Section>
      </div>

      <Section title={tr('Best sellers')} action={<CsvButton name={`${name}-top-products`} head={['Product', 'Quantity', 'Sales']} rows={d.top_products.map((p) => [p.name, p.quantity, p.revenue.toFixed(2)])} />}
               note={<>{tr('Top 10 by sales. What each one earns you after its cost is on')} <Link to="/app/profitability" className="font-medium text-brand-700">{tr('Profitability')}</Link>.</>}>
        {d.top_products.length === 0 ? <p className="text-small text-ink-500">{tr('No sales in this period.')}</p> : (
          <ol className="divide-y divide-line">
            {d.top_products.map((p, i) => (
              <li key={p.product_id ?? p.name} className="flex items-center gap-3 py-2 text-small">
                <span className="tabular w-5 shrink-0 text-caption text-ink-400">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-ink-900">{p.product_id ? <Link to={`/app/products?p=${p.product_id}`} className="hover:text-brand-700">{p.name}</Link> : p.name}</span>
                <span className="tabular shrink-0 text-ink-500">{tr('{{Number}} sold', { Number: Number(p.quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 }) })}</span>
                <span className="tabular w-28 shrink-0 text-right font-medium text-ink-900">{formatCurrency(p.revenue)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
};

const WaitersReport = ({ d, period }) => {
  const tr = useT();
  return (
  d.waiters.length === 0 ? <p className="rounded-(--radius-card) border border-dashed border-line-strong p-8 text-center text-small text-ink-500">{tr('No table sales in this period.')}</p> : (
    <Section title={tr('Sales by who served the table')} action={<CsvButton name={`waiters-${period.from}-to-${period.to}`} head={['Waiter', 'Bills', 'Average bill', 'Discounts', 'Sales']} rows={d.waiters.map((w) => [w.name, w.bills, w.average_bill.toFixed(2), w.discounts.toFixed(2), w.revenue.toFixed(2)])} />}
             note={`From billed orders, net of credit notes. Total ${formatCurrency(d.total)}.`}>
      <ul className="space-y-3">
        {d.waiters.map((w) => (
          <li key={w.waiter_user_id ?? 'none'}>
            <div className="flex items-baseline justify-between gap-3 text-small">
              <span className="font-medium text-ink-900">{w.name}</span>
              <span className="tabular font-semibold text-ink-900">{formatCurrency(w.revenue)}</span>
            </div>
            <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${(w.revenue / (d.waiters[0].revenue || 1)) * 100}%` }} /></span>
            <p className="tabular mt-1 text-caption text-ink-500">{w.bills} bill{w.bills === 1 ? '' : 's'} · {formatCurrency(w.average_bill)} each{w.discounts > 0 && ` · ${formatCurrency(w.discounts)} given in discounts`}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
);
};

const PurchasesReport = ({ d, period }) => {
  const tr = useT();
  return (
  <div className="space-y-5">
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
      <Tile label={tr('Bought')} value={formatCurrency(d.total_purchases)} note="received, after returns" />
      <Tile label={tr('Deliveries')} value={d.po_count} />
      <Tile label={tr('Still to pay on these')} value={formatCurrency(d.total_payable)} note={<Link to="/app/purchases" className="font-medium text-brand-700">{tr('Open Purchases')}</Link>} />
    </div>
    <Section title={tr('By supplier')} action={<CsvButton name={`purchases-${period.from}-to-${period.to}`} head={['Supplier', 'Bought']} rows={d.by_supplier.map((s) => [s.name, s.total.toFixed(2)])} />} note="Top 10.">
      <Bars rows={d.by_supplier.map((s) => ({ key: s.supplier_id ?? s.name, label: s.name, value: s.total, to: s.supplier_id ? `/app/suppliers?s=${s.supplier_id}` : undefined }))} empty="Nothing received in this period." />
    </Section>
  </div>
);
};

const ExpensesReport = ({ d, period }) => {
  const tr = useT();
  return (
  <div className="space-y-5">
    <div className="grid grid-cols-2 gap-2">
      <Tile label={tr('Spent')} value={formatCurrency(d.total_expenses)} note={<Link to="/app/expenses" className="font-medium text-brand-700">{tr('Open Expenses')}</Link>} />
      <Tile label={tr('Expenses logged')} value={d.expense_count} />
    </div>
    <Section title={tr('By category')} action={<CsvButton name={`expenses-${period.from}-to-${period.to}`} head={['Category', 'Amount']} rows={d.by_category.map((c) => [c.category, c.amount.toFixed(2)])} />}>
      <Bars rows={d.by_category.map((c) => ({ key: c.category, label: c.category, value: c.amount }))} empty="No expenses logged in this period." />
    </Section>
  </div>
);
};

const OutstandingReport = ({ d }) => {
  const tr = useT();
  const total = d.reduce((t, c) => t + c.balance_due, 0);
  const today = localISO();
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        <Tile label={tr('Owed to you')} value={formatCurrency(total)} note="on bills with a customer, as of now" />
        <Tile label={tr('Customers')} value={d.length} />
      </div>
      <Section title={tr('Who owes you')} action={<CsvButton name={`owed-${today}`} head={['Customer', 'Phone', 'Oldest unpaid bill', 'Owed']} rows={d.map((c) => [c.name, c.phone || '', c.oldest_invoice_date, c.balance_due.toFixed(2)])} />}>
        {d.length === 0 ? <p className="text-small text-ink-500">{tr('Nobody owes you anything.')}</p> : (
          <ul className="divide-y divide-line">
            {d.map((c) => {
              const age = daysBetween(String(c.oldest_invoice_date).slice(0, 10), today) - 1;
              return (
                <li key={c.customer_id} className="flex items-center gap-3 py-2.5 text-small">
                  <span className="min-w-0 flex-1">
                    <Link to={`/app/customers?c=${c.customer_id}`} className="block truncate font-medium text-ink-900 hover:text-brand-700">{c.name}</Link>
                    <span className="block text-caption text-ink-500">{[c.phone, `oldest unpaid ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={`tabular shrink-0 font-semibold ${age > 30 ? 'text-danger' : 'text-warning'}`}>{formatCurrency(c.balance_due)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
};

const StockReport = ({ d }) => {
  const tr = useT();
  return (
  <div className="space-y-5">
    <div className="grid grid-cols-2 gap-2">
      <Tile label={tr('Stock value')} value={formatCurrency(d.total_value)} note="at what you paid, as of now" />
      <Tile label={tr('Items counted')} value={d.product_count} note={<Link to="/app/inventory" className="font-medium text-brand-700">{tr('Open Inventory')}</Link>} />
    </div>
    <Section title={tr('Running low')} action={<CsvButton name={`low-stock-${localISO()}`} head={['Item', 'In stock', 'Warns below']} rows={d.low_stock.map((p) => [p.name, p.current_stock, p.min_stock])} />} note="The 20 lowest against their warning level.">
      {d.low_stock.length === 0 ? <p className="text-small text-ink-500">{tr('Nothing is running low.')}</p> : (
        <ul className="divide-y divide-line">
          {d.low_stock.map((p) => (
            <li key={p.product_id} className="flex items-center justify-between gap-3 py-2 text-small">
              <Link to={`/app/inventory?item=${p.product_id}`} className="min-w-0 truncate text-ink-900 hover:text-brand-700">{p.name}</Link>
              <span className="tabular shrink-0"><span className={`font-semibold ${p.current_stock <= 0 ? 'text-danger' : 'text-warning'}`}>{p.current_stock}</span><span className="text-ink-500"> / warns below {p.min_stock}</span></span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  </div>
);
};

const CustomersReport = ({ d, period }) => {
  const tr = useT();
  return (
  <Section title={tr('Who spent the most')} action={<CsvButton name={`top-customers-${period.from}-to-${period.to}`} head={['Customer', 'Bills', 'Spent']} rows={d.map((c) => [c.name, c.invoice_count, c.total.toFixed(2)])} />} note="Top 20, on bills with a customer.">
    <Bars rows={d.map((c) => ({ key: c.customer_id, label: c.name, note: `${c.invoice_count} bill${c.invoice_count === 1 ? '' : 's'}`, value: c.total, to: `/app/customers?c=${c.customer_id}` }))} empty="No bills with a customer in this period." />
  </Section>
);
};

const GstReport = ({ d }) => {
  const tr = useT();
  const { business } = useAuth();
  const [error, setError] = useState('');
  return (
    <div className="space-y-5">
      <Alert>{error}</Alert>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Tile label={tr('Taxable value')} value={formatCurrency(d.taxable_value)} />
        <Tile label={tr('CGST')} value={formatCurrency(d.cgst)} />
        <Tile label={stateTaxName(business?.state)} value={formatCurrency(d.sgst)} />
        <Tile label={tr('IGST')} value={formatCurrency(d.igst)} />
        <Tile label={tr('Total GST')} value={formatCurrency(d.total_tax)} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-line bg-surface-2 p-4">
        <p className="text-small text-ink-700">Net of {d.credit_notes.count} credit note{d.credit_notes.count === 1 ? '' : 's'} ({formatCurrency(d.credit_notes.tax)} of tax taken back). The register lists every bill and credit note by tax rate, B2B and B2C, for your GSTR-1.</p>
        <Button variant="secondary" onClick={() => downloadFile(`/reports/gst/register?from=${d.range.from}&to=${d.range.to}&format=csv`, `gst-register-${d.range.from}-to-${d.range.to}.csv`).catch((e) => setError(e.message))}>
          <Download aria-hidden="true" className="h-4 w-4" />{tr('GST register (CSV)')}
        </Button>
      </div>
      <Section title={tr('By HSN / SAC')} action={<CsvButton name={`gst-hsn-${d.range.from}-to-${d.range.to}`} head={['HSN/SAC', 'Rate %', 'Taxable value', 'Tax']} rows={d.by_hsn.map((h) => [h.hsn_sac, h.tax_rate, h.taxable_value.toFixed(2), h.tax.toFixed(2)])} />}>
        {d.by_hsn.length === 0 ? <p className="text-small text-ink-500">{tr('No taxed sales in this period.')}</p> : (
          <table className="w-full text-small">
            <thead><tr className="border-b border-line text-left text-caption text-ink-500"><th className="py-2 font-medium">{tr('HSN / SAC')}</th><th className="py-2 text-right font-medium">{tr('Rate')}</th><th className="py-2 text-right font-medium">{tr('Taxable')}</th><th className="py-2 text-right font-medium">{tr('GST')}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {d.by_hsn.map((h, i) => (
                <tr key={i}><td className={`py-2 ${h.hsn_sac === 'No HSN/SAC' ? 'text-warning' : 'text-ink-900'}`}>{h.hsn_sac}</td><td className="tabular py-2 text-right text-ink-500">{h.tax_rate}%</td><td className="tabular py-2 text-right text-ink-700">{formatCurrency(h.taxable_value)}</td><td className="tabular py-2 text-right font-medium text-ink-900">{formatCurrency(h.tax)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {d.by_hsn.some((h) => h.hsn_sac === 'No HSN/SAC') && <p className="mt-3 text-caption text-ink-500">{tr('Some items have no HSN/SAC code. Add it on')} <Link to="/app/products" className="font-medium text-brand-700">{tr('Products')}</Link> {tr('before filing.')}</p>}
      </Section>
    </div>
  );
};

/* ── Ledger reports: Day Book, All transactions, Party statement, Sales / Purchases by party (ledgerReports.controller.js) ── */

const TXN = {
  SALE: [T('Sale'), 'text-ink-900'], PURCHASE: [T('Purchase'), 'text-ink-900'], PAYMENT_IN: [T('Payment in'), 'text-success'], PAYMENT_OUT: [T('Payment out'), 'text-warning'],
  EXPENSE: [T('Expense'), 'text-warning'], OTHER_INCOME: [T('Other income'), 'text-success'], SALE_RETURN: [T('Sale return'), 'text-danger'], PURCHASE_RETURN: [T('Purchase return'), 'text-danger']
};
const fmtDay = (iso) => formatDate(String(iso).slice(0, 10));
const TH = 'px-2 py-2 text-left text-caption font-semibold uppercase tracking-[0.08em] text-ink-500';

/* what a ledger report fetches: re-run whenever the path (or the outlet) changes */
const useLedger = (path) => {
  const { outletId } = useAuth();
  const [state, setState] = useState({ path: null, data: null, error: '' });
  useEffect(() => {
    let live = true;
    api(path).then((data) => { if (live) setState({ path, data, error: '' }); }).catch((caught) => { if (live) setState({ path, data: null, error: caught.message }); });
    return () => { live = false; };
  }, [path, outletId]);
  return state.path === path ? state : { path, data: null, error: '' };
};

const TxnTable = ({ rows }) => {
  const tr = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-small">
        <thead><tr className="border-b border-line"><th className={TH}>{tr('Date')}</th><th className={TH}>{tr('Type')}</th><th className={TH}>{tr('Number')}</th><th className={TH}>{tr('Party')}</th><th className={`${TH} text-right`}>{tr('Total')}</th><th className={`${TH} text-right`}>{tr('Paid')}</th><th className={`${TH} text-right`}>{tr('Balance')}</th></tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={`${r.type}-${r.ref_id}`} className={r.status === 'CANCELLED' ? 'text-ink-400 line-through' : ''}>
              <td className="tabular whitespace-nowrap px-2 py-2 text-ink-500">{fmtDay(r.date)}</td>
              <td className={`whitespace-nowrap px-2 py-2 font-medium ${TXN[r.type][1]}`}>{tr(TXN[r.type][0])}{r.note && ['PAYMENT_IN', 'PAYMENT_OUT', 'EXPENSE', 'OTHER_INCOME'].includes(r.type) ? <span className="font-normal text-ink-500"> · {METHOD[r.note] || r.note}</span> : null}</td>
              <td className="px-2 py-2">{r.type === 'SALE' ? <Link to={`/app/billing/invoices/${r.ref_id}`} className="text-brand-700 hover:underline">{r.number}</Link> : r.number}</td>
              <td className="max-w-[16rem] truncate px-2 py-2 text-ink-700">{r.party}</td>
              <td className="tabular px-2 py-2 text-right font-medium text-ink-900">{formatCurrency(r.total)}</td>
              <td className="tabular px-2 py-2 text-right text-ink-500">{['SALE', 'PURCHASE'].includes(r.type) ? formatCurrency(r.paid) : ''}</td>
              <td className={`tabular px-2 py-2 text-right ${r.balance > 0 ? 'font-semibold text-warning' : 'text-ink-500'}`}>{['SALE', 'PURCHASE'].includes(r.type) && r.balance > 0 ? formatCurrency(r.balance) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const csvOfTxns = (rows) => rows.map((r) => [r.date, r.type, r.number, r.party, r.total, r.paid, r.balance]);
const TXN_HEAD = ['Date', 'Type', 'Number', 'Party', 'Total', 'Paid', 'Balance'];

/* Day Book (one day) and All transactions (the period, filtered) are the same list. */
const TransactionsReport = ({ period, day }) => {
  const tr = useT();
  const [date, setDate] = useState(localISO());
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const from = day ? date : period.from; const to = day ? date : period.to;
  const { data, error } = useLedger(`/reports/transactions?from=${from}&to=${to}${type ? `&type=${type}` : ''}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {day && <Input type="date" aria-label={tr('Day')} value={date} max={localISO()} onChange={(e) => e.target.value && setDate(e.target.value)} className="!w-auto" />}
        <select aria-label={tr('Type')} value={type} onChange={(e) => setType(e.target.value)} className="h-10 rounded-lg border border-line bg-surface px-2 text-small">
          <option value="">{tr('All types')}</option>
          {Object.entries(TXN).map(([k, [label]]) => <option key={k} value={k}>{tr(label)}</option>)}
        </select>
        <Input aria-label={tr('Search party or number')} placeholder={tr('Search party or number')} value={q} onChange={(e) => setQ(e.target.value)} className="!w-56" />
      </div>
      <Alert>{error}</Alert>
      {!data ? <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" /> : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label={tr('Sales')} value={formatCurrency(data.summary.sales)} />
          <Tile label={tr('Purchases')} value={formatCurrency(data.summary.purchases)} />
          <Tile label={tr('Money in')} value={formatCurrency(data.summary.money_in)} />
          <Tile label={tr('Money out')} value={formatCurrency(data.summary.money_out)} />
        </div>
        <Section title={day ? tr('Day Book') : tr('All transactions')} action={<CsvButton name={`${day ? 'day-book' : 'transactions'}-${from}-to-${to}`} head={TXN_HEAD} rows={csvOfTxns(data.rows)} />}
                 note={data.truncated ? tr('Only the first 2,000 rows are shown. Narrow the dates.') : null}>
          {data.rows.length ? <TxnTable rows={data.rows} /> : <p className="text-small text-ink-500">{day ? tr('Nothing on this day.') : tr('Nothing found for this period.')}</p>}
        </Section>
      </>}
    </div>
  );
};

/* WhatsApp with a payment reminder ready for a customer who owes money (the shop's own WhatsApp, no messaging service needed); the window is opened first so the browser does not block it */
const remindOnWhatsApp = async (customerId) => {
  const win = window.open('', '_blank');
  try {
    const r = await api('/messaging/balance-share', { method: 'POST', body: { customer_id: Number(customerId) } });
    if (win) { win.opener = null; win.location.href = r.wa_url; } else window.location.href = r.wa_url;
  } catch (caught) { win?.close(); throw caught; }
};

/* The statement as its own printable page (print, or choose "Save as PDF" as the printer) */
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const printStatement = (d, period, businessName) => {
  const money = (n) => (n ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  const rows = d.lines.map((l) => `<tr><td>${escapeHtml(String(l.date).slice(0, 10))}</td><td>${escapeHtml(l.type)}</td><td>${escapeHtml(l.number)}</td><td class="n">${money(l.debit)}</td><td class="n">${money(l.credit)}</td><td class="n">${money(l.balance)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Statement - ${escapeHtml(d.party.name)}</title><style>
    body{font:13px/1.4 system-ui,sans-serif;color:#111;margin:24px} h1{font-size:18px;margin:0} p{margin:2px 0;color:#444}
    table{border-collapse:collapse;width:100%;margin-top:14px} th,td{border:1px solid #999;padding:4px 6px;text-align:left} th{background:#f2f2f2} .n{text-align:right} tr.t td{font-weight:700}
    @media print{body{margin:0}}</style></head><body>
    <h1>${escapeHtml(businessName || '')}</h1><p><b>Statement of account: ${escapeHtml(d.party.name)}</b></p>
    <p>${[d.party.phone, d.party.gstin && 'GSTIN ' + d.party.gstin].filter(Boolean).map(escapeHtml).join(' | ')}</p><p>${escapeHtml(period.from)} to ${escapeHtml(period.to)}</p>
    <table><thead><tr><th>Date</th><th>Type</th><th>Number</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead><tbody>
    <tr class="t"><td colspan="5">Opening balance</td><td class="n">${money(d.opening_balance)}</td></tr>${rows}
    <tr class="t"><td colspan="5">Closing balance</td><td class="n">${money(d.closing_balance)}</td></tr></tbody></table></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html); w.document.close(); w.focus(); w.print();
};

/* One customer's or supplier's statement with a running balance. The parties offered are those with bills in the books. */
const PartyStatementReport = ({ period }) => {
  const tr = useT();
  const { business } = useAuth();
  const [remindError, setRemindError] = useState('');
  const [kind, setKind] = useState('customer');
  const [id, setId] = useState('');
  const parties = useLedger(`/reports/by-party?kind=${kind === 'customer' ? 'sales' : 'purchases'}&from=2000-01-01&to=${localISO()}`);
  const list = (parties.data?.rows || []).filter((r) => r.party_id);
  const stmt = useLedger(id ? `/reports/party-statement?kind=${kind}&id=${id}&from=${period.from}&to=${period.to}` : '/reports/by-party?kind=sales&from=2000-01-01&to=2000-01-02');
  const d = id ? stmt.data : null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {[['customer', tr('Customer')], ['supplier', tr('Supplier')]].map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setId(''); }}
                  className={`rounded-md border px-3 py-1.5 text-small font-medium ${kind === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-500 hover:text-ink-900'}`}>{label}</button>
        ))}
        <select aria-label={tr('Choose a party')} value={id} onChange={(e) => setId(e.target.value)} className="h-10 min-w-56 rounded-lg border border-line bg-surface px-2 text-small">
          <option value="">{tr('Choose a party')}</option>
          {list.map((p) => <option key={p.party_id} value={p.party_id}>{p.name}</option>)}
        </select>
      </div>
      {!id ? <p className="text-small text-ink-500">{tr('Choose a party')}</p> : <>
        <Alert>{stmt.error}</Alert>
        {!d ? <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" /> : <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label={tr('Opening balance')} value={formatCurrency(d.opening_balance)} />
            <Tile label={kind === 'customer' ? tr('Sales') : tr('Purchases')} value={formatCurrency(kind === 'customer' ? d.total_debit : d.total_credit)} />
            <Tile label={tr('Closing balance')} value={formatCurrency(d.closing_balance)} />
          </div>
          <Section title={d.party.name} action={<div className="flex flex-wrap items-center gap-2">
            {kind === 'customer' && d.closing_balance > 0 && <button type="button" onClick={() => { setRemindError(''); remindOnWhatsApp(id).catch((e) => setRemindError(e.message)); }} className="inline-flex h-8 items-center rounded-lg border border-line px-2.5 text-caption font-semibold text-ink-700 hover:border-brand-500 hover:text-brand-700">{tr('Remind on WhatsApp')}</button>}
            <button type="button" onClick={() => printStatement(d, period, business?.name)} className="inline-flex h-8 items-center rounded-lg border border-line px-2.5 text-caption font-semibold text-ink-700 hover:border-brand-500 hover:text-brand-700">{tr('Print / PDF')}</button>
            <CsvButton name={`statement-${d.party.name.replace(/\W+/g, '-')}-${period.from}-to-${period.to}`} head={['Date', 'Type', 'Number', 'Debit', 'Credit', 'Balance']} rows={d.lines.map((l) => [l.date, l.type, l.number, l.debit, l.credit, l.balance])} />
          </div>}>
            {remindError && <div className="mb-3"><Alert>{remindError}</Alert></div>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-small">
                <thead><tr className="border-b border-line"><th className={TH}>{tr('Date')}</th><th className={TH}>{tr('Type')}</th><th className={TH}>{tr('Number')}</th><th className={`${TH} text-right`}>{tr('Debit')}</th><th className={`${TH} text-right`}>{tr('Credit')}</th><th className={`${TH} text-right`}>{tr('Balance')}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  <tr className="text-ink-500"><td className="px-2 py-2" colSpan={5}>{tr('Opening balance')}</td><td className="tabular px-2 py-2 text-right">{formatCurrency(d.opening_balance)}</td></tr>
                  {d.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="tabular whitespace-nowrap px-2 py-2 text-ink-500">{fmtDay(l.date)}</td><td className="px-2 py-2">{l.type}</td><td className="px-2 py-2">{l.number}</td>
                      <td className="tabular px-2 py-2 text-right">{l.debit ? formatCurrency(l.debit) : ''}</td><td className="tabular px-2 py-2 text-right">{l.credit ? formatCurrency(l.credit) : ''}</td>
                      <td className="tabular px-2 py-2 text-right font-medium text-ink-900">{formatCurrency(l.balance)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold"><td className="px-2 py-2" colSpan={5}>{tr('Closing balance')}</td><td className="tabular px-2 py-2 text-right">{formatCurrency(d.closing_balance)}</td></tr>
                </tbody>
              </table>
            </div>
          </Section>
        </>}
      </>}
    </div>
  );
};

/* Sales or purchases grouped by party: bills, total, paid, still due. */
const ByPartyReport = ({ d, period }) => {
  const tr = useT();
  const sales = d.kind === 'sales';
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label={sales ? tr('Sales') : tr('Purchases')} value={formatCurrency(d.totals.total)} note={`${d.totals.docs} ${tr('Bills')}`} />
        <Tile label={tr('Paid')} value={formatCurrency(d.totals.paid)} />
        <Tile label={tr('Balance')} value={formatCurrency(d.totals.balance)} />
      </div>
      <Section title={sales ? tr('Sales by party') : tr('Purchases by party')} action={<CsvButton name={`${d.kind}-by-party-${period.from}-to-${period.to}`} head={['Party', 'Bills', 'Total', 'Paid', 'Balance', 'Last']} rows={d.rows.map((r) => [r.name, r.docs, r.total, r.paid, r.balance, r.last_date])} />}>
        {d.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-small">
              <thead><tr className="border-b border-line"><th className={TH}>{tr('Party')}</th><th className={`${TH} text-right`}>{tr('Bills')}</th><th className={`${TH} text-right`}>{tr('Total')}</th><th className={`${TH} text-right`}>{tr('Paid')}</th><th className={`${TH} text-right`}>{tr('Balance')}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.rows.map((r) => (
                  <tr key={r.party_id ?? r.name}>
                    <td className="px-2 py-2 text-ink-900">{r.name}</td><td className="tabular px-2 py-2 text-right text-ink-500">{r.docs}</td>
                    <td className="tabular px-2 py-2 text-right font-medium text-ink-900">{formatCurrency(r.total)}</td><td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.paid)}</td>
                    <td className={`tabular px-2 py-2 text-right ${r.balance > 0 ? 'font-semibold text-warning' : 'text-ink-500'}`}>{r.balance > 0 ? formatCurrency(r.balance) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
      </Section>
    </div>
  );
};

/* ── Profit reports: Profit & Loss, profit by bill / item / party, discounts (profitReports.controller.js) ── */

const marginText = (m) => (m == null ? '' : `${m}%`);
const PROFIT_COLS = {
  bills: { title: T('Bill-wise profit'), first: T('Number'), cell: (r) => (r.invoice_id ? <Link to={`/app/billing/invoices/${r.invoice_id}`} className="text-brand-700 hover:underline">{r.number}</Link> : r.number), sub: (r) => `${fmtDay(r.date)} · ${r.party}` },
  items: { title: T('Item-wise profit'), first: T('Item'), cell: (r) => r.name, sub: (r) => `× ${r.quantity}` },
  parties: { title: T('Party-wise profit'), first: T('Party'), cell: (r) => r.name, sub: (r) => `${r.bills} ×` }
};

/* profit by bill, item or party: one row each, sales (ex-tax), cost, profit and margin */
const ProfitListReport = ({ d, period, kind }) => {
  const tr = useT();
  const col = PROFIT_COLS[kind];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={tr('Sales')} value={formatCurrency(d.totals.sales)} note={tr('Without tax')} />
        <Tile label={tr('Cost')} value={formatCurrency(d.totals.cost)} />
        <Tile label={tr('Profit')} value={formatCurrency(d.totals.profit)} />
        <Tile label={tr('Margin')} value={marginText(d.totals.margin_pct) || '–'} />
      </div>
      {d.totals.uncosted_bills > 0 && <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-small text-warning">{tr('Bills with no cost on record, so their profit is shown too high.')} ({d.totals.uncosted_bills})</p>}
      <Section title={tr(col.title)} action={<CsvButton name={`profit-${kind}-${period.from}-to-${period.to}`} head={['Name', 'Sales', 'Cost', 'Profit', 'Margin %']} rows={d.rows.map((r) => [r.number || r.name, r.sales, r.cost, r.profit, r.margin_pct])} />}>
        {d.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-small">
              <thead><tr className="border-b border-line"><th className={TH}>{tr(col.first)}</th><th className={`${TH} text-right`}>{tr('Sales')}</th><th className={`${TH} text-right`}>{tr('Cost')}</th><th className={`${TH} text-right`}>{tr('Profit')}</th><th className={`${TH} text-right`}>{tr('Margin')}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.rows.map((r) => (
                  <tr key={r.invoice_id ?? r.product_id ?? r.party_id ?? r.name}>
                    <td className="px-2 py-2"><span className="block text-ink-900">{col.cell(r)}{r.uncosted > 0 ? <span className="ml-1.5 rounded bg-warning/15 px-1.5 py-0.5 text-caption text-warning">!</span> : null}</span><span className="block text-caption text-ink-500">{col.sub(r)}</span></td>
                    <td className="tabular px-2 py-2 text-right text-ink-700">{formatCurrency(r.sales)}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.cost)}</td>
                    <td className={`tabular px-2 py-2 text-right font-semibold ${r.profit < 0 ? 'text-danger' : 'text-ink-900'}`}>{formatCurrency(r.profit)}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-500">{marginText(r.margin_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
      </Section>
    </div>
  );
};

/* Profit & Loss: the period as a statement */
const ProfitLossReport = ({ d, period }) => {
  const tr = useT();
  const line = (label, value, { strong, minus, tone } = {}) => (
    <tr className={strong ? 'border-t border-line font-semibold' : ''}>
      <td className={`px-2 py-2 ${strong ? 'text-ink-900' : 'text-ink-700'}`}>{label}</td>
      <td className={`tabular px-2 py-2 text-right ${tone || (strong ? 'text-ink-900' : 'text-ink-700')}`}>{minus ? '− ' : ''}{formatCurrency(Math.abs(value))}</td>
    </tr>
  );
  const rows = [
    [tr('Gross sales'), d.gross_sales], [tr('Discounts'), d.discounts, { minus: true }], [tr('Returns'), d.returns, { minus: true }],
    [tr('Net sales'), d.net_sales, { strong: true }], [tr('Cost of goods'), d.cost_of_goods, { minus: true }],
    [tr('Gross profit'), d.gross_profit, { strong: true, tone: d.gross_profit < 0 ? 'text-danger' : undefined }]
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label={tr('Net sales')} value={formatCurrency(d.net_sales)} note={tr('Without tax')} />
        <Tile label={tr('Gross profit')} value={formatCurrency(d.gross_profit)} note={marginText(d.gross_margin_pct)} />
        <Tile label={tr('Net profit')} value={formatCurrency(d.net_profit)} note={marginText(d.net_margin_pct)} />
      </div>
      {d.uncosted_bills > 0 && <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-small text-warning">{tr('Bills with no cost on record, so their profit is shown too high.')} ({d.uncosted_bills})</p>}
      <Section title={tr('Profit & Loss')} action={<CsvButton name={`profit-and-loss-${period.from}-to-${period.to}`} head={['Line', 'Amount']}
        rows={[['Gross sales', d.gross_sales], ['Discounts', d.discounts], ['Returns', d.returns], ['Net sales', d.net_sales], ['Cost of goods', d.cost_of_goods], ['Gross profit', d.gross_profit], ...d.expenses.map((e) => [e.category, e.amount]), ['Total expenses', d.total_expenses], ...d.other_income.map((e) => [e.category, e.amount]), ['Total other income', d.total_other_income], ['Net profit', d.net_profit]]} />}>
        <table className="w-full text-small">
          <tbody>
            {rows.map(([label, value, o]) => <Fragment key={label}>{line(label, value, o)}</Fragment>)}
            {d.expenses.map((e) => <Fragment key={e.category}>{line(e.category, e.amount, { minus: true })}</Fragment>)}
            {line(tr('Total expenses'), d.total_expenses, { minus: true })}
            {d.other_income.map((e) => <Fragment key={`oi-${e.category}`}>{line(e.category, e.amount)}</Fragment>)}
            {d.total_other_income > 0 && line(tr('Total other income'), d.total_other_income)}
            {line(tr('Net profit'), d.net_profit, { strong: true, tone: d.net_profit < 0 ? 'text-danger' : 'text-success' })}
          </tbody>
        </table>
      </Section>
    </div>
  );
};

/* Discounts given, bill by bill */
const DiscountReport = ({ d, period }) => {
  const tr = useT();
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label={tr('Discounts')} value={formatCurrency(d.totals.discount)} note={`${d.totals.bills} ${tr('Bills')}`} />
        <Tile label={tr('Line discounts')} value={formatCurrency(d.totals.line_discount)} />
        <Tile label={`${tr('Discount')} %`} value={marginText(d.totals.pct) || '–'} note={tr('of the goods sold')} />
      </div>
      <Section title={tr('Discount report')} action={<CsvButton name={`discounts-${period.from}-to-${period.to}`} head={['Bill', 'Date', 'Party', 'Goods', 'Line discount', 'Bill discount', 'Total', '%']} rows={d.rows.map((r) => [r.number, r.date, r.party, r.gross, r.line_discount, r.bill_discount, r.discount, r.pct])} />}>
        {d.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-small">
              <thead><tr className="border-b border-line"><th className={TH}>{tr('Number')}</th><th className={TH}>{tr('Party')}</th><th className={`${TH} text-right`}>{tr('Gross')}</th><th className={`${TH} text-right`}>{tr('Discount')}</th><th className={`${TH} text-right`}>%</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.rows.map((r) => (
                  <tr key={r.invoice_id}>
                    <td className="px-2 py-2"><Link to={`/app/billing/invoices/${r.invoice_id}`} className="text-brand-700 hover:underline">{r.number}</Link><span className="block text-caption text-ink-500">{fmtDay(r.date)}</span></td>
                    <td className="px-2 py-2 text-ink-700">{r.party}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.gross)}</td>
                    <td className="tabular px-2 py-2 text-right font-medium text-ink-900">{formatCurrency(r.discount)}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-500">{marginText(r.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
      </Section>
    </div>
  );
};

/* ── GST reports: summary by HSN / SAC, by rate, and the purchase register (gstReports.controller.js) ── */

const TAX_HEAD = ['CGST', 'SGST', 'IGST'];

/* Sale (or purchase) summary by HSN, and the SAC report: the same list, goods or service codes */
const GstSummaryReport = ({ period, by }) => {
  const tr = useT();
  const [kind, setKind] = useState('sales');
  const { data: d, error } = useLedger(`/reports/gst/summary?by=${by}&kind=${kind}&from=${period.from}&to=${period.to}`);
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {[['sales', tr('Sales')], ['purchases', tr('Purchases')]].map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                  className={`rounded-md border px-3 py-1.5 text-small font-medium ${kind === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-500 hover:text-ink-900'}`}>{label}</button>
        ))}
      </div>
      <Alert>{error}</Alert>
      {!d ? <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" /> : <>
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label={tr('Taxable value')} value={formatCurrency(d.totals.taxable)} />
          <Tile label={tr('Total tax')} value={formatCurrency(d.totals.tax)} />
          <Tile label={tr('Total')} value={formatCurrency(d.totals.total)} />
        </div>
        {d.missing_code > 0 && by === 'hsn' && <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-small text-warning">{tr('Some items have no HSN/SAC code. Add it on the product.')} ({d.missing_code})</p>}
        <Section title={by === 'sac' ? tr('SAC report') : tr('Sale summary by HSN')} action={<CsvButton name={`gst-${by}-${kind}-${period.from}-to-${period.to}`} head={['HSN/SAC', 'Rate %', 'Quantity', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total tax', 'Total']} rows={d.rows.map((r) => [r.code, r.rate, r.qty, r.taxable, r.cgst, r.sgst, r.igst, r.tax, r.total])} />}>
          {d.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-small">
                <thead><tr className="border-b border-line"><th className={TH}>{tr('HSN / SAC')}</th><th className={`${TH} text-right`}>{tr('Rate')}</th><th className={`${TH} text-right`}>{tr('Quantity')}</th><th className={`${TH} text-right`}>{tr('Taxable value')}</th>{TAX_HEAD.map((h) => <th key={h} className={`${TH} text-right`}>{h}</th>)}<th className={`${TH} text-right`}>{tr('Total')}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {d.rows.map((r) => (
                    <tr key={`${r.code}|${r.rate}`}>
                      <td className="px-2 py-2 text-ink-900">{r.code || '–'}</td><td className="tabular px-2 py-2 text-right text-ink-500">{r.rate}%</td><td className="tabular px-2 py-2 text-right text-ink-500">{r.qty}</td>
                      <td className="tabular px-2 py-2 text-right text-ink-700">{formatCurrency(r.taxable)}</td>
                      <td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.cgst)}</td><td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.sgst)}</td><td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.igst)}</td>
                      <td className="tabular px-2 py-2 text-right font-medium text-ink-900">{formatCurrency(r.total)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold"><td className="px-2 py-2" colSpan={3}>{tr('Total')}</td><td className="tabular px-2 py-2 text-right">{formatCurrency(d.totals.taxable)}</td><td className="tabular px-2 py-2 text-right">{formatCurrency(d.totals.cgst)}</td><td className="tabular px-2 py-2 text-right">{formatCurrency(d.totals.sgst)}</td><td className="tabular px-2 py-2 text-right">{formatCurrency(d.totals.igst)}</td><td className="tabular px-2 py-2 text-right">{formatCurrency(d.totals.total)}</td></tr>
                </tbody>
              </table>
            </div>
          ) : <p className="text-small text-ink-500">{by === 'sac' ? tr('No service codes (SAC) in this period.') : tr('Nothing found for this period.')}</p>}
        </Section>
      </>}
    </div>
  );
};

/* Output tax against input tax, by rate */
const GstRatesReport = ({ d, period }) => {
  const tr = useT();
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label={tr('Output tax')} value={formatCurrency(d.totals.output_tax)} note={tr('Sales')} />
        <Tile label={tr('Input tax')} value={formatCurrency(d.totals.input_tax)} note={tr('Purchases')} />
        <Tile label={tr('Net tax to pay')} value={formatCurrency(d.totals.net_tax)} />
      </div>
      <Section title={tr('GST rate report')} action={<CsvButton name={`gst-rates-${period.from}-to-${period.to}`} head={['Rate %', 'Sales taxable', 'Output tax', 'Purchases taxable', 'Input tax', 'Net tax']} rows={d.rows.map((r) => [r.rate, r.sales_taxable, r.output_tax, r.purchase_taxable, r.input_tax, r.net_tax])} />}>
        {d.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-small">
              <thead><tr className="border-b border-line"><th className={TH}>{tr('Rate')}</th><th className={`${TH} text-right`}>{tr('Sales')}</th><th className={`${TH} text-right`}>{tr('Output tax')}</th><th className={`${TH} text-right`}>{tr('Purchases')}</th><th className={`${TH} text-right`}>{tr('Input tax')}</th><th className={`${TH} text-right`}>{tr('Net tax to pay')}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.rows.map((r) => (
                  <tr key={r.rate}>
                    <td className="px-2 py-2 font-medium text-ink-900">{r.rate}%</td>
                    <td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.sales_taxable)}</td><td className="tabular px-2 py-2 text-right text-ink-700">{formatCurrency(r.output_tax)}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.purchase_taxable)}</td><td className="tabular px-2 py-2 text-right text-ink-700">{formatCurrency(r.input_tax)}</td>
                    <td className="tabular px-2 py-2 text-right font-semibold text-ink-900">{formatCurrency(r.net_tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
      </Section>
    </div>
  );
};

/* Cess, TCS, TDS, reverse charge and composite tax: one row per bill that carries any of them (gstReports.controller.js options). Statutory words stay in English. */
const GstOptionsReport = ({ d, period }) => {
  const tr = useT();
  return (
  <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile label={tr('Cess charged')} value={formatCurrency(d.totals.cess)} />
      <Tile label={tr('TCS collected')} value={formatCurrency(d.totals.tcs)} />
      <Tile label={tr('TDS held back by customers')} value={formatCurrency(d.totals.tds)} />
      <Tile label={tr('Reverse charge bills')} value={d.totals.reverse_charge_bills} note={formatCurrency(d.totals.reverse_charge_value)} />
      <Tile label={tr('Composite turnover')} value={formatCurrency(d.totals.composite_turnover)} note={tr('Bills of supply')} />
      <Tile label={tr('Composite tax payable ({{rate}}%)', { rate: d.totals.composite_rate })} value={formatCurrency(d.totals.composite_tax)} />
    </div>
    <Section title={tr('Bills with these')} action={<CsvButton name={`gst-options-${period.from}-to-${period.to}`} head={['Date', 'Bill', 'Party', 'GSTIN', 'Taxable', 'Cess', 'TCS', 'TDS', 'Reverse charge', 'Bill of Supply', 'Total']} rows={d.rows.map((r) => [r.date, r.number, r.party, r.gstin, r.taxable, r.cess, r.tcs, r.tds, r.reverse_charge ? 'Yes' : '', r.bill_of_supply ? 'Yes' : '', r.total])} />}>
      {d.rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-small">
            <thead><tr className="border-b border-line"><th className={TH}>{tr('Date')}</th><th className={TH}>{tr('Bill')}</th><th className={TH}>{tr('Party')}</th><th className={`${TH} text-right`}>{tr('Taxable')}</th><th className={`${TH} text-right`}>{tr('Cess')}</th><th className={`${TH} text-right`}>TCS</th><th className={`${TH} text-right`}>TDS</th><th className={TH}>{tr('Notes')}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {d.rows.map((r) => (
                <tr key={r.invoice_id}>
                  <td className="px-2 py-2 text-ink-500">{fmtDay(r.date)}</td><td className="px-2 py-2 font-medium text-ink-900">{r.number}</td><td className="px-2 py-2 text-ink-700">{r.party}</td>
                  <td className="tabular px-2 py-2 text-right text-ink-700">{formatCurrency(r.taxable)}</td><td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.cess)}</td>
                  <td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.tcs)}</td><td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.tds)}</td>
                  <td className="px-2 py-2 text-caption text-ink-500">{[r.reverse_charge && tr('Reverse charge'), r.bill_of_supply && tr('Bill of supply')].filter(Boolean).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-small text-ink-500">{tr('No bills carried cess, TCS, TDS, reverse charge or composite supply in this period. Switch these on in Settings → Business → GST options.')}</p>}
    </Section>
  </div>
  );
};

/* GSTR-2 style purchase register: each supplier bill by rate, with the supplier's GSTIN */
const Gstr2Report = ({ d, period }) => {
  const tr = useT();
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label={tr('Purchases')} value={formatCurrency(d.totals.taxable)} note={`${d.totals.bills} ${tr('Bills')}`} />
        <Tile label={tr('Input tax')} value={formatCurrency(d.totals.tax)} />
        <Tile label={tr('Claimable input tax')} value={formatCurrency(d.totals.claimable_tax)} note={d.totals.unregistered_tax > 0 ? `${tr('Unregistered suppliers (no input credit)')}: ${formatCurrency(d.totals.unregistered_tax)}` : null} />
      </div>
      <Section title={tr('GSTR-2 (purchases)')} action={<CsvButton name={`gstr2-${period.from}-to-${period.to}`} head={['Date', 'Our no.', 'Supplier bill', 'Supplier', 'GSTIN', 'Rate %', 'Taxable', 'CGST', 'SGST', 'IGST']} rows={d.rows.map((r) => [r.date, r.number, r.bill_no, r.party, r.gstin, r.rate, r.taxable, r.cgst, r.sgst, r.igst])} />}>
        {d.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-small">
              <thead><tr className="border-b border-line"><th className={TH}>{tr('Date')}</th><th className={TH}>{tr('Supplier')}</th><th className={TH}>{tr('Supplier GSTIN')}</th><th className={`${TH} text-right`}>{tr('Rate')}</th><th className={`${TH} text-right`}>{tr('Taxable value')}</th>{TAX_HEAD.map((h) => <th key={h} className={`${TH} text-right`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {d.rows.map((r) => (
                  <tr key={`${r.doc_id}|${r.rate}`}>
                    <td className="tabular whitespace-nowrap px-2 py-2 text-ink-500">{fmtDay(r.date)}</td>
                    <td className="px-2 py-2"><span className="block text-ink-900">{r.party}</span><span className="block text-caption text-ink-500">{r.bill_no || r.number}</span></td>
                    <td className={`px-2 py-2 ${r.gstin ? 'text-ink-700' : 'text-warning'}`}>{r.gstin || '–'}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-500">{r.rate}%</td>
                    <td className="tabular px-2 py-2 text-right text-ink-700">{formatCurrency(r.taxable)}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.cgst)}</td><td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.sgst)}</td><td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.igst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
      </Section>
    </div>
  );
};

/* ── Stock reports: summary by category, low stock, item detail, stock detail, sales / purchases by category (stockReports.controller.js) ── */

const qtyFmt = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });

const StockSummaryReport = ({ d }) => {
  const tr = useT();
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={tr('Items')} value={d.totals.items} note={d.totals.low > 0 ? `${d.totals.low} ${tr('Low')}` : null} />
        <Tile label={tr('Quantity')} value={qtyFmt(d.totals.qty)} />
        <Tile label={tr('Cost value')} value={formatCurrency(d.totals.cost_value)} />
        <Tile label={tr('Selling value')} value={formatCurrency(d.totals.sell_value)} />
      </div>
      <Section title={tr('Stock summary')} action={<CsvButton name={`stock-summary-${localISO()}`} head={['Category', 'Items', 'Quantity', 'Cost value', 'Selling value', 'Low']} rows={d.rows.map((r) => [r.category, r.items, r.qty, r.cost_value, r.sell_value, r.low])} />}>
        {d.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-small">
              <thead><tr className="border-b border-line"><th className={TH}>{tr('Category')}</th><th className={`${TH} text-right`}>{tr('Items')}</th><th className={`${TH} text-right`}>{tr('Quantity')}</th><th className={`${TH} text-right`}>{tr('Cost value')}</th><th className={`${TH} text-right`}>{tr('Selling value')}</th><th className={`${TH} text-right`}>{tr('Low')}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.rows.map((r) => (
                  <tr key={r.category}>
                    <td className="px-2 py-2 text-ink-900">{r.category}</td><td className="tabular px-2 py-2 text-right text-ink-500">{r.items}</td><td className="tabular px-2 py-2 text-right text-ink-700">{qtyFmt(r.qty)}</td>
                    <td className="tabular px-2 py-2 text-right font-medium text-ink-900">{formatCurrency(r.cost_value)}</td><td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.sell_value)}</td>
                    <td className={`tabular px-2 py-2 text-right ${r.low ? 'font-semibold text-warning' : 'text-ink-500'}`}>{r.low || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
      </Section>
    </div>
  );
};

const LowStockReport = ({ d }) => {
  const tr = useT();
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label={tr('Low')} value={d.totals.items} />
        <Tile label={tr('Out of stock')} value={d.totals.out_of_stock} />
        <Tile label={tr('Refill cost')} value={formatCurrency(d.totals.refill_cost)} />
      </div>
      <Section title={tr('Low stock')} action={<CsvButton name={`low-stock-${localISO()}`} head={['Item', 'Category', 'Supplier', 'In stock', 'Warns below', 'Short by', 'Refill cost']} rows={d.rows.map((r) => [r.name, r.category, r.supplier, r.qty, r.min_stock, r.short, r.refill_cost])} />}>
        {d.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-small">
              <thead><tr className="border-b border-line"><th className={TH}>{tr('Item')}</th><th className={TH}>{tr('Supplier')}</th><th className={`${TH} text-right`}>{tr('In stock')}</th><th className={`${TH} text-right`}>{tr('Warns below')}</th><th className={`${TH} text-right`}>{tr('Short by')}</th><th className={`${TH} text-right`}>{tr('Refill cost')}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.rows.map((r) => (
                  <tr key={r.product_id}>
                    <td className="px-2 py-2"><Link to={`/app/inventory?item=${r.product_id}`} className="text-ink-900 hover:text-brand-700">{r.name}</Link><span className="block text-caption text-ink-500">{r.category}</span></td>
                    <td className="px-2 py-2 text-ink-500">{r.supplier || ''}</td>
                    <td className={`tabular px-2 py-2 text-right font-semibold ${r.out_of_stock ? 'text-danger' : 'text-warning'}`}>{qtyFmt(r.qty)}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-500">{qtyFmt(r.min_stock)}</td><td className="tabular px-2 py-2 text-right text-ink-700">{qtyFmt(r.short)}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-700">{formatCurrency(r.refill_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-small text-ink-500">{tr('Nothing is running low.')}</p>}
      </Section>
    </div>
  );
};

/* Item detail: the period per item, opening to closing */
const ItemDetailReport = ({ d, period }) => {
  const tr = useT();
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label={tr('Bought')} value={qtyFmt(d.totals.bought)} />
        <Tile label={tr('Sold')} value={qtyFmt(d.totals.sold)} />
        <Tile label={tr('Cost value')} value={formatCurrency(d.totals.value)} note={tr('Closing')} />
      </div>
      <Section title={tr('Item detail')} action={<CsvButton name={`item-detail-${period.from}-to-${period.to}`} head={['Item', 'Category', 'Opening', 'Bought', 'Sold', 'Returned', 'Adjusted', 'Closing', 'Value']} rows={d.rows.map((r) => [r.name, r.category, r.opening, r.bought, r.sold, r.returned, r.adjusted, r.closing, r.value])} />}>
        {d.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-small">
              <thead><tr className="border-b border-line"><th className={TH}>{tr('Item')}</th>{['Opening', 'Bought', 'Sold', 'Returned', T('Adjusted'), 'Closing', 'Value'].map((h) => <th key={h} className={`${TH} text-right`}>{tr(h)}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {d.rows.map((r) => (
                  <tr key={r.product_id}>
                    <td className="px-2 py-2"><span className="block text-ink-900">{r.name}</span><span className="block text-caption text-ink-500">{r.category}</span></td>
                    {[r.opening, r.bought, r.sold, r.returned, r.adjusted].map((v, i) => <td key={i} className="tabular px-2 py-2 text-right text-ink-500">{v ? qtyFmt(v) : ''}</td>)}
                    <td className="tabular px-2 py-2 text-right font-semibold text-ink-900">{qtyFmt(r.closing)}</td><td className="tabular px-2 py-2 text-right text-ink-700">{formatCurrency(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
      </Section>
    </div>
  );
};

/* Stock detail: one item, movement by movement */
const StockLedgerReport = ({ period }) => {
  const tr = useT();
  const [id, setId] = useState('');
  const items = useLedger(`/reports/stock/items?from=2000-01-01&to=${localISO()}`);
  const led = useLedger(id ? `/reports/stock/ledger?product_id=${id}&from=${period.from}&to=${period.to}` : '/reports/stock/low');
  const d = id ? led.data : null;
  return (
    <div className="space-y-5">
      <select aria-label={tr('Choose an item')} value={id} onChange={(e) => setId(e.target.value)} className="h-10 min-w-64 rounded-lg border border-line bg-surface px-2 text-small">
        <option value="">{tr('Choose an item')}</option>
        {(items.data?.rows || []).map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
      </select>
      {!id ? null : <>
        <Alert>{led.error}</Alert>
        {!d ? <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" /> : <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Tile label={tr('Opening')} value={`${qtyFmt(d.opening)} ${d.product.unit || ''}`} />
            <Tile label={tr('Closing')} value={`${qtyFmt(d.closing)} ${d.product.unit || ''}`} />
          </div>
          <Section title={d.product.name} action={<CsvButton name={`stock-detail-${d.product.name.replace(/\W+/g, '-')}-${period.from}-to-${period.to}`} head={['Date', 'Type', 'Quantity', 'Reference', 'Balance']} rows={d.lines.map((l) => [l.date, l.type, l.quantity, l.reference, l.balance])} />}>
            {d.lines.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-small">
                  <thead><tr className="border-b border-line"><th className={TH}>{tr('Date')}</th><th className={TH}>{tr('Type')}</th><th className={`${TH} text-right`}>{tr('Quantity')}</th><th className={TH}>{tr('Number')}</th><th className={`${TH} text-right`}>{tr('Balance')}</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {d.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="tabular whitespace-nowrap px-2 py-2 text-ink-500">{fmtDay(l.date)}</td><td className="px-2 py-2 text-ink-900">{l.type}</td>
                        <td className={`tabular px-2 py-2 text-right font-medium ${l.quantity < 0 ? 'text-warning' : 'text-success'}`}>{l.quantity > 0 ? '+' : ''}{qtyFmt(l.quantity)}</td>
                        <td className="px-2 py-2 text-ink-500">{l.reference}</td><td className="tabular px-2 py-2 text-right font-semibold text-ink-900">{qtyFmt(l.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
          </Section>
        </>}
      </>}
    </div>
  );
};

/* Sales or purchases by item category, without tax */
const CategorySalesReport = ({ period }) => {
  const tr = useT();
  const [kind, setKind] = useState('sales');
  const { data: d, error } = useLedger(`/reports/category-sales?kind=${kind}&from=${period.from}&to=${period.to}`);
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {[['sales', tr('Sales')], ['purchases', tr('Purchases')]].map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                  className={`rounded-md border px-3 py-1.5 text-small font-medium ${kind === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-500 hover:text-ink-900'}`}>{label}</button>
        ))}
      </div>
      <Alert>{error}</Alert>
      {!d ? <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" /> : <>
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label={tr('Quantity')} value={qtyFmt(d.totals.qty)} />
          <Tile label={tr('Taxable value')} value={formatCurrency(d.totals.taxable)} note={tr('Without tax')} />
          <Tile label={tr('Total')} value={formatCurrency(d.totals.total)} />
        </div>
        <Section title={tr('Sales and purchases by category')} action={<CsvButton name={`${kind}-by-category-${period.from}-to-${period.to}`} head={['Category', 'Quantity', 'Taxable', 'Tax', 'Total']} rows={d.rows.map((r) => [r.category, r.qty, r.taxable, r.tax, r.total])} />}>
          {d.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-small">
                <thead><tr className="border-b border-line"><th className={TH}>{tr('Category')}</th><th className={`${TH} text-right`}>{tr('Quantity')}</th><th className={`${TH} text-right`}>{tr('Taxable value')}</th><th className={`${TH} text-right`}>{tr('Tax')}</th><th className={`${TH} text-right`}>{tr('Total')}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {d.rows.map((r) => (
                    <tr key={r.category}>
                      <td className="px-2 py-2 text-ink-900">{r.category}</td><td className="tabular px-2 py-2 text-right text-ink-500">{qtyFmt(r.qty)}</td>
                      <td className="tabular px-2 py-2 text-right text-ink-700">{formatCurrency(r.taxable)}</td><td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.tax)}</td>
                      <td className="tabular px-2 py-2 text-right font-medium text-ink-900">{formatCurrency(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
        </Section>
      </>}
    </div>
  );
};

/* ── Ask your reports: a question in plain words, answered by Flow AI from the same reports (modules/ai/reportTools.js) ── */

const ASK_EXAMPLES = [T('What was my profit this month?'), T('Which items lose money?'), T('How much GST do I owe?'), T('What should I reorder?')];

const AskReports = () => {
  const tr = useT();
  const [status, setStatus] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);   // { question, text } while shown
  const [error, setError] = useState('');
  useEffect(() => { api('/ai/status').then(setStatus).catch(() => setStatus(null)); }, []);
  if (!status?.can_ask) return null;   // Flow AI off, not set up, or out of questions: the reports stand alone

  const ask = async (q) => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true); setError(''); setAnswer(null);
    try {
      const r = await api('/ai/chat', { method: 'POST', body: { message: question } });
      setAnswer({ question, text: r.answer });
      setText('');
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <section aria-label={tr('Ask your reports')} className="mb-6 rounded-(--radius-card) border border-line bg-surface p-4">
      <form onSubmit={(e) => { e.preventDefault(); void ask(text); }} className="flex flex-wrap items-center gap-2">
        <Input aria-label={tr('Ask your reports')} placeholder={tr('Ask your reports')} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} className="min-w-56 flex-1" />
        <Button type="submit" disabled={busy || !text.trim()}>{busy ? tr('Thinking…') : tr('Ask')}</Button>
      </form>
      {!answer && !busy && (
        <div className="mt-3 flex flex-wrap gap-2">
          {ASK_EXAMPLES.map((q) => <button key={q} type="button" onClick={() => void ask(tr(q))} className="rounded-full border border-line px-3 py-1 text-caption text-ink-700 hover:border-brand-500 hover:text-brand-700">{tr(q)}</button>)}
        </div>
      )}
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {answer && (
        <div className="mt-3 rounded-lg bg-surface-2 p-3 text-small text-ink-900">
          <p className="mb-1 text-caption font-semibold text-ink-500">{answer.question}</p>
          <p className="whitespace-pre-line">{answer.text}</p>
          <Link to="/app/ai" className="mt-2 inline-block text-caption font-medium text-brand-700">{tr('Open in Flow AI')}</Link>
        </div>
      )}
    </section>
  );
};

/* ── Expense reports: by category, by item, the list (expenseReports.controller.js) ── */

const changeText = (pct) => (pct == null ? '' : `${pct > 0 ? '+' : ''}${pct}%`);

/* where the money went: each category with its share, the change on the period before, and how it was paid */
const ExpenseCategoriesReport = ({ d, period }) => {
  const tr = useT();
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={tr('Expenses')} value={formatCurrency(d.totals.total)} note={`${d.totals.count} ${tr('Count')}`} />
        <Tile label={tr('Before')} value={formatCurrency(d.totals.previous)} note={d.totals.change_pct != null ? changeText(d.totals.change_pct) : null} />
        <Tile label={tr('Per day')} value={formatCurrency(d.totals.per_day)} />
        <Tile label={tr('How it was paid')} value={d.by_method[0] ? (METHOD[d.by_method[0].method] || d.by_method[0].method) : '–'} note={d.by_method[0] ? formatCurrency(d.by_method[0].amount) : null} />
      </div>
      <Section title={tr('Expense categories')} action={<CsvButton name={`expense-categories-${period.from}-to-${period.to}`} head={['Category', 'Count', 'Total', 'Share %', 'Average', 'Biggest', 'Before', 'Change %']} rows={d.rows.map((r) => [r.category, r.count, r.total, r.share_pct, r.average, r.biggest, r.previous, r.change_pct])} />}>
        {d.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-small">
              <thead><tr className="border-b border-line"><th className={TH}>{tr('Category')}</th><th className={`${TH} text-right`}>{tr('Count')}</th><th className={`${TH} text-right`}>{tr('Total')}</th><th className={`${TH} text-right`}>{tr('Share')}</th><th className={`${TH} text-right`}>{tr('Average')}</th><th className={`${TH} text-right`}>{tr('Biggest')}</th><th className={`${TH} text-right`}>{tr('Before')}</th><th className={`${TH} text-right`}>{tr('Change')}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.rows.map((r) => (
                  <tr key={r.category}>
                    <td className="px-2 py-2 text-ink-900">{r.category}</td><td className="tabular px-2 py-2 text-right text-ink-500">{r.count}</td>
                    <td className="tabular px-2 py-2 text-right font-medium text-ink-900">{formatCurrency(r.total)}</td><td className="tabular px-2 py-2 text-right text-ink-500">{r.share_pct}%</td>
                    <td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.average)}</td><td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.biggest)}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-500">{formatCurrency(r.previous)}</td>
                    <td className={`tabular px-2 py-2 text-right ${r.change_pct > 0 ? 'text-warning' : 'text-success'}`}>{changeText(r.change_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
      </Section>
      {d.by_method.length > 1 && (
        <Section title={tr('How it was paid')}>
          <Bars rows={d.by_method.map((m) => ({ key: m.method, label: METHOD[m.method] || m.method, value: m.amount }))} />
        </Section>
      )}
    </div>
  );
};

/* what the money was spent on: the same words grouped together, optionally inside one category */
const ExpenseItemsReport = ({ period }) => {
  const tr = useT();
  const [category, setCategory] = useState('');
  const cats = useLedger(`/reports/expense/categories?from=${period.from}&to=${period.to}`);
  const { data: d, error } = useLedger(`/reports/expense/items?from=${period.from}&to=${period.to}${category ? `&category=${encodeURIComponent(category)}` : ''}`);
  return (
    <div className="space-y-5">
      <select aria-label={tr('Category')} value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 rounded-lg border border-line bg-surface px-2 text-small">
        <option value="">{tr('All categories')}</option>
        {(cats.data?.rows || []).map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
      </select>
      <Alert>{error}</Alert>
      {!d ? <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" /> : <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile label={tr('Expenses')} value={formatCurrency(d.totals.total)} />
          <Tile label={tr('Items')} value={d.totals.items} />
        </div>
        <Section title={tr('Expense items')} action={<CsvButton name={`expense-items-${period.from}-to-${period.to}`} head={['Item', 'Category', 'Count', 'Total', 'Share %', 'Last']} rows={d.rows.map((r) => [r.name, r.category, r.count, r.total, r.share_pct, r.last_date])} />}>
          {d.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-small">
                <thead><tr className="border-b border-line"><th className={TH}>{tr('Item')}</th><th className={`${TH} text-right`}>{tr('Count')}</th><th className={`${TH} text-right`}>{tr('Total')}</th><th className={`${TH} text-right`}>{tr('Share')}</th><th className={`${TH} text-right`}>{tr('Date')}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {d.rows.map((r) => (
                    <tr key={r.name.toLowerCase()}>
                      <td className="px-2 py-2"><span className="block text-ink-900">{r.name}</span>{r.category && <span className="block text-caption text-ink-500">{r.category}</span>}</td>
                      <td className="tabular px-2 py-2 text-right text-ink-500">{r.count}</td><td className="tabular px-2 py-2 text-right font-medium text-ink-900">{formatCurrency(r.total)}</td>
                      <td className="tabular px-2 py-2 text-right text-ink-500">{r.share_pct}%</td><td className="tabular whitespace-nowrap px-2 py-2 text-right text-ink-500">{fmtDay(r.last_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
        </Section>
      </>}
    </div>
  );
};

/* every expense in the period, newest first, with a category filter and a search */
const ExpenseListReport = ({ period }) => {
  const tr = useT();
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const cats = useLedger(`/reports/expense/categories?from=${period.from}&to=${period.to}`);
  const { data: d, error } = useLedger(`/reports/expense/list?from=${period.from}&to=${period.to}${category ? `&category=${encodeURIComponent(category)}` : ''}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={tr('Category')} value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 rounded-lg border border-line bg-surface px-2 text-small">
          <option value="">{tr('All categories')}</option>
          {(cats.data?.rows || []).map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
        </select>
        <Input aria-label={tr('Search')} placeholder={tr('Search')} value={q} onChange={(e) => setQ(e.target.value)} className="!w-56" />
      </div>
      <Alert>{error}</Alert>
      {!d ? <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" /> : <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile label={tr('Expenses')} value={formatCurrency(d.totals.total)} />
          <Tile label={tr('Count')} value={d.totals.count} />
        </div>
        <Section title={tr('Expense list')} action={<CsvButton name={`expenses-${period.from}-to-${period.to}`} head={['Date', 'Category', 'Description', 'Method', 'Amount']} rows={d.rows.map((r) => [r.date, r.category, r.description, r.method, r.amount])} />}
                 note={d.truncated ? tr('Only the first 2,000 rows are shown. Narrow the dates.') : null}>
          {d.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-small">
                <thead><tr className="border-b border-line"><th className={TH}>{tr('Date')}</th><th className={TH}>{tr('Category')}</th><th className={TH}>{tr('Description')}</th><th className={TH}>{tr('Method')}</th><th className={`${TH} text-right`}>{tr('Amount')}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {d.rows.map((r) => (
                    <tr key={r.expense_id}>
                      <td className="tabular whitespace-nowrap px-2 py-2 text-ink-500">{fmtDay(r.date)}</td><td className="px-2 py-2 text-ink-900">{r.category}</td>
                      <td className="max-w-[18rem] truncate px-2 py-2 text-ink-700">{r.description}</td><td className="px-2 py-2 text-ink-500">{METHOD[r.method] || r.method}</td>
                      <td className="tabular px-2 py-2 text-right font-medium text-ink-900">{formatCurrency(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
        </Section>
      </>}
    </div>
  );
};

/* ── Party reports: all parties, and the party / item cross (partyReports.controller.js) ── */

const KindToggle = ({ kind, onChange }) => {
  const tr = useT();
  return (
    <div className="flex gap-2">
      {[['customers', tr('Customers')], ['suppliers', tr('Suppliers')]].map(([k, label]) => (
        <button key={k} type="button" aria-pressed={kind === k} onClick={() => onChange(k)}
                className={`rounded-md border px-3 py-1.5 text-small font-medium ${kind === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-500 hover:text-ink-900'}`}>{label}</button>
      ))}
    </div>
  );
};

/* every customer or supplier: bills and total in the period, what they owe now, the last bill, and the credit limit for customers */
const AllPartiesReport = ({ period }) => {
  const tr = useT();
  const [remindError, setRemindError] = useState('');
  const [kind, setKind] = useState('customers');
  const { data: d, error } = useLedger(`/reports/parties/all?kind=${kind}&from=${period.from}&to=${period.to}`);
  return (
    <div className="space-y-5">
      <KindToggle kind={kind} onChange={setKind} />
      <Alert>{error || remindError}</Alert>
      {!d ? <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" /> : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label={kind === 'customers' ? tr('Customers') : tr('Suppliers')} value={d.totals.parties} note={`${d.totals.active_in_period} ${tr('Bills')}`} />
          <Tile label={kind === 'customers' ? tr('Sales') : tr('Purchases')} value={formatCurrency(d.totals.total)} />
          <Tile label={kind === 'customers' ? tr('Owed to you') : tr('You owe')} value={formatCurrency(d.totals.due)} note={`${d.totals.owing} ${tr('Owing')}`} />
          {kind === 'customers' ? <Tile label={tr('Over limit')} value={d.totals.over_limit} /> : null}
        </div>
        <Section title={tr('All parties')} action={<CsvButton name={`all-${kind}-${period.to}`} head={['Name', 'Phone', 'GSTIN', 'Bills', 'Total', 'Due', 'Last bill', 'Credit limit']} rows={d.rows.map((r) => [r.name, r.phone, r.gstin, r.docs, r.total, r.due, r.last_date, r.credit_limit])} />}
                 note={kind === 'customers' ? tr('Counter bills with no customer attached are not part of any party.') : null}>
          {d.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-small">
                <thead><tr className="border-b border-line"><th className={TH}>{tr('Party')}</th><th className={`${TH} text-right`}>{tr('Bills')}</th><th className={`${TH} text-right`}>{tr('Total')}</th><th className={`${TH} text-right`}>{kind === 'customers' ? tr('Owed to you') : tr('You owe')}</th><th className={`${TH} text-right`}>{tr('Last bill')}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {d.rows.map((r) => (
                    <tr key={r.party_id}>
                      <td className="px-2 py-2">
                        {kind === 'customers' ? <Link to={`/app/customers?c=${r.party_id}`} className="text-ink-900 hover:text-brand-700">{r.name}</Link> : <span className="text-ink-900">{r.name}</span>}
                        <span className="block text-caption text-ink-500">{[r.phone, r.gstin].filter(Boolean).join(' · ')}{kind === 'customers' && r.due > 0 ? <button type="button" onClick={() => { setRemindError(''); remindOnWhatsApp(r.party_id).catch((e) => setRemindError(e.message)); }} className="ml-2 font-medium text-brand-700 hover:underline">{tr('Remind')}</button> : null}</span>
                      </td>
                      <td className="tabular px-2 py-2 text-right text-ink-500">{r.docs || ''}</td><td className="tabular px-2 py-2 text-right text-ink-700">{r.total ? formatCurrency(r.total) : ''}</td>
                      <td className={`tabular px-2 py-2 text-right ${r.due > 0 ? 'font-semibold text-warning' : 'text-ink-500'}`}>{r.due > 0 ? formatCurrency(r.due) : ''}{r.over_limit ? <span className="ml-1.5 rounded bg-danger/10 px-1.5 py-0.5 text-caption font-medium text-danger">{tr('Over limit')}</span> : null}</td>
                      <td className="tabular whitespace-nowrap px-2 py-2 text-right text-ink-500">{r.last_date ? fmtDay(r.last_date) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
        </Section>
      </>}
    </div>
  );
};

/* what one party bought, or who bought one item */
const PartyItemsReport = ({ period }) => {
  const tr = useT();
  const [kind, setKind] = useState('customers');
  const [by, setBy] = useState('party');
  const [id, setId] = useState('');
  const parties = useLedger(`/reports/parties/all?kind=${kind}&from=2000-01-01&to=${localISO()}`);
  const products = useLedger('/products');
  const { data: d, error } = useLedger(id ? `/reports/parties/items?kind=${kind}&${by === 'party' ? 'party_id' : 'product_id'}=${id}&from=${period.from}&to=${period.to}` : '/reports/parties/items?kind=none');
  const choices = by === 'party' ? (parties.data?.rows || []).map((p) => [p.party_id, p.name]) : (Array.isArray(products.data) ? products.data : []).map((p) => [p.product_id, p.name]);
  const shown = id ? d : null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <KindToggle kind={kind} onChange={(k) => { setKind(k); setId(''); }} />
        {[['party', tr('By party')], ['item', tr('By item')]].map(([k, label]) => (
          <button key={k} type="button" aria-pressed={by === k} onClick={() => { setBy(k); setId(''); }}
                  className={`rounded-md border px-3 py-1.5 text-small font-medium ${by === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-500 hover:text-ink-900'}`}>{label}</button>
        ))}
        <select aria-label={by === 'party' ? tr('Choose a party') : tr('Choose an item')} value={id} onChange={(e) => setId(e.target.value)} className="h-10 min-w-56 rounded-lg border border-line bg-surface px-2 text-small">
          <option value="">{by === 'party' ? tr('Choose a party') : tr('Choose an item')}</option>
          {choices.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select>
      </div>
      {!id ? null : <>
        <Alert>{error}</Alert>
        {!shown ? <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" /> : <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label={tr('Quantity')} value={qtyFmt(shown.totals.qty)} />
            <Tile label={tr('Taxable value')} value={formatCurrency(shown.totals.taxable)} note={tr('Without tax')} />
            <Tile label={tr('Total')} value={formatCurrency(shown.totals.total)} />
          </div>
          <Section title={shown.subject || tr('Party report by items')} action={<CsvButton name={`party-items-${(shown.subject || 'report').replace(/\W+/g, '-')}-${period.from}-to-${period.to}`} head={['Name', 'Quantity', 'Taxable', 'Total', 'Bills', 'Last']} rows={shown.rows.map((r) => [r.name, r.qty, r.taxable, r.total, r.docs, r.last_date])} />}>
            {shown.rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-small">
                  <thead><tr className="border-b border-line"><th className={TH}>{by === 'party' ? tr('Item') : tr('Party')}</th><th className={`${TH} text-right`}>{tr('Quantity')}</th><th className={`${TH} text-right`}>{tr('Taxable value')}</th><th className={`${TH} text-right`}>{tr('Total')}</th><th className={`${TH} text-right`}>{tr('Bills')}</th><th className={`${TH} text-right`}>{tr('Last bill')}</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {shown.rows.map((r) => (
                      <tr key={`${r.ref_id ?? ''}|${r.name}`}>
                        <td className="px-2 py-2 text-ink-900">{r.name}</td><td className="tabular px-2 py-2 text-right text-ink-500">{qtyFmt(r.qty)}</td>
                        <td className="tabular px-2 py-2 text-right text-ink-700">{formatCurrency(r.taxable)}</td><td className="tabular px-2 py-2 text-right font-medium text-ink-900">{formatCurrency(r.total)}</td>
                        <td className="tabular px-2 py-2 text-right text-ink-500">{r.docs}</td><td className="tabular whitespace-nowrap px-2 py-2 text-right text-ink-500">{fmtDay(r.last_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-small text-ink-500">{tr('Nothing found for this period.')}</p>}
          </Section>
        </>}
      </>}
    </div>
  );
};

/* ── Accountant pack: every book an accountant asks for, as one ZIP of CSV files; downloaded, or emailed to the accountant (accountantPack.controller.js) ── */

const AccountantPack = ({ period }) => {
  const tr = useT();
  const { hasFeature } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState(() => { try { return localStorage.getItem('flowxp.ca.phone') || ''; } catch { return ''; } });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const range = `from=${period.from}&to=${period.to}`;
  const show = () => {
    setOpen(true); setError(''); setNote('');
    api('/businesses/current').then((b) => setEmail((e) => e || b?.receipt_settings?.accountant_email || '')).catch(() => {});
  };
  const download = async () => {
    setBusy('download'); setError(''); setNote('');
    try { await downloadFile(`/reports/accountant-pack?${range}`, `accountant-pack-${period.from}-to-${period.to}.zip`); }
    catch (caught) { setError(caught.message); } finally { setBusy(''); }
  };
  // WhatsApp: the phone's share sheet attaches the ZIP; where the browser cannot, the ZIP downloads and WhatsApp opens on the accountant's number to attach it
  const whatsapp = async () => {
    setBusy('whatsapp'); setError(''); setNote('');
    const name = `accountant-pack-${period.from}-to-${period.to}.zip`;
    const text = `${tr('Accounts')} ${period.from} – ${period.to}`;
    try {
      if (!(await shareFile(`/reports/accountant-pack?${range}`, name, text))) {
        const digits = phone.replace(/\D/g, '');
        window.open(`https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        setNote(tr('The file is downloaded. Attach it in the WhatsApp chat that opened.'));
      }
      if (phone) { try { localStorage.setItem('flowxp.ca.phone', phone); } catch { /* the number is just a convenience */ } }
    } catch (caught) { setError(caught.message); } finally { setBusy(''); }
  };
  const send = async (e) => {
    e.preventDefault(); setBusy('email'); setError(''); setNote('');
    try { const r = await api('/reports/accountant-pack/email', { method: 'POST', body: { email, from: period.from, to: period.to } }); setNote(`${tr('Sent')}: ${r.sent_to}`); }
    catch (caught) { setError(caught.message); } finally { setBusy(''); }
  };
  return (
    <>
      <Button variant="secondary" onClick={show}><Download aria-hidden="true" className="h-4 w-4" />{tr('Accountant pack')}</Button>
      {open && (
        <Modal title={tr('Accountant pack')} onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <p className="text-small text-ink-500">{tr('One ZIP of CSV files for the period: sales and purchase registers, HSN and tax-rate summaries, profit and loss, expenses, every transaction, and what is owed each way.')}</p>
            <p className="tabular text-small font-medium text-ink-900">{short(period.from)} – {short(period.to)}</p>
            <Alert>{error}</Alert>
            {note && <p role="status" className="text-small font-medium text-success">{note}</p>}
            <Button onClick={download} disabled={Boolean(busy)}><Download aria-hidden="true" className="h-4 w-4" />{busy === 'download' ? tr('Thinking…') : tr('Download')}</Button>
            <form onSubmit={send} className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <Input type="email" aria-label={tr('Accountant email')} placeholder={tr('Accountant email')} value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-56 flex-1" required />
              <Button type="submit" variant="secondary" disabled={Boolean(busy)}><Send aria-hidden="true" className="h-4 w-4" />{busy === 'email' ? tr('Thinking…') : tr('Email')}</Button>
            </form>
            {hasFeature('messaging') && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <Input type="tel" inputMode="tel" aria-label={tr('Accountant WhatsApp number')} placeholder={tr('Accountant WhatsApp number')} value={phone} onChange={(e) => setPhone(e.target.value)} className="min-w-56 flex-1" />
                <Button variant="secondary" onClick={whatsapp} disabled={Boolean(busy)}><Send aria-hidden="true" className="h-4 w-4" />{busy === 'whatsapp' ? tr('Thinking…') : tr('WhatsApp')}</Button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

/* ── The screen ───────────────────────────────────────────────────────── */

const REPORTS = [
  { key: 'sales', label: T('Sales'), text: 'What sold, when and how it was paid', dated: true, Render: SalesReport },
  { key: 'waiters', label: T('Waiters'), text: 'Sales by who served', dated: true, restaurant: true, Render: WaitersReport },
  { key: 'customers', label: T('Top customers'), text: 'Who spent the most', dated: true, Render: CustomersReport },
  { key: 'outstanding', label: T('Who owes you'), text: 'Unpaid bills, by customer', dated: false, Render: OutstandingReport },
  { key: 'purchases', label: T('Purchases'), text: 'What you bought, by supplier', dated: true, Render: PurchasesReport },
  { key: 'expenses', label: T('Expenses'), text: 'Where the money went', dated: true, Render: ExpensesReport },
  { key: 'inventory', label: T('Stock'), text: 'Its value, and what is low', dated: false, Render: StockReport },
  { key: 'gst', label: T('GST'), text: 'Tax summary and register', dated: true, Render: GstReport },
  { key: 'daybook', label: T('Day Book'), text: T('Everything that happened on one day'), dated: false, own: true, Render: () => <TransactionsReport day /> },
  { key: 'transactions', label: T('All transactions'), text: T('Bills, purchases and money, by date'), dated: true, own: true, Render: TransactionsReport },
  { key: 'party-statement', label: T('Party statement'), text: T('One party, with a running balance'), dated: true, own: true, Render: PartyStatementReport },
  { key: 'sales-by-party', label: T('Sales by party'), text: T('What each customer bought'), dated: true, path: '/reports/by-party?kind=sales', Render: ByPartyReport },
  { key: 'purchases-by-party', label: T('Purchases by party'), text: T('What you bought from each supplier'), dated: true, path: '/reports/by-party?kind=purchases', Render: ByPartyReport },
  { key: 'profit-loss', label: T('Profit & Loss'), text: T('What is left after cost and expenses'), dated: true, Render: ProfitLossReport },
  { key: 'profit-bills', label: T('Bill-wise profit'), text: T('Profit on every bill'), dated: true, path: '/reports/profit/bills', Render: (props) => <ProfitListReport {...props} kind="bills" /> },
  { key: 'profit-items', label: T('Item-wise profit'), text: T('Profit on every item sold'), dated: true, path: '/reports/profit/items', Render: (props) => <ProfitListReport {...props} kind="items" /> },
  { key: 'profit-parties', label: T('Party-wise profit'), text: T('Profit by customer'), dated: true, path: '/reports/profit/parties', Render: (props) => <ProfitListReport {...props} kind="parties" /> },
  { key: 'discounts', label: T('Discount report'), text: T('Discounts given on bills'), dated: true, Render: DiscountReport },
  { key: 'gst-hsn', label: T('Sale summary by HSN'), text: T('Tax by HSN code and rate'), dated: true, own: true, Render: (props) => <GstSummaryReport {...props} by="hsn" /> },
  { key: 'gst-sac', label: T('SAC report'), text: T('Tax on services, by SAC code'), dated: true, own: true, Render: (props) => <GstSummaryReport {...props} by="sac" /> },
  { key: 'gst-rates', label: T('GST rate report'), text: T('Tax you charged against tax you paid'), dated: true, path: '/reports/gst/rates', Render: GstRatesReport },
  { key: 'gst-options', label: T('TCS, TDS & cess'), text: T('Cess, TCS, TDS, reverse charge, composite tax'), dated: true, path: '/reports/gst/options', Render: GstOptionsReport },
  { key: 'gstr2', label: T('GSTR-2 (purchases)'), text: T('Purchases with supplier GSTIN and tax'), dated: true, path: '/reports/gst/gstr2', Render: Gstr2Report },
  { key: 'stock-summary', label: T('Stock summary'), text: T('Stock and its worth, by category'), dated: false, path: '/reports/stock/summary', Render: StockSummaryReport },
  { key: 'stock-low', label: T('Low stock'), text: T('Everything at or under its warning level'), dated: false, path: '/reports/stock/low', Render: LowStockReport },
  { key: 'stock-items', label: T('Item detail'), text: T('Each item: opening, bought, sold, closing'), dated: true, path: '/reports/stock/items', Render: ItemDetailReport },
  { key: 'stock-ledger', label: T('Stock detail'), text: T('One item, movement by movement'), dated: true, own: true, Render: StockLedgerReport },
  { key: 'category-sales', label: T('Sales and purchases by category'), text: T('What each category sold or cost'), dated: true, own: true, Render: CategorySalesReport },
  { key: 'expense-categories', label: T('Expense categories'), text: T('Where the money went, and what moved'), dated: true, path: '/reports/expense/categories', Render: ExpenseCategoriesReport },
  { key: 'expense-items', label: T('Expense items'), text: T('What the money was spent on'), dated: true, own: true, Render: ExpenseItemsReport },
  { key: 'expense-list', label: T('Expense list'), text: T('Every expense, newest first'), dated: true, own: true, Render: ExpenseListReport },
  { key: 'all-parties', label: T('All parties'), text: T('Every customer or supplier, and what they owe'), dated: true, own: true, Render: AllPartiesReport },
  { key: 'party-items', label: T('Party report by items'), text: T('What a party bought, or who bought an item'), dated: true, own: true, Render: PartyItemsReport }
];

const GROUPS = [
  [T('Sales and profit'), ['sales', 'waiters', 'profit-loss', 'profit-bills', 'profit-items', 'profit-parties', 'discounts']],
  [T('Transactions'), ['daybook', 'transactions']],
  [T('Parties'), ['customers', 'outstanding', 'all-parties', 'party-statement', 'party-items', 'sales-by-party', 'purchases-by-party']],
  [T('Purchases and expenses'), ['purchases', 'expenses', 'expense-categories', 'expense-items', 'expense-list']],
  [T('GST'), ['gst', 'gst-hsn', 'gst-sac', 'gst-rates', 'gst-options', 'gstr2']],
  [T('Stock'), ['inventory', 'stock-summary', 'stock-low', 'stock-items', 'stock-ledger', 'category-sales']]
];

const ReportsPage = () => {
  const tr = useT();
  const { business, outletId, activeOutlet } = useAuth();
  const isRestaurant = RESTAURANT_TYPES.includes(business?.business_type);
  const reports = REPORTS.filter((r) => !r.restaurant || isRestaurant);
  const [tab, setTab] = useState('sales');
  const [periodKey, setPeriodKey] = useState('7d');
  const [custom, setCustom] = useState({ from: plusDays(localISO(), -6), to: localISO() });
  const [result, setResult] = useState(null);   // { key, data, prev } — tagged, so a tab never renders another tab's shape
  const [error, setError] = useState('');
  const period = useMemo(() => periodFor(periodKey, custom), [periodKey, custom]);
  const report = reports.find((r) => r.key === tab) || reports[0];

  useEffect(() => {
    let live = true;
    setError('');
    if (report.own) { setResult({ key: report.key, data: null, prev: null }); return undefined; }
    const base = report.path || `/reports/${report.key}`;
    const q = report.dated ? `${base.includes('?') ? '&' : '?'}from=${period.from}&to=${period.to}` : '';
    Promise.all([
      api(`${base}${q}`),
      report.key === 'sales' ? api(`/reports/sales?from=${period.prevFrom}&to=${period.prevTo}`).catch(() => null) : Promise.resolve(null)
    ]).then(([data, prev]) => { if (live) setResult({ key: report.key, data, prev }); })
      .catch((caught) => { if (live) { setResult(null); setError(caught.message); } });
    return () => { live = false; };
  }, [report.key, period, outletId]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = result?.key === report.key ? result : null;
  const Render = report.Render;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
        <h1 className="text-h3 font-semibold text-ink-900">{tr('Reports')}</h1>
        <p className="mt-1 text-small text-ink-500">{activeOutlet && outletId !== 'all' ? `For ${activeOutlet.name}.` : outletId === 'all' ? tr('For every outlet together.') : tr('How the business is doing.')} For margins and what is left after costs, see <Link to="/app/profitability" className="font-medium text-brand-700">{tr('Profitability')}</Link>.</p>
        </div>
        <AccountantPack period={period} />
      </div>

      <AskReports />

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label={tr('Reports')} className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
          {[...GROUPS, [T('More'), reports.filter((r) => !GROUPS.some(([, keys]) => keys.includes(r.key))).map((r) => r.key)]].map(([title, keys]) => {
            const items = keys.map((k) => reports.find((r) => r.key === k)).filter(Boolean);
            if (!items.length) return null;
            return (
              <div key={title} className="contents lg:mb-3 lg:flex lg:flex-col lg:gap-0.5 lg:border-t-2 lg:border-line lg:pt-3 lg:first:border-t-0 lg:first:pt-0">
                <p className="mb-1 hidden rounded-md border-l-4 border-brand-500 bg-surface-2 px-3 py-1.5 text-small font-bold uppercase tracking-[0.08em] text-ink-900 lg:block">{tr(title)}</p>
                {items.map((r) => (
                  <button key={r.key} type="button" onClick={() => setTab(r.key)} aria-current={r.key === report.key ? 'page' : undefined}
                          className={`shrink-0 rounded-lg px-3 py-1.5 text-left transition-colors duration-(--duration-fast) lg:ml-3 ${r.key === report.key ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-surface-2'} max-lg:border max-lg:border-line`}>
                    <span className="block text-small font-medium">{tr(r.label)}</span>
                    <span className="hidden text-caption leading-snug text-ink-500 lg:block [@media(max-height:780px)]:lg:hidden">{tr(r.text)}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {report.dated ? <>
              <div role="group" aria-label={tr('Period')} className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface-2 p-1">
                {PERIODS.map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={periodKey === k} onClick={() => setPeriodKey(k)}
                          className={`shrink-0 rounded-md px-3 py-1.5 text-small font-medium ${periodKey === k ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'}`}>{tr(label)}</button>
                ))}
              </div>
              {periodKey === 'custom' && (
                <div className="flex items-center gap-2">
                  <Input type="date" aria-label={tr('From')} value={custom.from} max={localISO()} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="!w-auto" />
                  <span className="text-small text-ink-500">{tr('to')}</span>
                  <Input type="date" aria-label={tr('To')} value={custom.to} min={custom.from} max={localISO()} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="!w-auto" />
                </div>
              )}
              <p className="tabular text-small text-ink-500">{tr(period.label)}{period.days > 1 && ` · ${short(period.from)} – ${short(period.to)}`}</p>
            </> : report.own ? null : <p className="text-small text-ink-500">{tr('As it stands now.')}</p>}
          </div>

          <h2 className="sr-only">{tr(report.label)}</h2>
          <Alert>{error}</Alert>
          {!data && !error && <div className="space-y-3"><div className="h-24 animate-pulse rounded-(--radius-card) bg-surface-3" /><div className="h-56 animate-pulse rounded-(--radius-card) bg-surface-3" /></div>}
          {data && <Render d={data.data} prev={data.prev} period={period} />}
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;
