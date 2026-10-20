/*
 * Hotel reports: the manager's flash first (the report an owner reads each morning), then the day-by-day, department, collections, lists, lost-business, source and
 * forecast reports. Closed days come from night audit exactly as they were; the open day is marked provisional. Money is before GST unless it says so.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { formatCurrency } from '../../lib/api.js';
import { addDays, departmentName, longDate, methodName, monthStart, qs, sourceName, useLoad } from '../../lib/hotel.js';
import { saveCsv } from '../../lib/salon.js';
import { Badge, Button, Field, Input, ListState, PageHeader, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Panel } from '../salon/parts.jsx';
import { useT, T } from '../../i18n/useT.js';

const rs = (p) => formatCurrency((p || 0) / 100);
const REPORTS = [
  ['flash', T('Manager’s flash'), 'The day at a glance'], ['occupancy', T('Occupancy and revenue'), 'Day by day'], ['departments', T('Revenue by department'), 'Rooms, restaurant, extras'],
  ['collections', T('Collections'), 'Money taken, by method and person'], ['inhouse', T('In the hotel'), 'Guests and what they owe'], ['arrivals', T('Arrivals'), 'Who is due'], ['departures', T('Departures'), 'Who is leaving'],
  ['lost', T('No-shows and cancellations'), 'Business that did not happen'], ['sources', T('Source of business'), 'Where guests come from'], ['forecast', T('Forecast'), 'Rooms booked ahead'], ['banquet', T('Banquet'), 'Events, halls and what is owed']
];

const Range = ({ from, to, onChange }) => {
  const tr = useT();
  return (
  <div className="mb-5 flex flex-wrap items-end gap-3">
    <Field id="rp-from" label={tr('From')}><Input id="rp-from" type="date" value={from} onChange={(e) => onChange({ from: e.target.value, to })} /></Field>
    <Field id="rp-to" label={tr('To')}><Input id="rp-to" type="date" value={to} onChange={(e) => onChange({ from, to: e.target.value })} /></Field>
  </div>
);
};

const Csv = ({ name, columns, rows }) => {
  const tr = useT();
  return <Button variant="secondary" size="sm" onClick={() => saveCsv(name, columns, rows)} disabled={!rows?.length}><Download aria-hidden="true" className="h-4 w-4" />{tr('Download CSV')}</Button>;
};

/* ── the flash ─────────────────────────────────────────────────────────── */

const FlashRow = ({ label, strong, ...f }) => {
  const tr = useT();
  return (
  <Tr className={strong ? 'bg-surface-2/60 font-semibold' : ''}><Td>{tr(label)}</Td>{f.cols.map((c, i) => <Td key={i} className="tabular text-right">{c}</Td>)}</Tr>
);
};

