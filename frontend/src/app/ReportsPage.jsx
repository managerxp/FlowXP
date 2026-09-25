/*
 * Reports: one page, seven tabs, one date range. Each tab is a thin renderer
 * over the aggregate its endpoint already computed — this file formats,
 * it does not calculate anything the backend hasn't already worked out.
 */
import { useEffect, useState } from 'react';
import { api, downloadFile, formatCurrency } from '../lib/api.js';
import { daysAgoISO } from '../lib/dates.js';
import { Alert, Button, Card, Input, ListState, Table, Td, Th, Thead, Tr } from '../components/ui.jsx';

const TABS = [
  { key: 'sales', label: 'Sales' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'customers', label: 'Customers' },
  { key: 'gst', label: 'GST' }
];
const DATED_TABS = new Set(['sales', 'purchases', 'expenses', 'customers', 'gst']);

const Stat = ({ label, value }) => (
  <div className="glass rounded-[--radius-card] p-4">
    <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</p>
    <p className="mt-1 text-xl font-bold text-ink-900">{value}</p>
  </div>
);

const Sales = ({ d }) => (
  <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-4">
      <Stat label="Total sales" value={formatCurrency(d.total_sales)} />
      <Stat label="Invoices" value={d.invoice_count} />
      <Stat label="Tax collected" value={formatCurrency(d.total_tax)} />
      <Stat label="Outstanding" value={formatCurrency(d.outstanding)} />
    </div>
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink-900">Top products</h3>
      <Table><Thead><Th>Product</Th><Th className="text-right">Quantity</Th><Th className="text-right">Revenue</Th></Thead>
        <tbody>{d.top_products.map((p) => (
          <Tr key={p.product_id}><Td>{p.name}</Td><Td className="text-right">{p.quantity}</Td><Td className="text-right">{formatCurrency(p.revenue)}</Td></Tr>
        ))}</tbody>
      </Table>
      {!d.top_products.length && <p className="mt-2 text-sm text-ink-400">No sales in this range yet.</p>}
    </div>
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink-900">By payment method</h3>
      <Table><Thead><Th>Method</Th><Th className="text-right">Amount</Th></Thead>
        <tbody>{d.by_payment_method.map((m) => <Tr key={m.method}><Td>{m.method.replace('_', ' ')}</Td><Td className="text-right">{formatCurrency(m.amount)}</Td></Tr>)}</tbody>
      </Table>
    </div>
  </div>
);

const Purchases = ({ d }) => (
  <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-3">
      <Stat label="Total purchases" value={formatCurrency(d.total_purchases)} />
      <Stat label="Purchase orders" value={d.po_count} />
      <Stat label="Payable" value={formatCurrency(d.total_payable)} />
    </div>
    <Table><Thead><Th>Supplier</Th><Th className="text-right">Total</Th></Thead>
      <tbody>{d.by_supplier.map((s) => <Tr key={s.supplier_id ?? s.name}><Td>{s.name}</Td><Td className="text-right">{formatCurrency(s.total)}</Td></Tr>)}</tbody>
    </Table>
  </div>
);

const Expenses = ({ d }) => (
  <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2">
      <Stat label="Total expenses" value={formatCurrency(d.total_expenses)} />
      <Stat label="Entries" value={d.expense_count} />
    </div>
    <Table><Thead><Th>Category</Th><Th className="text-right">Amount</Th></Thead>
      <tbody>{d.by_category.map((c) => <Tr key={c.category}><Td>{c.category}</Td><Td className="text-right">{formatCurrency(c.amount)}</Td></Tr>)}</tbody>
    </Table>
  </div>
);

const Outstanding = ({ d }) => (
  <Table><Thead><Th>Customer</Th><Th>Phone</Th><Th>Oldest unpaid invoice</Th><Th className="text-right">Balance due</Th></Thead>
    <tbody>{d.map((c) => (
      <Tr key={c.customer_id}><Td className="font-medium">{c.name}</Td><Td className="text-ink-500">{c.phone || '—'}</Td>
        <Td className="text-ink-500">{c.oldest_invoice_date}</Td><Td className="text-right font-semibold text-warning">{formatCurrency(c.balance_due)}</Td></Tr>
    ))}</tbody>
  </Table>
);

