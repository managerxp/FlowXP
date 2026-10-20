/* Auto parts overview: what is on the shelves, what it is worth, and what is waiting for someone (put-away, holds, supplier claims, reorders). */
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { rsPaise, useLoad } from '../../lib/autoparts.js';
import { ListState, PageHeader, StatCard } from '../../components/ui.jsx';
import { Panel } from '../salon/parts.jsx';
import { useT } from '../../i18n/useT.js';

const Task = ({ to, n, label, hint }) => {
  const tr = useT();
  return (
  <Link to={to} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 hover:border-line-strong">
    <span><span className="block text-small font-medium text-ink-900">{tr(label)}</span><span className="block text-caption text-ink-500">{tr(hint)}</span></span>
    <span className={`tabular text-title font-semibold ${n > 0 ? 'text-brand-700' : 'text-ink-300'}`}>{n}</span>
  </Link>
);
};

export default function PartsHome() {
  const tr = useT();
  const { business } = useAuth();
  const o = useLoad('/autoparts/overview');
  const m = useLoad('/autoparts/reports/movers?limit=5&class=FAST');
  const d = o.data;
  return (
    <div>
      <PageHeader title={tr('Spare parts')} lead={`${business?.name || ''}: stock, racks and what needs doing today.`} />
      <ListState loading={o.loading && !d} error={o.error} />
      {d && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard size="lg" label={tr('Parts in the catalogue')} value={d.parts} note={`${d.parts_in_stock} in stock`} />
            <StatCard size="lg" label={tr('Units on hand')} value={d.units} tone="brand" note={`${d.out_of_stock} parts out of stock`} />
            <StatCard size="lg" label={tr('Stock at cost')} value={rsPaise(d.stock_cost_paise)} note="Purchase price x quantity" />
            <StatCard size="lg" label={tr('Stock at selling price')} value={rsPaise(d.stock_value_paise)} />
          </div>
          <Panel title={tr('Needs doing')}>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Task to="/app/parts/warehouse?tab=putaway" n={d.unassigned_units} label={tr('Units waiting for a bin')} hint={tr('Received but not put on a shelf yet')} />
              <Task to="/app/parts/warehouse?tab=putaway" n={d.open_putaway_tasks} label={tr('Put-away tasks')} hint={tr('Open jobs from receipts and returns')} />
              <Task to="/app/parts/reports?tab=reorder" n={d.below_reorder} label={tr('Below reorder level')} hint={tr('See what to buy')} />
              <Task to="/app/parts/trade?tab=holds" n={d.open_holds} label={tr('Parts held for customers')} hint={tr('{{held_units}} units set aside', { held_units: d.held_units })} />
              <Task to="/app/parts/trade?tab=claims" n={d.open_claims} label={tr('Open supplier claims')} hint={tr('Damaged or rejected goods owed back')} />
            </div>
          </Panel>
          <Panel title={tr('Fastest sellers')} lead={tr('Last 30 days')}>
            {m.data?.parts?.length ? (
              <ul className="divide-y divide-line">
                {m.data.parts.map((p) => (
                  <li key={p.product_id} className="flex items-center justify-between py-2 text-small"><span>{p.name} <span className="text-ink-400">{p.sku}</span></span><span className="tabular">{tr('{{sold_30}} sold, {{on_hand}} left', { sold_30: p.sold_30, on_hand: p.on_hand })}</span></li>
                ))}
              </ul>
            ) : <p className="text-small text-ink-500">{tr('Sales will show here once you have billed some parts.')}</p>}
          </Panel>
        </div>
      )}
    </div>
  );
}