const Flash = ({ date }) => {
  const tr = useT();
  const r = useLoad(`/hotel/reports/flash${qs({ date })}`);
  const d = r.data;
  if (!d) return <ListState loading={r.loading} error={r.error} />;
  const cols = (fn) => [d.day, d.month_to_date, d.year_to_date].map((x) => (x ? fn(x) : '—'));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-semibold text-ink-900">{longDate(d.date)}</h2>{d.provisional && <Badge tone="warning">{tr('Open day: figures so far, not yet closed')}</Badge>}<span className="text-small text-ink-500">{tr('Hotel\'s date is {{longDate}}', { longDate: longDate(d.business_date) })}</span></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label={tr('Occupancy')} value={d.day ? `${d.day.occupancy_pct}%` : '—'} note={d.day ? `${d.day.rooms_sold} of ${d.day.rooms_available} rooms` : ''} />
        <StatCard label={tr('ADR')} value={d.day ? rs(d.day.adr_paise) : '—'} note="Average room rate" />
        <StatCard label={tr('RevPAR')} value={d.day ? rs(d.day.revpar_paise) : '—'} note="Room revenue per available room" />
        <StatCard label={tr('Room revenue')} value={d.day ? rs(d.day.room_revenue_paise) : '—'} />
        <StatCard label={tr('Total revenue')} value={d.day ? rs(d.day.total_revenue_paise) : '—'} note="Before GST" />
      </div>
      <Table>
        <Thead><Th></Th><Th className="text-right">{tr('Day')}</Th><Th className="text-right">{tr('Month to date')}</Th><Th className="text-right">{tr('Year to date')}</Th></Thead>
        <tbody>
          <FlashRow label={tr('Rooms available')} cols={cols((x) => x.rooms_available)} />
          <FlashRow label={tr('Rooms sold')} cols={cols((x) => x.rooms_sold)} />
          <FlashRow label={tr('Occupancy')} cols={cols((x) => `${x.occupancy_pct}%`)} strong />
          <FlashRow label={tr('Average daily rate (ADR)')} cols={cols((x) => rs(x.adr_paise))} />
          <FlashRow label={tr('Revenue per available room (RevPAR)')} cols={cols((x) => rs(x.revpar_paise))} />
          <FlashRow label={tr('Room revenue')} cols={cols((x) => rs(x.room_revenue_paise))} />
          <FlashRow label={tr('Food and beverage revenue')} cols={cols((x) => rs(x.fnb_revenue_paise))} />
          <FlashRow label={tr('Other revenue')} cols={cols((x) => rs(x.other_revenue_paise))} />
          <FlashRow label={tr('Total revenue (before GST)')} cols={cols((x) => rs(x.total_revenue_paise))} strong />
          <FlashRow label={tr('GST charged')} cols={cols((x) => rs(x.tax_paise))} />
          <FlashRow label={tr('Arrivals')} cols={cols((x) => x.arrivals)} />
          <FlashRow label={tr('Departures')} cols={cols((x) => x.departures)} />
          <FlashRow label={tr('Walk-ins')} cols={cols((x) => x.walk_ins)} />
          <FlashRow label={tr('No-shows')} cols={cols((x) => x.no_shows)} />
          <FlashRow label={tr('Cancellations')} cols={cols((x) => x.cancellations)} />
        </tbody>
      </Table>
      <Panel title={tr('Right now')}>
        <dl className="grid grid-cols-2 gap-4 text-small sm:grid-cols-5">
          {[['Rooms in the hotel', d.now.rooms_in_house], ['Arrivals expected', d.now.arrivals_expected], ['Departures expected', d.now.departures_expected], ['Rooms to clean', d.now.rooms_dirty], ['Out of order', d.now.rooms_out_of_order]].map(([k, v]) => <div key={k}><dt className="text-ink-500">{k}</dt><dd className="mt-1 text-xl font-semibold tabular text-ink-900">{v}</dd></div>)}
        </dl>
      </Panel>
    </div>
  );
};

/* ── ranges ────────────────────────────────────────────────────────────── */

