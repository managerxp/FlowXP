/*
 * A restaurant or cafe's public reservation page (/reserve/<address>): how many people, which day, then every time of the day shown free or
 * booked for that group size. Pick a free time, leave a name and mobile number, and get a short code. No sign-in, and it works inside a frame on the
 * business's own website. The server decides what is free; this page only shows it.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, MapPin, Minus, Phone, Plus, Tag } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, Button, Field, Input, PageLoader, Select, Textarea } from '../components/ui.jsx';

const iso = (d) => d.toLocaleDateString('en-CA');
const clock = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const dayText = (d) => new Date(`${d}T00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

export default function Reserve() {
  const { slug } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [outlet, setOutlet] = useState('');
  const [party, setParty] = useState(2);
  const [date, setDate] = useState(iso(new Date()));
  const [slots, setSlots] = useState(null);
  const [time, setTime] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', notes: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => { api(`/public/reserve/${encodeURIComponent(slug)}${outlet ? `?branch_id=${outlet}` : ''}`).then(setInfo).catch((e) => setError(e.message)); }, [slug, outlet]);

  const load = () => {
    if (!info) return () => {};
    let live = true;
    setSlots(null); setTime(''); setFormError('');
    api(`/public/reserve/${encodeURIComponent(slug)}/slots?date=${date}&party=${party}&branch_id=${info.outlet_id}`)
      .then((r) => live && setSlots(r.slots)).catch((e) => { if (live) { setSlots([]); setFormError(e.message); } });
    return () => { live = false; };
  };
  useEffect(load, [info, date, party, slug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="mx-auto max-w-md px-5 py-20 text-center"><p className="text-title font-semibold text-ink-900">Online reservations aren’t available</p><p className="mt-2 text-small text-ink-500">{error}</p></div>;
  if (!info) return <PageLoader label="Loading…" />;

  const submit = async (e) => {
    e.preventDefault(); setFormError(''); setBusy(true);
    try {
      setDone(await api(`/public/reserve/${encodeURIComponent(slug)}/book`, { method: 'POST', body: { name: form.name, phone: form.phone, notes: form.notes || undefined, website: form.website, party, date, time, branch_id: info.outlet_id } }));
    } catch (caught) { setFormError(caught.message); load(); }   // a time just taken: show the list again
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-md px-5 py-10">
        <div className="rounded-(--radius-card) border border-line bg-surface p-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success text-white"><Check aria-hidden="true" className="h-6 w-6" /></span>
          <h1 className="mt-4 text-title font-semibold text-ink-900">Your table is booked</h1>
          {done.code && <>
            <p className="mt-1 text-small text-ink-700">{dayText(done.date)} at {clock(done.time)} · table for {done.party}</p>
            <p className="mt-4 text-caption text-ink-500">Your booking code</p>
            <p className="tabular text-3xl font-bold tracking-[0.2em] text-ink-900">{done.code}</p>
            {done.offer && <p className="mt-4 flex items-center justify-center gap-1.5 rounded-(--radius-control) bg-success/10 px-3 py-2 text-small font-medium text-success"><Tag aria-hidden="true" className="h-4 w-4" />{done.offer.text}</p>}
          </>}
          <p className="mt-4 text-caption text-ink-500">{info.name}{info.phone && <> · call {info.phone} to change or cancel</>}</p>
        </div>
      </div>
    );
  }

  const today = iso(new Date());
  const last = iso(new Date(Date.now() + info.max_advance_days * 86400000));
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <header className="mb-6">
        {info.logo_url && <img src={info.logo_url} alt="" className="mb-3 h-12 w-auto" />}
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Reserve a table at {info.name}</h1>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-500">
          {info.address && <span className="flex items-center gap-1.5"><MapPin aria-hidden="true" className="h-3.5 w-3.5" />{info.address}</span>}
          {info.phone && <span className="flex items-center gap-1.5"><Phone aria-hidden="true" className="h-3.5 w-3.5" />{info.phone}</span>}
        </p>
        {info.offer && <p className="mt-3 flex items-center gap-2 rounded-(--radius-control) bg-success/10 px-3.5 py-2.5 text-small font-semibold text-success"><Tag aria-hidden="true" className="h-4 w-4" />{info.offer.text}</p>}
        {info.notice && <p className="mt-3 rounded-(--radius-control) bg-brand-50 px-3.5 py-2.5 text-small text-ink-900">{info.notice}</p>}
      </header>

      {!info.has_tables ? <p className="text-small text-ink-500">Online reservations are not open yet. Please call to book.</p> : (
        <form onSubmit={submit} className="space-y-8">
          {info.outlets.length > 1 && <Field id="rs-outlet" label="Where"><Select id="rs-outlet" value={info.outlet_id} onChange={(e) => setOutlet(e.target.value)}>{info.outlets.map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name}{o.city ? ` · ${o.city}` : ''}</option>)}</Select></Field>}

          <section aria-labelledby="rs-when" className="space-y-4">
            <h2 id="rs-when" className="text-body font-semibold text-ink-900">1. How many, and when</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="rs-party" label="People">
                <div className="flex items-center gap-3">
                  <button type="button" aria-label="One fewer" onClick={() => setParty((n) => Math.max(1, n - 1))} className="flex h-11 w-11 items-center justify-center rounded-full border border-line-strong"><Minus className="h-4 w-4" aria-hidden="true" /></button>
                  <span id="rs-party" className="tabular w-8 text-center text-title font-semibold">{party}</span>
                  <button type="button" aria-label="One more" onClick={() => setParty((n) => Math.min(info.max_party, n + 1))} className="flex h-11 w-11 items-center justify-center rounded-full border border-line-strong"><Plus className="h-4 w-4" aria-hidden="true" /></button>
                </div>
              </Field>
              <Field id="rs-date" label="Day"><Input id="rs-date" type="date" value={date} min={today} max={last} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
            </div>
            {slots === null ? <p className="text-small text-ink-500">Looking at the tables…</p>
              : slots.length === 0 ? <p className="text-small text-warning">No times are open that day.</p> : (
                <>
                  <div role="radiogroup" aria-label="Times" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {slots.map((s) => (
                      <button key={s.time} type="button" role="radio" aria-checked={time === s.time} disabled={!s.free} onClick={() => setTime(s.time)}
                              className={`rounded-(--radius-control) border px-2 py-2.5 text-small transition-colors ${time === s.time ? 'border-brand-500 bg-brand-500 font-semibold text-white' : s.free ? 'border-line-strong bg-surface font-medium text-ink-900 hover:border-brand-500' : 'cursor-not-allowed border-line bg-surface-2 text-ink-400 line-through'}`}>
                        {clock(s.time)}
                        <span className={`block text-[11px] font-normal no-underline ${time === s.time ? 'text-white/90' : 'text-ink-500'}`}>{s.past ? 'Passed' : s.free ? (s.left <= 2 ? `${s.left} left` : 'Free') : 'Booked'}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-caption text-ink-500">Crossed-out times are already booked for a group of {party}. Your table is held for about {info.stay_min} minutes.</p>
                </>
              )}
          </section>

          {time && (
            <section aria-labelledby="rs-you" className="space-y-4">
              <h2 id="rs-you" className="text-body font-semibold text-ink-900">2. Your details</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="rs-name" label="Your name"><Input id="rs-name" value={form.name} onChange={(e) => setForm((x) => ({ ...x, name: e.target.value }))} required autoComplete="name" /></Field>
                <Field id="rs-phone" label="Mobile number"><Input id="rs-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((x) => ({ ...x, phone: e.target.value }))} required autoComplete="tel" /></Field>
              </div>
              <Field id="rs-notes" label="Anything we should know? (optional)"><Textarea id="rs-notes" rows={2} maxLength={300} value={form.notes} onChange={(e) => setForm((x) => ({ ...x, notes: e.target.value }))} /></Field>
              <div aria-hidden="true" className="absolute -left-[9999px]"><label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm((x) => ({ ...x, website: e.target.value }))} /></label></div>
              <Alert>{formError}</Alert>
              <p className="rounded-(--radius-control) bg-surface-2 px-3.5 py-3 text-small text-ink-700">Table for <strong className="text-ink-900">{party}</strong> on {dayText(date)} at <strong className="text-ink-900">{clock(time)}</strong>{info.offer ? ` · ${info.offer.text}` : ''}.</p>
              <Button type="submit" size="lg" className="w-full" loading={busy}>Confirm reservation</Button>
            </section>
          )}
          {!time && formError && <Alert>{formError}</Alert>}
        </form>
      )}
    </div>
  );
}
