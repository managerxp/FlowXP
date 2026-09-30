/*
 * Reservations and the walk-in waitlist for the active outlet: the day's
 * bookings by hour on the left, who is waiting at the door on the right.
 *
 * Seating marks the party seated (reservations.controller.js never creates an
 * order); the seat dialog can then start the table's order straight away, the
 * same POST /orders the floor uses, and lands on /app/orders?order=ID.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, ChevronLeft, ChevronRight, Minus, Plus, StickyNote, UserPlus, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { localISO } from '../lib/dates.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '../components/ui.jsx';

const POLL_MS = 30000;
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const hourOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric' });
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const shiftDay = (iso, n) => { const d = new Date(`${iso}T00:00`); d.setDate(d.getDate() + n); return localISO(d); };
const dayLabel = (iso) => {
  const today = localISO();
  if (iso === today) return 'Today';
  if (iso === shiftDay(today, 1)) return 'Tomorrow';
  if (iso === shiftDay(today, -1)) return 'Yesterday';
  return new Date(`${iso}T00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};
const STAYS = [60, 90, 120, 150, 180];
const FINISHED = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];
const FINISHED_LABEL = { COMPLETED: 'Finished', CANCELLED: 'Cancelled', NO_SHOW: 'No-show' };

/* Where a booking stands against the clock: late, due, or nothing to say yet. */
const timing = (r) => {
  if (r.status !== 'BOOKED') return null;
  const diff = Math.round((Date.now() - new Date(r.reserved_at).getTime()) / 60000);
  if (diff > 15) return { tone: 'late', text: `${diff} min late` };
  if (diff >= -30) return { tone: 'due', text: diff >= 0 ? 'Due now' : `Due in ${-diff} min` };
  return null;
};