const Occupancy = ({ from, to }) => {
  const tr = useT();
  const r = useLoad(`/hotel/reports/occupancy${qs({ from, to })}`);
  const d = r.data;
  if (!d) return <ListState loading={r.loading} error={r.error} />;
  const max = Math.max(1, ...d.days.map((x) => x.occupancy_pct));
  const cols = [{ key: 'date', label: T('Date') }, { key: 'rooms_available', label: T('Rooms available') }, { key: 'rooms_sold', label: T('Rooms sold') }, { key: 'occupancy_pct', label: T('Occupancy %') }, { key: 'adr', label: T('ADR') }, { key: 'revpar', label: T('RevPAR') }, { key: 'room_revenue', label: T('Room revenue') }, { key: 'fnb_revenue', label: T('F&B revenue') }, { key: 'other_revenue', label: T('Other revenue') }, { key: 'total_revenue', label: T('Total revenue') }];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard label={tr('Occupancy')} value={`${d.total.occupancy_pct}%`} /><StatCard label={tr('ADR')} value={rs(d.total.adr_paise)} /><StatCard label={tr('RevPAR')} value={rs(d.total.revpar_paise)} /><StatCard label={tr('Total revenue')} value={rs(d.total.total_revenue_paise)} note="Before GST" /></div>
      {d.days.length > 0 && <div className="flex h-24 items-end gap-1" aria-label={tr('Occupancy by day')}>{d.days.map((x) => <div key={x.date} title={`${longDate(x.date)}: ${x.occupancy_pct}%`} style={{ height: `${Math.max(4, (x.occupancy_pct / max) * 100)}%` }} className="flex-1 rounded-t bg-brand-500/80" />)}</div>}
      <div className="flex justify-end"><Csv name={`hotel-occupancy-${from}-${to}.csv`} columns={cols} rows={d.days} /></div>
      <ListState empty={!d.days.length} emptyLabel={tr('No day has been closed in this range yet. Run night audit to record a day.')} />
      {d.days.length > 0 && <Table><Thead><Th>{tr('Date')}</Th><Th className="text-right">{tr('Sold')}</Th><Th className="text-right">{tr('Occupancy')}</Th><Th className="text-right">{tr('ADR')}</Th><Th className="text-right">{tr('RevPAR')}</Th><Th className="text-right">{tr('Room')}</Th><Th className="text-right">F&amp;B</Th><Th className="text-right">{tr('Other')}</Th><Th className="text-right">{tr('Total')}</Th></Thead>
        <tbody>{d.days.map((x) => <Tr key={x.date}><Td>{longDate(x.date)}</Td><Td className="tabular text-right">{x.rooms_sold}/{x.rooms_available}</Td><Td className="tabular text-right">{x.occupancy_pct}%</Td><Td className="tabular text-right">{rs(x.adr_paise)}</Td><Td className="tabular text-right">{rs(x.revpar_paise)}</Td><Td className="tabular text-right">{rs(x.room_revenue_paise)}</Td><Td className="tabular text-right">{rs(x.fnb_revenue_paise)}</Td><Td className="tabular text-right">{rs(x.other_revenue_paise)}</Td><Td className="tabular text-right font-medium">{rs(x.total_revenue_paise)}</Td></Tr>)}</tbody></Table>}
    </div>
  );
};

const Departments = ({ from, to }) => {
  const tr = useT();
  const r = useLoad(`/hotel/reports/departments${qs({ from, to })}`);
  const d = r.data;
  if (!d) return <ListState loading={r.loading} error={r.error} />;
  const rows = d.departments.map((x) => ({ department: departmentName(x.department), revenue: x.revenue, tax: x.tax, lines: x.lines }));
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Csv name={`hotel-departments-${from}-${to}.csv`} columns={[{ key: 'department', label: T('Department') }, { key: 'revenue', label: T('Revenue before GST') }, { key: 'tax', label: T('GST') }, { key: 'lines', label: T('Lines') }]} rows={rows} /></div>
      <Table><Thead><Th>{tr('Department')}</Th><Th className="text-right">{tr('Revenue (before GST)')}</Th><Th className="text-right">{tr('GST')}</Th><Th className="text-right">{tr('Lines')}</Th></Thead>
        <tbody>{d.departments.map((x) => <Tr key={x.department}><Td>{departmentName(x.department)}</Td><Td className="tabular text-right">{rs(x.revenue_paise)}</Td><Td className="tabular text-right text-ink-500">{rs(x.tax_paise)}</Td><Td className="tabular text-right text-ink-500">{x.lines}</Td></Tr>)}
          <Tr className="bg-surface-2/60 font-semibold"><Td>{tr('Total')}</Td><Td className="tabular text-right">{rs(d.total_paise)}</Td><Td></Td><Td></Td></Tr></tbody></Table>
      <p className="text-caption text-ink-500">{tr('Rooms and extras are charges posted to guests\' bills on the day charged. Restaurant is the restaurant\'s own sales.')}</p>
    </div>
  );
};

