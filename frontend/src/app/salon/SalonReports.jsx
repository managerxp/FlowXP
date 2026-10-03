/*
 * Salon reports: the catalogue the server offers, grouped (sales, customers, staff, inventory, financial,
 * loyalty), each a table over a date range with totals, exportable as CSV. The figures are computed by the
 * server from the same bills, stock ledger and expenses as everything else — nothing here is recalculated.
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, Lock } from 'lucide-react';
import { formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { addDays, longDate, qs, saveCsv, todayIn, useLoad } from '../../lib/salon.js';
import { Button, EmptyState, Input, ListState, PageHeader, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Chips } from './parts.jsx';

const fmt = (v, type) => {
  if (v == null || v === '') return '—';
  if (type === 'money') return formatCurrency(v);
  if (type === 'number') return Number(v).toLocaleString('en-IN');
  if (type === 'percent') return `${v}%`;
  if (type === 'date') return longDate(v);
  return String(v);
};
const align = (type) => (['money', 'number', 'percent'].includes(type) ? 'text-right tabular' : '');

const PRESETS = [
  ['7', 'Last 7 days', (t) => [addDays(t, -6), t]],
  ['30', 'Last 30 days', (t) => [addDays(t, -29), t]],
  ['month', 'This month', (t) => [t.slice(0, 8) + '01', t]],
  ['90', 'Last 90 days', (t) => [addDays(t, -89), t]],
  ['year', 'This year', (t) => [`${t.slice(0, 4)}-01-01`, t]]
];

const SalonReports = () => {
  const { hasFeature } = useAuth();
  const today = todayIn();
  const catalog = useLoad('/salon/reports');
  const [report, setReport] = useState('sales-daily');
  const [preset, setPreset] = useState('30');
  const [range, setRange] = useState(() => PRESETS[1][2](today));
  const [from, to] = range;
  const data = useLoad(report ? `/salon/reports/${report}${qs({ from, to })}` : null);
  const groups = useMemo(() => Object.entries(catalog.data || {}), [catalog.data]);
  const current = useMemo(() => groups.flatMap(([g, list]) => list.map((r) => ({ ...r, group: g }))).find((r) => r.key === report), [groups, report]);
  useEffect(() => { if (catalog.data && !current) { const first = Object.values(catalog.data)[0]?.[0]; if (first) setReport(first.key); } }, [catalog.data, current]);

  const pick = (p) => { setPreset(p); setRange(PRESETS.find((x) => x[0] === p)[2](today)); };
  const d = data.data;
  const locked = data.error && /Advanced reports|not on your plan/i.test(data.error);

  const exportCsv = () => {
    if (!d) return;
    const cols = d.columns.map((c) => ({ key: c.key, label: c.label }));
    const rows = [...d.rows, ...(d.totals ? [{ [d.columns[0].key]: 'Total', ...d.totals }] : [])];
    saveCsv(`${report}-${from}-to-${to}.csv`, cols, rows);
  };

  return (
    <div>
      <PageHeader title="Reports" lead="Sales, clients, team, stock and money — for any dates you choose."
                  action={<Button variant="secondary" onClick={exportCsv} disabled={!d || !d.rows.length}><Download aria-hidden="true" className="h-4 w-4" />Export CSV</Button>} />
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Reports" className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <ListState loading={catalog.loading && !catalog.data} error={catalog.error} />
          {groups.map(([group, list]) => (
            <div key={group}>
              <p className="mb-0.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">{group}</p>
              <div className="space-y-0.5">
                {list.map((r) => <button key={r.key} type="button" onClick={() => setReport(r.key)} aria-current={report === r.key ? 'page' : undefined} className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-small transition-colors ${report === r.key ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-700 hover:bg-surface-2'}`}><span className="flex items-center justify-between gap-2">{r.title}{r.advanced && !hasFeature('advanced_reports') && <Lock aria-label="Part of Advanced reports" className="h-3.5 w-3.5 shrink-0 text-ink-400" />}</span></button>)}
              </div>
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Chips label="Period" value={preset} onChange={pick} options={PRESETS.map(([value, label]) => ({ value, label }))} />
            <div className="flex items-center gap-2 text-small text-ink-500">
              <div className="w-36"><Input type="date" aria-label="From" value={from} max={to} onChange={(e) => { if (e.target.value) { setPreset(''); setRange([e.target.value, to]); } }} /></div>to
              <div className="w-36"><Input type="date" aria-label="To" value={to} min={from} max={today} onChange={(e) => { if (e.target.value) { setPreset(''); setRange([from, e.target.value]); } }} /></div>
            </div>
          </div>

          <h2 className="mb-3 text-title font-semibold text-ink-900">{d?.title || current?.title || 'Report'}</h2>
          {locked && <EmptyState icon={Lock} title="Part of Advanced reports" body="This report is not on your plan. See Settings → Subscription to add it." />}
          {!locked && <ListState loading={data.loading && !d} error={data.error} empty={d && d.rows.length === 0} emptyLabel="No data for these dates." emptyBody="Try a longer period." />}
          {d && d.rows.length > 0 && (
            <div className={data.loading ? 'opacity-60 transition-opacity' : ''}>
              <Table>
                <Thead>{d.columns.map((c) => <Th key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'text-right' : ''}>{c.label}</Th>)}</Thead>
                <tbody>
                  {d.rows.map((r, i) => (
                    <Tr key={i} className={r.strong ? 'bg-surface-2 font-semibold' : ''}>
                      {d.columns.map((c, j) => <Td key={c.key} className={`${align(c.type)} ${j === 0 && !align(c.type) ? 'font-medium' : ''}`}>{fmt(r[c.key], c.type)}</Td>)}
                    </Tr>
                  ))}
                  {d.totals && (
                    <tr className="border-t-2 border-line-strong bg-surface-2 font-semibold">
                      {d.columns.map((c, j) => <td key={c.key} className={`px-4 py-3 ${align(c.type)}`}>{j === 0 ? 'Total' : fmt(d.totals[c.key], c.type)}</td>)}
                    </tr>
                  )}
                </tbody>
              </Table>
              {d.note && <p className="mt-3 text-caption text-ink-500">{d.note}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SalonReports;
