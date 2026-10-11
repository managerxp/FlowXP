/*
 * The calendar (tape chart): every room down the side, the days across, and each stay as a bar. Green is a guest in the hotel, blue is a booking, grey is a room taken
 * out of sale. Bookings with no room number yet sit in an "Unassigned" row under their room type. Click a bar to open the booking, an empty day to make one.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { addDays, isWeekend, monthDay, qs, shortDay, useLoad } from '../../lib/hotel.js';
import { Button, ListState, PageHeader } from '../../components/ui.jsx';
import BookingForm from './BookingForm.jsx';

const DAYS = 14;
const NAME_W = '9.5rem';

const lanes = (stays, from, to) => {
  const ends = []; const out = [];
  for (const s of [...stays].sort((a, b) => (a.arrival < b.arrival ? -1 : 1))) {
    let lane = ends.findIndex((e) => e <= s.arrival);
    if (lane < 0) { lane = ends.length; ends.push(s.departure); } else ends[lane] = s.departure;
    out.push({ ...s, lane });
  }
  return { rows: out, count: Math.max(1, ends.length) };
};

const Bar = ({ s, from, days, onOpen, row = 1 }) => {
  const start = Math.max(0, days.indexOf(s.arrival) === -1 ? (s.arrival < from ? 0 : days.length) : days.indexOf(s.arrival));
  const endIdx = days.indexOf(s.departure);
  const end = endIdx === -1 ? (s.departure > days[days.length - 1] ? days.length : 0) : endIdx;
  if (end <= start) return null;
  const inHouse = s.status === 'IN_HOUSE';
  return (
    <button type="button" onClick={() => onOpen(s)} title={`${s.guest_name} · ${s.res_no}${s.balance_paise > 0 ? ' · owes money' : ''}`}
            style={{ gridColumn: `${start + 2} / ${end + 2}`, gridRow: row }}
            className={`relative z-10 mx-0.5 my-1 flex min-w-0 items-center truncate rounded-md px-2 text-left text-caption font-medium ${inHouse ? 'bg-success text-white' : 'bg-brand-500 text-white'} ${s.arrival < from ? 'rounded-l-none' : ''} hover:brightness-110`}>
      <span className="truncate">{s.guest_name}</span>
    </button>
  );
};

export default function HotelCalendar() {
  const nav = useNavigate();
  const { can } = useAuth();
  const dash = useLoad('/hotel/dashboard');
  const [from, setFrom] = useState(null);
  const today = dash.data?.business_date;
  const start = from || today;
  const chart = useLoad(start ? `/hotel/chart${qs({ from: start, to: addDays(start, DAYS) })}` : null);
  const [booking, setBooking] = useState(null);
  const days = useMemo(() => (start ? Array.from({ length: DAYS }, (_, i) => addDays(start, i)) : []), [start]);
  const c = chart.data;

  const byType = useMemo(() => {
    if (!c) return [];
    const groups = new Map();
    for (const r of c.rooms) { if (!groups.has(r.room_type_id)) groups.set(r.room_type_id, { id: r.room_type_id, name: r.room_type, rooms: [] }); groups.get(r.room_type_id).rooms.push(r); }
    return [...groups.values()].map((g) => ({
      ...g,
      stays: c.stays.filter((s) => s.room_id && g.rooms.some((r) => r.room_id === s.room_id)),
      unassigned: lanes(c.stays.filter((s) => !s.room_id && s.room_type_id === g.id), start, days[days.length - 1])
    }));
  }, [c, start, days]);

  if (!dash.data) return <ListState loading={dash.loading} error={dash.error} />;
  const grid = { display: 'grid', gridTemplateColumns: `${NAME_W} repeat(${DAYS}, minmax(3rem, 1fr))` };
  const open = (s) => nav(`/app/hotel/bookings/${s.booking_id}`);

  return (
    <div>
      <PageHeader title="Calendar" lead="Rooms down the side, days across. Click a day to make a booking."
        action={<>
          <Button variant="secondary" size="sm" onClick={() => setFrom(addDays(start, -7))} aria-label="Earlier"><ChevronLeft aria-hidden="true" className="h-4 w-4" /></Button>
          <Button variant="secondary" size="sm" onClick={() => setFrom(null)}>Today</Button>
          <Button variant="secondary" size="sm" onClick={() => setFrom(addDays(start, 7))} aria-label="Later"><ChevronRight aria-hidden="true" className="h-4 w-4" /></Button>
        </>} />
      <ListState loading={chart.loading && !c} error={chart.error} />
      {c && (
        <div className="overflow-x-auto rounded-(--radius-card) border border-line bg-surface">
          <div className="min-w-[56rem]">
            <div style={grid} className="sticky top-0 z-20 border-b border-line bg-surface-2 text-caption font-medium text-ink-500">
              <div className="px-3 py-2">{monthDay(start)} to {monthDay(days[days.length - 1])}</div>
              {days.map((d) => <div key={d} className={`border-l border-line px-1 py-2 text-center ${d === today ? 'bg-brand-50 text-brand-700' : isWeekend(d) ? 'bg-surface-3/60' : ''}`}>{shortDay(d)}</div>)}
            </div>
            {byType.map((g) => (
              <div key={g.id}>
                <div className="border-b border-line bg-surface-2 px-3 py-1.5 text-caption font-semibold uppercase tracking-wide text-ink-500">{g.name}</div>
                {g.rooms.map((r) => (
                  <div key={r.room_id} style={grid} className="relative border-b border-line">
                    <div className="flex items-center justify-between gap-2 px-3 py-2 text-small font-medium text-ink-900">{r.room_no}{r.hk_status === 'OUT_OF_ORDER' && <span className="text-caption font-normal text-danger">out of order</span>}</div>
                    {days.map((d, i) => (
                      <button key={d} type="button" disabled={!can('front_desk') || d < today} aria-label={`Book room ${r.room_no} from ${monthDay(d)}`}
                              onClick={() => setBooking({ arrival: d, room_type_id: r.room_type_id, room_id: r.room_id })} style={{ gridColumn: i + 2, gridRow: 1 }}
                              className={`border-l border-line ${d === today ? 'bg-brand-50/60' : isWeekend(d) ? 'bg-surface-3/40' : ''} hover:bg-brand-50 disabled:hover:bg-transparent`} />
                    ))}
                    {g.stays.filter((s) => s.room_id === r.room_id).map((s) => <Bar key={s.rr_id} s={s} from={start} days={days} onOpen={open} />)}
                    {c.blocks.filter((b) => b.room_id === r.room_id).map((b) => {
                      const a = Math.max(0, days.indexOf(b.from_date) === -1 ? (b.from_date < start ? 0 : days.length) : days.indexOf(b.from_date));
                      const e = days.indexOf(b.to_date) === -1 ? (b.to_date > days[days.length - 1] ? days.length : 0) : days.indexOf(b.to_date);
                      return e > a ? <div key={b.block_id} title={b.reason || 'Out of sale'} style={{ gridColumn: `${a + 2} / ${e + 2}`, gridRow: 1 }} className="pointer-events-none z-10 mx-0.5 my-1 flex items-center truncate rounded-md bg-ink-400/30 px-2 text-caption text-ink-700">{b.reason || 'Out of sale'}</div> : null;
                    })}
                  </div>
                ))}
                {g.unassigned.rows.length > 0 && (
                  <div className="border-b border-line bg-warning/5">
                    {Array.from({ length: g.unassigned.count }, (_, lane) => (
                      <div key={lane} style={grid} className="relative">
                        <div className="px-3 py-2 text-caption font-medium text-warning">{lane === 0 ? 'Room not chosen yet' : ''}</div>
                        {days.map((d, i) => <div key={d} style={{ gridColumn: i + 2, gridRow: 1 }} className="border-l border-line" />)}
                        {g.unassigned.rows.filter((s) => s.lane === lane).map((s) => <Bar key={s.rr_id} s={s} from={start} days={days} onOpen={open} />)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!byType.length && <p className="p-6 text-small text-ink-500">Add room types and rooms in Set-up first.</p>}
          </div>
        </div>
      )}
      <p className="mt-3 text-caption text-ink-500"><span className="mr-4"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-success" />In the hotel</span><span className="mr-4"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-brand-500" />Booked</span><span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-ink-400/40" />Out of sale</span></p>
      {booking && <BookingForm businessDate={today} initial={booking} onClose={() => setBooking(null)} onSaved={(saved) => { setBooking(null); chart.reload(); nav(`/app/hotel/bookings/${saved.booking_id}`); }} />}
    </div>
  );
}