const Collections = ({ from, to }) => {
  const tr = useT();
  const r = useLoad(`/hotel/reports/collections${qs({ from, to })}`);
  const d = r.data;
  if (!d) return <ListState loading={r.loading} error={r.error} />;
  return (
    <div className="space-y-6">
      <StatCard label={tr('Net collected')} value={rs(d.total_paise)} note="After refunds" className="max-w-xs" />
      <Table><Thead><Th>{tr('Method')}</Th><Th className="text-right">{tr('Hotel')}</Th><Th className="text-right">{tr('Restaurant')}</Th><Th className="text-right">{tr('Refunds')}</Th><Th className="text-right">{tr('Net')}</Th></Thead>
        <tbody>{d.methods.map((m) => <Tr key={m.method}><Td>{methodName(m.method)}</Td><Td className="tabular text-right">{rs(m.hotel_paise)}</Td><Td className="tabular text-right">{rs(m.restaurant_paise)}</Td><Td className="tabular text-right text-danger">{m.refunds_paise ? `−${rs(m.refunds_paise)}` : '—'}</Td><Td className="tabular text-right font-medium">{rs(m.net_paise)}</Td></Tr>)}</tbody></Table>
      <Panel title={tr('By person')}><ul className="divide-y divide-line text-small">{d.by_person.map((p) => <li key={p.person} className="flex justify-between py-2"><span>{p.person}</span><span className="tabular font-medium">{rs(p.net_paise)}</span></li>)}{!d.by_person.length && <li className="py-2 text-ink-500">{tr('Nothing collected in this range.')}</li>}</ul></Panel>
    </div>
  );
};

const Lost = ({ from, to }) => {
  const tr = useT();
  const r = useLoad(`/hotel/reports/lost${qs({ from, to })}`);
  const d = r.data;
  if (!d) return <ListState loading={r.loading} error={r.error} />;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard label={tr('Cancellations')} value={d.cancellations} /><StatCard label={tr('No-shows')} value={d.no_shows} /><StatCard label={tr('Room value lost')} value={rs(d.room_value_lost_paise)} note="Before GST" /><StatCard label={tr('Advance kept')} value={rs(d.advance_kept_paise)} /></div>
      <ListState empty={!d.rows.length} emptyLabel={tr('No cancellations or no-shows in this range.')} />
      {d.rows.length > 0 && <Table><Thead><Th>{tr('Date')}</Th><Th>{tr('Booking')}</Th><Th>{tr('Guest')}</Th><Th>{tr('Was for')}</Th><Th>{tr('From')}</Th><Th>{tr('Reason')}</Th><Th className="text-right">{tr('Room value')}</Th><Th className="text-right">{tr('Advance kept')}</Th></Thead>
        <tbody>{d.rows.map((x) => <Tr key={x.booking_id}><Td>{longDate(x.on_date)}</Td><Td><Link className="font-medium text-brand-600 hover:underline" to={`/app/hotel/bookings/${x.booking_id}`}>{x.res_no}</Link> <Badge tone={x.status === 'NO_SHOW' ? 'warning' : 'neutral'}>{x.status === 'NO_SHOW' ? tr('No-show') : tr('Cancelled')}</Badge></Td><Td>{x.guest_name}</Td><Td className="whitespace-nowrap">{longDate(x.arrival)}</Td><Td>{sourceName(x.source)}</Td><Td>{x.cancel_reason || '—'}</Td><Td className="tabular text-right">{rs(x.room_value_paise)}</Td><Td className="tabular text-right">{rs(x.advance_kept_paise)}</Td></Tr>)}</tbody></Table>}
    </div>
  );
};

