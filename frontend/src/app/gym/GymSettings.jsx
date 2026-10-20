/*
 * Gym settings: the rules that every check-in follows, each outlet's hours and holidays, and the entrance QR poster.
 * The poster's QR is only a link to the check-in page of that outlet. It lets nobody in by itself: a member still has to sign in with a code
 * sent to their phone, and the gym can also ask for today's front-desk code.
 */
import { useEffect, useState } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../../lib/api.js';
import { DAYS, useLoad } from '../../lib/gym.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Alert, Button, Field, Input, ListState, PageHeader, Select, useDialog, useToast } from '../../components/ui.jsx';
import GymDevices from './GymDevices.jsx';
import { NumberField, Panel, Tabs, Toggle, useAction } from '../salon/parts.jsx';
import { T, useT } from '../../i18n/useT.js';

const Rules = ({ s, reload }) => {
  const tr = useT();
  const [f, setF] = useState(s);
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  useEffect(() => setF(s), [s]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => run(async () => {
    setError('');
    try {
      await api('/gym/settings', { method: 'PUT', body: {
        member_prefix: f.member_prefix, public_slug: f.public_slug || '', grace_days: Number(f.grace_days), cooldown_seconds: Number(f.cooldown_seconds), visits_per_day: Number(f.visits_per_day), checkout_enabled: f.checkout_enabled,
        reception_confirm: f.reception_confirm, self_checkin_enabled: f.self_checkin_enabled, self_checkin_daily_code: f.self_checkin_daily_code,
        self_checkin_fresh_otp_minutes: f.fresh ? Number(f.self_checkin_fresh_otp_minutes || 10) : null, session_days: Number(f.session_days), pass_ttl_seconds: Number(f.pass_ttl_seconds), travel_minutes: Number(f.travel_minutes),
        class_cancel_hours: Number(f.class_cancel_hours), pt_cancel_hours: Number(f.pt_cancel_hours), class_booking_days: Number(f.class_booking_days), class_waitlist: f.class_waitlist
      } });
      reload();
    } catch (e) { setError(e.message); }
  }, 'Settings saved');
  const fresh = f.fresh ?? f.self_checkin_fresh_otp_minutes != null;
  return (
    <div className="space-y-5">
      <Panel title={tr('Check-in rules')} lead={tr('Every way in follows these: the desk, the member\'s phone and the gates.')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField id="g-grace" label={tr('Grace days after a membership ends')} value={f.grace_days} onChange={set('grace_days')} min={0} step={1} hint="The default; a plan can set its own." />
          <NumberField id="g-cool" label={tr('Ignore a repeat scan for (seconds)')} value={f.cooldown_seconds} onChange={set('cooldown_seconds')} min={0} step={1} hint={tr('Stops one visit being recorded twice. Never less than 5.')} />
          <NumberField id="g-visits" label="Most visits a day (0 = no limit)" value={f.visits_per_day} onChange={set('visits_per_day')} min={0} step={1} />
          <NumberField id="g-travel" label={tr('Same card at two branches within (minutes)')} value={f.travel_minutes} onChange={set('travel_minutes')} min={0} step={1} hint={tr('Asks the desk to look at who it is. 0 turns it off.')} />
        </div>
        <div className="mt-4 space-y-3">
          <Toggle id="g-out" checked={f.checkout_enabled} onChange={set('checkout_enabled')} label={tr('Record check-out as well as check-in')} hint={tr('Shows who is in the gym now.')} />
          <Toggle id="g-confirm" checked={f.reception_confirm} onChange={set('reception_confirm')} label={tr('The desk confirms every scan by looking at the member')} hint={tr('Printed cards can be lent to a friend. With this on, the screen shows the member and the desk presses \'It is them\'.')} />
        </div>
      </Panel>
      <Panel title={tr('Members on their own phone')} lead={tr('A member signs in with a code sent to their phone, then shows a pass or checks in themselves. No app to install.')}>
        <div className="space-y-3">
          <Toggle id="g-self" checked={f.self_checkin_enabled} onChange={set('self_checkin_enabled')} label={tr('Let members check in from their own phone')} hint={tr('They scan the poster at the door with their phone\'s camera.')} />
          <Toggle id="g-daily" checked={f.self_checkin_daily_code} onChange={set('self_checkin_daily_code')} label={tr('Also ask for today\'s front-desk code')} hint={tr('The poster is a photo anyone can take. This proves they are in the building: the code is on the front desk screen and changes every day.')} />
          <Toggle id="g-fresh" checked={fresh} onChange={(v) => setF((x) => ({ ...x, fresh: v }))} label={tr('Ask for a fresh sign-in code every time')} hint={tr('Strictest: each check-in needs a code sent in the last few minutes.')} />
          {fresh && <NumberField id="g-freshmin" label={tr('A code counts for (minutes)')} value={f.self_checkin_fresh_otp_minutes ?? 10} onChange={set('self_checkin_fresh_otp_minutes')} min={1} step={1} />}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="g-slug" label={tr('The gym\'s web address')} hint={f.public_slug ? `Members open ${window.location.origin}/gym/${f.public_slug}` : tr('Letters, digits and hyphens. Needed for members to sign in.')}>
            <div className="flex items-center gap-1 text-small text-ink-500">/gym/<Input id="g-slug" value={f.public_slug || ''} onChange={(e) => set('public_slug')(e.target.value.toLowerCase())} className="flex-1" placeholder="ironworks" /></div>
          </Field>
          <Field id="g-prefix" label={tr('Member number starts with')} hint={tr('IRON gives IRON-00001, IRON-00002 ...')}><Input id="g-prefix" value={f.member_prefix} onChange={(e) => set('member_prefix')(e.target.value.toUpperCase())} maxLength={8} /></Field>
          <NumberField id="g-session" label={tr('Stay signed in for (days)')} value={f.session_days} onChange={set('session_days')} min={1} step={1} />
          <NumberField id="g-ttl" label={tr('A phone pass QR lasts (seconds)')} value={f.pass_ttl_seconds} onChange={set('pass_ttl_seconds')} min={15} step={5} hint={tr('It works once and then expires, so a screenshot is no use.')} />
        </div>
      </Panel>
      <Panel title={tr('Classes')} lead={tr('How booking works for members and the desk.')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField id="g-ccancel" label={tr('Cancel a class free until (hours before)')} value={f.class_cancel_hours} onChange={set('class_cancel_hours')} min={0} step={1} hint={tr('Later than this, a class pack session is kept.')} />
          <NumberField id="g-ptcancel" label={tr('Cancel personal training free until (hours before)')} value={f.pt_cancel_hours} onChange={set('pt_cancel_hours')} min={0} step={1} />
          <NumberField id="g-cdays" label={tr('Members can book up to (days ahead)')} value={f.class_booking_days} onChange={set('class_booking_days')} min={1} step={1} />
        </div>
        <div className="mt-3"><Toggle id="g-wait" checked={f.class_waitlist} onChange={set('class_waitlist')} label={tr('A full class has a waitlist')} hint={tr('When a place opens, the first person waiting who can still come gets it.')} /></div>
      </Panel>
      {error && <Alert>{error}</Alert>}
      <Button onClick={save} loading={busy}>{tr('Save settings')}</Button>
    </div>
  );
};

const Poster = ({ branch, gymName }) => {
  const tr = useT();
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(branch.checkin_url, { width: 640, margin: 1, errorCorrectionLevel: 'M' }).then(setSrc); }, [branch.checkin_url]);
  return (
    <div className="light-sheet mx-auto w-full max-w-sm rounded-(--radius-panel) border border-line bg-white p-6 text-center text-ink-900 print:max-w-none print:border-0">
      <p className="text-small font-semibold uppercase tracking-wider text-ink-500">{gymName}</p>
      <h3 className="mt-1 text-h3 font-bold">{tr('Check in here')}</h3>
      {src && <img src={src} alt={tr('Entrance QR code for {{branch_name}}', { branch_name: branch.name })} className="mx-auto my-4 h-64 w-64" />}
      <p className="text-small text-ink-700">{tr('Scan with your phone\'s camera. Sign in with the code we send you, then tap Check in.')}</p>
      <p className="mt-2 text-caption text-ink-500">{branch.name}</p>
    </div>
  );
};

const Branches = ({ s, reload }) => {
  const tr = useT();
  const dialog = useDialog();
  const toast = useToast();
  const { business } = useAuth();
  const [id, setId] = useState(s.branches[0]?.branch_id);
  const b = s.branches.find((x) => x.branch_id === id) || s.branches[0];
  const [hours, setHours] = useState(null);       // null = open all day
  const [holidays, setHolidays] = useState('');
  const [busy, run] = useAction();
  useEffect(() => { if (b) { setHours(b.hours); setHolidays((b.holidays || []).join('\n')); } }, [b?.branch_id, b?.hours, b?.holidays]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!b) return null;
  const setDay = (d, v) => setHours((h) => { const n = { ...(h || {}) }; if (v) n[d] = v; else delete n[d]; return n; });
  const save = () => run(async () => {
    await api(`/gym/branches/${b.branch_id}/settings`, { method: 'PUT', body: { hours, holidays: holidays.split(/[\s,]+/).filter(Boolean) } });
    reload();
  }, 'Hours saved');
  const rotate = async () => {
    if (!await dialog.confirm({ title: tr('Make a new entrance QR?'), body: tr('The poster on the wall stops working. Print the new one and put it up. Use this if the old poster was copied or spread around.'), confirmLabel: tr('Make a new QR'), danger: true })) return;
    try { await api(`/gym/branches/${b.branch_id}/checkin-qr/rotate`, { method: 'POST' }); reload(); toast.success(tr('New QR made. Print it now.')); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="space-y-5">
      {s.branches.length > 1 && <span className="block w-52"><Select aria-label={tr('Branch')} value={b.branch_id} onChange={(e) => setId(Number(e.target.value))}>{s.branches.map((x) => <option key={x.branch_id} value={x.branch_id}>{x.name}</option>)}</Select></span>}
      <Panel title={tr('Opening hours')} lead={tr('Nobody is let in outside these hours, whatever their plan.')}>
        <Toggle id="h-all" checked={hours == null} onChange={(v) => setHours(v ? null : Object.fromEntries([1, 2, 3, 4, 5, 6, 0].map((d) => [d, { open: '06:00', close: '22:00' }])))} label={tr('Open all day, every day')} />
        {hours && (
          <ul className="mt-3 space-y-2">
            {DAYS.map(([d, name]) => (
              <li key={d} className="flex flex-wrap items-center gap-3 text-small">
                <label className="flex w-24 items-center gap-2"><input type="checkbox" checked={Boolean(hours[d])} onChange={(e) => setDay(d, e.target.checked ? { open: '06:00', close: '22:00' } : null)} className="accent-(--color-brand-500)" />{name}</label>
                {hours[d] ? <><Input aria-label={tr('{{name}} opens', { name })} type="time" value={hours[d].open} onChange={(e) => setDay(d, { ...hours[d], open: e.target.value })} className="w-32" />{tr('to')}<Input aria-label={tr('{{name}} closes', { name })} type="time" value={hours[d].close} onChange={(e) => setDay(d, { ...hours[d], close: e.target.value })} className="w-32" /></> : <span className="text-ink-500">{tr('Closed')}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4"><Field id="h-hol" label={tr('Holidays (closed all day)')} hint={tr('One date a line, like 2026-11-08.')}><textarea id="h-hol" rows={3} value={holidays} onChange={(e) => setHolidays(e.target.value)} className="w-full rounded-(--radius-control) border border-line-strong bg-surface px-3 py-2 text-small" /></Field></div>
        <Button className="mt-3" onClick={save} loading={busy}>{tr('Save hours')}</Button>
      </Panel>
      <Panel title={tr('Entrance QR')} lead={tr('Put this poster at the door. It only opens the check-in page for this branch.')}
             action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={rotate}><RefreshCw aria-hidden="true" className="h-4 w-4" />{tr('New QR')}</Button><Button size="sm" onClick={() => window.print()}><Printer aria-hidden="true" className="h-4 w-4" />{tr('Print')}</Button></div>}>
        {!s.public_slug && !s.self_checkin_enabled && <div className="mb-3"><Alert>{tr('Phone check-in is switched off. Turn it on under Rules before putting the poster up.')}</Alert></div>}
        <Poster branch={b} gymName={business?.name} />
      </Panel>
    </div>
  );
};

export default function GymSettings() {
  const tr = useT();
  const { hasFeature } = useAuth();
  const s = useLoad('/gym/settings');
  const [tab, setTab] = useState('rules');
  return (
    <div>
      <PageHeader title={tr('Gym settings')} lead={tr('The rules for coming in, each branch\'s hours, and the entrance QR.')} />
      <Tabs tabs={[{ key: 'rules', label: T('Rules') }, { key: 'branches', label: T('Branches and QR') }, ...(hasFeature('gym_devices') ? [{ key: 'devices', label: T('Devices') }] : [])]} value={tab} onChange={setTab} />
      <ListState loading={s.loading && !s.data} error={s.error} />
      {s.data && (tab === 'rules' ? <Rules s={s.data} reload={s.reload} /> : tab === 'branches' ? <Branches s={s.data} reload={s.reload} /> : <GymDevices settings={s.data} />)}
    </div>
  );
}