const InventoryReport = ({ d }) => (
  <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2">
      <Stat label="Total stock value" value={formatCurrency(d.total_value)} />
      <Stat label="Tracked products" value={d.product_count} />
    </div>
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink-900">Low stock</h3>
      <Table><Thead><Th>Product</Th><Th className="text-right">Current</Th><Th className="text-right">Reorder at</Th></Thead>
        <tbody>{d.low_stock.map((p) => <Tr key={p.product_id}><Td>{p.name}</Td><Td className="text-right font-semibold text-warning">{p.current_stock}</Td><Td className="text-right">{p.min_stock}</Td></Tr>)}</tbody>
      </Table>
      {!d.low_stock.length && <p className="mt-2 text-sm text-ink-400">Nothing is low right now.</p>}
    </div>
  </div>
);

const Customers = ({ d }) => (
  <Table><Thead><Th>Customer</Th><Th className="text-right">Invoices</Th><Th className="text-right">Total</Th></Thead>
    <tbody>{d.map((c) => <Tr key={c.customer_id}><Td className="font-medium">{c.name}</Td><Td className="text-right">{c.invoice_count}</Td><Td className="text-right">{formatCurrency(c.total)}</Td></Tr>)}</tbody>
  </Table>
);

const Gst = ({ d }) => (
  <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-ink-500">Net of {d.credit_notes.count} credit note{d.credit_notes.count === 1 ? '' : 's'} ({formatCurrency(d.credit_notes.tax)} of tax reversed).</p>
      <Button size="sm" variant="secondary" onClick={() => downloadFile(`/reports/gst/register?from=${d.range.from}&to=${d.range.to}&format=csv`, `gst-register-${d.range.from}-to-${d.range.to}.csv`).catch((e) => alert(e.message))}>Download GST register (CSV)</Button>
    </div>
    <div className="grid gap-4 sm:grid-cols-4">
      <Stat label="Taxable value" value={formatCurrency(d.taxable_value)} />
      <Stat label="CGST" value={formatCurrency(d.cgst)} />
      <Stat label="SGST" value={formatCurrency(d.sgst)} />
      <Stat label="IGST" value={formatCurrency(d.igst)} />
    </div>
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink-900">By HSN / SAC</h3>
      <Table><Thead><Th>HSN/SAC</Th><Th className="text-right">Rate</Th><Th className="text-right">Taxable value</Th><Th className="text-right">Tax</Th></Thead>
        <tbody>{d.by_hsn.map((h, i) => (
          <Tr key={i}><Td>{h.hsn_sac}</Td><Td className="text-right">{h.tax_rate}%</Td><Td className="text-right">{formatCurrency(h.taxable_value)}</Td><Td className="text-right">{formatCurrency(h.tax)}</Td></Tr>
        ))}</tbody>
      </Table>
    </div>
  </div>
);

const RENDERERS = { sales: Sales, purchases: Purchases, expenses: Expenses, outstanding: Outstanding, inventory: InventoryReport, customers: Customers, gst: Gst };

const ReportsPage = () => {
  const [tab, setTab] = useState('sales');
  const [range, setRange] = useState({
    from: daysAgoISO(30),
    to: daysAgoISO(0)
  });
  const [error, setError] = useState('');

  /*
   * setTab() re-renders immediately with the new tab selected, but `data`
   * still holds the PREVIOUS tab's shape until this effect's fetch resolves
   * — the reset to null happens inside the same effect, which only runs
   * after that render has already committed. For one frame the GST tab was
   * rendering sales data, `d.by_hsn.map` threw on a shape that never had
   * `by_hsn`, and with no error boundary the whole tree unmounted (a blank
   * page, not just a broken one). Tagging data with the tab it belongs to,
   * and refusing to render unless they match, closes that window instead of
   * only guarding one renderer against one wrong shape.
   */
  const [result, setResult] = useState(null);

  useEffect(() => {
    setError('');
    const params = DATED_TABS.has(tab) ? `?from=${range.from}&to=${range.to}` : '';
    api(`/reports/${tab}${params}`)
      .then((data) => setResult({ tab, data }))
      .catch((caught) => { setResult(null); setError(caught.message); });
  }, [tab, range.from, range.to]);

  const data = result?.tab === tab ? result.data : null;
  const Renderer = RENDERERS[tab];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-ink-900">Reports</h1>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex gap-1 rounded-full border border-line bg-surface-2 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${tab === t.key ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {DATED_TABS.has(tab) && (
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <div className="w-40"><Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></div>
            <span>to</span>
            <div className="w-40"><Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></div>
          </div>
        )}
      </div>

      <ListState loading={!data && !error} error={error} empty={Array.isArray(data) && data.length === 0} emptyLabel="Nothing in this range yet." />
      {data && Renderer && (Array.isArray(data) ? data.length > 0 : true) && <Renderer d={data} />}
    </div>
  );
};

export default ReportsPage;