const Sources = ({ from, to }) => {
  const tr = useT();
  const r = useLoad(`/hotel/reports/sources${qs({ from, to })}`);
  const d = r.data;
  if (!d) return <ListState loading={r.loading} error={r.error} />;
  const max = Math.max(1, ...d.sources.map((s) => s.room_revenue_paise));
  return (
    <div className="space-y-4">
      <ListState empty={!d.sources.length} emptyLabel={tr('No stays in this range yet.')} />
      {d.sources.length > 0 && <Table><Thead><Th>{tr('Source')}</Th><Th className="text-right">{tr('Bookings')}</Th><Th className="text-right">{tr('Room nights')}</Th><Th className="text-right">{tr('ADR')}</Th><Th className="text-right">{tr('Room revenue')}</Th><Th>{tr('Share')}</Th></Thead>
        <tbody>{d.sources.map((s) => <Tr key={s.source}><Td>{sourceName(s.source)}</Td><Td className="tabular text-right">{s.bookings}</Td><Td className="tabular text-right">{s.room_nights}</Td><Td className="tabular text-right">{rs(s.adr_paise)}</Td><Td className="tabular text-right font-medium">{rs(s.room_revenue_paise)}</Td><Td className="w-40"><div className="h-2 rounded-full bg-surface-3"><div style={{ width: `${(s.room_revenue_paise / max) * 100}%` }} className="h-2 rounded-full bg-brand-500" /></div></Td></Tr>)}</tbody></Table>}
    </div>
  );
};

const Forecast = ({ from, to }) => {
  const tr = useT();
  const r = useLoad(`/hotel/reports/forecast${qs({ from, to })}`);
  const d = r.data;
  if (!d) return <ListState loading={r.loading} error={r.error} />;
  return (
    <div className="space-y-4">
      <div className="flex h-24 items-end gap-1" aria-label={tr('Rooms booked by night')}>{d.days.map((x) => <div key={x.date} title={tr('{{longDate}}: {{occupancy_pct}}% booked', { longDate: longDate(x.date), occupancy_pct: x.occupancy_pct })} style={{ height: `${Math.max(4, x.occupancy_pct)}%` }} className={`flex-1 rounded-t ${x.occupancy_pct >= 90 ? 'bg-warning/80' : 'bg-brand-500/80'}`} />)}</div>
      <Table><Thead><Th>{tr('Night')}</Th><Th className="text-right">{tr('Booked')}</Th><Th className="text-right">{tr('Occupancy')}</Th><Th className="text-right">{tr('Arrivals')}</Th><Th className="text-right">{tr('Departures')}</Th><Th className="text-right">{tr('Room revenue booked')}</Th><Th className="text-right">{tr('ADR')}</Th></Thead>
        <tbody>{d.days.map((x) => <Tr key={x.date}><Td>{longDate(x.date)}</Td><Td className="tabular text-right">{x.rooms_booked}/{x.rooms_available}</Td><Td className="tabular text-right">{x.occupancy_pct}%</Td><Td className="tabular text-right">{x.arrivals}</Td><Td className="tabular text-right">{x.departures}</Td><Td className="tabular text-right">{rs(x.expected_room_revenue_paise)}</Td><Td className="tabular text-right">{rs(x.adr_paise)}</Td></Tr>)}</tbody></Table>
    </div>
  );
};

