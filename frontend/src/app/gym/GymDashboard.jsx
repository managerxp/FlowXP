/* The gym's front page: who is in, how many members stand where, what was sold, and who needs a call. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DoorOpen, Plus, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { REASON, dayTime, longDate, rsPaise, useLoad } from '../../lib/gym.js';
import { Button, DashboardHeader, ListState, StatCard } from '../../components/ui.jsx';
import { Panel, Tabs } from '../salon/parts.jsx';
import { useT, T } from '../../i18n/useT.js';

const TILES = [['ACTIVE', T('Active members'), 'success'], ['EXPIRING', T('Ending within a week'), 'warning'], ['EXPIRED', T('Membership ended'), 'danger'], ['FROZEN', T('Frozen'), 'brand'], ['NONE', T('No membership yet')]];

export default function GymDashboard() {
  const tr = useT();
  const { can, business } = useAuth();
  const d = useLoad('/gym/dashboard');
  const data = d.data;
  const [picked, setRange] = useState(null);   // null: show the shortest window that has anybody in it
  const range = picked ?? (data?.renewals?.d7 ? 7 : data?.renewals?.d15 ? 15 : 30);
  const max = Math.max(1, ...(data?.last_7_days || []).map((x) => x.visits));
  return (
    <div>
      <DashboardHeader title={business?.name || 'Gym'} lead={data ? `${data.visits.today} visit${data.visits.today === 1 ? '' : 's'} today, ${data.members.ACTIVE + data.members.EXPIRING} members with a running membership.` : tr('Today at a glance.')}
        action={<>
          {(can('gym_desk') || can('gym_setup')) && <Button to="/app/gym/reception"><DoorOpen aria-hidden="true" className="h-4 w-4" />{tr('Front desk')}</Button>}
          {(can('gym_members') || can('gym_setup')) && <Button to="/app/gym/members?new=1" variant="secondary"><UserPlus aria-hidden="true" className="h-4 w-4" />{tr('New member')}</Button>}
        </>} />
      <ListState loading={d.loading && !data} error={d.error} />
      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {TILES.map(([k, label, tone]) => <StatCard key={k} size="lg" label={tr(label)} value={data.members[k]} tone={data.members[k] ? tone : undefined} to={`/app/gym/members?state=${k}`} />)}
          </div>
          {data.money && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <StatCard size="lg" label={tr('Received today')} value={rsPaise(data.money.received_today_paise)} />
                <StatCard size="lg" label={tr('Received this month')} value={rsPaise(data.money.received_month_paise)} />
                <StatCard size="lg" label={tr('Owed to you')} value={rsPaise(data.money.owed_paise)} tone={data.money.owed_paise > 0 ? 'danger' : undefined} note={data.money.owed_bills ? `${data.money.owed_bills} ${tr('bills unpaid')}` : tr('Nothing owed')} />
                <StatCard size="lg" label={tr('Shop sales this month')} value={rsPaise(data.money.billed_month.shop_paise)} />
                {data.money.wallet_liability_paise > 0 && <StatCard size="lg" label={tr('Held in wallets')} value={rsPaise(data.money.wallet_liability_paise)} note={tr('Members\' advance money')} />}
                <StatCard size="lg" label={tr('Low on stock')} value={data.money.low_stock} tone={data.money.low_stock ? 'warning' : undefined} to={data.money.low_stock ? '/app/inventory' : undefined} />
              </div>
              <Panel title={tr('Where this month\'s billing came from')} lead={tr('Billed after refunds, by what was sold')}>
                {(() => {
                  const rows = [[tr('Memberships'), data.money.billed_month.membership_paise], [tr('Personal training and class packs'), data.money.billed_month.training_paise], [tr('Shop'), data.money.billed_month.shop_paise], [tr('Other'), data.money.billed_month.other_paise]];
                  const total = rows.reduce((a, r) => a + r[1], 0);
                  return total === 0 ? <p className="text-small text-ink-500">{tr('Nothing billed yet this month.')}</p> : (
                    <ul className="space-y-2.5 text-small">
                      {rows.map(([label, v]) => (
                        <li key={label}>
                          <div className="flex justify-between"><span className="text-ink-700">{label}</span><span className="tabular font-medium">{rsPaise(v)} <span className="text-ink-500">· {Math.round((v / total) * 100)}%</span></span></div>
                          <div className="mt-1 h-1.5 rounded-full bg-surface-3"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.round((v / total) * 100)}%` }} /></div>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </Panel>
            </>
          )}
          <div className="grid gap-5 lg:grid-cols-3">
            <Panel title={tr('Visits, last 7 days')} lead={tr('{{last_7_days}} in all', { last_7_days: data.visits.last_7_days })}>
              <div className="flex h-32 items-end gap-2" role="img" aria-label={tr('Visits per day: {{v}}', { v: data.last_7_days.map((x) => x.visits).join(', ') })}>
                {data.last_7_days.map((x, i) => (
                  <div key={x.date} className="flex flex-1 flex-col items-center gap-1">
                    <span className="tabular text-caption text-ink-500">{x.visits}</span>
                    <span className={`w-full rounded-t-md ${i === data.last_7_days.length - 1 ? 'bg-brand-500' : 'bg-brand-200'}`} style={{ height: `${Math.max(4, (x.visits / max) * 88)}px` }} />
                    <span className="text-[11px] text-ink-400">{new Date(`${x.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title={tr('This month')} lead={tr('Memberships sold and what is owed')}>
              <dl className="space-y-2 text-small">
                <div className="flex justify-between"><dt className="text-ink-500">{tr('New members joined')}</dt><dd className="tabular font-medium">{data.joined_this_month}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">{tr('Memberships sold')}</dt><dd className="tabular font-medium">{data.sales_this_month.sold}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">{tr('Billed (after refunds)')}</dt><dd className="tabular font-medium">{rsPaise(data.sales_this_month.sales_paise)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">{tr('Still to collect')}</dt><dd className={`tabular font-medium ${data.sales_this_month.due_paise > 0 ? 'text-danger' : ''}`}>{rsPaise(data.sales_this_month.due_paise)}</dd></div>
              </dl>
              <Button className="mt-3" size="sm" variant="secondary" to="/app/gym/plans"><Plus aria-hidden="true" className="h-4 w-4" />{tr('Plans')}</Button>
            </Panel>
            <Panel title={tr('Turned away today')} lead={data.denied_today.length ? tr('And why') : tr('Nobody so far')}>
              {data.denied_today.length > 0 && (
                <ul className="space-y-1.5 text-small">{data.denied_today.map((x) => <li key={x.reason_code} className="flex justify-between"><span>{REASON[x.reason_code]?.title || x.reason_code}</span><span className="tabular font-medium">{x.n}</span></li>)}</ul>
              )}
              {data.denied_today.length > 0 && <Link to="/app/gym/attendance?tab=log" className="mt-3 inline-block text-small text-brand-600 hover:underline">{tr('See each one')}</Link>}
            </Panel>
          </div>
          {data.renewals && (
            <Panel title={tr('Renewals coming up')} lead={tr('Worth a call or a message. Nothing has been renewed for them yet.')}>
              <Tabs label="Renewal window" value={range} onChange={setRange} tabs={[{ key: 7, label: tr('7 days'), count: data.renewals.d7 }, { key: 15, label: tr('15 days'), count: data.renewals.d15 }, { key: 30, label: tr('30 days'), count: data.renewals.d30 }]} />
              {(() => {
                const rows = data.renewals.list.filter((x) => x.days_left <= range);
                return rows.length === 0 ? <p className="text-small text-ink-500">{tr('Nobody ends in this time.')}</p> : (
                  <ul className="divide-y divide-line">
                    {rows.slice(0, 15).map((x) => (
                      <li key={x.member_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-small">
                        <Link to={`/app/gym/members/${x.member_id}`} className="font-medium text-brand-600 hover:underline">{x.name}</Link>
                        <span className="text-ink-500">{x.plan_name} · {x.days_left === 0 ? tr('ends today') : `${tr('ends')} ${longDate(x.ends_on)} (${x.days_left} ${tr('days')})`}</span>
                        <span className="tabular text-ink-500">{x.phone}</span>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </Panel>
          )}
          {data.activity?.length > 0 && (
            <Panel title={tr('Recent activity')} lead={tr('Sign-ups, sales, payments and check-ins as they happen')}>
              <ul className="divide-y divide-line">
                {data.activity.map((x, i) => (
                  <li key={`${x.kind}-${x.member_id}-${x.at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-small">
                    <span>
                      {x.member_id ? <Link to={`/app/gym/members/${x.member_id}`} className="font-medium text-brand-600 hover:underline">{x.name}</Link> : <span className="font-medium text-ink-900">{x.name}</span>}{' '}
                      <span className="text-ink-700">{({ JOINED: tr('joined'), SOLD: tr('bought'), RENEWED: tr('renewed'), FROZEN: tr('froze'), UNFROZEN: tr('came off hold'), CANCELLED: tr('cancelled'), REFUNDED: tr('was refunded for'), TRANSFERRED: tr('transferred'), PAYMENT: tr('paid'), CHECKIN: tr('checked in') })[x.kind] || x.kind}</span>
                      {x.kind === 'PAYMENT' ? <span className="tabular font-medium"> {rsPaise(x.amount_paise)}</span> : x.detail ? <span className="font-medium text-ink-900"> {x.detail}</span> : null}
                    </span>
                    <span className="text-caption text-ink-500">{dayTime(x.at)}</span>
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
