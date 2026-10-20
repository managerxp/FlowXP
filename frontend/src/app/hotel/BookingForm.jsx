/*
 * The booking form: a guest, the dates, one or more rooms, the source, an advance. Used for a booking made ahead and for a walk-in (who arrives today and is
 * checked in at once, so each room must be chosen by number). The price of each room comes from the rate card for those dates and can be overridden by the desk.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { ID_TYPES, METHODS, SOURCES, addDays, nightsBetween, qs, useDebounced } from '../../lib/hotel.js';
import { Alert, Badge, Button, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui.jsx';
import { useAction } from '../salon/parts.jsx';
import { useT } from '../../i18n/useT.js';

const blankRoom = (typeId = '') => ({ key: Math.random().toString(36).slice(2), room_type_id: typeId, adults: 1, children: 0, room_id: '', rate: '' });

const GuestPicker = ({ guest, setGuest, onPick }) => {
  const tr = useT();
  const [text, setText] = useState('');
  const q = useDebounced(text, 250);
  const [hits, setHits] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2 || guest.guest_id) { setHits([]); return; }
    let live = true;
    api(`/hotel/guests${qs({ q: q.trim() })}`).then((r) => live && setHits(r)).catch(() => {});
    return () => { live = false; };
  }, [q, guest.guest_id]);
  if (guest.guest_id) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-control) border border-line bg-surface-2 px-3.5 py-2.5">
        <div className="text-small"><span className="font-semibold text-ink-900">{guest.name}</span>{guest.phone && <span className="ml-2 text-ink-500">{guest.phone}</span>}{guest.is_vip && <span className="ml-2"><Badge tone="warning">{tr('VIP')}</Badge></span>}</div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setGuest({ name: '', phone: '', email: '' })}>{tr('Choose someone else')}</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-400" />
        <Input aria-label={tr('Find a returning guest')} placeholder={tr('Find a returning guest by name or phone')} value={text} onChange={(e) => setText(e.target.value)} className="pl-9" />
      </div>
      {hits.length > 0 && (
        <ul className="max-h-44 divide-y divide-line overflow-auto rounded-(--radius-control) border border-line bg-surface">
          {hits.map((g) => (
            <li key={g.guest_id}>
              <button type="button" onClick={() => { onPick(g); setText(''); setHits([]); }} className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-small hover:bg-surface-2">
                <span><span className="font-medium text-ink-900">{g.name}</span> <span className="text-ink-500">{g.phone}</span></span>
                <span className="text-caption text-ink-500">{g.stays ? `${g.stays} stay${g.stays === 1 ? '' : 's'}` : tr('New')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default function BookingForm({ walkIn = false, businessDate, initial = {}, onClose, onSaved }) {
  const tr = useT();
  const toast = useToast();
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [types, setTypes] = useState([]);
  const [plans, setPlans] = useState([]);
  const [free, setFree] = useState({});         // room type id -> rooms free for the dates
  const [avail, setAvail] = useState({});       // room type id -> rooms free on the tightest night
  const [quotes, setQuotes] = useState({});     // line key -> quote
  const [more, setMore] = useState(false);
  const arrivalDefault = walkIn ? businessDate : (initial.arrival || businessDate);
  const [form, setForm] = useState({
    arrival: arrivalDefault, departure: initial.departure || addDays(arrivalDefault, 1), rate_plan_id: '', source: walkIn ? 'WALK_IN' : 'PHONE', source_ref: '', company: '', notes: '',
    advance_amount: '', advance_method: 'CASH', advance_ref: ''
  });
  const [guest, setGuest] = useState({ name: '', phone: '', email: '', id_type: '', id_number: '', nationality: 'Indian', address: '', gstin: '' });
  const [rooms, setRooms] = useState([{ ...blankRoom(initial.room_type_id || ''), room_id: initial.room_id || '' }]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setG = (k) => (e) => setGuest((g) => ({ ...g, [k]: e.target.value }));
  const nights = form.arrival && form.departure ? nightsBetween(form.arrival, form.departure) : 0;
  const datesOk = nights >= 1 && nights <= 120;

  useEffect(() => {
    Promise.all([api('/hotel/room-types'), api('/hotel/rate-plans')]).then(([t, p]) => {
      setTypes(t); setPlans(p);
      setForm((f) => ({ ...f, rate_plan_id: f.rate_plan_id || p.find((x) => x.is_default)?.rate_plan_id || '' }));
      setRooms((r) => r.map((x) => (x.room_type_id ? x : { ...x, room_type_id: t[0]?.room_type_id || '' })));
    }).catch((e) => setError(e.message));
  }, []);

  // what is free for these dates, and which rooms
  useEffect(() => {
    if (!datesOk) return;
    let live = true;
    api(`/hotel/availability${qs({ from: form.arrival, to: form.departure })}`).then((a) => {
      if (live) setAvail(Object.fromEntries(a.room_types.map((t) => [t.room_type_id, Math.min(...t.nights.map((n) => n.available))])));
    }).catch(() => {});
    Promise.all(types.map((t) => api(`/hotel/free-rooms${qs({ room_type_id: t.room_type_id, arrival: form.arrival, departure: form.departure })}`).then((r) => [t.room_type_id, r]))).then((all) => { if (live) setFree(Object.fromEntries(all)); }).catch(() => {});
    return () => { live = false; };
  }, [form.arrival, form.departure, datesOk, types]);

  // the price of each room line from the rate card
  const lineKey = rooms.map((r) => `${r.key}:${r.room_type_id}:${r.adults}:${r.children}`).join('|');
  useEffect(() => {
    if (!datesOk) return;
    let live = true;
    Promise.all(rooms.map((r) => (r.room_type_id
      ? api(`/hotel/quote${qs({ room_type_id: r.room_type_id, rate_plan_id: form.rate_plan_id, arrival: form.arrival, departure: form.departure, adults: r.adults, children: r.children })}`).then((q) => [r.key, q]).catch((e) => [r.key, { error: e.message }])
      : Promise.resolve([r.key, null])))).then((all) => { if (live) setQuotes(Object.fromEntries(all)); });
    return () => { live = false; };
  }, [lineKey, form.arrival, form.departure, form.rate_plan_id, datesOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRoom = (key, patch) => setRooms((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const wanted = useMemo(() => rooms.reduce((m, r) => ({ ...m, [r.room_type_id]: (m[r.room_type_id] || 0) + 1 }), {}), [rooms]);

  const total = rooms.reduce((s, r) => {
    const q = quotes[r.key];
    if (r.rate !== '' && Number(r.rate) >= 0) return s + Number(r.rate) * nights;
    return s + (q?.total || 0);
  }, 0);

  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (!guest.name.trim() && !guest.guest_id) { setError(tr('Enter the guest’s name')); return; }
    if (!datesOk) { setError(nights < 1 ? tr('The departure must be after the arrival') : tr('A stay can be up to 120 nights')); return; }
    if (walkIn && rooms.some((r) => !r.room_id)) { setError(tr('Choose the room number for each room')); return; }
    const body = {
      guest: guest.guest_id ? { guest_id: guest.guest_id } : { ...guest, name: guest.name.trim(), phone: guest.phone || undefined, email: guest.email || undefined, id_type: guest.id_type || undefined, id_number: guest.id_number || undefined, address: guest.address || undefined, gstin: guest.gstin || undefined },
      arrival: walkIn ? undefined : form.arrival, departure: form.departure, rate_plan_id: form.rate_plan_id || undefined, source: form.source, source_ref: form.source_ref || undefined,
      company: form.company || undefined, notes: form.notes || undefined,
      rooms: rooms.map((r) => ({ room_type_id: Number(r.room_type_id), room_id: r.room_id ? Number(r.room_id) : undefined, adults: Number(r.adults) || 1, children: Number(r.children) || 0, rate: r.rate === '' ? undefined : Number(r.rate) })),
      advance: Number(form.advance_amount) > 0 ? { amount: Number(form.advance_amount), method: form.advance_method, reference: form.advance_ref || undefined } : undefined
    };
    const saved = await run(() => api(walkIn ? '/hotel/walk-ins' : '/hotel/bookings', { method: 'POST', body }).catch((c) => { setError(c.message); throw c; }), walkIn ? 'Checked in' : 'Booking made');
    if (saved) { toast.success(tr('{{res_no}} for {{guest_name}}', { res_no: saved.res_no, guest_name: saved.guest_name })); onSaved(saved); }
  };

  return (
    <Modal title={walkIn ? tr('Walk-in guest') : tr('New booking')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-6">
        <Alert>{error}</Alert>

        <section className="space-y-3">
          <h3 className="text-small font-semibold text-ink-900">{tr('Guest')}</h3>
          <GuestPicker guest={guest} setGuest={setGuest} onPick={(g) => setGuest({ ...g, name: g.name, phone: g.phone || '' })} />
          {!guest.guest_id && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id="bk-name" label={tr('Name')}><Input id="bk-name" value={guest.name} onChange={setG('name')} required autoFocus /></Field>
                <Field id="bk-phone" label={tr('Mobile')}><Input id="bk-phone" type="tel" inputMode="tel" value={guest.phone} onChange={setG('phone')} /></Field>
                <Field id="bk-email" label={tr('Email')}><Input id="bk-email" type="email" value={guest.email} onChange={setG('email')} /></Field>
              </div>
              <button type="button" onClick={() => setMore((m) => !m)} className="text-caption font-medium text-brand-600 hover:underline">{more ? tr('Hide') : tr('Add')} ID, nationality and company details</button>
              {more && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field id="bk-idt" label={tr('ID type')}><Select id="bk-idt" value={guest.id_type} onChange={setG('id_type')}><option value="">{tr('Not taken yet')}</option>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
                  <Field id="bk-idn" label={tr('ID number')}><Input id="bk-idn" value={guest.id_number} onChange={setG('id_number')} /></Field>
                  <Field id="bk-nat" label={tr('Nationality')}><Input id="bk-nat" value={guest.nationality} onChange={setG('nationality')} /></Field>
                  <Field id="bk-addr" label={tr('Address')}><Input id="bk-addr" value={guest.address} onChange={setG('address')} /></Field>
                  <Field id="bk-gstin" label={tr('GSTIN')} hint={tr('For a company bill')}><Input id="bk-gstin" value={guest.gstin} onChange={setG('gstin')} /></Field>
                  <Field id="bk-co" label={tr('Company')}><Input id="bk-co" value={form.company} onChange={set('company')} /></Field>
                </div>
              )}
            </>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-small font-semibold text-ink-900">{tr('Stay')}</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field id="bk-arr" label={tr('Arrival')}><Input id="bk-arr" type="date" value={form.arrival} min={businessDate} onChange={(e) => setForm((f) => ({ ...f, arrival: e.target.value, departure: e.target.value >= f.departure ? addDays(e.target.value, 1) : f.departure }))} disabled={walkIn} required /></Field>
            <Field id="bk-dep" label={tr('Departure')}><Input id="bk-dep" type="date" value={form.departure} min={addDays(form.arrival || businessDate, 1)} onChange={set('departure')} required /></Field>
            <Field id="bk-plan" label={tr('Rate plan')}><Select id="bk-plan" value={form.rate_plan_id} onChange={set('rate_plan_id')}>{plans.map((p) => <option key={p.rate_plan_id} value={p.rate_plan_id}>{p.name}</option>)}</Select></Field>
            <Field id="bk-src" label={tr('Where it came from')}><Select id="bk-src" value={form.source} onChange={set('source')}>{SOURCES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
          </div>
          {form.source !== 'WALK_IN' && form.source !== 'PHONE' && <Field id="bk-ref" label={tr('Their booking number')} hint={tr('The OTA or agent\'s reference, so you can match it later')}><Input id="bk-ref" value={form.source_ref} onChange={set('source_ref')} /></Field>}
          <p className="text-caption text-ink-500">{datesOk ? `${nights} night${nights === 1 ? '' : 's'}` : tr('Choose the dates')}</p>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-small font-semibold text-ink-900">{tr('Rooms')}</h3>
            <Button type="button" variant="secondary" size="sm" onClick={() => setRooms((r) => [...r, blankRoom(types[0]?.room_type_id || '')])}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add a room')}</Button>
          </div>
          {rooms.map((r, i) => {
            const t = types.find((x) => String(x.room_type_id) === String(r.room_type_id));
            const q = quotes[r.key];
            const left = (avail[r.room_type_id] ?? 0) - (wanted[r.room_type_id] || 0);
            return (
              <div key={r.key} className="space-y-3 rounded-(--radius-card) border border-line p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field id={`rm-t-${i}`} label={tr('Room type')}><Select id={`rm-t-${i}`} value={r.room_type_id} onChange={(e) => updateRoom(r.key, { room_type_id: e.target.value, room_id: '' })}>{types.map((x) => <option key={x.room_type_id} value={x.room_type_id}>{x.name}</option>)}</Select></Field>
                  <Field id={`rm-a-${i}`} label={tr('Adults')}><Input id={`rm-a-${i}`} type="number" min="1" max={t?.max_adults || 20} value={r.adults} onChange={(e) => updateRoom(r.key, { adults: e.target.value })} /></Field>
                  <Field id={`rm-c-${i}`} label={tr('Children')}><Input id={`rm-c-${i}`} type="number" min="0" max={t?.max_children ?? 20} value={r.children} onChange={(e) => updateRoom(r.key, { children: e.target.value })} /></Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id={`rm-n-${i}`} label={walkIn ? tr('Room number') : tr('Room number (optional)')}>
                    <Select id={`rm-n-${i}`} value={r.room_id} onChange={(e) => updateRoom(r.key, { room_id: e.target.value })}>
                      <option value="">{walkIn ? tr('Choose a room') : tr('Decide at check-in')}</option>
                      {(free[r.room_type_id] || []).filter((f) => f.room_id === Number(r.room_id) || !rooms.some((o) => o.key !== r.key && Number(o.room_id) === f.room_id)).map((f) => <option key={f.room_id} value={f.room_id}>{f.room_no}{f.hk_status === 'DIRTY' ? tr('(not cleaned)') : ''}</option>)}
                    </Select>
                  </Field>
                  <Field id={`rm-r-${i}`} label={tr('Rate a night')} hint={q?.nights?.[0] ? `Card: ${formatCurrency(q.nights[0].rate_paise / 100)}` : undefined}><Input id={`rm-r-${i}`} type="number" min="0" step="any" placeholder={q?.nights?.[0] ? String(q.nights[0].rate_paise / 100) : ''} value={r.rate} onChange={(e) => updateRoom(r.key, { rate: e.target.value })} /></Field>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-caption">
                  <span className="text-ink-500">
                    {q?.error ? <span className="text-danger">{q.error}</span> : q ? `${q.nights.length} night${q.nights.length === 1 ? '' : 's'} · ${formatCurrency((r.rate !== '' ? Number(r.rate) * nights : q.total_paise / 100))} before GST` : ''}
                    {q?.nights && new Set(q.nights.map((n) => n.rate_paise)).size > 1 && r.rate === '' && ` · rate changes with the season`}
                  </span>
                  <span className={left < 0 ? 'font-medium text-danger' : 'text-ink-500'}>{left < 0 ? tr('More rooms than are free') : `${Math.max(left, 0)} more free for these dates`}</span>
                  {rooms.length > 1 && <button type="button" onClick={() => setRooms((rs) => rs.filter((x) => x.key !== r.key))} className="inline-flex items-center gap-1 text-danger hover:underline"><Trash2 aria-hidden="true" className="h-3.5 w-3.5" />{tr('Remove')}</button>}
                </div>
              </div>
            );
          })}
        </section>

        <section className="grid gap-3 sm:grid-cols-4">
          <Field id="bk-adv" label={tr('Advance taken')}><Input id="bk-adv" type="number" min="0" step="any" value={form.advance_amount} onChange={set('advance_amount')} placeholder="0" /></Field>
          <Field id="bk-advm" label={tr('Paid by')}><Select id="bk-advm" value={form.advance_method} onChange={set('advance_method')}>{METHODS.filter(([c]) => c !== 'CREDIT').map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
          <div className="sm:col-span-2"><Field id="bk-advr" label={tr('Reference')}><Input id="bk-advr" value={form.advance_ref} onChange={set('advance_ref')} placeholder={tr('UPI reference, cheque number…')} /></Field></div>
        </section>
        <Field id="bk-notes" label={tr('Notes')}><Textarea id="bk-notes" rows={2} value={form.notes} onChange={set('notes')} placeholder={tr('Late arrival, extra bed, airport pickup…')} /></Field>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-small text-ink-500">{tr('Rooms before GST')} <span className="tabular font-semibold text-ink-900">{formatCurrency(total)}</span></p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>{tr('Cancel')}</Button>
            <Button type="submit" loading={busy}>{walkIn ? tr('Check in') : tr('Make the booking')}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
