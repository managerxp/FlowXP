/* The lounge's front page: what is on now, today and the week in money, and what is waiting to be paid. */
import { Gamepad2, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { rs, rsPaise, useLoad } from '../../lib/gaming.js';
import { Button, DashboardHeader, ListState, StatCard } from '../../components/ui.jsx';
import { Panel } from '../salon/parts.jsx';

export default function GamingDashboard() {
  const { can, business, hasFeature } = useAuth();
  const allowed = can('gaming_setup') || can('reports');
  const d = useLoad(allowed ? '/gaming/dashboard' : null);
  const w = useLoad(allowed && hasFeature('gaming_wallet') ? '/gaming/wallet/liability' : null);
  const data = d.data;
  const max = Math.max(1, ...(data?.last_7_days || []).map((x) => x.gaming + x.fnb));
  return (
    <div>
      <DashboardHeader title={business?.name || 'Gaming lounge'} lead={data ? `${data.playing_now} playing now${data.paused_now ? `, ${data.paused_now} paused` : ''}. ${rs(data.today.total)} today.` : 'Stations, timers and the tab for each.'}
        action={<>{(can('gaming_desk') || can('gaming_setup')) && <Button to="/app/gaming"><Gamepad2 aria-hidden="true" className="h-4 w-4" />Open the board</Button>}</>} />
      {!allowed && <p className="text-small text-ink-500">Open the board to start and stop sessions.</p>}
      <ListState loading={d.loading && !data} error={d.error} />
      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard size="lg" label="Today" value={rs(data.today.total)} note={`${data.today.sessions} session${data.today.sessions === 1 ? '' : 's'}`} />
            <StatCard size="lg" label="Time" value={rs(data.today.gaming)} note={`${data.today.hours_played} hours played`} tone="brand" />
            <StatCard size="lg" label="Food and drink" value={rs(data.today.fnb)} note={`${data.today.fnb_share_pct}% of today`} />
            <StatCard size="lg" label="To collect" value={rs(data.to_collect)} note={`${data.tabs_to_collect} tab${data.tabs_to_collect === 1 ? '' : 's'} stopped, not paid`} tone={data.tabs_to_collect ? 'danger' : undefined} to="/app/gaming" />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Panel title="Last 7 days" lead={`${rs(data.week.total)} · ${data.week.sessions} sessions · ${data.week.hours_played} hours`} className="lg:col-span-2">
              <div className="flex h-40 items-end gap-2" role="img" aria-label={`Takings per day: ${data.last_7_days.map((x) => rs(x.gaming + x.fnb)).join(', ')}`}>
                {data.last_7_days.length === 0 && <p className="text-small text-ink-500">Nothing billed yet this week.</p>}
                {data.last_7_days.map((x) => (
                  <div key={x.date} className="flex flex-1 flex-col items-center gap-1">
                    <span className="tabular text-caption text-ink-500">{Math.round((x.gaming + x.fnb) / 100) / 10}k</span>
                    <div className="flex w-full flex-col justify-end" style={{ height: `${Math.max(6, ((x.gaming + x.fnb) / max) * 96)}px` }}>
                      <span className="w-full bg-brand-200" style={{ height: `${(x.fnb / Math.max(1, x.gaming + x.fnb)) * 100}%` }} />
                      <span className="w-full rounded-t-md bg-brand-500" style={{ height: `${(x.gaming / Math.max(1, x.gaming + x.fnb)) * 100}%` }} />
                    </div>
                    <span className="text-[11px] text-ink-400">{new Date(`${x.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 flex gap-4 text-caption text-ink-500"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500" />Time</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-200" />Food and drink</span></p>
            </Panel>
            <Panel title="Wallets" lead="Prepaid money held for players">
              {w.data ? (
                <dl className="space-y-2 text-small">
                  <div className="flex justify-between"><dt className="text-ink-500">Owed to players</dt><dd className="tabular font-medium">{rsPaise(w.data.owed_paise)}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">With a balance</dt><dd className="tabular font-medium">{w.data.players}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">Topped up this month</dt><dd className="tabular font-medium">{rsPaise(w.data.month_topups_paise)}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">Bonus given</dt><dd className="tabular font-medium">{rsPaise(w.data.month_bonus_paise)}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">Spent this month</dt><dd className="tabular font-medium">{rsPaise(w.data.month_spent_paise)}</dd></div>
                </dl>
              ) : <p className="text-small text-ink-500">{hasFeature('gaming_wallet') ? 'Loading…' : 'Wallets are not part of your plan.'}</p>}
              {hasFeature('gaming_wallet') && <Button className="mt-3" size="sm" variant="secondary" to="/app/gaming/players"><Wallet aria-hidden="true" className="h-4 w-4" />Players and wallet</Button>}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
