/* Gaming reports: money by time and by food, by station, busy hours and games. Every figure comes from billed station tabs. */
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { DAYS, KIND_LABEL, qs, rs, useLoad } from '../../lib/gaming.js';
import { ListState, PageHeader, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Chips, Panel } from '../salon/parts.jsx';
import { useT } from '../../i18n/useT.js';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const PRESETS = [['today', 'Today', 0], ['7', 'Last 7 days', 6], ['30', 'Last 30 days', 29], ['90', 'Last 90 days', 89]];
const HOURS = Array.from({ length: 16 }, (_, i) => 9 + i);
const dayName = Object.fromEntries(DAYS);

export default function GamingReports() {
  const tr = useT();
  const { business } = useAuth();
  const [preset, setPreset] = useState('30');
  const days = PRESETS.find(([k]) => k === preset)[2];
  const range = { from: ago(days), to: ymd(new Date()) };
  const q = qs(range);
  const summary = useLoad(`/gaming/reports/summary${q}`);
  const stations = useLoad(`/gaming/reports/stations${q}`);
  const heat = useLoad(`/gaming/reports/heatmap${q}`);
  const games = useLoad(`/gaming/reports/games${q}`);
  const s = summary.data;
  const cells = new Map((heat.data?.cells || []).map((c) => [`${c.dow}-${c.hour}`, c.sessions]));
  const top = Math.max(1, ...cells.values());

  return (
    <div>
      <PageHeader title={tr('Gaming reports')} lead={`${business?.name || ''}: time and food and drink, from the tabs that were billed.`} />
      <div className="mb-5"><Chips label={tr('Period')} value={preset} onChange={setPreset} options={PRESETS.map(([value, label]) => ({ value, label }))} /></div>
      <ListState loading={summary.loading && !s} error={summary.error} />
      {s && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard size="lg" label={tr('Billed (before GST)')} value={rs(s.total)} note={`${s.bills} bill${s.bills === 1 ? '' : 's'}, average ${rs(s.average_bill)}`} />
            <StatCard size="lg" label={tr('Time')} value={rs(s.gaming)} tone="brand" note={`${s.hours_played} hours in ${s.sessions} sessions`} />
            <StatCard size="lg" label={tr('Food and drink')} value={rs(s.fnb)} note={`${s.fnb_share_pct}% of the total`} />
            <StatCard size="lg" label={tr('Average session')} value={`${s.average_session_minutes} min`} note={`${s.players} named players`} />
          </div>
          <Panel title={tr('By station')} lead={tr('Use is played time against a 12-hour day, on the days the station was used')}>
            <ListState loading={stations.loading && !stations.data} error={stations.error} empty={stations.data && !stations.data.length} emptyLabel={tr('No stations')} />
            {stations.data?.length > 0 && (
              <Table>
                <Thead><Th>{tr('Station')}</Th><Th className="text-right">{tr('Sessions')}</Th><Th className="text-right">{tr('Hours')}</Th><Th className="text-right">{tr('Use')}</Th><Th className="text-right">{tr('Time')}</Th><Th className="text-right">{tr('Food and drink')}</Th><Th className="text-right">{tr('Total')}</Th></Thead>
                <tbody>
                  {stations.data.map((r) => (
                    <Tr key={r.station_id}>
                      <Td><span className="font-medium">{r.name}</span><span className="block text-caption text-ink-500">{KIND_LABEL[r.kind]}{r.zone_name ? ` · ${r.zone_name}` : ''}</span></Td>
                      <Td className="tabular text-right">{r.sessions}</Td><Td className="tabular text-right">{r.hours_played}</Td>
                      <Td className="tabular text-right"><span className="inline-flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3"><span className="block h-full bg-brand-500" style={{ width: `${r.utilisation_pct}%` }} /></span>{r.utilisation_pct}%</span></Td>
                      <Td className="tabular text-right">{rs(r.gaming)}</Td><Td className="tabular text-right">{rs(r.fnb)}</Td><Td className="tabular text-right font-medium">{rs(r.total)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
          <div className="grid gap-5 lg:grid-cols-3">
            <Panel title={tr('Busy hours')} lead={tr('Sessions started, by day and hour')} className="lg:col-span-2">
              <div className="overflow-x-auto">
                <table className="text-caption" aria-label={tr('Sessions started by day and hour')}>
                  <thead><tr><th className="pr-2" />{HOURS.map((h) => <th key={h} className="px-0.5 pb-1 text-center font-normal text-ink-400">{h > 12 ? h - 12 : h}</th>)}</tr></thead>
                  <tbody>
                    {DAYS.map(([dow]) => (
                      <tr key={dow}>
                        <th className="pr-2 text-left font-normal text-ink-500">{dayName[dow]}</th>
                        {HOURS.map((h) => {
                          const n = cells.get(`${dow}-${h}`) || 0;
                          return <td key={h} title={`${n} session${n === 1 ? '' : 's'}`} className="p-0.5"><span className="block h-6 w-6 rounded-sm" style={{ background: n ? `color-mix(in srgb, var(--color-brand-500) ${Math.max(15, Math.round((n / top) * 100))}%, transparent)` : 'var(--color-surface-3)' }} /></td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {heat.data?.peak && <p className="mt-3 text-small text-ink-500">Busiest: {dayName[heat.data.peak.dow]} around {heat.data.peak.hour > 12 ? heat.data.peak.hour - 12 : heat.data.peak.hour} {heat.data.peak.hour >= 12 ? 'pm' : 'am'}.</p>}
            </Panel>
            <Panel title={tr('Most played')}>
              {(games.data || []).length === 0 ? <p className="text-small text-ink-500">{tr('Note the game when you start a session to see this.')}</p> : (
                <ul className="divide-y divide-line text-small">
                  {games.data.map((g) => <li key={g.name} className="flex items-center justify-between py-2"><span className="font-medium text-ink-900">{g.name}</span><span className="tabular text-ink-500">{g.sessions} · {g.hours} h</span></li>)}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
