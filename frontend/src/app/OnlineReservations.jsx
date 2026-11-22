/*
 * The owner's side of the reservation page guests book from (/reserve/<address>): switch it on, choose the address, the hours guests
 * can book, how long a table is held, and an optional percentage offer. Then copy the link or paste it into the website.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '../components/ui.jsx';
import ShareBox from '../components/ShareBox.jsx';

const SLOTS = [15, 30, 45, 60, 90, 120];
const STAYS = [45, 60, 90, 120, 150, 180];

export default function OnlineReservations({ onClose }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api('/reservations/online-settings').then((d) => { setSaved(d); setF({ ...d, slug: d.slug || '', notice: d.notice || '', offer_pct: d.offer_pct ?? '', offer_text: d.offer_text || '' }); }).catch((e) => setError(e.message)); }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const d = await api('/reservations/online-settings', { method: 'PUT', body: {
        enabled: f.enabled, slug: f.slug, notice: f.notice, open_time: f.open_time, close_time: f.close_time, slot_min: Number(f.slot_min), stay_min: Number(f.stay_min),
        max_party: Number(f.max_party), max_advance_days: Number(f.max_advance_days), offer_pct: f.offer_pct === '' ? null : Number(f.offer_pct), offer_text: f.offer_text
      } });
      setSaved(d); toast.success(d.enabled ? 'Online reservations are on' : 'Saved');
    } catch (caught) { setError(caught.message); } finally { setBusy(false); }
  };

  const link = saved?.enabled && saved.slug ? `${window.location.origin}/reserve/${saved.slug}` : '';
  return (
    <Modal title="Online reservations" onClose={onClose} wide>
      {!f ? <Alert>{error}</Alert> : (
        <form onSubmit={submit} className="space-y-5">
          <p className="text-small text-ink-500">A page your guests use to book a table themselves. They see which times are free for their group, and you see the booking here at once.</p>
          <Alert>{error}</Alert>
          <label className="flex items-center gap-3 text-small font-medium text-ink-900">
            <input type="checkbox" className="h-5 w-5" checked={f.enabled} onChange={(e) => setF((x) => ({ ...x, enabled: e.target.checked }))} /> Let guests book online
          </label>
          <Field id="or-slug" label="Your reservation address" hint="Letters, numbers and dashes. It becomes part of the link.">
            <div className="flex items-center gap-2"><span className="text-small text-ink-500">/reserve/</span><div className="flex-1"><Input id="or-slug" value={f.slug} maxLength={40} onChange={(e) => setF((x) => ({ ...x, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} /></div></div>
          </Field>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field id="or-open" label="First table"><Input id="or-open" type="time" value={f.open_time} onChange={set('open_time')} required /></Field>
            <Field id="or-close" label="Last table"><Input id="or-close" type="time" value={f.close_time} onChange={set('close_time')} required /></Field>
            <Field id="or-slot" label="A time every"><Select id="or-slot" value={f.slot_min} onChange={set('slot_min')}>{SLOTS.map((n) => <option key={n} value={n}>{n} min</option>)}</Select></Field>
            <Field id="or-stay" label="Table held for"><Select id="or-stay" value={f.stay_min} onChange={set('stay_min')}>{STAYS.map((n) => <option key={n} value={n}>{n} min</option>)}</Select></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field id="or-party" label="Largest group online"><Input id="or-party" type="number" min="1" max="100" value={f.max_party} onChange={set('max_party')} /></Field>
            <Field id="or-days" label="How many days ahead"><Input id="or-days" type="number" min="1" max="365" value={f.max_advance_days} onChange={set('max_advance_days')} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Field id="or-off" label="Offer %" hint="Leave empty for no offer"><Input id="or-off" type="number" min="0" max="100" step="0.5" value={f.offer_pct} onChange={set('offer_pct')} /></Field>
            <Field id="or-offt" label="Offer wording" hint="Shown on the page, e.g. 10% off for online bookings"><Input id="or-offt" value={f.offer_text} maxLength={120} onChange={set('offer_text')} /></Field>
          </div>
          <Field id="or-notice" label="Message at the top of the page" hint="Optional: dress code, parking, a festive notice."><Input id="or-notice" value={f.notice} maxLength={300} onChange={set('notice')} /></Field>
          <ShareBox link={link} buttonText="Reserve a table" />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Close</Button><Button type="submit" loading={busy}>Save</Button></div>
        </form>
      )}
    </Modal>
  );
}
