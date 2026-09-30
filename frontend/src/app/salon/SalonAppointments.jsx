/*
 * Appointments: the day as a column per team member (who is free, who is booked, who is off), the week, and a
 * plain list. Booking checks availability on the server — one person can never be booked twice at once — and
 * all times are the salon's own, whatever the browser's zone.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Footprints, Plus, UserRound } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  APPT_STATUS, DEFAULT_TZ, addDays, clockText, dateText, fromLocal, localParts, qs, timeText, toClock, toMinutes, todayIn, useLoad, weekStart
} from '../../lib/salon.js';
import { Alert, Badge, Button, EmptyState, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Textarea, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import ClientPicker from './ClientPicker.jsx';
import { Chips, Segmented, useAction } from './parts.jsx';

const money = (n) => formatCurrency(n);
const LIVE = ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'];
const TONE_BLOCK = {
  BOOKED: 'border-brand-500 bg-brand-50 text-brand-700', CONFIRMED: 'border-brand-600 bg-brand-100 text-brand-700',
  CHECKED_IN: 'border-warning bg-warning/10 text-ink-900', IN_SERVICE: 'border-warning bg-warning/20 text-ink-900',
  COMPLETED: 'border-success bg-success/10 text-ink-900', CANCELLED: 'border-line bg-surface-2 text-ink-400', NO_SHOW: 'border-danger bg-danger/10 text-danger'
};
const PX_PER_MIN = 1.3;

const StatusPill = ({ status }) => <Badge tone={APPT_STATUS[status]?.tone || 'neutral'}>{APPT_STATUS[status]?.label || status}</Badge>;
const servicesText = (a) => a.services.map((s) => s.name).join(', ');

/* ── booking form ─────────────────────────────────────────────────────────── */