const Banquet = ({ from, to }) => {
  const tr = useT();
  const r = useLoad(`/hotel/banquet/summary${qs({ from, to })}`);
  const d = r.data;
  if (!d) return <ListState loading={r.loading} error={r.error} />;
  const name = { ENQUIRY: 'Enquiries', TENTATIVE: 'Held', CONFIRMED: 'Confirmed', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
  const cat = { HALL: 'Hall rent', FOOD: 'Food and drink', DECOR: 'Decor and flowers', AV: 'Sound and lights', ROOMS: 'Guest rooms', OTHER: 'Other' };
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{['ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'COMPLETED'].map((s) => { const x = d.by_status.find((b) => b.status === s); return <StatCard key={s} label={name[s]} value={x?.events || 0} note={x ? `${x.guests} guests` : ''} />; })}<StatCard label={tr('Revenue')} value={rs(d.total_revenue_paise)} note="Confirmed and completed, before GST" /></div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={tr('Revenue by kind')}><ul className="divide-y divide-line text-small">{d.revenue.map((x) => <li key={x.category} className="flex justify-between py-2"><span>{cat[x.category] || x.category}</span><span className="tabular font-medium">{rs(x.revenue_paise)}</span></li>)}{!d.revenue.length && <li className="py-2 text-ink-500">{tr('No events in this range.')}</li>}</ul></Panel>
        <Panel title={tr('Halls')}><ul className="divide-y divide-line text-small">{d.halls.map((h) => <li key={h.name} className="flex justify-between py-2"><span>{h.name}</span><span className="text-ink-500">{h.functions} function{h.functions === 1 ? '' : 's'} · {h.days_used} day{h.days_used === 1 ? '' : 's'} used · {h.guests} guests</span></li>)}</ul></Panel>
      </div>
      <Panel title={tr('Owed by confirmed events')} lead={tr('Confirmed events where the organiser has paid less than the bill.')}>
        {d.outstanding.length === 0 ? <p className="text-small text-ink-500">{tr('Nothing is owed.')}</p> : <Table><Thead><Th>{tr('Event')}</Th><Th>{tr('Organiser')}</Th><Th>{tr('First function')}</Th><Th className="text-right">{tr('Bill')}</Th><Th className="text-right">{tr('Paid')}</Th><Th className="text-right">{tr('Owes')}</Th></Thead>
          <tbody>{d.outstanding.map((o) => <Tr key={o.event_id}><Td><Link className="font-medium text-brand-600 hover:underline" to={`/app/hotel/banquet/events/${o.event_id}`}>{tr(o.title)}</Link><span className="block text-caption text-ink-500">{o.event_no}</span></Td><Td>{o.organiser}</Td><Td>{o.first_date ? longDate(o.first_date) : '—'}</Td><Td className="tabular text-right">{rs(o.charges_paise)}</Td><Td className="tabular text-right">{rs(o.paid_paise)}</Td><Td className="tabular text-right font-medium text-danger">{rs(o.balance_paise)}</Td></Tr>)}</tbody></Table>}
      </Panel>
    </div>
  );
};

/* ── lists ─────────────────────────────────────────────────────────────── */

const GuestList = ({ path, date, empty, columns }) => {
  const tr = useT();
  const r = useLoad(`/hotel/reports/${path}${qs({ date })}`);
  const rows = r.data?.rows || [];
  if (!r.data) return <ListState loading={r.loading} error={r.error} />;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Csv name={`hotel-${path}.csv`} columns={[{ key: 'res_no', label: T('Booking') }, { key: 'guest_name', label: T('Guest') }, { key: 'phone', label: T('Phone') }, { key: 'rooms', label: T('Rooms') }, { key: 'arrival', label: T('Arrival') }, { key: 'departure', label: T('Departure') }, { key: 'charges', label: T('Charges') }, { key: 'paid', label: T('Paid') }, { key: 'balance', label: T('Balance') }]} rows={rows} /></div>
      <ListState empty={!rows.length} emptyLabel={empty} />
      {rows.length > 0 && <Table><Thead><Th>{tr('Booking')}</Th><Th>{tr('Guest')}</Th><Th>{tr('Rooms')}</Th><Th>{tr('Stay')}</Th>{columns.includes('nationality') && <Th>{tr('Nationality')}</Th>}<Th className="text-right">{tr('Charges')}</Th><Th className="text-right">{tr('Paid')}</Th><Th className="text-right">{tr('Balance')}</Th></Thead>
        <tbody>{rows.map((b) => <Tr key={b.booking_id}><Td><Link className="font-medium text-brand-600 hover:underline" to={`/app/hotel/bookings/${b.booking_id}`}>{b.res_no}</Link></Td><Td>{b.guest_name}<span className="block text-caption text-ink-500">{b.phone}</span></Td><Td>{b.rooms || '—'}</Td><Td className="whitespace-nowrap">{longDate(b.arrival)}<span className="block text-caption text-ink-500">{tr('to {{longDate}}', { longDate: longDate(b.departure) })}</span></Td>{columns.includes('nationality') && <Td>{b.nationality || '—'}</Td>}<Td className="tabular text-right">{rs(b.charges_paise)}</Td><Td className="tabular text-right">{rs(b.paid_paise)}</Td><Td className={`tabular text-right font-medium ${b.balance_paise > 0 ? 'text-danger' : ''}`}>{rs(b.balance_paise)}</Td></Tr>)}</tbody></Table>}
    </div>
  );
};

/* ── the page ──────────────────────────────────────────────────────────── */

export default function HotelReports() {
  const tr = useT();
  const [params, setParams] = useSearchParams();
  const report = params.get('report') || 'flash';
  const dash = useLoad('/hotel/dashboard');
  const today = dash.data?.business_date;
  const [range, setRange] = useState(null);
  const [day, setDay] = useState(params.get('date') || '');
  const r = useMemo(() => range || (today ? { from: monthStart(today), to: today } : null), [range, today]);
  const ahead = useMemo(() => (today ? { from: today, to: addDays(today, 29) } : null), [today]);
  const title = REPORTS.find(([k]) => k === report)?.[1] || 'Reports';
  if (!today) return <ListState loading={dash.loading} error={dash.error} />;

  return (
    <div>
      <PageHeader title={tr('Hotel reports')} lead={tr('Occupancy, revenue, collections and who is in the hotel. Money is before GST unless it says otherwise.')} />
      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <nav aria-label={tr('Reports')} className="space-y-1">
          {REPORTS.map(([k, label, hint]) => (
            <button key={k} type="button" aria-current={report === k ? 'page' : undefined} onClick={() => { setParams({ report: k }); setRange(null); }}
                    className={`block w-full rounded-(--radius-control) px-3 py-2 text-left transition-colors ${report === k ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-surface-2'}`}>
              <span className="block text-small font-medium">{tr(label)}</span><span className="block text-caption text-ink-500">{tr(hint)}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          <h2 className="mb-4 text-lg font-semibold text-ink-900">{tr(title)}</h2>
          {report === 'flash' && <><div className="mb-5 max-w-xs"><Field id="fl-d" label={tr('Day')} hint={tr('Leave empty for the latest closed day')}><Input id="fl-d" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} /></Field></div><Flash date={day} /></>}
          {['occupancy', 'departments', 'collections', 'lost', 'sources', 'banquet'].includes(report) && <Range from={r.from} to={r.to} onChange={setRange} />}
          {report === 'forecast' && <Range from={(range || ahead).from} to={(range || ahead).to} onChange={setRange} />}
          {report === 'occupancy' && <Occupancy {...r} />}
          {report === 'departments' && <Departments {...r} />}
          {report === 'collections' && <Collections {...r} />}
          {report === 'lost' && <Lost {...r} />}
          {report === 'sources' && <Sources {...r} />}
          {report === 'forecast' && <Forecast {...(range || ahead)} />}
          {report === 'banquet' && <Banquet {...r} />}
          {report === 'inhouse' && <GuestList path="in-house" empty="Nobody is in the hotel." columns={['nationality']} />}
          {report === 'arrivals' && <GuestList path="arrivals" empty="Nobody is due today." columns={[]} />}
          {report === 'departures' && <GuestList path="departures" empty="Nobody is leaving today." columns={[]} />}
        </div>
      </div>
    </div>
  );
}
