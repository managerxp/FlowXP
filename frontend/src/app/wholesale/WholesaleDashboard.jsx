/*
 * The wholesaler's front page: sales, what customers owe, stock and expiry alerts, orders and the warehouse floor.
 * Every number comes from /wholesale/dashboard (computed live from invoices, orders, receipts and stock); what a
 * person sees depends on what they may open — someone who runs the warehouse sees the floor, not the books.
 */
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Package, Plus, TriangleAlert, Truck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { BUCKET_TONES } from './constants.js';
import { dateText, money, pct, plural, qty, useLoad } from '../../lib/wholesale.js';
import { Alert, Badge, Button, EmptyState, PageHeader, SkeletonCards, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Bars, Panel, RankBars, StackStrip } from './parts.jsx';

const ALERT_TONE = { critical: 'danger', warning: 'warning', informational: 'brand' };

const Alerts = ({ items }) => (
  <Panel title="Needs attention" lead="What to act on today, most urgent first">
    {items.length === 0 && <EmptyState compact icon={TriangleAlert} title="All clear" body="Nothing needs your attention right now." />}
    <ul className="divide-y divide-line">
      {items.map((a, i) => (
        <li key={i}>
          <Link to={a.link} className="flex items-center gap-3 py-2.5 text-small hover:text-brand-700">
            <Badge tone={ALERT_TONE[a.level] || 'neutral'}>{a.level === 'critical' ? 'Urgent' : a.level === 'warning' ? 'Check' : 'FYI'}</Badge>
            <span className="min-w-0 flex-1 text-ink-900">{a.text}</span>
            <span aria-hidden="true" className="text-ink-400">›</span>
          </Link>
        </li>
      ))}
    </ul>
  </Panel>
);

