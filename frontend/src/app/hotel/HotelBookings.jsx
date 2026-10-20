/* All bookings: find one by guest, phone, booking number or room, and filter by what stage it is at. */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarPlus, Search } from 'lucide-react';
import { formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { BOOKING_STATUS, longDate, qs, sourceName, useDebounced, useLoad } from '../../lib/hotel.js';
import { Badge, Button, Input, ListState, PageHeader, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Chips, Pager } from '../salon/parts.jsx';
import BookingForm from './BookingForm.jsx';
import { useT, T } from '../../i18n/useT.js';

const rs = (p) => formatCurrency((p || 0) / 100);
const PAGE = 30;
const VIEWS = [['CONFIRMED', T('Booked')], ['CHECKED_IN', T('In the hotel')], ['CHECKED_OUT', T('Checked out')], ['CANCELLED,NO_SHOW', 'Cancelled and no-shows'], ['', 'All']];

export default function HotelBookings() {
  const tr = useT();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'CONFIRMED';
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const dash = useLoad('/hotel/dashboard');
  const list = useLoad(`/hotel/bookings${qs({ status, q: q.trim(), limit: PAGE, offset })}`, { paged: true });
  const rows = list.data || [];

  return (
    <div>
      <PageHeader title={tr('Bookings')} lead={tr('Every booking, from the first call to check-out.')}
        action={can('front_desk') && dash.data && <Button onClick={() => setOpen(true)}><CalendarPlus aria-hidden="true" className="h-4 w-4" />{tr('New booking')}</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Chips label={tr('Show')} options={VIEWS.map(([value, label]) => ({ value, label }))} value={status} onChange={(v) => { setOffset(0); setParams(v === 'CONFIRMED' ? {} : { status: v }); }} />
        <div className="relative min-w-60 flex-1 sm:max-w-sm">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-400" />
          <Input aria-label={tr('Search bookings')} placeholder={tr('Guest, phone, booking number or room')} value={text} onChange={(e) => { setText(e.target.value); setOffset(0); }} className="pl-9" />
        </div>
      </div>
      <ListState loading={list.loading && !rows.length} error={list.error} empty={!list.loading && !rows.length} emptyLabel={q ? tr('No booking matches.') : tr('No bookings here yet.')} />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>{tr('Booking')}</Th><Th>{tr('Guest')}</Th><Th>{tr('Stay')}</Th><Th>{tr('Rooms')}</Th><Th>{tr('From')}</Th><Th className="text-right">{tr('Charges')}</Th><Th className="text-right">{tr('Balance')}</Th><Th>{tr('Status')}</Th></Thead>
          <tbody>
            {rows.map((b) => {
              const s = BOOKING_STATUS[b.status] || { label: b.status, tone: 'neutral' };
              return (
                <Tr key={b.booking_id}>
                  <Td><Link to={`/app/hotel/bookings/${b.booking_id}`} className="font-medium text-brand-600 hover:underline">{b.res_no}</Link></Td>
                  <Td>{b.guest_name}{b.is_vip && <span className="ml-2"><Badge tone="warning">{tr('VIP')}</Badge></span>}<span className="block text-caption text-ink-500">{b.guest_phone}</span></Td>
                  <Td className="whitespace-nowrap">{longDate(String(b.arrival).slice(0, 10))}<span className="block text-caption text-ink-500">{tr('to {{longDate}}', { longDate: longDate(String(b.departure).slice(0, 10)) })}</span></Td>
                  <Td>{b.room_list || '—'}</Td>
                  <Td>{sourceName(b.source)}</Td>
                  <Td className="tabular text-right">{rs(b.charges_paise)}</Td>
                  <Td className={`tabular text-right ${b.balance_paise > 0 ? 'font-medium text-danger' : 'text-ink-500'}`}>{rs(b.balance_paise)}</Td>
                  <Td><Badge tone={s.tone}>{tr(s.label)}</Badge></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pager meta={list.meta} onPage={setOffset} />
      {open && dash.data && <BookingForm businessDate={dash.data.business_date} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); list.reload(); }} />}
    </div>
  );
}
