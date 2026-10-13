/* Parts reports: what sells and what sits, stock age, what to buy, supplier quality, stock value and how full the racks are. Every list can be downloaded; suggestions never change anything. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { downloadFile } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { MOVER_TONE, n3, qs, rsPaise, useLoad } from '../../lib/autoparts.js';
import { Badge, ListState, PageHeader, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Chips, Panel, Tabs } from '../salon/parts.jsx';

const Csv = ({ path }) => {
  const [err, setErr] = useState('');
  const file = `${path.split('?')[0].split('/').pop()}.csv`;
  return (
    <span>
      <button type="button" onClick={() => downloadFile(`${path}${path.includes('?') ? '&' : '?'}format=csv`, file).catch((e) => setErr(e.message))} className="inline-flex items-center gap-1 text-small font-semibold text-brand-600"><Download aria-hidden="true" className="h-4 w-4" /> Download</button>
      {err && <span className="ml-2 text-caption text-danger">{err}</span>}
    </span>
  );
};

const Movers = () => {
  const [cls, setCls] = useState('');
  const path = `/autoparts/reports/movers${qs({ class: cls, limit: 200 })}`;
  const m = useLoad(path);
  const d = m.data;
  return (
    <div className="space-y-4">
      <Chips label="Class" value={cls} onChange={setCls} options={[{ value: '', label: 'All' }, ...['FAST', 'SLOW', 'DEAD'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))]} />
      <ListState loading={m.loading && !d} error={m.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {['FAST', 'MEDIUM', 'SLOW', 'DEAD'].map((k) => <StatCard key={k} label={k.charAt(0) + k.slice(1).toLowerCase()} value={d.summary[k]?.parts || 0} note={`${rsPaise(d.summary[k]?.stock_cost_paise || 0)} at cost`} />)}
          </div>
          <p className="text-caption text-ink-500">Fast: {d.rules.fast}. Slow: {d.rules.slow}. Dead: {d.rules.dead}.</p>
          <Panel action={<Csv path={path} />} className="!p-0">
            <Table>
              <Thead><Th>Part</Th><Th>Class</Th><Th className="text-right">Sold 30 days</Th><Th className="text-right">Sold 90 days</Th><Th className="text-right">On hand</Th><Th className="text-right">Cover (days)</Th><Th className="text-right">Idle (days)</Th><Th className="text-right">Value at cost</Th></Thead>
              <tbody>{d.parts.map((p) => (<Tr key={p.product_id}><Td>{p.name}<span className="block text-caption text-ink-500">{p.sku}</span></Td><Td><Badge tone={MOVER_TONE[p.class]}>{p.class.toLowerCase()}</Badge></Td><Td className="tabular text-right">{n3(p.sold_30)}</Td><Td className="tabular text-right">{n3(p.sold_90)}</Td><Td className="tabular text-right">{n3(p.on_hand)}</Td><Td className="tabular text-right">{p.days_of_cover ?? '-'}</Td><Td className="tabular text-right">{p.idle_days}</Td><Td className="tabular text-right">{rsPaise(p.stock_cost_paise)}</Td></Tr>))}</tbody>
            </Table>
          </Panel>
        </>
      )}
    </div>
  );
};

const Ageing = () => {
  const a = useLoad('/autoparts/reports/ageing');
  return (
    <Panel title="Stock age" lead={a.data?.basis} action={<Csv path="/autoparts/reports/ageing" />}>
      <ListState loading={a.loading && !a.data} error={a.error} />
      {a.data && <Table><Thead><Th>Age</Th><Th className="text-right">Parts</Th><Th className="text-right">Units</Th><Th className="text-right">At cost</Th></Thead><tbody>{a.data.buckets.map((b) => (<Tr key={b.label}><Td>{b.label} days</Td><Td className="tabular text-right">{b.parts}</Td><Td className="tabular text-right">{n3(b.units)}</Td><Td className="tabular text-right">{rsPaise(b.cost_paise)}</Td></Tr>))}</tbody></Table>}
    </Panel>
  );
};

const Reorder = () => {
  const r = useLoad('/autoparts/reports/reorder');
  const d = r.data;
  return (
    <Panel title="What to buy" lead={d?.note} action={<Csv path="/autoparts/reports/reorder" />} className="!p-0">
      <div className="p-5"><ListState loading={r.loading && !d} error={r.error} empty={d && d.parts.length === 0} emptyLabel="Nothing needs buying right now." /></div>
      {d?.parts.length > 0 && (
        <Table>
          <Thead><Th>Part</Th><Th>Supplier</Th><Th className="text-right">On hand</Th><Th className="text-right">On order</Th><Th className="text-right">Suggested</Th><Th className="text-right">Cost</Th><Th>Why</Th></Thead>
          <tbody>{d.parts.map((p) => (<Tr key={p.product_id}><Td>{p.name}<span className="block text-caption text-ink-500">{p.sku}</span></Td><Td>{p.supplier || '-'}</Td><Td className="tabular text-right">{n3(p.on_hand)}</Td><Td className="tabular text-right">{n3(p.on_order)}</Td><Td className="tabular text-right font-medium">{p.suggested_qty}</Td><Td className="tabular text-right">{rsPaise(p.est_cost_paise)}</Td><Td className="text-caption text-ink-500">{p.rule}</Td></Tr>))}</tbody>
        </Table>
      )}
    </Panel>
  );
};

const Suppliers = () => {
  const s = useLoad('/autoparts/reports/suppliers');
  return (
    <Panel title="Supplier quality" lead="From the receipts you have booked" action={<Csv path="/autoparts/reports/suppliers" />} className="!p-0">
      <div className="p-5"><ListState loading={s.loading && !s.data} error={s.error} empty={s.data && s.data.length === 0} emptyLabel="Book a receipt to see supplier figures." /></div>
      {s.data?.length > 0 && (
        <Table>
          <Thead><Th>Supplier</Th><Th className="text-right">Receipts</Th><Th className="text-right">Arrived</Th><Th className="text-right">Damaged</Th><Th className="text-right">Rejected</Th><Th className="text-right">Order filled</Th><Th className="text-right">Days to deliver</Th><Th className="text-right">Open claims</Th></Thead>
          <tbody>{s.data.map((x) => (<Tr key={x.supplier_id}><Td className="font-medium">{x.supplier}</Td><Td className="tabular text-right">{x.receipts}</Td><Td className="tabular text-right">{n3(x.received)}</Td><Td className="tabular text-right">{x.damaged_pct ?? '-'}%</Td><Td className="tabular text-right">{x.rejected_pct ?? '-'}%</Td><Td className="tabular text-right">{x.fill_rate_pct != null ? `${x.fill_rate_pct}%` : '-'}</Td><Td className="tabular text-right">{x.lead_days ?? '-'}</Td><Td className="tabular text-right">{x.open_claims}</Td></Tr>))}</tbody>
        </Table>
      )}
    </Panel>
  );
};

const Value = ({ can }) => {
  const v = useLoad(can ? '/autoparts/reports/valuation' : null);
  const o = useLoad('/autoparts/reports/occupancy');
  return (
    <div className="space-y-5">
      {can && (
        <Panel title="Stock value" action={<Csv path="/autoparts/reports/valuation" />}>
          <ListState loading={v.loading && !v.data} error={v.error} />
          {v.data && (<>
            <p className="mb-3 text-small text-ink-700">At cost {rsPaise(v.data.total_cost_paise)}; at selling price {rsPaise(v.data.total_sell_paise)}.</p>
            <Table><Thead><Th>Category</Th><Th className="text-right">Parts</Th><Th className="text-right">Units</Th><Th className="text-right">At cost</Th><Th className="text-right">At selling price</Th></Thead><tbody>{v.data.categories.map((c) => (<Tr key={c.category}><Td>{c.category}</Td><Td className="tabular text-right">{c.parts}</Td><Td className="tabular text-right">{n3(c.units)}</Td><Td className="tabular text-right">{rsPaise(c.cost_paise)}</Td><Td className="tabular text-right">{rsPaise(c.sell_paise)}</Td></Tr>))}</tbody></Table></>)}
        </Panel>
      )}
      <Panel title="Rack use">
        <ListState loading={o.loading && !o.data} error={o.error} />
        {o.data && (<div className="space-y-3 text-small text-ink-700">
          <p>{o.data.occupied} of {o.data.storing_locations} bins hold stock; {o.data.empty} are empty{o.data.fill_pct != null ? `; bins with a limit are ${o.data.fill_pct}% full` : ''}.</p>
          {o.data.over_capacity.length > 0 && <p className="text-danger">Over their limit: {o.data.over_capacity.map((x) => `${x.code} (${n3(x.qty)} of ${n3(x.capacity)})`).join(', ')}</p>}
          {o.data.fullest.length > 0 && <p>Fullest: {o.data.fullest.map((x) => `${x.code} ${x.pct}%`).join(', ')}</p>}
          {o.data.empty_locations.length > 0 && <p>Empty: {o.data.empty_locations.join(', ')}</p>}
        </div>)}
      </Panel>
    </div>
  );
};

export default function PartsReports() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'movers';
  return (
    <div>
      <PageHeader title="Parts reports" lead="Read-only. The suggestions are rules applied to your own sales and stock, shown with the reason." />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ key: 'movers', label: 'Fast and dead stock' }, { key: 'ageing', label: 'Stock age' }, { key: 'reorder', label: 'What to buy' }, { key: 'suppliers', label: 'Suppliers' }, { key: 'value', label: 'Value and racks' }]} />
      {tab === 'movers' && <Movers />}
      {tab === 'ageing' && <Ageing />}
      {tab === 'reorder' && <Reorder />}
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'value' && <Value can={can('valuation')} />}
    </div>
  );
}
