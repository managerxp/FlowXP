/*
 * A banquet event and its functions. FunctionFields is shared: the new-event form uses it for each function, and an event's own page uses it to add or change one.
 * Picking a hall fills its rent, picking a package fills its price a plate; both can be changed. The form asks the server if the hall is already held at that time.
 */
import { useEffect, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { EVENT_TYPES, SETUP_STYLES, SOURCES, addDays, hhmm, qs, useDebounced, useLoad } from '../../lib/hotel.js';
import { Alert, Badge, Button, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui.jsx';
import { useAction } from '../salon/parts.jsx';

export const blankFunction = (hall, date) => ({ key: Math.random().toString(36).slice(2), name: '', hall_id: hall?.hall_id || '', event_date: date || '', start_time: '19:00', end_time: '23:00', expected_guests: '', guaranteed_guests: '', package_id: '', per_plate: '', rent: hall ? String(Number(hall.rent_paise) / 100) : '', setup_style: 'BANQUET_ROUNDS', menu: '', setup_notes: '' });

export const functionBody = (f) => ({
  hall_id: Number(f.hall_id), name: f.name, event_date: f.event_date, start_time: f.start_time, end_time: f.end_time, expected_guests: Number(f.expected_guests) || 0,
  guaranteed_guests: f.guaranteed_guests === '' || f.guaranteed_guests == null ? null : Number(f.guaranteed_guests), package_id: f.package_id ? Number(f.package_id) : null,
  per_plate: f.per_plate === '' ? 0 : Number(f.per_plate), rent: f.rent === '' ? 0 : Number(f.rent), setup_style: f.setup_style, menu: f.menu || undefined, setup_notes: f.setup_notes || undefined
});

export const FunctionFields = ({ f, set, halls, packages, idPrefix, excludeFunctionId }) => {
  const [clash, setClash] = useState(null);
  useEffect(() => {
    if (!f.hall_id || !f.event_date || !f.start_time || !f.end_time || f.end_time <= f.start_time) { setClash(null); return undefined; }
    let live = true;
    const t = setTimeout(() => api(`/hotel/banquet/check-hall${qs({ hall_id: f.hall_id, date: f.event_date, start: f.start_time, end: f.end_time, exclude_function_id: excludeFunctionId })}`).then((r) => live && setClash(r.conflicts[0] || null)).catch(() => {}), 250);
    return () => { live = false; clearTimeout(t); };
  }, [f.hall_id, f.event_date, f.start_time, f.end_time, excludeFunctionId]);
  const hall = halls.find((h) => String(h.hall_id) === String(f.hall_id));
  const pkgOf = (id) => packages.find((p) => String(p.package_id) === String(id));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id={`${idPrefix}-n`} label="Function"><Input id={`${idPrefix}-n`} value={f.name} onChange={(e) => set({ name: e.target.value })} required placeholder="Reception, Mehendi, Sangeet…" /></Field>
        <Field id={`${idPrefix}-h`} label="Hall" hint={hall ? `Seats ${hall.capacity_seated || '—'}, standing ${hall.capacity_floating || '—'}` : undefined}>
          <Select id={`${idPrefix}-h`} value={f.hall_id} onChange={(e) => { const h = halls.find((x) => String(x.hall_id) === e.target.value); set({ hall_id: e.target.value, rent: h ? String(Number(h.rent_paise) / 100) : f.rent }); }} required><option value="">Choose a hall</option>{halls.map((h) => <option key={h.hall_id} value={h.hall_id}>{h.name}</option>)}</Select></Field>
        <Field id={`${idPrefix}-d`} label="Date"><Input id={`${idPrefix}-d`} type="date" value={f.event_date} onChange={(e) => set({ event_date: e.target.value })} required /></Field>
        <Field id={`${idPrefix}-s`} label="From"><Input id={`${idPrefix}-s`} type="time" value={f.start_time} onChange={(e) => set({ start_time: e.target.value })} required /></Field>
        <Field id={`${idPrefix}-e`} label="Until"><Input id={`${idPrefix}-e`} type="time" value={f.end_time} onChange={(e) => set({ end_time: e.target.value })} required /></Field>
        <Field id={`${idPrefix}-st`} label="Set-up"><Select id={`${idPrefix}-st`} value={f.setup_style} onChange={(e) => set({ setup_style: e.target.value })}>{SETUP_STYLES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
      </div>
      {clash && <Alert>{`The hall is already held then by ${clash.event_no} (${clash.title}), ${hhmm(clash.start_time)} to ${hhmm(clash.end_time)}.`}</Alert>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field id={`${idPrefix}-x`} label="Guests expected"><Input id={`${idPrefix}-x`} type="number" min="0" value={f.expected_guests} onChange={(e) => set({ expected_guests: e.target.value })} required /></Field>
        <Field id={`${idPrefix}-g`} label="Guests guaranteed" hint="Food is charged on this"><Input id={`${idPrefix}-g`} type="number" min="0" value={f.guaranteed_guests ?? ''} onChange={(e) => set({ guaranteed_guests: e.target.value })} placeholder={f.expected_guests} /></Field>
        <Field id={`${idPrefix}-p`} label="Menu package"><Select id={`${idPrefix}-p`} value={f.package_id ?? ''} onChange={(e) => { const p = pkgOf(e.target.value); set({ package_id: e.target.value, per_plate: p ? String(Number(p.per_plate_paise) / 100) : f.per_plate, menu: p && !f.menu ? p.menu || '' : f.menu }); }}><option value="">No package</option>{packages.map((p) => <option key={p.package_id} value={p.package_id}>{p.name} · {formatCurrency(Number(p.per_plate_paise) / 100)}</option>)}</Select></Field>
        <Field id={`${idPrefix}-pp`} label="Price a plate" hint="Before GST"><Input id={`${idPrefix}-pp`} type="number" min="0" step="any" value={f.per_plate} onChange={(e) => set({ per_plate: e.target.value })} /></Field>
        <Field id={`${idPrefix}-r`} label="Hall rent" hint="Before GST"><Input id={`${idPrefix}-r`} type="number" min="0" step="any" value={f.rent} onChange={(e) => set({ rent: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${idPrefix}-m`} label="Menu"><Textarea id={`${idPrefix}-m`} rows={2} value={f.menu || ''} onChange={(e) => set({ menu: e.target.value })} placeholder="Welcome drink, starters, mains, dessert…" /></Field>
        <Field id={`${idPrefix}-sn`} label="Set-up notes"><Textarea id={`${idPrefix}-sn`} rows={2} value={f.setup_notes || ''} onChange={(e) => set({ setup_notes: e.target.value })} placeholder="Stage, flowers, sound, entry, parking…" /></Field>
      </div>
    </div>
  );
};

const OrganiserPicker = ({ guest, setGuest }) => {
  const [text, setText] = useState('');
  const q = useDebounced(text, 250);
  const [hits, setHits] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2 || guest.guest_id) { setHits([]); return undefined; }
    let live = true;
    api(`/hotel/guests${qs({ q: q.trim() })}`).then((r) => live && setHits(r)).catch(() => {});
    return () => { live = false; };
  }, [q, guest.guest_id]);
  if (guest.guest_id) return <div className="flex items-center justify-between rounded-(--radius-control) border border-line bg-surface-2 px-3.5 py-2.5 text-small"><span><span className="font-semibold text-ink-900">{guest.name}</span> <span className="text-ink-500">{guest.phone}</span></span><Button type="button" variant="ghost" size="sm" onClick={() => setGuest({ name: '', phone: '', email: '' })}>Choose someone else</Button></div>;
  return (
    <div className="space-y-2">
      <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-400" /><Input aria-label="Find a returning organiser" placeholder="Find someone you know by name or phone" value={text} onChange={(e) => setText(e.target.value)} className="pl-9" /></div>
      {hits.length > 0 && <ul className="max-h-40 divide-y divide-line overflow-auto rounded-(--radius-control) border border-line bg-surface">{hits.map((g) => <li key={g.guest_id}><button type="button" onClick={() => { setGuest({ guest_id: g.guest_id, name: g.name, phone: g.phone || '' }); setText(''); setHits([]); }} className="flex w-full items-center justify-between px-3.5 py-2 text-left text-small hover:bg-surface-2"><span><span className="font-medium text-ink-900">{g.name}</span> <span className="text-ink-500">{g.phone}</span></span>{g.stays > 0 && <Badge>{g.stays} stay{g.stays === 1 ? '' : 's'}</Badge>}</button></li>)}</ul>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="ev-gn" label="Organiser's name"><Input id="ev-gn" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} required /></Field>
        <Field id="ev-gp" label="Mobile"><Input id="ev-gp" type="tel" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} /></Field>
        <Field id="ev-ge" label="Email"><Input id="ev-ge" type="email" value={guest.email || ''} onChange={(e) => setGuest({ ...guest, email: e.target.value })} /></Field>
      </div>
    </div>
  );
};

export default function EventForm({ onClose, onSaved }) {
  const toast = useToast();
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const dash = useLoad('/hotel/dashboard');
  const halls = useLoad('/hotel/banquet/halls');
  const packages = useLoad('/hotel/banquet/packages');
  const [guest, setGuest] = useState({ name: '', phone: '', email: '' });
  const [f, setF] = useState({ title: '', event_type: 'WEDDING', status: 'TENTATIVE', hold_until: '', company: '', source: 'PHONE', notes: '' });
  const [fns, setFns] = useState(null);
  const today = dash.data?.business_date;
  const H = halls.data || []; const P = packages.data || [];
  useEffect(() => { if (today && H.length && !fns) { setFns([blankFunction(H[0], addDays(today, 14))]); setF((x) => ({ ...x, hold_until: addDays(today, 7) })); } }, [today, H.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFn = (key, patch) => setFns((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (!guest.guest_id && !guest.name.trim()) { setError('Enter the organiser’s name'); return; }
    const body = {
      guest: guest.guest_id ? { guest_id: guest.guest_id } : { name: guest.name.trim(), phone: guest.phone || undefined, email: guest.email || undefined },
      title: f.title, event_type: f.event_type, status: f.status, hold_until: f.status === 'TENTATIVE' ? f.hold_until : undefined, company: f.company || undefined, source: f.source, notes: f.notes || undefined, functions: fns.map(functionBody)
    };
    const saved = await run(() => api('/hotel/banquet/events', { method: 'POST', body }).catch((c) => { setError(c.message); throw c; }));
    if (saved) { toast.success(`${saved.event_no} made`); onSaved(saved); }
  };

  return (
    <Modal title="New banquet event" onClose={onClose} wide>
      {halls.loading || !fns ? (halls.loading ? <p className="py-8 text-center text-small text-ink-500">Loading…</p> : <Alert>Add a banquet hall in Rooms &amp; rates (the Banquet tab) before taking events.</Alert>) : (
        <form onSubmit={submit} className="space-y-6">
          <Alert>{error}</Alert>
          <section className="space-y-3"><h3 className="text-small font-semibold text-ink-900">Organiser</h3><OrganiserPicker guest={guest} setGuest={setGuest} /></section>
          <section className="space-y-3">
            <h3 className="text-small font-semibold text-ink-900">Event</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2"><Field id="ev-t" label="Title"><Input id="ev-t" value={f.title} onChange={set('title')} required placeholder="Pillai–Nair wedding" /></Field></div>
              <Field id="ev-ty" label="Type"><Select id="ev-ty" value={f.event_type} onChange={set('event_type')}>{EVENT_TYPES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
              <Field id="ev-s" label="Status" hint={{ ENQUIRY: 'Someone asked. The hall is not held.', TENTATIVE: 'The hall is held until the date below, then freed.', CONFIRMED: 'The hall is booked.' }[f.status]}><Select id="ev-s" value={f.status} onChange={set('status')}><option value="ENQUIRY">Enquiry</option><option value="TENTATIVE">Hold the hall</option><option value="CONFIRMED">Confirmed</option></Select></Field>
              {f.status === 'TENTATIVE' && <Field id="ev-h" label="Hold until"><Input id="ev-h" type="date" value={f.hold_until} onChange={set('hold_until')} required /></Field>}
              <Field id="ev-src" label="Where it came from"><Select id="ev-src" value={f.source} onChange={set('source')}>{SOURCES.filter(([c]) => !['WALK_IN', 'BOOKING_COM', 'MAKEMYTRIP', 'GOIBIBO', 'AGODA', 'EXPEDIA', 'AIRBNB'].includes(c)).map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
            </div>
          </section>
          <section className="space-y-4">
            <div className="flex items-center justify-between"><h3 className="text-small font-semibold text-ink-900">Functions</h3><Button type="button" variant="secondary" size="sm" onClick={() => setFns((l) => [...l, blankFunction(H[0], l.at(-1)?.event_date)])}><Plus aria-hidden="true" className="h-4 w-4" />Add a function</Button></div>
            {fns.map((x, i) => (
              <div key={x.key} className="rounded-(--radius-card) border border-line p-4">
                <FunctionFields f={x} set={(patch) => setFn(x.key, patch)} halls={H} packages={P} idPrefix={`fn-${i}`} />
                {fns.length > 1 && <div className="mt-2 text-right"><button type="button" onClick={() => setFns((l) => l.filter((y) => y.key !== x.key))} className="inline-flex items-center gap-1 text-caption text-danger hover:underline"><Trash2 aria-hidden="true" className="h-3.5 w-3.5" />Remove this function</button></div>}
              </div>
            ))}
          </section>
          <Field id="ev-n" label="Notes"><Textarea id="ev-n" rows={2} value={f.notes} onChange={set('notes')} /></Field>
          <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Make the event</Button></div>
        </form>
      )}
    </Modal>
  );
}
