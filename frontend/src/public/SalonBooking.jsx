/*
 * A salon's public booking page (/book/<address>): choose services, a time and (optionally) a person, leave a name
 * and mobile number. No sign-in and no app chrome. Availability is asked of the server, which applies the same
 * rules as the front desk — opening hours, who does what, leave, notice, and never booking one person twice —
 * so the times shown here are times that can really be booked.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck, Check, Clock, MapPin, Phone } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { addDays, clockText, dateText, fromLocal, qs, timeText, todayIn, toMinutes } from '../lib/salon.js';
import { Alert, Button, Field, Input, PageLoader, Select, Textarea } from '../components/ui.jsx';

const money = (n) => formatCurrency(n);

const SalonBooking = () => {
  const { slug } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState([]);              // service ids
  const [staffId, setStaffId] = useState('');
  const [outlet, setOutlet] = useState('');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState(null);
  const [time, setTime] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', notes: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    api(`/public/salon/${encodeURIComponent(slug)}${qs({ branch_id: outlet })}`).then((d) => { setInfo(d); setDate((x) => x || todayIn(d.timezone)); }).catch((e) => setError(e.message));
  }, [slug, outlet]);

  const byId = useMemo(() => new Map((info?.services || []).map((s) => [s.service_id, s])), [info]);
  const chosen = picked.map((id) => byId.get(id)).filter(Boolean);
  const minutes = chosen.reduce((s, x) => s + x.duration_min, 0);
  const total = chosen.reduce((s, x) => s + x.price, 0);
  const staff = (info?.staff || []).filter((s) => !s.service_ids.length || picked.every((id) => s.service_ids.includes(id)));

  useEffect(() => {
    if (!info || !picked.length || !date) { setSlots(null); return undefined; }
    let live = true;
    setSlots(null); setTime('');
    api(`/public/salon/${encodeURIComponent(slug)}/availability${qs({ date, service_ids: picked.join(','), staff_id: staffId, branch_id: info.outlet_id })}`)
      .then((a) => live && setSlots(a.slots)).catch((e) => live && (setSlots([]), setFormError(e.message)));
    return () => { live = false; };
  }, [info, picked, date, staffId, slug]);

  if (error) return <div className="mx-auto max-w-md px-5 py-20 text-center"><p className="text-title font-semibold text-ink-900">Online booking isn’t available</p><p className="mt-2 text-small text-ink-500">{error}</p></div>;
  if (!info) return <PageLoader label="Loading…" />;

  const toggle = (id) => { setStaffId(''); setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  const groups = [...new Set(info.services.map((s) => s.category || 'Services'))];

  const submit = async (e) => {
    e.preventDefault(); setFormError(''); setBusy(true);
    try {
      const out = await api(`/public/salon/${encodeURIComponent(slug)}/appointments`, { method: 'POST', body: {
        name: form.name, phone: form.phone, notes: form.notes || undefined, website: form.website, branch_id: info.outlet_id,
        start_at: fromLocal(date, toMinutes(time), info.timezone).toISOString(),
        services: picked.map((id) => ({ service_id: id, ...(staffId ? { staff_id: Number(staffId) } : {}) }))
      } });
      setDone(out);
    } catch (caught) { setFormError(caught.message); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-md px-5 py-12">
        <div className="rounded-(--radius-card) border border-line bg-surface p-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success text-white"><Check aria-hidden="true" className="h-6 w-6" /></span>
          <h1 className="mt-4 text-title font-semibold text-ink-900">You’re booked</h1>
          {done.received && !done.appointment_id ? null : <>
            <p className="mt-1 text-small text-ink-700">{dateText(date, { weekday: 'long', day: 'numeric', month: 'long' })} at {timeText(done.start_at, info.timezone)}</p>
            <ul className="mt-4 divide-y divide-line rounded-(--radius-control) border border-line text-left text-small">
              {done.services.map((s, i) => <li key={i} className="flex justify-between px-3.5 py-2"><span>{s.name}<span className="block text-caption text-ink-500">with {s.staff_name} · {timeText(s.start_at, info.timezone)}</span></span></li>)}
              <li className="flex justify-between px-3.5 py-2 font-semibold"><span>Total at the salon</span><span className="tabular">{money(done.total)}</span></li>
            </ul></>}
          <p className="mt-4 text-caption text-ink-500">{info.name}{info.phone && <> · call {info.phone} to change or cancel</>}</p>
          {info.cancellation_policy && <p className="mt-2 text-caption text-ink-500">{info.cancellation_policy}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        {info.logo_url && <img src={info.logo_url} alt="" className="mb-3 h-12 w-auto" />}
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Book at {info.name}</h1>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-500">
          {info.address && <span className="flex items-center gap-1.5"><MapPin aria-hidden="true" className="h-3.5 w-3.5" />{info.address}</span>}
          {info.phone && <span className="flex items-center gap-1.5"><Phone aria-hidden="true" className="h-3.5 w-3.5" />{info.phone}</span>}
        </p>
        {info.notice && <p className="mt-3 rounded-(--radius-control) bg-brand-50 px-3.5 py-2.5 text-small text-ink-900">{info.notice}</p>}
      </header>

      <form onSubmit={submit} className="space-y-8">
        {info.outlets.length > 1 && <Field id="bk-outlet" label="Where"><Select id="bk-outlet" value={info.outlet_id} onChange={(e) => { setPicked([]); setStaffId(''); setOutlet(e.target.value); }}>{info.outlets.map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name}{o.city ? ` — ${o.city}` : ''}</option>)}</Select></Field>}

        <section aria-labelledby="bk-services">
          <h2 id="bk-services" className="mb-3 text-body font-semibold text-ink-900">1. Choose services</h2>
          {groups.map((g) => (
            <div key={g} className="mb-4">
              <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-ink-400">{g}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {info.services.filter((s) => (s.category || 'Services') === g).map((s) => {
                  const on = picked.includes(s.service_id);
                  return (
                    <button type="button" key={s.service_id} aria-pressed={on} onClick={() => toggle(s.service_id)}
                            className={`rounded-(--radius-control) border px-3.5 py-3 text-left transition-colors ${on ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:border-line-strong'}`}>
                      <span className="flex items-start justify-between gap-2"><span className="text-small font-medium text-ink-900">{s.name}</span><span className="tabular text-small font-semibold text-ink-900">{money(s.price)}</span></span>
                      <span className="mt-0.5 flex items-center gap-1 text-caption text-ink-500"><Clock aria-hidden="true" className="h-3 w-3" />{s.duration_min} min</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {info.services.length === 0 && <p className="text-small text-ink-500">No services are open for booking yet.</p>}
        </section>

        {picked.length > 0 && (
          <section aria-labelledby="bk-when" className="space-y-4">
            <h2 id="bk-when" className="text-body font-semibold text-ink-900">2. Pick a day and time</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="bk-date" label="Day"><Input id="bk-date" type="date" value={date} min={todayIn(info.timezone)} max={addDays(todayIn(info.timezone), info.max_advance_days)} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
              <Field id="bk-staff" label="With"><Select id="bk-staff" value={staffId} onChange={(e) => setStaffId(e.target.value)}><option value="">Anyone available</option>{staff.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.name}</option>)}</Select></Field>
            </div>
            {slots === null ? <p className="text-small text-ink-500">Looking for free times…</p>
              : slots.length === 0 ? <p className="text-small text-warning">Nothing is free for {minutes} minutes that day. Try another day.</p>
              : <div role="radiogroup" aria-label="Free times" className="flex flex-wrap gap-1.5">{slots.map((s) => <button type="button" role="radio" aria-checked={time === s.time} key={s.time} onClick={() => setTime(s.time)} className={`rounded-full border px-3.5 py-1.5 text-small font-medium ${time === s.time ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-surface hover:border-brand-500'}`}>{clockText(s.time)}</button>)}</div>}
          </section>
        )}

        {time && (
          <section aria-labelledby="bk-you" className="space-y-4">
            <h2 id="bk-you" className="text-body font-semibold text-ink-900">3. Your details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="bk-name" label="Your name"><Input id="bk-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required autoComplete="name" /></Field>
              <Field id="bk-phone" label="Mobile number"><Input id="bk-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} required autoComplete="tel" /></Field>
            </div>
            <Field id="bk-notes" label="Anything we should know? (optional)"><Textarea id="bk-notes" rows={2} maxLength={300} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
            {/* a trap for bots: people never see or fill this */}
            <div aria-hidden="true" className="absolute -left-[9999px]"><label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} /></label></div>
            <Alert>{formError}</Alert>
            <div className="rounded-(--radius-control) bg-surface-2 px-3.5 py-3 text-small text-ink-700">
              {chosen.map((s) => s.name).join(', ')} · {minutes} min · <strong className="font-semibold text-ink-900">{money(total)}</strong> to pay at the salon, on {dateText(date)} at {clockText(time)}.
            </div>
            <Button type="submit" size="lg" className="w-full" loading={busy}><CalendarCheck aria-hidden="true" className="h-5 w-5" />Confirm booking</Button>
          </section>
        )}
      </form>
    </div>
  );
};

export default SalonBooking;