const WholesaleDashboard = () => {
  const { business, can, hasFeature } = useAuth();
  const navigate = useNavigate();
  const { data: d, loading, error } = useLoad('/wholesale/dashboard');
  const s = d?.sales; const m = d?.money; const o = d?.orders; const inv = d?.inventory; const f = d?.fulfilment; const p = d?.purchasing;

  return (
    <div>
      <PageHeader title={business?.name || 'Today'} lead="Sales, receivables, stock and the warehouse at a glance."
                  action={<>
                    {can('sales_orders') && hasFeature('wholesale_orders') && <Button to="/app/wholesale/orders/new"><Plus aria-hidden="true" className="h-4 w-4" />New order</Button>}
                    {can('purchases') && <Button to="/app/wholesale/purchasing/new" variant="secondary"><Package aria-hidden="true" className="h-4 w-4" />New purchase</Button>}
                    {can('payments') && <Button to="/app/wholesale/money?tab=receipts&new=1" variant="secondary">Record payment</Button>}
                  </>} />
      <Alert>{error}</Alert>
      {loading && !d && <SkeletonCards count={4} />}
      {d && (
        <div className="space-y-6">
          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {s && <StatCard size="lg" label="Sales today" value={money(s.today.total)} note={plural(s.today.invoices, 'invoice')} />}
            {s && <StatCard size="lg" label="Sales this month" value={money(s.month.total)} note={s.month.change_pct != null ? `${s.month.change_pct >= 0 ? '▲' : '▼'} ${Math.abs(s.month.change_pct)}% vs last month` : `${plural(s.month.invoices, 'invoice')}`} tone={s.month.change_pct < 0 ? 'warning' : undefined} />}
            {m && <StatCard size="lg" to="/app/wholesale/money" label="Customers owe" value={money(m.receivable)} tone={m.overdue > 0 ? 'warning' : undefined} note={m.overdue > 0 ? `${money(m.overdue)} overdue` : 'Nothing overdue'} />}
            {m && m.payable != null && <StatCard size="lg" to="/app/wholesale/money?tab=payables" label="You owe suppliers" value={money(m.payable)} note={m.payable_due_soon > 0 ? `${money(m.payable_due_soon)} due within a week` : 'Nothing due soon'} />}
            {m && <StatCard size="lg" label="Collected today" value={money(m.collected_today)} note={`${money(m.collected_month)} this month`} />}
            {m && <StatCard size="lg" label="Gross profit this month" value={money(m.gross_profit_month)} note={m.margin_pct != null ? `${pct(m.margin_pct)} margin` : 'No sales yet'} tone={m.gross_profit_month < 0 ? 'danger' : undefined} />}
            {o && <StatCard size="lg" to="/app/wholesale/orders?status=PENDING,DRAFT" label="Orders to confirm" value={o.pending} note={o.pending ? `${money(o.pending_value)} waiting${o.needing_approval ? ` · ${o.needing_approval} need approval` : ''}` : 'None waiting'} tone={o.needing_approval ? 'warning' : undefined} />}
            {o && <StatCard size="lg" to="/app/wholesale/fulfilment" label="Orders to ship" value={o.to_fulfil} note={o.backorder_lines ? `${plural(o.backorder_lines, 'back-ordered line')}` : 'Stock covers them'} tone={o.backorder_lines ? 'warning' : undefined} />}
            {inv && <StatCard size="lg" to="/app/wholesale/inventory" label="Stock value" value={money(inv.stock_value)} note={`${money(inv.reserved_value)} promised to orders`} />}
            {inv && <StatCard size="lg" to="/app/wholesale/inventory?state=low" label="Low or out of stock" value={inv.alerts.low_stock + inv.alerts.out_of_stock} tone={inv.alerts.low_stock + inv.alerts.out_of_stock > 0 ? 'warning' : undefined} note={inv.alerts.out_of_stock ? `${inv.alerts.out_of_stock} out of stock` : 'Above reorder level'} />}
            {inv && <StatCard size="lg" to="/app/wholesale/inventory?tab=expiry" label="Expiring or expired" value={inv.alerts.expiring + inv.alerts.expired} tone={inv.alerts.expired > 0 ? 'danger' : inv.alerts.expiring > 0 ? 'warning' : undefined} note={inv.alerts.expired ? `${inv.alerts.expired} batch${inv.alerts.expired === 1 ? '' : 'es'} expired` : 'Within your alert window'} />}
            {f && <StatCard size="lg" to="/app/wholesale/fulfilment" label="Out for delivery" value={f.out_for_delivery} note={`${f.delivered_today} delivered today${f.failed_deliveries ? ` · ${f.failed_deliveries} failed` : ''}`} tone={f.failed_deliveries ? 'warning' : undefined} />}
          </section>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {s && (
              <Panel title="Sales, last 30 days" lead="Invoiced amounts after returns">
                <Bars data={s.trend.map((x) => ({ label: x.date, value: x.sales }))} every={5} label="Daily sales for the last 30 days" />
                <p className="mt-3 text-caption text-ink-500">Hover a bar for the day’s total. This month so far: <strong className="tabular font-semibold text-ink-900">{money(s.month.total)}</strong> across {plural(s.month.invoices, 'invoice')}.</p>
              </Panel>
            )}
            <Alerts items={d.alerts} />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
            {s && <Panel title="Top customers" lead="This month, by net sales"><RankBars rows={s.top_customers.map((c) => ({ ...c, label: c.name, value: c.total }))} sub={(c) => plural(c.invoices, 'invoice')} onClick={(c) => navigate(`/app/wholesale/customers/${c.customer_id}`)} /></Panel>}
            {s && <Panel title="Top products" lead="This month, by revenue before GST"><RankBars rows={s.top_products.map((x) => ({ ...x, label: x.name, value: x.revenue }))} tone="bg-cyan-100" sub={(x) => `${qty(x.units)} units`} /></Panel>}
            {s?.by_salesperson && s.by_salesperson.length > 0 && <Panel title="Sales by salesperson" lead="This month"><RankBars rows={s.by_salesperson.map((x) => ({ ...x, label: x.name, value: x.total }))} tone="bg-amber-100" sub={(x) => plural(x.invoices, 'invoice')} /></Panel>}
            {m?.top_debtors?.length > 0 && <Panel title="Who owes the most" lead="Open invoices by customer" action={<Button to="/app/wholesale/money" variant="ghost" size="sm">Receivables</Button>}><RankBars rows={m.top_debtors.map((x) => ({ ...x, label: x.name, value: x.owed }))} tone="bg-red-100" sub={(x) => `oldest due ${dateText(x.oldest_due)}`} onClick={(c) => navigate(`/app/wholesale/customers/${c.customer_id}`)} /></Panel>}
          </div>

          {m && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
              <Panel title="Receivables by age" lead="Days past due date"><StackStrip parts={[['current', 'Current'], ['d1_30', '1–30'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['d90_plus', '90+']].map(([k, label]) => ({ label, value: m.ageing[k], tone: BUCKET_TONES[k] }))} /></Panel>
              {m.payable_ageing && <Panel title="Payables by age" lead="Days past due date"><StackStrip parts={[['current', 'Current'], ['d1_30', '1–30'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['d90_plus', '90+']].map(([k, label]) => ({ label, value: m.payable_ageing[k], tone: BUCKET_TONES[k] }))} /></Panel>}
            </div>
          )}

          {inv && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
              <Panel title="Running low" lead="Available stock at or below the reorder level" action={<Button to="/app/wholesale/inventory?state=low" variant="ghost" size="sm">See all</Button>}>
                {inv.low_stock.length === 0 ? <EmptyState compact icon={Package} title="Nothing low" body="Every product is above its reorder level." /> : (
                  <Table><Thead><Th>Product</Th><Th className="text-right">Available</Th><Th className="text-right">Reorder at</Th></Thead>
                    <tbody>{inv.low_stock.map((x) => <Tr key={x.product_id}><Td className="font-medium">{x.name}</Td><Td className={`text-right tabular ${x.available <= 0 ? 'font-semibold text-danger' : ''}`}>{qty(x.available)} {x.unit}</Td><Td className="text-right tabular">{qty(x.reorder_level)}</Td></Tr>)}</tbody></Table>
                )}
              </Panel>
              <Panel title="Expiring soon" lead="Soonest first" action={<Button to="/app/wholesale/inventory?tab=expiry" variant="ghost" size="sm">See all</Button>}>
                {inv.expiring.length === 0 ? <EmptyState compact icon={Package} title="Nothing expiring" body="No batch is inside your alert window." /> : (
                  <Table><Thead><Th>Product</Th><Th>Batch</Th><Th className="text-right">Qty</Th><Th className="text-right">Expires</Th></Thead>
                    <tbody>{inv.expiring.map((x, i) => <Tr key={i}><Td className="font-medium">{x.name}</Td><Td>{x.batch_no}</Td><Td className="text-right tabular">{qty(x.qty)}</Td><Td className={`text-right ${x.days_left < 0 ? 'font-semibold text-danger' : ''}`}>{x.days_left < 0 ? 'Expired' : `${x.days_left} d`}</Td></Tr>)}</tbody></Table>
                )}
              </Panel>
              {inv.by_warehouse.length > 1 && <Panel title="Stock value by warehouse"><RankBars rows={inv.by_warehouse.map((w) => ({ ...w, label: w.name, value: w.value }))} tone="bg-teal-100" /></Panel>}
            </div>
          )}

          {(f || p) && (
            <Panel title="Warehouse and buying" lead="What is waiting on your team">
              <dl className="grid grid-cols-2 gap-4 text-small sm:grid-cols-4 lg:grid-cols-6">
                {f && [['To pick', f.to_pick, '/app/wholesale/fulfilment?tab=picks'], ['To dispatch', f.to_dispatch, '/app/wholesale/fulfilment?tab=picks'], ['Awaiting a driver', f.to_deliver, '/app/wholesale/fulfilment?tab=deliveries']].map(([k, v, to]) => <div key={k}><dt className="text-caption text-ink-500">{k}</dt><dd><Link to={to} className="tabular text-title font-semibold text-ink-900 hover:text-brand-700">{v}</Link></dd></div>)}
                {p && [['Purchase orders open', p.open_orders, '/app/wholesale/purchasing'], ['Drafts to approve', p.drafts_to_approve, '/app/wholesale/purchasing?status=DRAFT'], ['Late from suppliers', p.late_orders, '/app/wholesale/purchasing']].map(([k, v, to]) => <div key={k}><dt className="text-caption text-ink-500">{k}</dt><dd><Link to={to} className={`tabular text-title font-semibold hover:text-brand-700 ${k === 'Late from suppliers' && v > 0 ? 'text-warning' : 'text-ink-900'}`}>{v}</Link></dd></div>)}
              </dl>
            </Panel>
          )}
          {s && Object.keys(s.orders_by_status).length > 0 && (
            <Panel title="Orders, last 60 days" lead="By stage">
              <ul className="flex flex-wrap gap-2">
                {Object.entries(s.orders_by_status).map(([st, v]) => <li key={st}><Link to={`/app/wholesale/orders?status=${st}`} className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-small hover:border-line-strong"><ClipboardList aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />{st.replace(/_/g, ' ').toLowerCase()} <strong className="tabular font-semibold text-ink-900">{v.count}</strong><span className="tabular text-ink-500">{money(v.value)}</span></Link></li>)}
              </ul>
            </Panel>
          )}
          {!s && !m && !inv && <EmptyState icon={Truck} title="Welcome" body="Your role does not have a dashboard of its own. Use the menu to open your screens." />}
        </div>
      )}
    </div>
  );
};

export default WholesaleDashboard;
