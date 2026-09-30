/*
 * The salon's front page: today at a glance (takings, appointments, who is in), revenue and its mix, client
 * insights, the team's month, and what needs attention. Figures come straight from /salon/dashboard; someone who
 * runs the floor but may not see takings gets the activity without the money (the server withholds it).
 */
import { CalendarDays, Plus, ReceiptText, TriangleAlert, UserPlus } from 'lucide-react';
import { formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { APPT_STATUS, DEFAULT_TZ, timeText, todayIn, useLoad } from '../../lib/salon.js';
import { Alert, Badge, Button, EmptyState, ListState, PageHeader, SkeletonCards, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Panel } from './parts.jsx';

const money = (n) => formatCurrency(n);

/* Last 14 days of revenue as stacked bars, drawn with plain divs: no chart library for one picture. */
const RevenueChart = ({ data }) => {
  const max = Math.max(1, ...data.map((d) => d.services + d.products + d.plans));
  const parts = [['services', 'Services', 'bg-brand-500'], ['products', 'Products', 'bg-cyan-500'], ['plans', 'Packages & memberships', 'bg-amber-500']];
  return (
    <figure>
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Revenue for the last 14 days, by services, products and packages">
        {data.map((d) => {
          const total = d.services + d.products + d.plans;
          return (
            <div key={d.day} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.day}: ${money(total)}`}>
              {parts.map(([k, , cls]) => d[k] > 0 && <div key={k} className={`${cls} first:rounded-t`} style={{ height: `${(d[k] / max) * 100}%` }} />).reverse()}
              {total === 0 && <div className="h-0.5 rounded bg-line" />}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5 text-[10px] text-ink-400">{data.map((d) => <span key={d.day} className="min-w-0 flex-1 truncate text-center">{d.day.slice(8)}</span>)}</div>
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-500">{parts.map(([k, label, cls]) => <span key={k} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${cls}`} />{label}</span>)}</figcaption>
    </figure>
  );
};

const Upcoming = ({ tz }) => {
  const { data, loading, error } = useLoad(`/salon/appointments?date=${todayIn(tz)}`);
  const live = (data || []).filter((a) => ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'].includes(a.status)).slice(0, 6);
  return (
    <Panel title="Next up" lead="Today’s appointments still to come" action={<Button to="/app/salon/appointments" variant="ghost" size="sm">Open calendar</Button>}>
      <ListState loading={loading && !data} error={error} />
      {data && live.length === 0 && <EmptyState compact icon={CalendarDays} title="Nothing more today" body="No appointments waiting." />}
      <ul className="divide-y divide-line">
        {live.map((a) => (
          <li key={a.appointment_id} className="flex items-center gap-3 py-2.5 text-small">
            <span className="tabular w-16 shrink-0 font-medium text-ink-900">{timeText(a.start_at, tz)}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink-900">{a.customer_name || 'Guest'}</span><span className="block truncate text-caption text-ink-500">{a.services.map((s) => `${s.name} · ${s.staff_name}`).join(', ')}</span></span>
            <Badge tone={APPT_STATUS[a.status].tone}>{APPT_STATUS[a.status].label}</Badge>
          </li>
        ))}
      </ul>
    </Panel>
  );
};

const SalonDashboard = () => {
  const { can, hasFeature, business } = useAuth();
  const { data: d, loading, error } = useLoad('/salon/dashboard');
  const schedule = useLoad(can('appointments') && hasFeature('salon_appointments') ? `/salon/schedule?date=${todayIn(DEFAULT_TZ)}` : null);
  const tz = schedule.data?.timezone || DEFAULT_TZ;
  const o = d?.overview;
  const showMoney = o && o.sales_today != null;
  const apptOn = can('appointments') && hasFeature('salon_appointments');

  return (
    <div>
      <PageHeader title={business?.name || 'Today'} lead="How the salon is doing today."
                  action={<>
                    {can('billing') && <Button to="/app/salon/pos"><ReceiptText aria-hidden="true" className="h-4 w-4" />New bill</Button>}
                    {apptOn && <Button to="/app/salon/appointments" variant="secondary"><Plus aria-hidden="true" className="h-4 w-4" />Book</Button>}
                    {can('customers') && <Button to="/app/salon/clients" variant="secondary"><UserPlus aria-hidden="true" className="h-4 w-4" />Clients</Button>}
                  </>} />
      {error && <Alert>{error}</Alert>}
      {loading && !d && <SkeletonCards count={4} />}
      {d && (
        <div className="space-y-6">
          <section aria-label="Today" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {showMoney && <StatCard size="lg" label="Sales today" value={money(o.sales_today)} note={`${o.invoices_today} bill${o.invoices_today === 1 ? '' : 's'} · ${money(o.collections_today)} collected`} />}
            {apptOn && <StatCard size="lg" to="/app/salon/appointments" label="Appointments today" value={o.appointments_today} note={`${o.appointments_completed} done · ${o.appointments_upcoming} to come${o.appointments_no_show ? ` · ${o.appointments_no_show} no-show` : ''}${o.appointments_cancelled ? ` · ${o.appointments_cancelled} cancelled` : ''}`} />}
            <StatCard size="lg" to={can('staff_commission') || apptOn ? '/app/salon/team' : undefined} label="Team in today" value={`${o.active_staff} of ${o.staff_total}`} note={o.attendance_marked ? 'From attendance' : 'Attendance not marked yet'} />
            <StatCard size="lg" label="Clients today" value={o.new_customers + o.returning_customers} note={`${o.new_customers} new · ${o.returning_customers} returning`} />
            {showMoney && <StatCard size="lg" to="/app/billing/invoices" label="Still to collect" value={money(o.outstanding)} tone={o.outstanding > 0 ? 'warning' : undefined} note={`${o.outstanding_bills} unpaid bill${o.outstanding_bills === 1 ? '' : 's'}`} />}
            {(can('inventory') || can('reports')) && <StatCard size="lg" to="/app/salon/stock" label="Stock to check" value={o.low_stock} tone={o.low_stock > 0 ? 'warning' : undefined} note={o.low_stock ? 'Low or out of stock' : 'Nothing low'} />}
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            {d.revenue && (
              <Panel title="Revenue" lead="Billed amounts after returns. The split below each chart is before GST.">
                <div className="mb-5 grid grid-cols-3 gap-3">
                  {[['Today', d.revenue.daily], ['This week', d.revenue.weekly], ['This month', d.revenue.monthly]].map(([k, v]) => <div key={k}><p className="text-caption text-ink-500">{k}</p><p className="tabular text-title font-semibold text-ink-900">{money(v)}</p></div>)}
                </div>
                <RevenueChart data={d.revenue.chart.length ? d.revenue.chart : []} />
                <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-small sm:grid-cols-4">
                  {[['Services', d.revenue.month_by_type.services], ['Products', d.revenue.month_by_type.products], ['Packages', d.revenue.month_by_type.packages], ['Memberships', d.revenue.month_by_type.memberships]].map(([k, v]) => <div key={k}><dt className="text-caption text-ink-500">{k} this month</dt><dd className="tabular font-semibold text-ink-900">{money(v)}</dd></div>)}
                </dl>
              </Panel>
            )}
            <div className="space-y-6">
              {apptOn && <Upcoming tz={tz} />}
              <Panel title="Clients">
                <dl className="grid grid-cols-2 gap-3 text-small">
                  <div><dt className="text-caption text-ink-500">New today</dt><dd className="tabular text-title font-semibold">{d.customers.new_today}</dd></div>
                  <div><dt className="text-caption text-ink-500">Returning today</dt><dd className="tabular text-title font-semibold">{d.customers.returning_today}</dd></div>
                  {d.customers.vip != null && <div><dt className="text-caption text-ink-500">VIP clients</dt><dd className="tabular text-title font-semibold">{d.customers.vip}</dd></div>}
                  {d.customers.points_issued_30d != null && <div><dt className="text-caption text-ink-500">Points, last 30 days</dt><dd className="tabular font-semibold">{d.customers.points_issued_30d} given · {d.customers.points_redeemed_30d} used</dd></div>}
                </dl>
              </Panel>
            </div>
          </div>

          {d.staff && d.staff.length > 0 && (
            <Panel title="Team this month" lead="Sales and services by person">
              <Table>
                <Thead><Th>Name</Th><Th className="text-right">Sales</Th><Th className="text-right">Services done</Th><Th className="text-right">Days in</Th><Th className="text-right">Per day in</Th>{d.staff[0].commission != null && <Th className="text-right">Commission</Th>}</Thead>
                <tbody>
                  {d.staff.map((s) => <Tr key={s.staff_id}><Td className="font-medium">{s.name}</Td><Td className="text-right tabular">{money(s.sales)}</Td><Td className="text-right tabular">{s.services}</Td><Td className="text-right tabular">{s.days_present}</Td><Td className="text-right tabular">{s.productivity != null ? money(s.productivity) : <span className="text-ink-400">—</span>}</Td>{s.commission != null && <Td className="text-right tabular">{money(s.commission)}</Td>}</Tr>)}
                </tbody>
              </Table>
            </Panel>
          )}
          {o.low_stock > 0 && <p className="flex items-center gap-2 text-small text-warning"><TriangleAlert aria-hidden="true" className="h-4 w-4" />{o.low_stock} item{o.low_stock === 1 ? ' is' : 's are'} low or out of stock.</p>}
        </div>
      )}
    </div>
  );
};

export default SalonDashboard;
