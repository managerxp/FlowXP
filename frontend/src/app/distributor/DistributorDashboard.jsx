/*
 * The distributor's front page: today and the month against target, who is selling what where, what the field force is
 * doing, what customers owe, stock and scheme alerts. Every figure comes from /distributor/dashboard, computed live
 * from invoices, orders, receipts and stock; what a person sees depends on what they may open, and a field rep sees
 * only their own sales.
 */
import { Link } from 'react-router-dom';
import { Plus, Target, TriangleAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { BUCKET_TONES } from '../wholesale/constants.js';
import { money, pct, plural, useLoad } from '../../lib/distributor.js';
import { Alert, Badge, Button, EmptyState, PageHeader, SkeletonCards, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Bars, Panel, RankBars, StackStrip } from '../wholesale/parts.jsx';

const ALERT_TONE = { critical: 'danger', warning: 'warning', informational: 'brand' };

const Alerts = ({ items }) => (
  <Panel title="Needs attention" lead="What to act on today, most urgent first">
    {items.length === 0 && <EmptyState compact icon={TriangleAlert} title="All clear" body="Nothing needs your attention right now." />}
    <ul className="divide-y divide-line">
      {items.slice(0, 10).map((a, i) => (
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

/** Progress toward the month's target: the bar, the percentage, and what is needed each remaining day. */
const TargetCard = ({ k, month }) => {
  if (!k?.month_target) return <Panel title="Monthly target"><EmptyState compact icon={Target} title="No target set" body="Set this month’s target to see how the month is going." action={<Button to="/app/distributor/team?tab=targets" variant="secondary">Set targets</Button>} /></Panel>;
  const done = Math.min(100, k.target_achievement_pct || 0);
  return (
    <Panel title="Monthly target" lead={`${month.from} to ${month.to}`}>
      <div className="flex items-end justify-between gap-3"><p className="text-display-sm font-semibold tabular">{pct(k.target_achievement_pct)}</p><p className="text-small text-ink-500">{money(k.net_sales_month)} of {money(k.month_target)}</p></div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(done)} aria-valuemin={0} aria-valuemax={100} aria-label="Target achieved"><div className={`h-full rounded-full ${done >= 100 ? 'bg-success' : 'bg-brand-500'}`} style={{ width: `${done}%` }} /></div>
      <p className="mt-3 text-small text-ink-700">{k.target_remaining > 0 ? <>{money(k.target_remaining)} to go — about <strong>{money(k.target_per_day)}</strong> a day.</> : 'Target reached for the month.'}</p>
    </Panel>
  );
};

const DistributorDashboard = () => {
  const { business, can, hasFeature } = useAuth();
  const { data: d, loading, error } = useLoad('/distributor/dashboard');
  const k = d?.distributor?.kpis; const perf = d?.distributor?.performance; const m = d?.money; const inv = d?.inventory; const f = d?.distributor?.field; const sc = d?.distributor?.schemes;

  return (
    <div>
      <PageHeader title={business?.name || 'Today'} lead="Sales, collections, targets, stock and the field force at a glance."
                  action={<>
                    {can('field_sales') && <Button to="/app/distributor/field" variant="secondary">Field sales</Button>}
                    {can('sales_orders') && hasFeature('wholesale_orders') && <Button to="/app/wholesale/orders/new"><Plus aria-hidden="true" className="h-4 w-4" />New order</Button>}
                    {(can('payments') || can('collections')) && <Button to="/app/wholesale/money?tab=receipts&new=1" variant="secondary">Record payment</Button>}
                  </>} />
      <Alert>{error}</Alert>
      {loading && !d && <SkeletonCards count={4} />}
      {d && k && (
        <div className="space-y-6">
          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard size="lg" label="Sales today" value={money(k.sales_today)} note={`${plural(k.orders_today.count, 'order')} placed · ${money(k.orders_today.value)}`} />
            <StatCard size="lg" label="Collected today" value={k.collections_today == null ? '—' : money(k.collections_today)} note={m ? `${money(m.collected_month)} this month` : undefined} />
            <StatCard size="lg" label="Sales this month" value={money(k.sales_month)} note={k.sales_change_pct != null ? `${k.sales_change_pct >= 0 ? '▲' : '▼'} ${Math.abs(k.sales_change_pct)}% vs last month` : 'First month of sales'} />
            <StatCard size="lg" label="Target achieved" value={k.target_achievement_pct == null ? '—' : pct(k.target_achievement_pct)} note={k.month_target ? `of ${money(k.month_target)}` : 'No target set'} tone={k.target_achievement_pct != null && k.target_achievement_pct < 50 ? 'warning' : undefined} />
            {k.receivables != null && <StatCard size="lg" to="/app/wholesale/money" label="Retailers owe" value={money(k.receivables)} tone={m?.overdue > 0 ? 'warning' : undefined} note={m?.overdue > 0 ? `${money(m.overdue)} overdue` : 'Nothing overdue'} />}
            {k.payable != null && <StatCard size="lg" to="/app/wholesale/money?tab=payables" label="You owe principals" value={money(k.payable)} note={m?.payable_due_soon > 0 ? `${money(m.payable_due_soon)} due this week` : undefined} />}
            <StatCard size="lg" label="Gross margin" value={money(k.gross_margin)} note={k.margin_pct != null ? `${pct(k.margin_pct)} this month` : 'No sales yet'} tone={k.gross_margin < 0 ? 'danger' : undefined} />
            {k.stock_value != null && <StatCard size="lg" to="/app/wholesale/inventory" label="Stock value" value={money(k.stock_value)} note={f?.van_stock_value > 0 ? `${money(f.van_stock_value)} on vans` : undefined} />}
            {k.low_stock != null && <StatCard size="lg" to="/app/wholesale/inventory?state=low" label="Low stock" value={k.low_stock} tone={k.low_stock ? 'warning' : undefined} note={k.low_stock ? 'Reorder soon' : 'All above reorder level'} />}
            {k.expiring_stock != null && <StatCard size="lg" to="/app/wholesale/inventory?tab=expiry" label="Expiring stock" value={k.expiring_stock} tone={k.expiring_stock ? 'warning' : undefined} note={k.expiring_stock ? 'Batches expiring or expired' : 'Nothing near expiry'} />}
            <StatCard size="lg" to="/app/wholesale/orders?status=PENDING" label="Pending orders" value={k.pending_orders} tone={k.pending_orders ? 'warning' : undefined} note={k.pending_orders ? 'Waiting to be approved or shipped' : 'Nothing waiting'} />
            {k.pending_deliveries != null && <StatCard size="lg" to="/app/wholesale/fulfilment?tab=deliveries" label="Pending deliveries" value={k.pending_deliveries} tone={k.pending_deliveries ? 'warning' : undefined} note={d.fulfilment ? `${d.fulfilment.out_for_delivery} on the road · ${d.fulfilment.failed_deliveries} failed` : undefined} />}
            <StatCard size="lg" to="/app/wholesale/returns" label="Sales returns" value={money(k.sales_returns)} note={`${plural(k.sales_returns_count, 'credit note')} this month`} />
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Panel title="Sales, last 30 days" lead="Invoiced amounts after returns">
              <Bars data={d.sales.trend.map((x) => ({ label: x.date, value: x.sales }))} every={5} label="Daily sales for the last 30 days" />
            </Panel>
            <TargetCard k={k} month={d.distributor.month} />
          </div>

          <Alerts items={d.alerts || []} />

          {perf && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title="Sales by territory" lead="This month, net of GST"><RankBars rows={perf.by_territory} valueKey="revenue" labelKey="name" empty="No sales yet this month." /></Panel>
              <Panel title="Sales by salesperson" lead="This month"><RankBars rows={perf.by_salesperson} valueKey="revenue" labelKey="name" empty="No sales yet this month." /></Panel>
              <Panel title="Top retailers" lead="This month"><RankBars rows={perf.by_retailer} valueKey="revenue" labelKey="name" empty="No sales yet this month." /></Panel>
              <Panel title="Sales by brand" lead="This month"><RankBars rows={perf.by_brand} valueKey="revenue" labelKey="name" empty="No sales yet this month." /></Panel>
              <Panel title="Top products" lead="This month"><RankBars rows={perf.by_product} valueKey="revenue" labelKey="name" empty="No sales yet this month." /></Panel>
              <Panel title="Sales by category" lead="This month"><RankBars rows={perf.by_category} valueKey="revenue" labelKey="name" empty="No sales yet this month." /></Panel>
              {perf.primary_month != null && (
                <Panel title="Primary and secondary sales" lead="What you bought from principals, against what you sold to retailers, this month">
                  <StackStrip parts={[{ label: 'Bought from principals', value: perf.primary_month, tone: 'bg-brand-300' }, { label: 'Sold to retailers', value: perf.secondary_month, tone: 'bg-brand-600' }]} />
                </Panel>
              )}
            </div>
          )}

          {m && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title="What retailers owe" lead="By how late it is">
                <StackStrip parts={[['current', 'Not due yet'], ['d1_30', '1–30 days'], ['d31_60', '31–60 days'], ['d61_90', '61–90 days'], ['d90_plus', 'Over 90 days']].map(([key, label]) => ({ label, value: m.ageing[key], tone: BUCKET_TONES[key] }))} />
              </Panel>
              <Panel title="Who owes the most" action={<Button to="/app/wholesale/money" variant="ghost">All receivables</Button>}>
                {m.top_debtors.length === 0 ? <EmptyState compact icon={TriangleAlert} title="Nobody owes you" body="Every invoice is paid." /> : (
                  <Table><Thead><Th>Retailer</Th><Th className="text-right">Owes</Th><Th>Oldest due</Th></Thead><tbody>{m.top_debtors.map((c) => <Tr key={c.customer_id}><Td><Link to={`/app/wholesale/customers/${c.customer_id}`} className="font-medium text-brand-700">{c.name}</Link></Td><Td className="text-right tabular">{money(c.owed)}</Td><Td>{c.oldest_due ? new Date(c.oldest_due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</Td></Tr>)}</tbody></Table>
                )}
              </Panel>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {d.distributor.targets?.length > 0 && (
              <Panel title="Salespeople against target" action={<Button to="/app/distributor/team?tab=targets" variant="ghost">Targets</Button>}>
                <ul className="space-y-3">{d.distributor.targets.slice(0, 6).map((t) => (
                  <li key={t.salesperson_id}>
                    <div className="flex justify-between text-small"><span className="font-medium">{t.name}</span><span className="tabular text-ink-500">{pct(t.achievement_pct)}</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${t.status === 'BEHIND' ? 'bg-warning' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, t.achievement_pct)}%` }} /></div>
                  </li>))}</ul>
              </Panel>
            )}
            <Panel title="Field force and vans" action={can('field_sales') ? <Button to="/app/distributor/field" variant="ghost">Open</Button> : undefined}>
              <dl className="space-y-2 text-small">
                <div className="flex justify-between"><dt className="text-ink-500">Visits today</dt><dd className="tabular">{f.visits_today} <span className="text-ink-400">({f.productive_today} productive)</span></dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">Vans on the road</dt><dd className="tabular">{f.vans_active}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">Stock on vans</dt><dd className="tabular">{money(f.van_stock_value)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">Sold from vans today</dt><dd className="tabular">{money(f.van_sales_today)}</dd></div>
              </dl>
            </Panel>
            <Panel title="Schemes" action={<Button to="/app/distributor/schemes" variant="ghost">All schemes</Button>}>
              <dl className="mb-3 space-y-2 text-small"><div className="flex justify-between"><dt className="text-ink-500">Cost this month</dt><dd className="tabular">{money(sc.cost_month)}</dd></div><div className="flex justify-between"><dt className="text-ink-500">Schemes used</dt><dd className="tabular">{sc.in_use}</dd></div></dl>
              {sc.expiring.length === 0 ? <p className="text-small text-ink-500">None end this week.</p> : <ul className="space-y-1.5 text-small">{sc.expiring.map((s) => <li key={s.scheme_id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{s.name}</span><Badge tone="warning">{s.days_left === 0 ? 'today' : `${s.days_left} d`}</Badge></li>)}</ul>}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
};

export default DistributorDashboard;
