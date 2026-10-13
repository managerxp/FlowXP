/* Auto parts overview: what is on the shelves, what it is worth, and what is waiting for someone (put-away, holds, supplier claims, reorders). */
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { rsPaise, useLoad } from '../../lib/autoparts.js';
import { ListState, PageHeader, StatCard } from '../../components/ui.jsx';
import { Panel } from '../salon/parts.jsx';

const Task = ({ to, n, label, hint }) => (
  <Link to={to} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 hover:border-line-strong">
    <span><span className="block text-small font-medium text-ink-900">{label}</span><span className="block text-caption text-ink-500">{hint}</span></span>
    <span className={`tabular text-title font-semibold ${n > 0 ? 'text-brand-700' : 'text-ink-300'}`}>{n}</span>
  </Link>
);

export default function PartsHome() {
  const { business } = useAuth();
  const o = useLoad('/autoparts/overview');
  const m = useLoad('/autoparts/reports/movers?limit=5&class=FAST');
  const d = o.data;
  return (
    <div>
      <PageHeader title="Spare parts" lead={`${business?.name || ''}: stock, racks and what needs doing today.`} />
      <ListState loading={o.loading && !d} error={o.error} />
      {d && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard size="lg" label="Parts in the catalogue" value={d.parts} note={`${d.parts_in_stock} in stock`} />
            <StatCard size="lg" label="Units on hand" value={d.units} tone="brand" note={`${d.out_of_stock} parts out of stock`} />
            <StatCard size="lg" label="Stock at cost" value={rsPaise(d.stock_cost_paise)} note="Purchase price x quantity" />
            <StatCard size="lg" label="Stock at selling price" value={rsPaise(d.stock_value_paise)} />
          </div>
          <Panel title="Needs doing">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Task to="/app/parts/warehouse?tab=putaway" n={d.unassigned_units} label="Units waiting for a bin" hint="Received but not put on a shelf yet" />
              <Task to="/app/parts/warehouse?tab=putaway" n={d.open_putaway_tasks} label="Put-away tasks" hint="Open jobs from receipts and returns" />
              <Task to="/app/parts/reports?tab=reorder" n={d.below_reorder} label="Below reorder level" hint="See what to buy" />
              <Task to="/app/parts/trade?tab=holds" n={d.open_holds} label="Parts held for customers" hint={`${d.held_units} units set aside`} />
              <Task to="/app/parts/trade?tab=claims" n={d.open_claims} label="Open supplier claims" hint="Damaged or rejected goods owed back" />
            </div>
          </Panel>
          <Panel title="Fastest sellers" lead="Last 30 days">
            {m.data?.parts?.length ? (
              <ul className="divide-y divide-line">
                {m.data.parts.map((p) => (
                  <li key={p.product_id} className="flex items-center justify-between py-2 text-small"><span>{p.name} <span className="text-ink-400">{p.sku}</span></span><span className="tabular">{p.sold_30} sold, {p.on_hand} left</span></li>
                ))}
              </ul>
            ) : <p className="text-small text-ink-500">Sales will show here once you have billed some parts.</p>}
          </Panel>
        </div>
      )}
    </div>
  );
}
