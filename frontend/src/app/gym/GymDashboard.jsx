/* The gym's front page: who is in, how many members stand where, what was sold, and who needs a call. */
import { Link } from 'react-router-dom';
import { DoorOpen, Plus, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { REASON, longDate, rsPaise, useLoad } from '../../lib/gym.js';
import { Button, DashboardHeader, ListState, StatCard } from '../../components/ui.jsx';
import { Panel } from '../salon/parts.jsx';

const TILES = [['ACTIVE', 'Active members', 'success'], ['EXPIRING', 'Ending within a week', 'warning'], ['EXPIRED', 'Membership ended', 'danger'], ['FROZEN', 'Frozen', 'brand'], ['NONE', 'No membership yet']];

export default function GymDashboard() {
  const { can, business } = useAuth();
  const d = useLoad('/gym/dashboard');
  const m = useLoad(can('reports') || can('gym_setup') ? '/gym/reports/memberships' : null);
  const data = d.data;
  const max = Math.max(1, ...(data?.last_7_days || []).map((x) => x.visits));
  return (
    <div>
      <DashboardHeader title={business?.name || 'Gym'} lead={data ? `${data.visits.today} visit${data.visits.today === 1 ? '' : 's'} today, ${data.members.ACTIVE + data.members.EXPIRING} members with a running membership.` : 'Today at a glance.'}
        action={<>
          {(can('gym_desk') || can('gym_setup')) && <Button to="/app/gym/reception"><DoorOpen aria-hidden="true" className="h-4 w-4" />Front desk</Button>}
          {(can('gym_members') || can('gym_setup')) && <Button to="/app/gym/members?new=1" variant="secondary"><UserPlus aria-hidden="true" className="h-4 w-4" />New member</Button>}
        </>} />
      <ListState loading={d.loading && !data} error={d.error} />
      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {TILES.map(([k, label, tone]) => <StatCard key={k} size="lg" label={label} value={data.members[k]} tone={data.members[k] ? tone : undefined} to={`/app/gym/members?state=${k}`} />)}
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Panel title="Visits, last 7 days" lead={`${data.visits.last_7_days} in all`}>
              <div className="flex h-32 items-end gap-2" role="img" aria-label={`Visits per day: ${data.last_7_days.map((x) => x.visits).join(', ')}`}>
                {data.last_7_days.map((x, i) => (
                  <div key={x.date} className="flex flex-1 flex-col items-center gap-1">
                    <span className="tabular text-caption text-ink-500">{x.visits}</span>
                    <span className={`w-full rounded-t-md ${i === data.last_7_days.length - 1 ? 'bg-brand-500' : 'bg-brand-200'}`} style={{ height: `${Math.max(4, (x.visits / max) * 88)}px` }} />
                    <span className="text-[11px] text-ink-400">{new Date(`${x.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="This month" lead="Memberships sold and what is owed">
              <dl className="space-y-2 text-small">
                <div className="flex justify-between"><dt className="text-ink-500">New members joined</dt><dd className="tabular font-medium">{data.joined_this_month}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">Memberships sold</dt><dd className="tabular font-medium">{data.sales_this_month.sold}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">Billed (after refunds)</dt><dd className="tabular font-medium">{rsPaise(data.sales_this_month.sales_paise)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">Still to collect</dt><dd className={`tabular font-medium ${data.sales_this_month.due_paise > 0 ? 'text-danger' : ''}`}>{rsPaise(data.sales_this_month.due_paise)}</dd></div>
              </dl>
              <Button className="mt-3" size="sm" variant="secondary" to="/app/gym/plans"><Plus aria-hidden="true" className="h-4 w-4" />Plans</Button>
            </Panel>
            <Panel title="Turned away today" lead={data.denied_today.length ? 'And why' : 'Nobody so far'}>
              {data.denied_today.length > 0 && (
                <ul className="space-y-1.5 text-small">{data.denied_today.map((x) => <li key={x.reason_code} className="flex justify-between"><span>{REASON[x.reason_code]?.title || x.reason_code}</span><span className="tabular font-medium">{x.n}</span></li>)}</ul>
              )}
              {data.denied_today.length > 0 && <Link to="/app/gym/attendance?tab=log" className="mt-3 inline-block text-small text-brand-600 hover:underline">See each one</Link>}
            </Panel>
          </div>
          {m.data?.expiring_soon?.length > 0 && (
            <Panel title="Ending in the next two weeks" lead="Worth a call or a message. Nothing has been renewed for them yet.">
              <ul className="divide-y divide-line">
                {m.data.expiring_soon.slice(0, 12).map((x) => (
                  <li key={x.member_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-small">
                    <Link to={`/app/gym/members/${x.member_id}`} className="font-medium text-brand-600 hover:underline">{x.name}</Link>
                    <span className="text-ink-500">{x.plan_name} · ends {longDate(x.ends_on)}</span>
                    <span className="tabular text-ink-500">{x.phone}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
