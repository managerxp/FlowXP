/*
 * How the kitchen has been performing: preparation time is from the moment a
 * line was sent to the kitchen until it was marked ready. "On time" means ready
 * within the time the dish is set up to take. Everything compares with the equal
 * period just before, so "Biryani went from 18 to 27 minutes" is visible.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { daysAgoISO } from '../lib/dates.js';
import { Alert, Card, DataTable, PageHeader } from '../components/ui.jsx';

const RANGES = [{ days: 7, label: '7 days' }, { days: 14, label: '14 days' }, { days: 30, label: '30 days' }];
const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
const min = (n) => (n == null ? '—' : `${n} min`);

const Change = ({ value }) => {
  if (value == null || value === 0) return <span className="text-ink-400">—</span>;
  return <span className={value > 0 ? 'font-semibold text-danger' : 'font-semibold text-success'}>{value > 0 ? '▲' : '▼'} {Math.abs(value)} min</span>;
};

const Stat = ({ label, value, sub }) => (
  <div className="glass rounded-[--radius-card] p-4">
    <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</p>
    <p className="mt-1 text-xl font-bold text-ink-900">{value}</p>
    <p className="text-xs text-ink-400">{sub}</p>
  </div>
);

const KitchenPerformancePage = () => {
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    api(`/kitchen/performance?from=${daysAgoISO(days - 1)}&to=${daysAgoISO(0)}`).then(setData)
      .catch((e) => setError(e.status === 403 ? 'You need report access to see kitchen performance.' : e.message));
  }, [days]);

  const o = data?.overall; const p = data?.previous;
  const slowest = data?.items.filter((i) => i.change_minutes != null && i.change_minutes >= 2).slice(0, 3) ?? [];
  const peak = Math.max(...(data?.hours.map((h) => h.avg_minutes) ?? [1]), 1);

  return (
    <div>
      <PageHeader title="Kitchen performance" lead="How long dishes take from being sent to being ready." action={<Link to="/app/kitchen" className="text-sm font-semibold text-brand-600">← Kitchen display</Link>} />

      <div className="mb-5 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button key={r.days} type="button" onClick={() => setDays(r.days)} aria-pressed={days === r.days}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${days === r.days ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-line-strong bg-surface text-ink-700'}`}>Last {r.label}</button>
        ))}
      </div>

      <Alert>{error}</Alert>
      {!data && !error && <p className="py-10 text-center text-sm text-ink-400">Reading the tickets…</p>}

      {data && o.lines === 0 && (
        <p className="rounded-[--radius-card] border border-dashed border-line-strong py-10 text-center text-sm text-ink-500">
          No finished tickets in this period yet. Times are recorded from when an order is sent to the kitchen until the kitchen marks it ready.
        </p>
      )}

      {data && o.lines > 0 && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Average preparation" value={min(o.avg_minutes)} sub={p.lines ? `${min(p.avg_minutes)} in the period before` : 'no earlier period to compare'} />
            <Stat label="Slowest 1 in 10" value={min(o.p90_minutes)} sub="90% of items were ready by then" />
            <Stat label="Ready on time" value={o.on_time_pct == null ? '—' : `${o.on_time_pct}%`} sub={p.on_time_pct != null ? `${p.on_time_pct}% before` : 'within each dish’s set time'} />
            <Stat label="Items prepared" value={o.lines} sub={`over ${data.period.days} days`} />
          </div>

          {slowest.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-ink-900">Getting slower</h2>
              <ul className="mt-2 space-y-1 text-sm text-ink-700">
                {slowest.map((i) => <li key={i.name}><strong>{i.name}</strong> now averages {i.avg_minutes} minutes, up from {i.previous_avg_minutes}.</li>)}
              </ul>
              <p className="mt-2 text-xs text-ink-400">Worth asking: is it staffing at peak, a missing ingredient, a change to how it is made — or does the set time need updating?</p>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink-900">By station</h2>
              <DataTable keyField="name" rows={data.stations} emptyLabel="—" columns={[
                { key: 'name', label: 'Station' },
                { key: 'lines', label: 'Items', align: 'right' },
                { key: 'avg_minutes', label: 'Average', align: 'right', render: (r) => min(r.avg_minutes) },
                { key: 'p90_minutes', label: 'Slowest 1 in 10', align: 'right', render: (r) => min(r.p90_minutes) },
                { key: 'on_time_pct', label: 'On time', align: 'right', render: (r) => (r.on_time_pct == null ? '—' : `${r.on_time_pct}%`) }
              ]} />
            </div>
            <Card>
              <h2 className="text-sm font-semibold text-ink-900">Average time by hour sent</h2>
              <div className="mt-4 flex h-32 items-end gap-1.5" role="img" aria-label="Average preparation minutes by hour">
                {data.hours.map((h) => (
                  <div key={h.hour} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${hourLabel(h.hour)}: ${h.avg_minutes} min over ${h.lines} items`}>
                    <span className="text-[10px] text-ink-500">{Math.round(h.avg_minutes)}</span>
                    <div className={`w-full rounded-t-sm ${h.avg_minutes >= peak * 0.9 ? 'bg-warning' : 'bg-brand-500/50'}`} style={{ height: `${(h.avg_minutes / peak) * 100}%` }} />
                    <span className="text-[10px] text-ink-400">{hourLabel(h.hour)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-400">Busy hours usually run slower; a big gap here is a staffing question.</p>
            </Card>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink-900">By dish <span className="font-normal text-ink-400">— dishes with at least 3 finished items</span></h2>
            <DataTable keyField="name" rows={data.items} searchPlaceholder="Search dishes…" emptyLabel="Not enough finished items per dish yet." columns={[
              { key: 'name', label: 'Dish' },
              { key: 'lines', label: 'Items', align: 'right' },
              { key: 'expected_minutes', label: 'Set time', align: 'right', render: (r) => min(r.expected_minutes) },
              { key: 'avg_minutes', label: 'Average', align: 'right', render: (r) => min(r.avg_minutes) },
              { key: 'p90_minutes', label: 'Slowest 1 in 10', align: 'right', render: (r) => min(r.p90_minutes) },
              { key: 'on_time_pct', label: 'On time', align: 'right', render: (r) => (r.on_time_pct == null ? '—' : `${r.on_time_pct}%`) },
              { key: 'change_minutes', label: 'vs before', align: 'right', searchValue: () => '', render: (r) => <Change value={r.change_minutes} /> }
            ]} />
          </div>
        </div>
      )}
    </div>
  );
};

export default KitchenPerformancePage;
