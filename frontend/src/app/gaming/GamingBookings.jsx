/* Station bookings: the day as a timeline per station. Click a free stretch to book it; click a booking to seat, change, cancel or mark a no-show. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { KIND_LABEL, duration, timeText, useLoad } from '../../lib/gaming.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Textarea, useToast } from '../../components/ui.jsx';
import { useAction } from '../salon/parts.jsx';
import { PlayerPicker, Stepper } from './SessionDialogs.jsx';
import { useT } from '../../i18n/useT.js';

const FIRST_HOUR = 8;
const LAST_HOUR = 24;
const HOUR_PX = 72;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (date, days) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return ymd(d); };
const localInput = (d) => `${ymd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const MINUTES = [['30', '30 minutes'], ['60', '1 hour'], ['90', '1.5 hours'], ['120', '2 hours'], ['180', '3 hours'], ['240', '4 hours']];
const TONE = { BOOKED: 'bg-brand-100 border-brand-300 text-brand-900', SEATED: 'bg-success/15 border-success/40 text-ink-900', NO_SHOW: 'bg-surface-3 border-line text-ink-500', CANCELLED: 'bg-surface-3 border-line text-ink-400' };
const LABEL = { BOOKED: 'Booked', SEATED: 'Seated', NO_SHOW: 'No-show', CANCELLED: 'Cancelled' };

const BookingForm = ({ booking, stations, initial, onClose, onSaved }) => {
  const tr = useT();
  const [f, setF] = useState(() => booking
    ? { station_id: String(booking.station_id), starts: localInput(new Date(booking.starts_at)), minutes: String(booking.minutes), players: booking.players, guest_name: booking.customer_id ? '' : booking.name || '', guest_phone: booking.customer_id ? '' : booking.phone || '', note: booking.note || '' }
    : { station_id: String(initial.station_id), starts: initial.starts, minutes: '60', players: 1, guest_name: '', guest_phone: '', note: '' });
  const [player, setPlayer] = useState(booking?.customer_id ? { customer_id: booking.customer_id, name: booking.name, phone: booking.phone } : null);
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const station = stations.find((s) => String(s.station_id) === f.station_id);
  const save = () => run(async () => {
    setError('');
    const body = { station_id: Number(f.station_id), starts_at: new Date(f.starts).toISOString(), minutes: Number(f.minutes), players: f.players, note: f.note || null, customer_id: player?.customer_id ?? null, guest_name: player ? null : f.guest_name || null, guest_phone: player ? null : f.guest_phone || null };
    try { onSaved(await api(booking ? `/gaming/bookings/${booking.booking_id}` : '/gaming/bookings', { method: booking ? 'PUT' : 'POST', body })); } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal title={booking ? tr('Change the booking') : tr('Book a station')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={save} loading={busy} disabled={!(player || f.guest_name.trim())}>{booking ? tr('Save') : tr('Book')}</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="bk-station" label={tr('Station')}><Select id="bk-station" value={f.station_id} onChange={(e) => set('station_id')(e.target.value)}>{stations.map((s) => <option key={s.station_id} value={s.station_id}>{s.name} ({KIND_LABEL[s.kind]})</option>)}</Select></Field>
          <Field id="bk-starts" label={tr('Starts')}><Input id="bk-starts" type="datetime-local" value={f.starts} onChange={(e) => set('starts')(e.target.value)} /></Field>
          <Field id="bk-min" label={tr('For')}><Select id="bk-min" value={f.minutes} onChange={(e) => set('minutes')(e.target.value)}>{MINUTES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field id="bk-players" label={tr('Players')}><Stepper value={f.players} onChange={set('players')} max={station?.max_players || 20} label="players" /></Field>
        </div>
        <Field id="player-picker" label={tr('Who is it for?')} hint={tr('A player on file, or just a name below')}><PlayerPicker value={player} onChange={setPlayer} /></Field>
        {!player && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="bk-name" label={tr('Name')}><Input id="bk-name" value={f.guest_name} onChange={(e) => set('guest_name')(e.target.value)} maxLength={60} /></Field>
            <Field id="bk-phone" label={tr('Mobile')}><Input id="bk-phone" type="tel" inputMode="tel" value={f.guest_phone} onChange={(e) => set('guest_phone')(e.target.value)} /></Field>
          </div>
        )}
        <Field id="bk-note" label={tr('Note (optional)')}><Textarea id="bk-note" rows={2} value={f.note} maxLength={200} onChange={(e) => set('note')(e.target.value)} /></Field>
      </div>
    </Modal>
  );
};

const Detail = ({ booking, onClose, onChanged, onEdit }) => {
  const tr = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const act = (path, ok, after) => run(async () => { setError(''); try { const out = await api(`/gaming/bookings/${booking.booking_id}/${path}`, { method: 'POST', body: {} }); toast.success(ok); onChanged(); if (after) after(out); else onClose(); } catch (e) { setError(e.message); } }, null);
  return (
    <Modal title={`${booking.station_name}, ${timeText(booking.starts_at)}`} onClose={onClose}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <dl className="grid grid-cols-2 gap-3 text-small">
          <div><dt className="text-ink-500">{tr('For')}</dt><dd className="font-medium text-ink-900">{booking.name}</dd></div>
          <div><dt className="text-ink-500">{tr('Mobile')}</dt><dd className="font-medium text-ink-900">{booking.phone || '—'}</dd></div>
          <div><dt className="text-ink-500">{tr('Time')}</dt><dd className="font-medium text-ink-900">{tr('{{timeText}} to {{timeText2}} ({{duration}})', { timeText: timeText(booking.starts_at), timeText2: timeText(booking.ends_at), duration: duration(booking.minutes * 60) })}</dd></div>
          <div><dt className="text-ink-500">{tr('Players')}</dt><dd className="font-medium text-ink-900">{booking.players}</dd></div>
          {booking.note && <div className="col-span-2"><dt className="text-ink-500">{tr('Note')}</dt><dd className="text-ink-900">{booking.note}</dd></div>}
        </dl>
        <p><Badge tone={booking.status === 'BOOKED' ? 'brand' : booking.status === 'SEATED' ? 'success' : 'neutral'}>{LABEL[booking.status]}</Badge></p>
        {booking.status === 'BOOKED' && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button loading={busy} onClick={() => act('seat', 'Timer started', () => navigate('/app/gaming'))}>{tr('They are here: start the timer')}</Button>
            <Button variant="secondary" onClick={onEdit}>{tr('Change')}</Button>
            <Button variant="secondary" loading={busy} onClick={() => act('no-show', 'Marked as a no-show')}>{tr('No-show')}</Button>
            <Button variant="ghost" loading={busy} onClick={() => act('cancel', 'Booking cancelled')}>{tr('Cancel booking')}</Button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default function GamingBookings() {
  const tr = useT();
  const { can } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(ymd(new Date()));
  const stations = useLoad('/gaming/stations');
  const list = useLoad(`/gaming/bookings?date=${date}`);
  const [form, setForm] = useState(null);       // { booking? , initial? }
  const [open, setOpen] = useState(null);
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
  const live = useMemo(() => (list.data || []).filter((b) => b.status !== 'CANCELLED'), [list.data]);
  const desk = can('gaming_desk');
  const toLeft = (iso) => { const d = new Date(iso); return ((d.getHours() + d.getMinutes() / 60) - FIRST_HOUR) * HOUR_PX; };
  const clickSlot = (st, e) => {
    if (!desk) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const hour = FIRST_HOUR + Math.floor((e.clientX - rect.left) / HOUR_PX);
    const d = new Date(`${date}T00:00:00`); d.setHours(hour, 0, 0, 0);
    setForm({ initial: { station_id: st.station_id, starts: localInput(d) } });
  };

  return (
    <div>
      <PageHeader title={tr('Bookings')} lead={tr('Reserve a station for a time. A booked station is held for the player just before it starts.')}
        action={desk && <Button onClick={() => setForm({ initial: { station_id: stations.data?.[0]?.station_id, starts: localInput(new Date(Date.now() + 3600000 - ((Date.now() + 3600000) % 900000))) } })} disabled={!stations.data?.length}><CalendarPlus aria-hidden="true" className="h-4 w-4" />{tr('New booking')}</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" aria-label={tr('Previous day')} onClick={() => setDate(shift(date, -1))}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></Button>
        <div className="w-44"><Input aria-label={tr('Day')} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
        <Button size="sm" variant="secondary" aria-label={tr('Next day')} onClick={() => setDate(shift(date, 1))}><ChevronRight aria-hidden="true" className="h-4 w-4" /></Button>
        <Button size="sm" variant="ghost" onClick={() => setDate(ymd(new Date()))}>{tr('Today')}</Button>
        <span className="text-small text-ink-500">{tr('{{v}} waiting · {{v2}} seated', { v: live.filter((b) => b.status === 'BOOKED').length, v2: live.filter((b) => b.status === 'SEATED').length })}</span>
      </div>
      <ListState loading={(stations.loading && !stations.data) || (list.loading && !list.data)} error={stations.error || list.error} empty={stations.data && !stations.data.length} emptyLabel={tr('No stations yet')} />
      {stations.data?.length > 0 && (
        <div className="overflow-x-auto rounded-(--radius-card) border border-line bg-surface">
          <div style={{ minWidth: 150 + hours.length * HOUR_PX }}>
            <div className="flex border-b border-line bg-surface-2 text-caption text-ink-500">
              <div className="w-[150px] shrink-0 px-3 py-2 font-medium">{tr('Station')}</div>
              <div className="relative flex" style={{ width: hours.length * HOUR_PX }}>
                {hours.map((h) => <div key={h} className="border-l border-line px-1 py-2" style={{ width: HOUR_PX }}>{h === 24 ? tr('12 am') : h > 12 ? `${h - 12} pm` : h === 12 ? tr('12 pm') : `${h} am`}</div>)}
              </div>
            </div>
            {stations.data.map((st) => (
              <div key={st.station_id} className="flex border-b border-line last:border-0">
                <div className="w-[150px] shrink-0 px-3 py-3"><p className="truncate text-small font-medium text-ink-900">{st.name}</p><p className="truncate text-caption text-ink-500">{KIND_LABEL[st.kind]}</p></div>
                <div className="relative h-14 cursor-pointer" style={{ width: hours.length * HOUR_PX, backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${HOUR_PX - 1}px, var(--color-line) ${HOUR_PX - 1}px, var(--color-line) ${HOUR_PX}px)` }} onClick={(e) => clickSlot(st, e)} role="presentation">
                  {live.filter((b) => b.station_id === st.station_id).map((b) => {
                    const left = Math.max(0, toLeft(b.starts_at)); const right = Math.min(hours.length * HOUR_PX, toLeft(b.ends_at));
                    return (
                      <button key={b.booking_id} type="button" onClick={(e) => { e.stopPropagation(); setOpen(b); }} aria-label={`${b.name}, ${timeText(b.starts_at)}`}
                              className={`absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border px-2 text-left text-caption font-medium ${TONE[b.status]}`} style={{ left, width: Math.max(28, right - left) }}>
                        <span className="block truncate">{b.name}</span><span className="block truncate font-normal opacity-80">{timeText(b.starts_at)} · {b.players}p</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {form && <BookingForm booking={form.booking} initial={form.initial} stations={stations.data || []} onClose={() => setForm(null)} onSaved={() => { setForm(null); toast.success(tr('Saved')); list.reload(); }} />}
      {open && <Detail booking={open} onClose={() => setOpen(null)} onChanged={list.reload} onEdit={() => { setForm({ booking: open }); setOpen(null); }} />}
    </div>
  );
}