const PartyInput = ({ id, value, onChange }) => (
  <div className="flex h-10 items-center rounded-(--radius-control) border border-line-strong bg-surface">
    <button type="button" aria-label="One fewer" onClick={() => onChange(Math.max(1, value - 1))} className="flex h-full w-10 items-center justify-center text-ink-500 hover:text-ink-900"><Minus className="h-4 w-4" /></button>
    <input id={id} type="number" min="1" max="100" value={value} onChange={(e) => onChange(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
           className="tabular h-full w-full min-w-0 border-x border-line bg-transparent text-center text-body font-semibold text-ink-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
    <button type="button" aria-label="One more" onClick={() => onChange(Math.min(100, value + 1))} className="flex h-full w-10 items-center justify-center text-ink-500 hover:text-ink-900"><Plus className="h-4 w-4" /></button>
  </div>
);

const Chip = ({ active, onClick, children, disabled }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
          className={`rounded-lg border px-3 py-2 text-left text-small transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>
    {children}
  </button>
);

/* ── Book a table ─────────────────────────────────────────────────────── */

const BookingForm = ({ booking, date, onSaved, onClose }) => {
  const start = booking ? new Date(booking.reserved_at) : null;
  const [form, setForm] = useState(booking ? {
    guest_name: booking.guest_name, phone: booking.phone || '', party_size: booking.party_size,
    day: localISO(start), time: hhmm(start), duration_min: booking.duration_min, table_id: booking.table_id || '', notes: booking.notes || ''
  } : { guest_name: '', phone: '', party_size: 2, day: date, time: '20:00', duration_min: 90, table_id: '', notes: '' });
  const [free, setFree] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const at = new Date(`${form.day}T${form.time || '00:00'}`);

  // which tables are free for this slot and party
  useEffect(() => {
    if (Number.isNaN(at.getTime())) return;
    const q = new URLSearchParams({ reserved_at: at.toISOString(), party_size: form.party_size || 1, duration_min: form.duration_min || 90 });
    api(`/reservations/availability?${q}`).then(setFree).catch(() => setFree(null));
  }, [form.day, form.time, form.party_size, form.duration_min]); // eslint-disable-line react-hooks/exhaustive-deps

  const tables = [...(free || [])];
  if (booking?.table_id && !tables.some((t) => t.table_id === booking.table_id)) tables.push({ table_id: booking.table_id, name: booking.table_name });
  const picked = form.table_id && tables.some((t) => t.table_id === Number(form.table_id));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const body = {
        guest_name: form.guest_name, phone: form.phone, notes: form.notes,
        reserved_at: at.toISOString(), party_size: Number(form.party_size), duration_min: Number(form.duration_min),
        table_id: picked ? Number(form.table_id) : null
      };
      await api(booking ? `/reservations/${booking.reservation_id}` : '/reservations', { method: booking ? 'PATCH' : 'POST', body });
      onSaved(booking ? 'Booking updated' : `Booked for ${form.guest_name}`);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={booking ? 'Edit booking' : 'New booking'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-[3fr_2fr]">
          <Field id="r-name" label="Guest name"><Input id="r-name" value={form.guest_name} onChange={set('guest_name')} required autoFocus /></Field>
          <Field id="r-phone" label="Mobile (optional)" hint="Finds their loyalty card"><Input id="r-phone" inputMode="tel" value={form.phone} onChange={set('phone')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field id="r-day" label="Day"><Input id="r-day" type="date" value={form.day} onChange={set('day')} required /></Field>
          <Field id="r-time" label="Time"><Input id="r-time" type="time" value={form.time} onChange={set('time')} required /></Field>
          <Field id="r-party" label="People"><PartyInput id="r-party" value={Number(form.party_size)} onChange={(n) => setForm((f) => ({ ...f, party_size: n }))} /></Field>
          <Field id="r-dur" label="Staying">
            <Select id="r-dur" value={form.duration_min} onChange={set('duration_min')}>
              {[...new Set([...STAYS, Number(form.duration_min)])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`}</option>)}
            </Select>
          </Field>
        </div>
        <fieldset>
          <legend className="text-small font-medium text-ink-700">Table</legend>
          <p className="mt-0.5 text-caption text-ink-500">{free ? `${free.length} free then for ${form.party_size} ${Number(form.party_size) === 1 ? 'person' : 'people'}` : 'Checking which tables are free…'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip active={!picked} onClick={() => setForm((f) => ({ ...f, table_id: '' }))}>Decide later</Chip>
            {tables.map((t) => (
              <Chip key={t.table_id} active={picked && Number(form.table_id) === t.table_id} onClick={() => setForm((f) => ({ ...f, table_id: t.table_id }))}>
                <span className="font-semibold">{t.name}</span>
                {(t.seats || t.zone) && <span className="ml-1.5 text-caption text-ink-500">{[t.seats && `${t.seats} seats`, t.zone].filter(Boolean).join(' · ')}</span>}
              </Chip>
            ))}
          </div>
        </fieldset>
        <Field id="r-notes" label="Notes (optional)"><Input id="r-notes" value={form.notes} onChange={set('notes')} placeholder="Birthday, high chair, window seat…" /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : booking ? 'Save changes' : 'Book table'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* ── Seat a party ─────────────────────────────────────────────────────── */

/* Pick a free table, seat them, and (by default) open their order. "Seat
   anyway" appears when the server says the table is booked within the hour. */
const SeatModal = ({ who, party, customerId, initial, seat, onClose, onSeated }) => {
  const navigate = useNavigate();
  const toast = useToast();
  const [tables, setTables] = useState(null);
  const [tableId, setTableId] = useState(initial || null);
  const [startOrder, setStartOrder] = useState(true);
  const [error, setError] = useState('');
  const [needsForce, setNeedsForce] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/tables').then(setTables).catch((e) => setError(e.message)); }, []);

  const usable = (tables || []).filter((t) => t.status !== 'CLOSED' && !t.open_order_id);
  const fits = (t) => !t.seats || t.seats >= party;
  const sorted = [...usable].sort((a, b) => (fits(b) - fits(a)) || ((a.seats || 99) - (b.seats || 99)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const chosen = usable.find((t) => t.table_id === tableId);

  const go = async (force) => {
    setError(''); setBusy(true);
    try {
      await seat(tableId, force);
    } catch (caught) {
      setError(caught.message); setNeedsForce(/reserved within the next hour/.test(caught.message)); setBusy(false);
      return;
    }
    if (!startOrder) { toast.success(`${who} seated at ${chosen?.name}`); onSeated(); return; }
    try {
      const order = await api('/orders', { method: 'POST', body: { order_type: 'DINE_IN', table_id: tableId, customer_id: customerId || undefined } });
      navigate(`/app/orders?order=${order.order_id}`);
    } catch (caught) {
      toast.error(`Seated, but the order could not be started: ${caught.message}`);
      onSeated();
    }
  };

  return (
    <Modal title={`Seat ${who}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="-mt-2 flex items-center gap-1.5 text-small text-ink-500"><Users aria-hidden="true" className="h-4 w-4" />{party} {party === 1 ? 'person' : 'people'}</p>
        <Alert>{error}</Alert>
        {!tables && !error && <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-3" />)}</div>}
        {tables && usable.length === 0 && <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-small text-ink-500">Every table has a running order right now.</p>}
        {usable.length > 0 && (
          <div role="radiogroup" aria-label="Table" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {sorted.map((t) => {
              const cleaning = t.status === 'CLEANING';
              const theirs = t.table_id === initial;
              return (
                <button key={t.table_id} type="button" role="radio" aria-checked={tableId === t.table_id} disabled={cleaning}
                        onClick={() => { setTableId(t.table_id); setNeedsForce(false); }}
                        className={`flex flex-col rounded-lg border p-3 text-left transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-50 ${tableId === t.table_id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-line-strong bg-surface hover:border-ink-400'}`}>
                  <span className="flex items-baseline justify-between gap-1">
                    <span className="text-body font-semibold text-ink-900">{t.name}</span>
                    {t.seats && <span className={`tabular text-caption ${fits(t) ? 'text-ink-500' : 'font-medium text-warning'}`}>{t.seats} seats</span>}
                  </span>
                  <span className="mt-0.5 truncate text-caption text-ink-500">
                    {cleaning ? 'Being cleaned' : theirs ? <span className="font-medium text-brand-700">Their table</span>
                      : t.next_reservation ? <span className="text-warning">Booked {clock(t.next_reservation.reserved_at)}</span>
                      : !fits(t) ? 'Too small' : t.zone || 'Free'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <label className="flex items-center gap-2 text-small text-ink-700">
          <input type="checkbox" checked={startOrder} onChange={(e) => setStartOrder(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
          Start their order now
        </label>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {needsForce && <Button variant="secondary" disabled={busy} onClick={() => go(true)}>Seat anyway</Button>}
          <Button disabled={!chosen || busy} onClick={() => go(false)}>{busy ? 'Seating…' : chosen ? `Seat at ${chosen.name}` : 'Choose a table'}</Button>
        </div>
      </div>
    </Modal>
  );
};

/* ── Bookings ─────────────────────────────────────────────────────────── */

const BookingCard = ({ r, onSeat, onEdit, onStatus, onTakeOrder }) => {
  const t = timing(r);
  const seated = r.status === 'SEATED';
  return (
    <li className={`flex flex-col gap-3 rounded-(--radius-card) border bg-surface p-4 @lg:flex-row @lg:items-center ${t?.tone === 'late' ? 'border-warning/50' : seated ? 'border-success/40' : 'border-line'}`}>
      <div className="flex min-w-0 flex-1 gap-4">
        <p className="tabular w-[4.5rem] shrink-0 pt-0.5 text-body font-semibold text-ink-900">{clock(r.reserved_at)}</p>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-body font-semibold text-ink-900">{r.guest_name}</span>
            <span className="flex items-center gap-1 text-small text-ink-500"><Users aria-hidden="true" className="h-3.5 w-3.5" />{r.party_size}</span>
          </p>
          {!(seated && !r.phone) && (
            <p className="mt-0.5 text-caption text-ink-500">
              {[!seated && (r.table_name ? <span key="t" className="font-medium text-ink-700">{r.table_name}</span> : 'No table yet'), r.phone].filter(Boolean).map((part, i) => <span key={i}>{i > 0 && ' · '}{part}</span>)}
            </p>
          )}
          {r.notes && <p className="mt-1.5 flex items-start gap-1.5 text-caption text-ink-700"><StickyNote aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" />{r.notes}</p>}
          {t && <p className={`mt-1.5 text-caption font-semibold ${t.tone === 'late' ? 'text-warning' : 'text-brand-700'}`}>{t.text}</p>}
          {seated && <p className="mt-1.5 text-caption font-semibold text-success">Seated{r.table_name ? ` at ${r.table_name}` : ''}</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-[5.5rem] @lg:justify-end @lg:pl-0">
        {r.status === 'BOOKED' && <>
          <Button size="sm" onClick={onSeat}>Seat</Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
          {t?.tone === 'late' && <Button size="sm" variant="ghost" onClick={() => onStatus('NO_SHOW')}>No-show</Button>}
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => window.confirm(`Cancel ${r.guest_name}'s booking?`) && onStatus('CANCELLED')}>Cancel</Button>
        </>}
        {seated && <>
          <Button size="sm" variant="secondary" onClick={onTakeOrder}>Open order</Button>
          <Button size="sm" variant="ghost" onClick={() => onStatus('COMPLETED')}>They've left</Button>
        </>}
      </div>
    </li>
  );
};

const Bookings = ({ date, rows, error, onChanged, editing, setEditing }) => {
  const navigate = useNavigate();
  const toast = useToast();
  const [seating, setSeating] = useState(null);
  const [actionError, setActionError] = useState('');

  const setStatus = async (r, status) => {
    setActionError('');
    try { await api(`/reservations/${r.reservation_id}/status`, { method: 'POST', body: { status } }); onChanged(); }
    catch (caught) { setActionError(caught.message); }
  };
  // a seated party's table: its running order, or a new one
  const takeOrder = async (r) => {
    try {
      const table = (await api('/tables')).find((t) => t.table_id === r.table_id);
      if (table?.open_order_id) { navigate(`/app/orders?order=${table.open_order_id}`); return; }
      const order = await api('/orders', { method: 'POST', body: { order_type: 'DINE_IN', table_id: r.table_id, customer_id: r.customer_id || undefined } });
      navigate(`/app/orders?order=${order.order_id}`);
    } catch (caught) { toast.error(caught.message); }
  };

  const live = (rows || []).filter((r) => !FINISHED.includes(r.status));
  const done = (rows || []).filter((r) => FINISHED.includes(r.status));
  const byHour = useMemo(() => {
    const map = new Map();
    for (const r of live) { const h = hourOf(r.reserved_at); if (!map.has(h)) map.set(h, []); map.get(h).push(r); }
    return [...map.entries()];
  }, [live]);

  return (
    <div>
      <Alert>{error || actionError}</Alert>
      {!rows && !error && <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-(--radius-card) bg-surface-3" />)}</div>}
      {rows && live.length === 0 && (
        <div className="rounded-(--radius-card) border border-dashed border-line-strong p-10 text-center">
          <CalendarClock aria-hidden="true" className="mx-auto h-8 w-8 text-ink-400" />
          <p className="mt-3 text-body font-medium text-ink-900">No bookings {dayLabel(date) === 'Today' ? 'left today' : `for ${dayLabel(date).toLowerCase()}`}</p>
          <p className="mt-1 text-small text-ink-500">Take a booking by phone, or add walk-ins to the waitlist.</p>
          <Button className="mt-4" onClick={() => setEditing({})}>New booking</Button>
        </div>
      )}
      <div className="space-y-6">
        {byHour.map(([hour, list]) => (
          <section key={hour} aria-label={hour}>
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">{hour} <span className="tabular font-normal">· {list.reduce((n, r) => n + r.party_size, 0)} guests</span></h3>
            <ul className="@container space-y-2">
              {list.map((r) => <BookingCard key={r.reservation_id} r={r} onSeat={() => setSeating(r)} onEdit={() => setEditing(r)} onStatus={(s) => setStatus(r, s)} onTakeOrder={() => takeOrder(r)} />)}
            </ul>
          </section>
        ))}
      </div>
      {done.length > 0 && (
        <details className="mt-6 rounded-(--radius-card) border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-small font-medium text-ink-700">Finished, cancelled and no-shows <span className="tabular text-ink-400">({done.length})</span></summary>
          <ul className="divide-y divide-line border-t border-line">
            {done.map((r) => (
              <li key={r.reservation_id} className="flex items-center gap-4 px-4 py-2.5 text-small">
                <span className="tabular w-[4.5rem] shrink-0 text-ink-500">{clock(r.reserved_at)}</span>
                <span className="min-w-0 flex-1 truncate text-ink-700">{r.guest_name} · {r.party_size}{r.table_name ? ` · ${r.table_name}` : ''}</span>
                <span className={`shrink-0 text-caption font-medium ${r.status === 'NO_SHOW' ? 'text-warning' : 'text-ink-500'}`}>{FINISHED_LABEL[r.status]}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {editing && <BookingForm booking={editing.reservation_id ? editing : null} date={date} onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); toast.success(msg); onChanged(); }} />}
      {seating && (
        <SeatModal who={seating.guest_name} party={seating.party_size} customerId={seating.customer_id} initial={seating.table_id}
          seat={(table_id) => api(`/reservations/${seating.reservation_id}/seat`, { method: 'POST', body: { table_id } })}
          onClose={() => setSeating(null)} onSeated={() => { setSeating(null); onChanged(); }} />
      )}
    </div>
  );
};

/* ── Waitlist ─────────────────────────────────────────────────────────── */

const Waitlist = ({ rows, error, onChanged }) => {
  const [form, setForm] = useState({ guest_name: '', phone: '', party_size: 2 });
  const [seating, setSeating] = useState(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const act = async (fn) => { setActionError(''); try { await fn(); onChanged(); } catch (caught) { setActionError(caught.message); } };
  const add = (e) => {
    e.preventDefault(); setBusy(true);
    act(async () => {
      await api('/waitlist', { method: 'POST', body: { ...form, party_size: Number(form.party_size) } });
      setForm({ guest_name: '', phone: '', party_size: 2 }); nameRef.current?.focus();
    }).finally(() => setBusy(false));
  };
  const post = (w, path) => act(() => api(`/waitlist/${w.entry_id}/${path}`, { method: 'POST' }));

  return (
    <div>
      <form onSubmit={add} className="rounded-(--radius-card) border border-line bg-surface p-4">
        <p className="flex items-center gap-2 text-small font-semibold text-ink-900"><UserPlus aria-hidden="true" className="h-4 w-4 text-ink-500" />Add a walk-in</p>
        <div className="mt-3 grid grid-cols-[1fr_7.5rem] gap-2">
          <Input ref={nameRef} aria-label="Guest name" placeholder="Name" value={form.guest_name} onChange={set('guest_name')} required />
          <PartyInput id="w-party" value={Number(form.party_size)} onChange={(n) => setForm((f) => ({ ...f, party_size: n }))} />
          <Input aria-label="Mobile (optional)" inputMode="tel" placeholder="Mobile (optional)" value={form.phone} onChange={set('phone')} />
          <Button type="submit" disabled={busy}>Add</Button>
        </div>
      </form>

      <div className="mt-4">
        <Alert>{error || actionError}</Alert>
        {!rows && !error && <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-(--radius-card) bg-surface-3" />)}</div>}
        {rows?.length === 0 && <p className="rounded-(--radius-card) border border-dashed border-line-strong p-6 text-center text-small text-ink-500">Nobody is waiting.</p>}
        {rows?.length > 0 && (
          <ol className="space-y-2">
            {rows.map((w, i) => {
              const over = w.quoted_wait_min != null && w.waited_min > w.quoted_wait_min;
              const called = w.status === 'NOTIFIED';
              return (
                <li key={w.entry_id} className={`rounded-(--radius-card) border bg-surface p-3.5 ${called ? 'border-brand-500/50' : over ? 'border-warning/50' : 'border-line'}`}>
                  <div className="flex items-start gap-3">
                    <span className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption font-semibold text-ink-700" aria-label={`Number ${i + 1} in line`}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2">
                        <span className="truncate text-body font-semibold text-ink-900">{w.guest_name}</span>
                        <span className="flex items-center gap-1 text-small text-ink-500"><Users aria-hidden="true" className="h-3.5 w-3.5" />{w.party_size}</span>
                      </p>
                      <p className="tabular mt-0.5 text-caption text-ink-500">
                        <span className={over ? 'font-semibold text-warning' : ''}>Waiting {w.waited_min} min</span>
                        {w.quoted_wait_min != null && <> · told {w.quoted_wait_min} min</>}
                      </p>
                      {called && <p className="mt-1 text-caption font-semibold text-brand-700">Told their table is ready{w.notified_at ? ` at ${clock(w.notified_at)}` : ''}</p>}
                    </div>
                  </div>
                  <div className="mt-3 flex gap-1.5 pl-10">
                    <Button size="sm" onClick={() => setSeating(w)}>Seat</Button>
                    {!called && <Button size="sm" variant="secondary" onClick={() => post(w, 'notify')} title="Marks them called; they get a message too if messaging is set up">Table ready</Button>}
                    <Button size="sm" variant="ghost" onClick={() => post(w, 'leave')}>Left</Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {seating && (
        <SeatModal who={seating.guest_name} party={seating.party_size} customerId={seating.customer_id}
          seat={(table_id, force) => api(`/waitlist/${seating.entry_id}/seat`, { method: 'POST', body: { table_id, force } })}
          onClose={() => setSeating(null)} onSeated={() => { setSeating(null); onChanged(); }} />
      )}
    </div>
  );
};

/* ── The screen ───────────────────────────────────────────────────────── */

const ReservationsPage = () => {
  const { outletId } = useAuth();
  const [date, setDate] = useState(localISO());
  const [view, setView] = useState('bookings');   // phones show one column at a time
  const [rows, setRows] = useState(null);
  const [rowsError, setRowsError] = useState('');
  const [queue, setQueue] = useState(null);
  const [queueError, setQueueError] = useState('');
  const [editing, setEditing] = useState(null);   // a booking, or {} for a new one

  const loadRows = () => api(`/reservations?date=${date}`).then((r) => { setRows(r); setRowsError(''); }).catch((e) => setRowsError(e.message));
  const loadQueue = () => api('/waitlist').then((r) => { setQueue(r); setQueueError(''); }).catch((e) => setQueueError(e.message));
  useEffect(() => { setRows(null); loadRows(); const t = setInterval(loadRows, POLL_MS); return () => clearInterval(t); }, [date, outletId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setQueue(null); loadQueue(); const t = setInterval(loadQueue, POLL_MS); return () => clearInterval(t); }, [outletId]); // eslint-disable-line react-hooks/exhaustive-deps

  const booked = (rows || []).filter((r) => r.status === 'BOOKED');
  const seated = (rows || []).filter((r) => r.status === 'SEATED');
  const late = booked.filter((r) => timing(r)?.tone === 'late').length;
  const today = date === localISO();

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h3 font-semibold text-ink-900">Reservations</h1>
          <p className="tabular mt-1 text-small text-ink-500">
            {rows ? <>
              <span className="font-medium text-ink-900">{booked.length} to arrive</span> · {booked.reduce((n, r) => n + r.party_size, 0)} guests
              {seated.length > 0 && <> · <span className="font-medium text-success">{seated.length} seated</span></>}
              {late > 0 && <> · <span className="font-semibold text-warning">{late} running late</span></>}
            </> : 'Bookings and the walk-in waitlist for this outlet.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-(--radius-control) border border-line-strong bg-surface">
            <button type="button" aria-label="Previous day" onClick={() => setDate(shiftDay(date, -1))} className="flex h-10 w-9 items-center justify-center text-ink-500 hover:text-ink-900"><ChevronLeft className="h-4 w-4" /></button>
            <label className="relative flex h-10 min-w-[7.5rem] cursor-pointer items-center justify-center border-x border-line px-3 text-small font-semibold text-ink-900">
              {dayLabel(date)}
              <input type="date" aria-label="Choose a day" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
                     onClick={(e) => e.currentTarget.showPicker?.()} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            <button type="button" aria-label="Next day" onClick={() => setDate(shiftDay(date, 1))} className="flex h-10 w-9 items-center justify-center text-ink-500 hover:text-ink-900"><ChevronRight className="h-4 w-4" /></button>
          </div>
          {!today && <Button variant="ghost" onClick={() => setDate(localISO())}>Today</Button>}
          <Button onClick={() => setEditing({})}>New booking</Button>
        </div>
      </div>

      <div role="tablist" aria-label="Show" className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface-2 p-1 xl:hidden">
        {[['bookings', 'Bookings', booked.length + seated.length], ['waitlist', 'Waitlist', queue?.length || 0]].map(([id, label, n]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
                  className={`rounded-md py-2 text-small font-medium ${view === id ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500'}`}>
            {label} <span className="tabular text-ink-400">{n}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label="Bookings" className={view === 'bookings' ? '' : 'hidden xl:block'}>
          <h2 className="mb-3 hidden text-title font-semibold text-ink-900 xl:block">Bookings</h2>
          <Bookings date={date} rows={rows} error={rowsError} onChanged={loadRows} editing={editing} setEditing={setEditing} />
        </section>
        <section aria-label="Waitlist" className={view === 'waitlist' ? '' : 'hidden xl:block'}>
          <h2 className="mb-3 hidden items-baseline gap-2 text-title font-semibold text-ink-900 xl:flex">Waitlist {queue?.length > 0 && <span className="tabular text-small font-normal text-ink-500">{queue.length} waiting now</span>}</h2>
          <Waitlist rows={queue} error={queueError} onChanged={loadQueue} />
        </section>
      </div>
    </div>
  );
};

export default ReservationsPage;