const BookingModal = ({ tz, outlet, initial, onClose, onSaved }) => {
  const services = useLoad('/salon/services?limit=200', { paged: true });
  const team = useLoad('/salon/staff?bookable=1&limit=200', { paged: true });
  const [client, setClient] = useState(null);
  const [guest, setGuest] = useState({ name: '', phone: '' });
  const [isGuest, setIsGuest] = useState(false);
  const [source, setSource] = useState(initial.source || 'PHONE');
  const [date, setDate] = useState(initial.date);
  const [picked, setPicked] = useState(() => initial.service_id ? [{ service_id: initial.service_id, staff_id: initial.staff_id ? String(initial.staff_id) : '' }] : []);
  const [time, setTime] = useState(initial.minutes != null ? toClock(initial.minutes) : '');
  const [notes, setNotes] = useState('');
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const [q, setQ] = useState('');
  const walkIn = source === 'WALK_IN';

  const list = services.data || [];
  const byId = new Map(list.map((s) => [s.service_id, s]));
  const staffList = team.data || [];
  const duration = picked.reduce((s, p) => s + (byId.get(p.service_id)?.duration_min || 0), 0);
  const total = picked.reduce((s, p) => s + (byId.get(p.service_id)?.price || 0), 0);
  const staffSet = [...new Set(picked.map((p) => p.staff_id).filter(Boolean))];
  const sameStaff = staffSet.length === 1 && picked.every((p) => p.staff_id === staffSet[0]) ? staffSet[0] : '';
  const ids = picked.map((p) => p.service_id).join(',');

  useEffect(() => {
    if (walkIn || !picked.length || !date) { setSlots(null); return undefined; }
    let live = true;
    api(`/salon/availability${qs({ date, service_ids: ids, staff_id: sameStaff })}`).then((a) => { if (live) setSlots(a.slots); }).catch((e) => { if (live) { setSlots([]); setError(e.message); } });
    return () => { live = false; };
  }, [date, ids, sameStaff, walkIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setPicked((p) => (p.some((x) => x.service_id === id) ? p.filter((x) => x.service_id !== id) : [...p, { service_id: id, staff_id: initial.staff_id && p.length === 0 ? String(initial.staff_id) : '' }]));
  const setStaff = (id, staff_id) => setPicked((p) => p.map((x) => (x.service_id === id ? { ...x, staff_id } : x)));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isGuest && !client && !walkIn) { setError('Choose a client, or switch to a guest with a name and mobile'); return; }
    if (!picked.length) { setError('Choose at least one service'); return; }
    if (!walkIn && !time) { setError('Choose a time'); return; }
    const body = {
      source, notes: notes.trim() || undefined,
      ...(client && !isGuest ? { customer_id: client.customer_id } : { guest_name: guest.name || 'Walk-in', guest_phone: guest.phone || undefined }),
      ...(walkIn ? {} : { start_at: fromLocal(date, toMinutes(time), tz).toISOString() }),
      services: picked.map((p) => ({ service_id: p.service_id, ...(p.staff_id ? { staff_id: Number(p.staff_id) } : {}) }))
    };
    const made = await run(() => api('/salon/appointments', { method: 'POST', body }).catch((caught) => { setError(caught.message); throw caught; }), walkIn ? 'Checked in' : 'Appointment booked');
    if (made) onSaved(made);
  };

  const minTime = outlet?.open;
  return (
    <Modal title={walkIn ? 'Walk-in' : 'New appointment'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <Alert>{error}</Alert>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="How it was booked" value={source} onChange={setSource} options={[{ value: 'PHONE', label: 'Phone' }, { value: 'WALK_IN', label: 'Walk-in' }, { value: 'ONLINE', label: 'Online' }, { value: 'APP', label: 'App' }]} size="sm" />
          {walkIn && <span className="text-caption text-ink-500">Starts now, with whoever is free.</span>}
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-small font-medium text-ink-700">Client</legend>
          {!isGuest ? <ClientPicker value={client} onChange={setClient} id="appt-client" />
            : <div className="grid gap-3 sm:grid-cols-2"><Field id="guest-name" label="Guest name"><Input id="guest-name" value={guest.name} onChange={(e) => setGuest((g) => ({ ...g, name: e.target.value }))} /></Field><Field id="guest-phone" label="Guest mobile" hint="A number we know matches that client automatically"><Input id="guest-phone" type="tel" inputMode="tel" value={guest.phone} onChange={(e) => setGuest((g) => ({ ...g, phone: e.target.value }))} /></Field></div>}
          <button type="button" className="text-caption font-medium text-brand-600" onClick={() => setIsGuest((v) => !v)}>{isGuest ? 'Choose an existing client instead' : 'Book for a guest without adding them as a client'}</button>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-small font-medium text-ink-700">Services</legend>
          <Input type="search" aria-label="Search services" placeholder="Search services" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
          <ListState loading={services.loading} error={services.error} empty={!services.loading && list.length === 0} emptyLabel="Add services first under Services." />
          <div className="grid max-h-44 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {list.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())).map((s) => {
              const on = picked.some((p) => p.service_id === s.service_id);
              return (
                <button type="button" key={s.service_id} aria-pressed={on} onClick={() => toggle(s.service_id)}
                        className={`flex items-center justify-between gap-2 rounded-(--radius-control) border px-3 py-2 text-left text-small transition-colors ${on ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-line-strong'}`}>
                  <span className="font-medium text-ink-900">{s.name}</span>
                  <span className="shrink-0 text-caption text-ink-500">{s.duration_min} min · {money(s.price)}</span>
                </button>
              );
            })}
          </div>
          {picked.length > 0 && (
            <ul className="mt-3 space-y-2">
              {picked.map((p) => (
                <li key={p.service_id} className="flex flex-wrap items-center gap-2 text-small">
                  <span className="min-w-32 flex-1 font-medium text-ink-900">{byId.get(p.service_id)?.name}</span>
                  <Select aria-label={`Who does ${byId.get(p.service_id)?.name}`} value={p.staff_id} onChange={(e) => setStaff(p.service_id, e.target.value)} className="!w-auto min-w-40 !py-1.5">
                    <option value="">Whoever is free</option>
                    {staffList.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.name}</option>)}
                  </Select>
                </li>
              ))}
              <li className="text-caption text-ink-500">{duration} minutes in all · {money(total)}</li>
            </ul>
          )}
        </fieldset>

        {!walkIn && (
          <fieldset className="space-y-3">
            <legend className="mb-1 text-small font-medium text-ink-700">When</legend>
            <div className="flex flex-wrap items-end gap-3">
              <Field id="appt-date" label="Date"><Input id="appt-date" type="date" value={date} min={todayIn(tz)} onChange={(e) => { setDate(e.target.value); setTime(''); }} /></Field>
              <Field id="appt-time" label="Exact time" hint={minTime ? `We open at ${clockText(minTime)}` : undefined}><Input id="appt-time" type="time" value={time} step={(outlet?.slot_minutes || 15) * 60} onChange={(e) => setTime(e.target.value)} /></Field>
            </div>
            {picked.length > 0 && slots && (slots.length
              ? <div><p className="mb-1.5 text-caption text-ink-500">Free times that day</p>
                <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">{slots.map((s) => <button key={s.time} type="button" aria-pressed={time === s.time} title={s.staff.map((x) => x.name).join(', ')} onClick={() => setTime(s.time)} className={`rounded-full border px-3 py-1 text-caption font-medium ${time === s.time ? 'border-brand-500 bg-brand-500 text-white' : 'border-line hover:border-brand-500'}`}>{clockText(s.time)}</button>)}</div></div>
              : <p className="text-caption text-warning">Nobody is free for {duration} minutes that day. Try another day{sameStaff ? ' or another team member' : ''}.</p>)}
          </fieldset>
        )}

        <Field id="appt-notes" label="Notes"><Textarea id="appt-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the stylist should know" /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{walkIn ? 'Check in' : 'Book appointment'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* ── one appointment ──────────────────────────────────────────────────────── */

const NEXT = {
  BOOKED: [['CONFIRMED', 'Confirm'], ['CHECKED_IN', 'Check in']],
  CONFIRMED: [['CHECKED_IN', 'Check in']],
  CHECKED_IN: [['IN_SERVICE', 'Start service']],
  IN_SERVICE: []
};

const DetailModal = ({ id, tz, onClose, onChanged }) => {
  const { can, business } = useAuth();
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const { data: a, error, loading, reload } = useLoad(`/salon/appointments/${id}`);
  const team = useLoad('/salon/staff?bookable=1&limit=200', { paged: true });
  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState({ date: '', time: '' });
  const [busy, run] = useAction();
  const stylist = business?.role === 'STYLIST';

  useEffect(() => { if (a) { const p = localParts(a.start_at, tz); setWhen({ date: p.date, time: toClock(p.minutes) }); } }, [a, tz]);

  const setStatus = async (status, reason) => {
    const out = await run(() => api(`/salon/appointments/${id}/status`, { method: 'POST', body: { status, reason } }), `Marked ${APPT_STATUS[status].label.toLowerCase()}`);
    if (out) {
      if (out.policy?.late_cancellation) toast.info(`Late cancellation${out.policy.fee_pct ? ` — your policy charges ${out.policy.fee_pct}%` : ''}${out.policy.text ? `: ${out.policy.text}` : ''}`);
      onChanged(); reload();
    }
  };
  const cancel = async () => {
    const reason = await dialog.prompt({ title: 'Cancel this appointment?', label: 'Reason', required: false, confirmLabel: 'Cancel appointment', cancelLabel: 'Keep it', danger: true });
    if (reason !== null) setStatus('CANCELLED', reason || undefined);
  };
  const move = async () => {
    const out = await run(() => api(`/salon/appointments/${id}`, { method: 'PUT', body: { start_at: fromLocal(when.date, toMinutes(when.time), tz).toISOString() } }), 'Appointment moved');
    if (out) { setMoving(false); onChanged(); reload(); }
  };
  const changeStaff = async (line, staff_id) => {
    const out = await run(() => api(`/salon/appointments/${id}`, { method: 'PUT', body: { services: [{ line_id: line.line_id, staff_id: Number(staff_id) }] } }), 'Updated');
    if (out) { onChanged(); reload(); }
  };

  const live = a && LIVE.includes(a.status);
  return (
    <Modal title={a ? `${a.customer_name || 'Guest'} · ${dateText(localParts(a.start_at, tz).date)}` : 'Appointment'} onClose={onClose}>
      <ListState loading={loading} error={error} />
      {a && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusPill status={a.status} />
            <span className="text-small text-ink-500">{timeText(a.start_at, tz)} – {timeText(a.end_at, tz)}</span>
          </div>
          <p className="text-small text-ink-700">
            <UserRound aria-hidden="true" className="mr-1.5 inline h-4 w-4 text-ink-400" />{a.customer_name || 'Guest'}{a.customer_phone && ` · ${a.customer_phone}`}{a.is_guest && <Badge tone="neutral"> guest</Badge>}
          </p>
          <ul className="divide-y divide-line rounded-(--radius-card) border border-line">
            {a.services.map((s) => (
              <li key={s.line_id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-small">
                <span className="min-w-32 flex-1"><span className="block font-medium text-ink-900">{s.name}</span><span className="text-caption text-ink-500">{timeText(s.start_at, tz)} · {s.duration_min} min</span></span>
                {live && !stylist && team.data ? (
                  <Select aria-label={`Who does ${s.name}`} value={s.staff_id} onChange={(e) => changeStaff(s, e.target.value)} className="!w-auto !py-1">
                    {team.data.map((t) => <option key={t.staff_id} value={t.staff_id}>{t.name}</option>)}
                  </Select>
                ) : <span className="text-ink-700">{s.staff_name}</span>}
                <span className="tabular font-medium text-ink-900">{money(s.price)}</span>
              </li>
            ))}
            <li className="flex justify-between px-3.5 py-2.5 text-small font-semibold"><span>Total</span><span className="tabular">{money(a.total)}</span></li>
          </ul>
          {a.notes && <p className="rounded-(--radius-control) bg-surface-2 px-3 py-2 text-small text-ink-700">{a.notes}</p>}
          {a.cancel_reason && <p className="text-small text-ink-500">Cancelled: {a.cancel_reason}</p>}

          {moving && (
            <div className="flex flex-wrap items-end gap-3 rounded-(--radius-card) border border-line p-3">
              <Field id="mv-date" label="Date"><Input id="mv-date" type="date" value={when.date} onChange={(e) => setWhen((w) => ({ ...w, date: e.target.value }))} /></Field>
              <Field id="mv-time" label="Time"><Input id="mv-time" type="time" value={when.time} onChange={(e) => setWhen((w) => ({ ...w, time: e.target.value }))} /></Field>
              <Button loading={busy} onClick={move}>Move</Button>
              <Button variant="ghost" onClick={() => setMoving(false)}>Not now</Button>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {live && (NEXT[a.status] || []).map(([to, label]) => <Button key={to} variant="secondary" loading={busy} onClick={() => setStatus(to)}>{label}</Button>)}
            {live && !stylist && <Button variant="secondary" onClick={() => setMoving((v) => !v)}><Clock aria-hidden="true" className="h-4 w-4" />Reschedule</Button>}
            {['BOOKED', 'CONFIRMED'].includes(a.status) && !stylist && <Button variant="ghost" onClick={() => setStatus('NO_SHOW')}>No-show</Button>}
            {live && !stylist && <Button variant="ghost" className="text-danger" onClick={cancel}>Cancel</Button>}
            {live && can('billing') && <Button onClick={() => navigate(`/app/salon/pos?appointment=${a.appointment_id}`)}>Take payment</Button>}
            {a.status === 'COMPLETED' && a.invoice_id && <Button variant="secondary" onClick={() => navigate(`/app/billing/invoices/${a.invoice_id}`)}>View bill</Button>}
          </div>
        </div>
      )}
    </Modal>
  );
};

/* ── day: a column per person ─────────────────────────────────────────────── */

const DayGrid = ({ data, appts, tz, date, onBook, onOpen }) => {
  const { outlet, staff } = data;
  const open = toMinutes(outlet.open); const close = toMinutes(outlet.close);
  const byId = new Map(appts.map((a) => [a.appointment_id, a]));
  const hours = []; for (let m = Math.ceil(open / 60) * 60; m < close; m += 60) hours.push(m);
  const now = localParts(Date.now(), tz);
  const height = (close - open) * PX_PER_MIN;

  if (!outlet.open_today) return <EmptyState icon={CalendarDays} title="Closed this day" body="This outlet is not open on this weekday. Change the working days in Salon settings." />;
  if (!staff.length) return <EmptyState icon={UserRound} title="No team members to book" body="Add team members under Team & commission and mark them bookable." />;

  return (
    <div className="overflow-x-auto rounded-(--radius-card) border border-line bg-surface">
      <div className="flex min-w-max">
        <div className="sticky left-0 z-10 w-14 shrink-0 border-r border-line bg-surface">
          <div className="h-11 border-b border-line" />
          <div className="relative" style={{ height }}>
            {hours.map((m) => <span key={m} className="absolute right-2 -translate-y-1/2 text-[11px] text-ink-400" style={{ top: (m - open) * PX_PER_MIN }}>{clockText(toClock(m))}</span>)}
          </div>
        </div>
        {staff.map((s) => {
          const w = s.window ? { start: toMinutes(s.window.start), end: toMinutes(s.window.end) } : null;
          return (
            <div key={s.staff_id} className="w-44 shrink-0 border-r border-line last:border-0">
              <div className="flex h-11 flex-col justify-center border-b border-line px-3">
                <span className="truncate text-small font-semibold text-ink-900">{s.name}</span>
                <span className="truncate text-[11px] text-ink-500">{s.off ? (s.attendance === 'LEAVE' ? 'On leave' : s.attendance === 'ABSENT' ? 'Absent' : 'Day off') : `${clockText(s.window.start)} – ${clockText(s.window.end)}`}</span>
              </div>
              <div className="relative cursor-cell" style={{ height }}
                   onClick={(e) => {
                     if (!w) return;
                     const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                     const step = outlet.slot_minutes || 15;
                     const minutes = open + Math.floor(y / PX_PER_MIN / step) * step;
                     if (minutes >= w.start && minutes < w.end) onBook({ staff_id: s.staff_id, minutes });
                   }}>
                {hours.map((m) => <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-line/70" style={{ top: (m - open) * PX_PER_MIN }} />)}
                {/* the hours this person is not working */}
                {(!w ? [[open, close]] : [[open, Math.max(open, w.start)], [Math.min(close, w.end), close]]).filter(([a, b]) => b > a).map(([a, b], i) => (
                  <div key={i} className="pointer-events-none absolute inset-x-0 bg-surface-3/70" style={{ top: (a - open) * PX_PER_MIN, height: (b - a) * PX_PER_MIN, backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 6px, rgba(0,0,0,0.04) 6px 12px)' }} />
                ))}
                {now.date === date && now.minutes >= open && now.minutes <= close && <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: (now.minutes - open) * PX_PER_MIN }} />}
                {s.bookings.map((b) => {
                  const a = byId.get(b.appointment_id);
                  const st = localParts(b.start_at, tz).minutes; const en = localParts(b.end_at, tz).minutes || 24 * 60;
                  const top = (Math.max(st, open) - open) * PX_PER_MIN; const h = Math.max(22, (Math.min(en, close) - Math.max(st, open)) * PX_PER_MIN - 2);
                  const status = a?.status || 'BOOKED';
                  return (
                    <button key={b.line_id} type="button" onClick={(e) => { e.stopPropagation(); onOpen(b.appointment_id); }}
                            className={`absolute inset-x-1 overflow-hidden rounded-lg border-l-4 px-2 py-1 text-left text-[11px] leading-tight shadow-sm transition-shadow hover:shadow-md ${TONE_BLOCK[status] || TONE_BLOCK.BOOKED}`} style={{ top, height: h }}
                            aria-label={`${a?.customer_name || 'Guest'}, ${b.service}, ${timeText(b.start_at, tz)}`}>
                      <span className="block truncate font-semibold">{a?.customer_name || 'Guest'}</span>
                      <span className="block truncate opacity-80">{b.service}</span>
                      {h > 44 && <span className="block truncate opacity-70">{timeText(b.start_at, tz)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ── week and list ────────────────────────────────────────────────────────── */

const AppointmentRow = ({ a, tz, onOpen }) => (
  <button type="button" onClick={() => onOpen(a.appointment_id)} className={`w-full rounded-lg border-l-4 px-2.5 py-1.5 text-left text-caption transition-shadow hover:shadow-sm ${TONE_BLOCK[a.status]}`}>
    <span className="block font-semibold">{timeText(a.start_at, tz)} · {a.customer_name || 'Guest'}</span>
    <span className="block truncate opacity-80">{servicesText(a)}</span>
    <span className="block truncate opacity-70">{[...new Set(a.services.map((s) => s.staff_name))].join(', ')}</span>
  </button>
);

const WeekView = ({ appts, tz, start, today, onOpen, onDay }) => {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const by = new Map(days.map((d) => [d, []]));
  for (const a of appts) by.get(localParts(a.start_at, tz).date)?.push(a);
  return (
    <div className="grid gap-3 md:grid-cols-7">
      {days.map((d) => (
        <section key={d} aria-label={dateText(d)} className={`min-h-28 rounded-(--radius-card) border bg-surface p-2 ${d === today ? 'border-brand-500' : 'border-line'}`}>
          <button type="button" onClick={() => onDay(d)} className="mb-2 flex w-full items-baseline justify-between px-1 text-left">
            <span className={`text-small font-semibold ${d === today ? 'text-brand-700' : 'text-ink-900'}`}>{dateText(d, { weekday: 'short', day: 'numeric' })}</span>
            <span className="text-[11px] text-ink-400">{by.get(d).filter((a) => LIVE.includes(a.status) || a.status === 'COMPLETED').length || ''}</span>
          </button>
          <div className="space-y-1.5">{by.get(d).map((a) => <AppointmentRow key={a.appointment_id} a={a} tz={tz} onOpen={onOpen} />)}</div>
        </section>
      ))}
    </div>
  );
};

const ListView = ({ appts, tz, onOpen }) => (
  <Table>
    <Thead><Th>When</Th><Th>Client</Th><Th>Services</Th><Th>With</Th><Th>Status</Th><Th className="text-right">Total</Th></Thead>
    <tbody>
      {appts.map((a) => (
        <Tr key={a.appointment_id} onClick={() => onOpen(a.appointment_id)}>
          <Td className="whitespace-nowrap">{dateText(localParts(a.start_at, tz).date)} · {timeText(a.start_at, tz)}</Td>
          <Td>{a.customer_name || 'Guest'}{a.customer_phone && <span className="block text-caption text-ink-500">{a.customer_phone}</span>}</Td>
          <Td>{servicesText(a)}</Td>
          <Td>{[...new Set(a.services.map((s) => s.staff_name))].join(', ')}</Td>
          <Td><StatusPill status={a.status} /></Td>
          <Td className="text-right tabular">{money(a.total)}</Td>
        </Tr>
      ))}
    </tbody>
  </Table>
);

/* ── the page ─────────────────────────────────────────────────────────────── */

const SalonAppointments = () => {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') || 'day';
  const [tz, setTz] = useState(DEFAULT_TZ);
  const [date, setDate] = useState(params.get('date') || todayIn(DEFAULT_TZ));
  const [status, setStatus] = useState('');
  const [booking, setBooking] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  const schedule = useLoad(`/salon/schedule?date=${date}&t=${tick}`);
  useEffect(() => { if (schedule.data?.timezone) setTz(schedule.data.timezone); }, [schedule.data]);
  useEffect(() => { const s = schedule.data?.timezone; if (s && !params.get('date') && date === todayIn(DEFAULT_TZ)) setDate(todayIn(s)); }, [schedule.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = weekStart(date);
  const range = view === 'week' ? { from: start, to: addDays(start, 6) } : view === 'list' ? { from: date, to: addDays(date, 13) } : { from: date, to: date };
  const list = useLoad(`/salon/appointments${qs({ ...range, status, t: tick })}`);
  const appts = list.data || [];

  const setView = (v) => setParams({ view: v, date }, { replace: true });
  const go = (n) => setDate((d) => addDays(d, view === 'week' ? n * 7 : n));
  const canBook = can('appointments') && !schedule.error;
  const today = todayIn(tz);

  const summary = useMemo(() => ({
    total: appts.filter((a) => a.status !== 'CANCELLED').length,
    upcoming: appts.filter((a) => LIVE.includes(a.status)).length
  }), [appts]);

  return (
    <div>
      <PageHeader title="Appointments" lead="Book, move and check clients in. Nobody can be booked twice at the same time."
                  action={canBook && <>
                    <Button variant="secondary" onClick={() => setBooking({ date: today, source: 'WALK_IN' })}><Footprints aria-hidden="true" className="h-4 w-4" />Walk-in</Button>
                    <Button onClick={() => setBooking({ date })}><Plus aria-hidden="true" className="h-4 w-4" />Book</Button>
                  </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'list', label: 'List' }]} />
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label="Earlier" onClick={() => go(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="secondary" size="sm" onClick={() => setDate(today)}>Today</Button>
          <Button variant="secondary" size="sm" aria-label="Later" onClick={() => go(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="w-40"><Input type="date" aria-label="Go to a date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
        <p className="text-small font-medium text-ink-900">{view === 'week' ? `${dateText(start)} – ${dateText(addDays(start, 6))}` : dateText(date, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <span className="ml-auto text-caption text-ink-500">{summary.total} appointment{summary.total === 1 ? '' : 's'}{summary.upcoming ? ` · ${summary.upcoming} still to come` : ''}</span>
      </div>
      {view !== 'day' && <div className="mb-4"><Chips label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, ...Object.entries(APPT_STATUS).map(([value, s]) => ({ value, label: s.label }))]} /></div>}

      {schedule.error && <Alert>{schedule.error}</Alert>}
      {view === 'day' && schedule.data && <DayGrid data={schedule.data} appts={appts} tz={tz} date={date} onOpen={setOpenId} onBook={canBook ? (slot) => setBooking({ date, ...slot }) : () => {}} />}
      {view === 'week' && <WeekView appts={appts} tz={tz} start={start} today={today} onOpen={setOpenId} onDay={(d) => { setDate(d); setView('day'); }} />}
      {view === 'list' && (
        <>
          <ListState loading={list.loading} error={list.error} empty={!list.loading && appts.length === 0} emptyLabel="No appointments in the next two weeks." emptyIcon={CalendarDays} />
          {appts.length > 0 && <ListView appts={appts} tz={tz} onOpen={setOpenId} />}
        </>
      )}

      {booking && schedule.data && <BookingModal tz={tz} outlet={schedule.data.outlet} initial={booking} onClose={() => setBooking(null)} onSaved={() => { setBooking(null); refresh(); }} />}
      {openId && <DetailModal id={openId} tz={tz} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  );
};

export default SalonAppointments;
