/*
 * The hotel's front page: the hotel's date, what is arriving and leaving today, who is in the hotel and who owes money, and the two things a desk does all day:
 * a booking and a walk-in.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BedDouble, CalendarPlus, DoorOpen, LogIn, LogOut, Moon, UserPlus } from 'lucide-react';
import { formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { longDate, timeText, useLoad } from '../../lib/hotel.js';
import { Alert, Badge, Button, DashboardHeader, EmptyState, ListState, StatCard } from '../../components/ui.jsx';
import { Panel } from '../salon/parts.jsx';
import BookingForm from './BookingForm.jsx';
import { useT } from '../../i18n/useT.js';

const rs = (p) => formatCurrency((p || 0) / 100);

const Row = ({ b, children }) => {
  const tr = useT();
  return (
  <li>
    <Link to={`/app/hotel/bookings/${b.booking_id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-surface-2">
      <span className="min-w-0"><span className="block truncate text-small font-medium text-ink-900">{b.guest_name}{b.is_vip && <span className="ml-2"><Badge tone="warning">{tr('VIP')}</Badge></span>}</span>
        <span className="block truncate text-caption text-ink-500">{b.res_no} · {b.rooms || 'Room not chosen'}</span></span>
      <span className="text-right text-caption">{children}</span>
    </Link>
  </li>
);
};

export default function HotelDashboard() {
  const tr = useT();
  const nav = useNavigate();
  const { can } = useAuth();
  const dash = useLoad('/hotel/dashboard');
  const arrivals = useLoad('/hotel/reports/arrivals');
  const inHouse = useLoad('/hotel/reports/in-house');
  const [open, setOpen] = useState(null);
  const d = dash.data;
  const reload = () => { dash.reload(); arrivals.reload(); inHouse.reload(); };

  if (!d) return <ListState loading={dash.loading} error={dash.error} />;
  const businessDate = d.business_date;
  if (d.total_rooms === 0) {
    return (
      <div>
        <DashboardHeader title={tr('Front desk')} lead={tr('Welcome. Add your rooms and rates, then you can take bookings.')} />
        <EmptyState icon={BedDouble} title={tr('Start with your rooms')} body={tr('Add a room type (Standard, Deluxe…) with its rate, then the rooms of that type. It takes a few minutes, and you can change it any time.')}
                    action={can('hotel_setup') ? <Button to="/app/hotel/setup">{tr('Add rooms and rates')}</Button> : undefined} />
      </div>
    );
  }
  const dueOut = (inHouse.data?.rows || []).filter((r) => String(r.departure).slice(0, 10) <= businessDate);
  const staying = (inHouse.data?.rows || []).filter((r) => String(r.departure).slice(0, 10) > businessDate);
  const toCheckIn = (arrivals.data?.rows || []).filter((r) => r.status === 'CONFIRMED');
  const owing = (inHouse.data?.rows || []).filter((r) => r.balance_paise > 0).length;

  return (
    <div>
      <DashboardHeader title={tr('Front desk')} lead={tr('{{longDate}} · check-in from {{timeText}}, check-out by {{timeText2}}', { longDate: longDate(businessDate), timeText: timeText(d.check_in_time), timeText2: timeText(d.check_out_time) })}
        action={can('front_desk') && <>
          <Button variant="secondary" onClick={() => setOpen('walkin')}><UserPlus aria-hidden="true" className="h-4 w-4" />{tr('Walk-in')}</Button>
          <Button onClick={() => setOpen('booking')}><CalendarPlus aria-hidden="true" className="h-4 w-4" />{tr('New booking')}</Button>
        </>} />

      {d.arrivals_late > 0 && <div className="mb-4"><Alert>{`${d.arrivals_late} booking${d.arrivals_late === 1 ? ' was' : 's were'} due before today and ${d.arrivals_late === 1 ? 'has' : 'have'} not arrived. Check ${d.arrivals_late === 1 ? 'it' : 'them'} in or mark ${d.arrivals_late === 1 ? 'it' : 'them'} as no-show before night audit.`}</Alert></div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label={tr('Arriving today')} value={d.arrivals_due} note={`${d.rooms_arriving} room${d.rooms_arriving === 1 ? '' : 's'}`} to="/app/hotel/bookings?status=CONFIRMED" />
        <StatCard label={tr('In the hotel')} value={d.rooms_in_house} note={`${d.guests_in_house} guest${d.guests_in_house === 1 ? '' : 's'}`} tone="text-success" />
        <StatCard label={tr('Leaving today')} value={d.departures_due} note={owing ? `${owing} still owe money` : 'All settled'} tone={d.departures_due ? 'text-warning' : undefined} />
        <StatCard label={tr('Occupancy')} value={`${d.occupancy_pct}%`} note={`${d.rooms_in_house} of ${d.total_rooms - d.out_of_order} rooms`} />
        <StatCard label={tr('To clean')} value={d.dirty} note="Dirty rooms" to="/app/hotel/rooms" tone={d.dirty ? 'text-warning' : undefined} />
        <StatCard label={tr('Out of order')} value={d.out_of_order} note="Not for sale" to="/app/hotel/rooms" tone={d.out_of_order ? 'text-danger' : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel title={tr('Arriving today')} lead={tr('Open a booking to check the guest in.')} className="overflow-hidden" action={<LogIn aria-hidden="true" className="h-4 w-4 text-ink-400" />}>
          <ListState loading={arrivals.loading} error={arrivals.error} empty={!arrivals.loading && !(arrivals.data?.rows || []).length} emptyLabel={tr('Nobody is due today.')} />
          <ul className="-mx-5 -my-5 divide-y divide-line">{(arrivals.data?.rows || []).map((b) => (
            <Row key={b.booking_id} b={b}><Badge tone={b.status === 'CHECKED_IN' ? 'success' : 'brand'}>{b.status === 'CHECKED_IN' ? tr('Checked in') : tr('To check in')}</Badge>{b.paid_paise > 0 && <span className="mt-1 block text-ink-500">{tr('Advance {{rs}}', { rs: rs(b.paid_paise) })}</span>}</Row>
          ))}</ul>
        </Panel>

        <Panel title={tr('Leaving today')} lead={tr('Due out today, or stayed past their date.')} className="overflow-hidden" action={<LogOut aria-hidden="true" className="h-4 w-4 text-ink-400" />}>
          <ListState loading={inHouse.loading} error={inHouse.error} empty={!inHouse.loading && !dueOut.length} emptyLabel={tr('Nobody is leaving today.')} />
          <ul className="-mx-5 -my-5 divide-y divide-line">{dueOut.map((b) => (
            <Row key={b.booking_id} b={b}>{b.balance_paise > 0 ? <span className="font-semibold text-danger">{tr('Owes {{rs}}', { rs: rs(b.balance_paise) })}</span> : <Badge tone="success">{tr('Settled')}</Badge>}{String(b.departure).slice(0, 10) < businessDate && <span className="mt-1 block text-warning">{tr('Stayed past {{longDate}}', { longDate: longDate(String(b.departure).slice(0, 10)) })}</span>}</Row>
          ))}</ul>
        </Panel>

        <Panel title={tr('Staying')} lead={tr('Everyone else in the hotel.')} className="overflow-hidden" action={<BedDouble aria-hidden="true" className="h-4 w-4 text-ink-400" />}>
          <ListState loading={inHouse.loading} error={inHouse.error} empty={!inHouse.loading && !staying.length} emptyLabel={tr('No other guests in the hotel.')} />
          <ul className="-mx-5 -my-5 max-h-96 divide-y divide-line overflow-auto">{staying.map((b) => (
            <Row key={b.booking_id} b={b}><span className="text-ink-500">{tr('until {{longDate}}', { longDate: longDate(String(b.departure).slice(0, 10)) })}</span>{b.balance_paise > 0 && <span className="mt-1 block text-ink-700">{tr('{{rs}} due', { rs: rs(b.balance_paise) })}</span>}</Row>
          ))}</ul>
        </Panel>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button to="/app/hotel/calendar" variant="secondary"><DoorOpen aria-hidden="true" className="h-4 w-4" />{tr('Calendar')}</Button>
        {can('night_audit') && <Button to="/app/hotel/night-audit" variant="secondary"><Moon aria-hidden="true" className="h-4 w-4" />{tr('Close the day (night audit)')}</Button>}
      </div>

      {open && <BookingForm walkIn={open === 'walkin'} businessDate={businessDate} onClose={() => setOpen(null)} onSaved={(saved) => { setOpen(null); reload(); nav(`/app/hotel/bookings/${saved.booking_id}`); }} />}
    </div>
  );
}
