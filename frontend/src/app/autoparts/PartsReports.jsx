/* Parts reports: what sells and what sits, stock age, what to buy, supplier quality, stock value and how full the racks are. Every list can be downloaded; suggestions never change anything. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { downloadFile } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { MOVER_TONE, n3, qs, rsPaise, useLoad } from '../../lib/autoparts.js';
import { Badge, ListState, PageHeader, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Chips, Panel, Tabs } from '../salon/parts.jsx';
import { T, useT } from '../../i18n/useT.js';

const Csv = ({ path }) => {
  const tr = useT();
  const [err, setErr] = useState('');
  const file = `${path.split('?')[0].split('/').pop()}.csv`;
  return (
    <span>
      <button type="button" onClick={() => downloadFile(`${path}${path.includes('?') ? '&' : '?'}format=csv`, file).catch((e) => setErr(e.message))} className="inline-flex items-center gap-1 text-small font-semibold text-brand-600"><Download aria-hidden="true" className="h-4 w-4" /> {tr('Download')}</button>
      {err && <span className="ml-2 text-caption text-danger">{err}</span>}
    </span>
  );
};

const Movers = () => {
  const tr = useT();
  const [cls, setCls] = useState('');
  const path = `/autoparts/reports/movers${qs({ class: cls, limit: 200 })}`;
  const m = useLoad(path);
  const d = m.data;
  return (
    <div className="space-y-4">
      <Chips label={tr('Class')} value={cls} onChange={setCls} options={[{ value: '', label: T('All') }, ...['FAST', 'SLOW', 'DEAD'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))]} />
      <ListState loading={m.loading && !d} error={m.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {['FAST', 'MEDIUM', 'SLOW', 'DEAD'].map((k) => <StatCard key={k} label={k.charAt(0) + k.slice(1).toLowerCase()} value={d.summary[k]?.parts || 0} note={`${rsPaise(d.summary[k]?.stock_cost_paise || 0)} at cost`} />)}
          </div>
          <p className="text-caption text-ink-500">{tr('Fast: {{fast}}. Slow: {{slow}}. Dead: {{dead}}.', { fast: d.rules.fast, slow: d.rules.slow, dead: d.rules.dead })}</p>
          <Panel action={<Csv path={path} />} className="!p-0">
            <Table>
              <Thead><Th>{tr('Part')}</Th><Th>{tr('Class')}</Th><Th className="text-right">{tr('Sold 30 days')}</Th><Th className="text-right">{tr('Sold 90 days')}</Th><Th className="text-right">{tr('On hand')}</Th><Th className="text-right">{tr('Cover (days)')}</Th><Th className="text-right">{tr('Idle (days)')}</Th><Th className="text-right">{tr('Value at cost')}</Th></Thead>
              <tbody>{d.parts.map((p) => (<Tr key={p.product_id}><Td>{p.name}<span className="block text-caption text-ink-500">{p.sku}</span></Td><Td><Badge tone={MOVER_TONE[p.class]}>{p.class.toLowerCase()}</Badge></Td><Td className="tabular text-right">{n3(p.sold_30)}</Td><Td className="tabular text-right">{n3(p.sold_90)}</Td><Td className="tabular text-right">{n3(p.on_hand)}</Td><Td className="tabular text-right">{p.days_of_cover ?? '-'}</Td><Td className="tabular text-right">{p.idle_days}</Td><Td className="tabular text-right">{rsPaise(p.stock_cost_paise)}</Td></Tr>))}</tbody>
            </Table>
          </Panel>
        </>
      )}
    </div>
  );
};

const Ageing = () => {
  const tr = useT();
  const a = useLoad('/autoparts/reports/ageing');
  return (
    <Panel title={tr('Stock age')} lead={a.data?.basis} action={<Csv path="/autoparts/reports/ageing" />}>
      <ListState loading={a.loading && !a.data} error={a.error} />
      {a.data && <Table><Thead><Th>{tr('Age')}</Th><Th className="text-right">{tr('Parts')}</Th><Th className="text-right">{tr('Units')}</Th><Th className="text-right">{tr('At cost')}</Th></Thead><tbody>{a.data.buckets.map((b) => (<Tr key={b.label}><Td>{tr('{{label}} days', { label: b.label })}</Td><Td className="tabular text-right">{b.parts}</Td><Td className="tabular text-right">{n3(b.units)}</Td><Td className="tabular text-right">{rsPaise(b.cost_paise)}</Td></Tr>))}</tbody></Table>}
    </Panel>
  );
};

const Reorder = () => {
  const tr = useT();
  const r = useLoad('/autoparts/reports/reorder');
  const d = r.data;
  return (
    <Panel title={tr('What to buy')} lead={d?.note} action={<Csv path="/autoparts/reports/reorder" />} className="!p-0">
      <div className="p-5"><ListState loading={r.loading && !d} error={r.error} empty={d && d.parts.length === 0} emptyLabel={tr('Nothing needs buying right now.')} /></div>
      {d?.parts.length > 0 && (
        <Table>
          <Thead><Th>{tr('Part')}</Th><Th>{tr('Supplier')}</Th><Th className="text-right">{tr('On hand')}</Th><Th className="text-right">{tr('On order')}</Th><Th className="text-right">{tr('Suggested')}</Th><Th className="text-right">{tr('Cost')}</Th><Th>{tr('Why')}</Th></Thead>
          <tbody>{d.parts.map((p) => (<Tr key={p.product_id}><Td>{p.name}<span className="block text-caption text-ink-500">{p.sku}</span></Td><Td>{p.supplier || '-'}</Td><Td className="tabular text-right">{n3(p.on_hand)}</Td><Td className="tabular text-right">{n3(p.on_order)}</Td><Td className="tabular text-right font-medium">{p.suggested_qty}</Td><Td className="tabular text-right">{rsPaise(p.est_cost_paise)}</Td><Td className="text-caption text-ink-500">{p.rule}</Td></Tr>))}</tbody>
        </Table>
      )}
    </Panel>
  );
};

const Suppliers = () => {
  const tr = useT();
  const s = useLoad('/autoparts/reports/suppliers');
  return (
    <Panel title={tr('Supplier quality')} lead={tr('From the receipts you have booked')} action={<Csv path="/autoparts/reports/suppliers" />} className="!p-0">
      <div className="p-5"><ListState loading={s.loading && !s.data} error={s.error} empty={s.data && s.data.length === 0} emptyLabel={tr('Book a receipt to see supplier figures.')} /></div>
      {s.data?.length > 0 && (
        <Table>
          <Thead><Th>{tr('Supplier')}</Th><Th className="text-right">{tr('Receipts')}</Th><Th className="text-right">{tr('Arrived')}</Th><Th className="text-right">{tr('Damaged')}</Th><Th className="text-right">{tr('Rejected')}</Th><Th className="text-right">{tr('Order filled')}</Th><Th className="text-right">{tr('Days to deliver')}</Th><Th className="text-right">{tr('Open claims')}</Th></Thead>
          <tbody>{s.data.map((x) => (<Tr key={x.supplier_id}><Td className="font-medium">{x.supplier}</Td><Td className="tabular text-right">{x.receipts}</Td><Td className="tabular text-right">{n3(x.received)}</Td><Td className="tabular text-right">{x.damaged_pct ?? '-'}%</Td><Td className="tabular text-right">{x.rejected_pct ?? '-'}%</Td><Td className="tabular text-right">{x.fill_rate_pct != null ? `${x.fill_rate_pct}%` : '-'}</Td><Td className="tabular text-right">{x.lead_days ?? '-'}</Td><Td className="tabular text-right">{x.open_claims}</Td></Tr>))}</tbody>
        </Table>
      )}
    </Panel>
  );
};

const Value = ({ can }) => {
  const tr = useT();
  const v = useLoad(can ? '/autoparts/reports/valuation' : null);
  const o = useLoad('/autoparts/reports/occupancy');
  return (
    <div className="space-y-5">
      {can && (
        <Panel title={tr('Stock value')} action={<Csv path="/autoparts/reports/valuation" />}>
          <ListState loading={v.loading && !v.data} error={v.error} />
          {v.data && (<>
            <p className="mb-3 text-small text-ink-700">At cost {rsPaise(v.data.total_cost_paise)}; at selling price {rsPaise(v.data.total_sell_paise)}.</p>
            <Table><Thead><Th>{tr('Category')}</Th><Th className="text-right">{tr('Parts')}</Th><Th className="text-right">{tr('Units')}</Th><Th className="text-right">{tr('At cost')}</Th><Th className="text-right">{tr('At selling price')}</Th></Thead><tbody>{v.data.categories.map((c) => (<Tr key={c.category}><Td>{c.category}</Td><Td className="tabular text-right">{c.parts}</Td><Td className="tabular text-right">{n3(c.units)}</Td><Td className="tabular text-right">{rsPaise(c.cost_paise)}</Td><Td className="tabular text-right">{rsPaise(c.sell_paise)}</Td></Tr>))}</tbody></Table></>)}
        </Panel>
      )}
      <Panel title={tr('Rack use')}>
        <ListState loading={o.loading && !o.data} error={o.error} />
        {o.data && (<div className="space-y-3 text-small text-ink-700">
          <p>{o.data.occupied} of {o.data.storing_locations} bins hold stock; {o.data.empty} are empty{o.data.fill_pct != null ? `; bins with a limit are ${o.data.fill_pct}% full` : ''}.</p>
          {o.data.over_capacity.length > 0 && <p className="text-danger">{tr('Over their limit: {{v}}', { v: o.data.over_capacity.map((x) => `${x.code} (${n3(x.qty)} of ${n3(x.capacity)})`).join(', ') })}</p>}
          {o.data.fullest.length > 0 && <p>{tr('Fullest: {{v}}', { v: o.data.fullest.map((x) => `${x.code} ${x.pct}%`).join(', ') })}</p>}
          {o.data.empty_locations.length > 0 && <p>{tr('Empty: {{v}}', { v: o.data.empty_locations.join(', ') })}</p>}
        </div>)}
      </Panel>
    </div>
  );
};

export default function PartsReports() {
  const tr = useT();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'movers';
  return (
    <div>
      <PageHeader title={tr('Parts reports')} lead={tr('Read-only. The suggestions are rules applied to your own sales and stock, shown with the reason.')} />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ key: 'movers', label: T('Fast and dead stock') }, { key: 'ageing', label: T('Stock age') }, { key: 'reorder', label: T('What to buy') }, { key: 'suppliers', label: T('Suppliers') }, { key: 'value', label: T('Value and racks') }]} />
      {tab === 'movers' && <Movers />}
      {tab === 'ageing' && <Ageing />}
      {tab === 'reorder' && <Reorder />}
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'value' && <Value can={can('valuation')} />}
    </div>
  );
}
