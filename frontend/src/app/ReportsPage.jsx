/*
 * Reports: one period, a list of reports, each a thin renderer over the
 * aggregate its endpoint already worked out (reports.controller.js). This file
 * formats and draws; it calculates nothing the backend has not. The one extra
 * fetch is the sales report for the period before, to compare against.
 *
 * Charts are plain bars in the brand blue (one series each), with a hover
 * label and a table for screen readers. Every table can be downloaded as CSV.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { api, downloadFile, formatCurrency } from '../lib/api.js';
import { localISO } from '../lib/dates.js';
import { useAuth } from '../context/AuthContext.jsx';
import { RESTAURANT_TYPES, platformName } from '../lib/business.js';
import { Alert, Button, Input, StatCard } from '../components/ui.jsx';

/* ── Periods ───────────────────────────────────────────────────────────── */

const d0 = (iso) => new Date(`${iso}T00:00`);
const plusDays = (iso, n) => { const d = d0(iso); d.setDate(d.getDate() + n); return localISO(d); };
const daysBetween = (a, b) => Math.round((d0(b) - d0(a)) / 86400000) + 1;
const short = (iso) => d0(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['last-month', 'Last month'], ['custom', 'Pick dates']];
const periodFor = (key, custom) => {
  const today = localISO(); const now = new Date();
  const r = key === 'today' ? { from: today, to: today, label: 'Today' }
    : key === 'yesterday' ? { from: plusDays(today, -1), to: plusDays(today, -1), label: 'Yesterday' }
    : key === '7d' ? { from: plusDays(today, -6), to: today, label: 'Last 7 days' }
    : key === '30d' ? { from: plusDays(today, -29), to: today, label: 'Last 30 days' }
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
const CsvButton = ({ name, head, rows }) => (
  <button type="button" onClick={() => saveCsv(name, head, rows)} disabled={!rows.length} className="flex items-center gap-1 text-caption font-medium text-brand-700 hover:underline disabled:opacity-40">
    <Download aria-hidden="true" className="h-3.5 w-3.5" />CSV
  </button>
);

const Tile = ({ change, ...props }) => <StatCard {...props}>{change}</StatCard>;

/* "12% up on the 7 days before": spending more is the thing to notice on costs, earning more on sales. */
const Change = ({ now, before, vs, goodWhenUp = true }) => {
  if (before == null) return null;
  if (!before) return <p className="mt-0.5 text-caption text-ink-500">{now ? `nothing in ${vs}` : ' '}</p>;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <p className="mt-0.5 text-caption text-ink-500">the same as {vs}</p>;
  const good = (pct > 0) === goodWhenUp;
  return <p className="tabular mt-0.5 text-caption"><span className={`font-semibold ${good ? 'text-success' : 'text-warning'}`}>{pct > 0 ? '↑' : '↓'} {Math.abs(pct)}%</span> <span className="text-ink-500">on {vs}</span></p>;
};

const Section = ({ title, action, children, note }) => (
  <section className="rounded-(--radius-card) border border-line bg-surface p-5">
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-body font-semibold text-ink-900">{title}</h3>
      {action}
    </div>
    {children}
    {note && <p className="mt-3 text-caption text-ink-500">{note}</p>}
  </section>
);

/* Vertical bars (days, hours). One series, brand blue; the tallest is labelled. */
const Columns = ({ points, label, valueText }) => {
  const [hover, setHover] = useState(null);
  const max = Math.max(...points.map((p) => p.value), 0);
  if (!max) return <p className="py-6 text-center text-small text-ink-500">No sales in this period.</p>;
  const shown = hover != null ? points[hover] : points.reduce((a, b) => (b.value > a.value ? b : a));
  return (
    <div>
      <p className="tabular mb-2 h-5 text-small text-ink-700"><span className="font-semibold text-ink-900">{shown.label}</span> · {valueText(shown)}{hover == null && <span className="text-ink-500"> (the most)</span>}</p>
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
      <table className="sr-only"><caption>{label}</caption><tbody>{points.map((p) => <tr key={p.key}><th>{p.label}</th><td>{valueText(p)}</td></tr>)}</tbody></table>
    </div>
  );
};

/* Horizontal bars for a ranked breakdown (category, channel, method…). */
const Bars = ({ rows, empty = 'Nothing in this period.' }) => {
  const max = Math.max(...rows.map((r) => r.value), 0);
  const total = rows.reduce((t, r) => t + r.value, 0);
  if (!rows.length) return <p className="text-small text-ink-500">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="text-small">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-ink-900">{r.to ? <Link to={r.to} className="hover:text-brand-700">{r.label}</Link> : r.label}{r.note && <span className="text-ink-500"> · {r.note}</span>}</span>
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
        <Tile label="Sales" value={formatCurrency(d.total_sales)} change={<Change now={d.total_sales} before={prev?.total_sales} vs={period.vs} />} note="incl. GST" />
        <Tile label="Bills" value={d.invoice_count} change={<Change now={d.invoice_count} before={prev?.invoice_count} vs={period.vs} />} />
        <Tile label="Average bill" value={formatCurrency(avg)} change={<Change now={avg} before={prevAvg} vs={period.vs} />} />
        <Tile label="GST collected" value={formatCurrency(d.total_tax)} note={d.outstanding > 0 ? `${formatCurrency(d.outstanding)} of these bills still unpaid` : 'all bills paid'} />
      </div>

      {dayPoints.length > 0 && (
        <Section title="Day by day" action={<CsvButton name={`${name}-by-day`} head={['Date', 'Bills', 'Sales']} rows={dayPoints.map((p) => [p.key, p.bills, p.value.toFixed(2)])} />}>
          <Columns points={dayPoints} label="Sales by day" valueText={billsText} />
        </Section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Busiest hours" action={<CsvButton name={`${name}-by-hour`} head={['Hour', 'Bills', 'Sales']} rows={hourPoints.map((p) => [p.label, p.bills, p.value.toFixed(2)])} />} note={period.days > 1 ? 'All days in the period added together.' : undefined}>
          {hourPoints.length ? <Columns points={hourPoints} label="Sales by hour" valueText={billsText} /> : <p className="text-small text-ink-500">No sales in this period.</p>}
        </Section>
        <Section title="Where sales came from" action={<CsvButton name={`${name}-by-channel`} head={['Channel', 'Bills', 'Sales']} rows={d.by_channel.map((c) => [channelName(c), c.invoice_count, c.total.toFixed(2)])} />}>
          <Bars rows={d.by_channel.map((c) => ({ key: `${c.channel}-${c.platform}`, label: channelName(c), note: `${c.invoice_count} bill${c.invoice_count === 1 ? '' : 's'}`, value: c.total }))} />
        </Section>
        <Section title="By category" action={<CsvButton name={`${name}-by-category`} head={['Category', 'Quantity', 'Sales']} rows={d.by_category.map((c) => [c.category, c.quantity, c.revenue.toFixed(2)])} />}>
          <Bars rows={d.by_category.map((c) => ({ key: c.category, label: c.category, value: c.revenue }))} />
        </Section>
        <Section title="How customers paid" action={<CsvButton name={`${name}-by-method`} head={['Method', 'Amount']} rows={d.by_payment_method.map((m) => [METHOD[m.method] || m.method, m.amount.toFixed(2)])} />} note="Money taken in the period, including payments on older bills.">
          <Bars rows={d.by_payment_method.map((m) => ({ key: m.method, label: METHOD[m.method] || m.method, value: m.amount }))} empty="No payments taken in this period." />
        </Section>
      </div>

      <Section title="Best sellers" action={<CsvButton name={`${name}-top-products`} head={['Product', 'Quantity', 'Sales']} rows={d.top_products.map((p) => [p.name, p.quantity, p.revenue.toFixed(2)])} />}
               note={<>Top 10 by sales. What each one earns you after its cost is on <Link to="/app/profitability" className="font-medium text-brand-700">Profitability</Link>.</>}>
        {d.top_products.length === 0 ? <p className="text-small text-ink-500">No sales in this period.</p> : (
          <ol className="divide-y divide-line">
            {d.top_products.map((p, i) => (
              <li key={p.product_id ?? p.name} className="flex items-center gap-3 py-2 text-small">
                <span className="tabular w-5 shrink-0 text-caption text-ink-400">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-ink-900">{p.product_id ? <Link to={`/app/products?p=${p.product_id}`} className="hover:text-brand-700">{p.name}</Link> : p.name}</span>
                <span className="tabular shrink-0 text-ink-500">{Number(p.quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 })} sold</span>
                <span className="tabular w-28 shrink-0 text-right font-medium text-ink-900">{formatCurrency(p.revenue)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
};

const WaitersReport = ({ d, period }) => (
  d.waiters.length === 0 ? <p className="rounded-(--radius-card) border border-dashed border-line-strong p-8 text-center text-small text-ink-500">No table sales in this period.</p> : (
    <Section title="Sales by who served the table" action={<CsvButton name={`waiters-${period.from}-to-${period.to}`} head={['Waiter', 'Bills', 'Average bill', 'Discounts', 'Sales']} rows={d.waiters.map((w) => [w.name, w.bills, w.average_bill.toFixed(2), w.discounts.toFixed(2), w.revenue.toFixed(2)])} />}
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

const PurchasesReport = ({ d, period }) => (
  <div className="space-y-5">
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
      <Tile label="Bought" value={formatCurrency(d.total_purchases)} note="received, after returns" />
      <Tile label="Deliveries" value={d.po_count} />
      <Tile label="Still to pay on these" value={formatCurrency(d.total_payable)} note={<Link to="/app/purchases" className="font-medium text-brand-700">Open Purchases</Link>} />
    </div>
    <Section title="By supplier" action={<CsvButton name={`purchases-${period.from}-to-${period.to}`} head={['Supplier', 'Bought']} rows={d.by_supplier.map((s) => [s.name, s.total.toFixed(2)])} />} note="Top 10.">
      <Bars rows={d.by_supplier.map((s) => ({ key: s.supplier_id ?? s.name, label: s.name, value: s.total, to: s.supplier_id ? `/app/suppliers?s=${s.supplier_id}` : undefined }))} empty="Nothing received in this period." />
    </Section>
  </div>
);

const ExpensesReport = ({ d, period }) => (
  <div className="space-y-5">
    <div className="grid grid-cols-2 gap-2">
      <Tile label="Spent" value={formatCurrency(d.total_expenses)} note={<Link to="/app/expenses" className="font-medium text-brand-700">Open Expenses</Link>} />
      <Tile label="Expenses logged" value={d.expense_count} />
    </div>
    <Section title="By category" action={<CsvButton name={`expenses-${period.from}-to-${period.to}`} head={['Category', 'Amount']} rows={d.by_category.map((c) => [c.category, c.amount.toFixed(2)])} />}>
      <Bars rows={d.by_category.map((c) => ({ key: c.category, label: c.category, value: c.amount }))} empty="No expenses logged in this period." />
    </Section>
  </div>
);

const OutstandingReport = ({ d }) => {
  const total = d.reduce((t, c) => t + c.balance_due, 0);
  const today = localISO();
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Owed to you" value={formatCurrency(total)} note="on bills with a customer, as of now" />
        <Tile label="Customers" value={d.length} />
      </div>
      <Section title="Who owes you" action={<CsvButton name={`owed-${today}`} head={['Customer', 'Phone', 'Oldest unpaid bill', 'Owed']} rows={d.map((c) => [c.name, c.phone || '', c.oldest_invoice_date, c.balance_due.toFixed(2)])} />}>
        {d.length === 0 ? <p className="text-small text-ink-500">Nobody owes you anything.</p> : (
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

const StockReport = ({ d }) => (
  <div className="space-y-5">
    <div className="grid grid-cols-2 gap-2">
      <Tile label="Stock value" value={formatCurrency(d.total_value)} note="at what you paid, as of now" />
      <Tile label="Items counted" value={d.product_count} note={<Link to="/app/inventory" className="font-medium text-brand-700">Open Inventory</Link>} />
    </div>
    <Section title="Running low" action={<CsvButton name={`low-stock-${localISO()}`} head={['Item', 'In stock', 'Warns below']} rows={d.low_stock.map((p) => [p.name, p.current_stock, p.min_stock])} />} note="The 20 lowest against their warning level.">
      {d.low_stock.length === 0 ? <p className="text-small text-ink-500">Nothing is running low.</p> : (
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

const CustomersReport = ({ d, period }) => (
  <Section title="Who spent the most" action={<CsvButton name={`top-customers-${period.from}-to-${period.to}`} head={['Customer', 'Bills', 'Spent']} rows={d.map((c) => [c.name, c.invoice_count, c.total.toFixed(2)])} />} note="Top 20, on bills with a customer.">
    <Bars rows={d.map((c) => ({ key: c.customer_id, label: c.name, note: `${c.invoice_count} bill${c.invoice_count === 1 ? '' : 's'}`, value: c.total, to: `/app/customers?c=${c.customer_id}` }))} empty="No bills with a customer in this period." />
  </Section>
);

const GstReport = ({ d }) => {
  const [error, setError] = useState('');
  return (
    <div className="space-y-5">
      <Alert>{error}</Alert>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Tile label="Taxable value" value={formatCurrency(d.taxable_value)} />
        <Tile label="CGST" value={formatCurrency(d.cgst)} />
        <Tile label="SGST" value={formatCurrency(d.sgst)} />
        <Tile label="IGST" value={formatCurrency(d.igst)} />
        <Tile label="Total GST" value={formatCurrency(d.total_tax)} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-line bg-surface-2 p-4">
        <p className="text-small text-ink-700">Net of {d.credit_notes.count} credit note{d.credit_notes.count === 1 ? '' : 's'} ({formatCurrency(d.credit_notes.tax)} of tax taken back). The register lists every bill and credit note by tax rate, B2B and B2C, for your GSTR-1.</p>
        <Button variant="secondary" onClick={() => downloadFile(`/reports/gst/register?from=${d.range.from}&to=${d.range.to}&format=csv`, `gst-register-${d.range.from}-to-${d.range.to}.csv`).catch((e) => setError(e.message))}>
          <Download aria-hidden="true" className="h-4 w-4" />GST register (CSV)
        </Button>
      </div>
      <Section title="By HSN / SAC" action={<CsvButton name={`gst-hsn-${d.range.from}-to-${d.range.to}`} head={['HSN/SAC', 'Rate %', 'Taxable value', 'Tax']} rows={d.by_hsn.map((h) => [h.hsn_sac, h.tax_rate, h.taxable_value.toFixed(2), h.tax.toFixed(2)])} />}>
        {d.by_hsn.length === 0 ? <p className="text-small text-ink-500">No taxed sales in this period.</p> : (
          <table className="w-full text-small">
            <thead><tr className="border-b border-line text-left text-caption text-ink-500"><th className="py-2 font-medium">HSN / SAC</th><th className="py-2 text-right font-medium">Rate</th><th className="py-2 text-right font-medium">Taxable</th><th className="py-2 text-right font-medium">GST</th></tr></thead>
            <tbody className="divide-y divide-line">
              {d.by_hsn.map((h, i) => (
                <tr key={i}><td className={`py-2 ${h.hsn_sac === 'No HSN/SAC' ? 'text-warning' : 'text-ink-900'}`}>{h.hsn_sac}</td><td className="tabular py-2 text-right text-ink-500">{h.tax_rate}%</td><td className="tabular py-2 text-right text-ink-700">{formatCurrency(h.taxable_value)}</td><td className="tabular py-2 text-right font-medium text-ink-900">{formatCurrency(h.tax)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {d.by_hsn.some((h) => h.hsn_sac === 'No HSN/SAC') && <p className="mt-3 text-caption text-ink-500">Some items have no HSN/SAC code. Add it on <Link to="/app/products" className="font-medium text-brand-700">Products</Link> before filing.</p>}
      </Section>
    </div>
  );
};

/* ── The screen ───────────────────────────────────────────────────────── */

const REPORTS = [
  { key: 'sales', label: 'Sales', text: 'What sold, when and how it was paid', dated: true, Render: SalesReport },
  { key: 'waiters', label: 'Waiters', text: 'Sales by who served', dated: true, restaurant: true, Render: WaitersReport },
  { key: 'customers', label: 'Top customers', text: 'Who spent the most', dated: true, Render: CustomersReport },
  { key: 'outstanding', label: 'Who owes you', text: 'Unpaid bills, by customer', dated: false, Render: OutstandingReport },
  { key: 'purchases', label: 'Purchases', text: 'What you bought, by supplier', dated: true, Render: PurchasesReport },
  { key: 'expenses', label: 'Expenses', text: 'Where the money went', dated: true, Render: ExpensesReport },
  { key: 'inventory', label: 'Stock', text: 'Its value, and what is low', dated: false, Render: StockReport },
  { key: 'gst', label: 'GST', text: 'Tax summary and register', dated: true, Render: GstReport }
];

const ReportsPage = () => {
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
    const q = report.dated ? `?from=${period.from}&to=${period.to}` : '';
    Promise.all([
      api(`/reports/${report.key}${q}`),
      report.key === 'sales' ? api(`/reports/sales?from=${period.prevFrom}&to=${period.prevTo}`).catch(() => null) : Promise.resolve(null)
    ]).then(([data, prev]) => { if (live) setResult({ key: report.key, data, prev }); })
      .catch((caught) => { if (live) { setResult(null); setError(caught.message); } });
    return () => { live = false; };
  }, [report.key, period, outletId]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = result?.key === report.key ? result : null;
  const Render = report.Render;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-h3 font-semibold text-ink-900">Reports</h1>
        <p className="mt-1 text-small text-ink-500">{activeOutlet && outletId !== 'all' ? `For ${activeOutlet.name}.` : outletId === 'all' ? 'For every outlet together.' : 'How the business is doing.'} For margins and what is left after costs, see <Link to="/app/profitability" className="font-medium text-brand-700">Profitability</Link>.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Reports" className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {reports.map((r) => (
            <button key={r.key} type="button" onClick={() => setTab(r.key)} aria-current={r.key === report.key ? 'page' : undefined}
                    className={`shrink-0 rounded-lg px-3 py-2 text-left transition-colors duration-(--duration-fast) ${r.key === report.key ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-surface-2'} max-lg:border max-lg:border-line`}>
              <span className="block text-small font-medium">{r.label}</span>
              <span className="hidden text-caption text-ink-500 lg:block">{r.text}</span>
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {report.dated ? <>
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
              <p className="tabular text-small text-ink-500">{period.label}{period.days > 1 && ` · ${short(period.from)} – ${short(period.to)}`}</p>
            </> : <p className="text-small text-ink-500">As it stands now.</p>}
          </div>

          <h2 className="sr-only">{report.label}</h2>
          <Alert>{error}</Alert>
          {!data && !error && <div className="space-y-3"><div className="h-24 animate-pulse rounded-(--radius-card) bg-surface-3" /><div className="h-56 animate-pulse rounded-(--radius-card) bg-surface-3" /></div>}
          {data && <Render d={data.data} prev={data.prev} period={period} />}
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;
