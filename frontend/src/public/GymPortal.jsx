/*
 * What a gym member opens on their own phone. No app, no staff login, not inside the app shell.
 *
 *   /gym/in/:token   the page the entrance QR opens: sign in with a code sent to the phone, then "Check in".
 *   /gym/:slug       the same sign-in, then the member's own page: their membership, a phone pass QR, their visits.
 *
 * The QR on the door only says which gym and branch this is; it lets nobody in. Signing in proves the phone, and the gym's server makes the decision.
 * The phone pass is a short-lived, single-use code, shown as a QR that renews itself, so a screenshot of it stops working within a minute.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, LogOut, QrCode, ShieldAlert, X } from 'lucide-react';
import QRCode from 'qrcode';
import { APP_HEADER } from '../lib/api.js';

class PortalError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }

const call = async (path, { method = 'GET', body } = {}) => {
  let res;
  try {
    res = await fetch(`/api/public/gym${path}`, { method, credentials: 'same-origin', headers: { ...APP_HEADER, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new PortalError("You're offline, or FlowXP can't be reached. Try again in a moment.", 0, 'OFFLINE'); }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new PortalError(payload.message || 'Something went wrong', res.status, payload.code);
  return payload.data;
};

const longDate = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dayTime = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const STATE = { ACTIVE: ['Running', 'bg-success/10 text-success'], GRACE: ['In grace days', 'bg-warning/10 text-warning'], FROZEN: ['Frozen', 'bg-brand-50 text-brand-700'], UPCOMING: ['Starts soon', 'bg-surface-3 text-ink-700'], EXPIRED: ['Ended', 'bg-danger/10 text-danger'], CANCELLED: ['Cancelled', 'bg-danger/10 text-danger'], TRANSFERRED: ['Transferred', 'bg-surface-3 text-ink-700'] };
const PAY = { UNPAID: 'Payment due', PARTIAL: 'Part paid', REFUNDED: 'Refunded', INVOICE_CANCELLED: 'Bill cancelled' };
const NEEDS = { OTP_REQUIRED: 'For safety, sign in again with a new code, then check in.', DAILY_CODE: "Type today's code, which is on the front desk screen.", STAFF_CONFIRM: 'Please see the front desk.', TWO_OUTLETS: 'Please see the front desk.' };

const Shell = ({ title, children }) => (
  <div className="min-h-dvh bg-surface-2 px-4 py-6">
    <div className="mx-auto w-full max-w-md">
      <header className="mb-5 text-center"><p className="text-caption font-semibold uppercase tracking-wider text-ink-500">Member</p><h1 className="mt-0.5 text-h3 font-bold text-ink-900">{title}</h1></header>
      {children}
    </div>
  </div>
);
const Card = ({ children, className = '' }) => <div className={`rounded-(--radius-panel) border border-line bg-surface p-5 ${className}`}>{children}</div>;
const Btn = ({ children, variant = 'primary', ...rest }) => (
  <button type="button" {...rest} className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-body font-semibold transition-colors disabled:opacity-60 ${variant === 'primary' ? 'bg-brand-500 text-white hover:bg-brand-600' : 'border border-line-strong bg-surface text-ink-900 hover:bg-surface-2'}`}>{children}</button>
);
const Err = ({ children }) => (children ? <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-small text-danger">{children}</p> : null);

/* sign in: the phone number, then the code */
const SignIn = ({ slug, gymName, onDone }) => {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  useEffect(() => { if (wait <= 0) return undefined; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const send = async () => {
    setBusy(true); setError('');
    try { await call(`/${slug}/otp`, { method: 'POST', body: { phone } }); setStep('code'); setWait(60); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError('');
    try { await call(`/${slug}/verify`, { method: 'POST', body: { phone, code } }); onDone(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Card>
      <h2 className="text-title font-semibold text-ink-900">Sign in to {gymName}</h2>
      {step === 'phone' ? (
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="mt-3">
          <label htmlFor="ph" className="block text-small font-medium text-ink-700">Your mobile number</label>
          <input id="ph" type="tel" inputMode="tel" autoComplete="tel" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className="mt-1 h-12 w-full rounded-xl border border-line-strong bg-surface px-4 text-body" />
          <p className="mt-2 text-caption text-ink-500">Use the number you gave the gym. We will send a 6-digit code to it.</p>
          <Err>{error}</Err>
          <div className="mt-4"><Btn type="submit" disabled={busy || phone.replace(/\D/g, '').length < 10}>{busy ? 'Sending…' : 'Send me a code'}</Btn></div>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="mt-3">
          <p className="text-small text-ink-700">If that number belongs to a member, a code is on its way. It works for 10 minutes.</p>
          <label htmlFor="cd" className="mt-3 block text-small font-medium text-ink-700">The 6-digit code</label>
          <input id="cd" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="tabular mt-1 h-14 w-full rounded-xl border border-line-strong bg-surface px-4 text-center text-2xl tracking-[0.4em]" />
          <Err>{error}</Err>
          <div className="mt-4 space-y-2"><Btn type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</Btn>
            <Btn variant="secondary" onClick={send} disabled={busy || wait > 0}>{wait > 0 ? `Send again in ${wait}s` : 'Send a new code'}</Btn></div>
          <button type="button" onClick={() => { setStep('phone'); setCode(''); setError(''); }} className="mt-3 w-full text-center text-small text-brand-600 hover:underline">Wrong number?</button>
        </form>
      )}
    </Card>
  );
};

/* the phone pass: a QR that renews itself */
const Pass = ({ active }) => {
  const [src, setSrc] = useState('');
  const [left, setLeft] = useState(0);
  const [ttl, setTtl] = useState(60);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const refresh = useCallback(async () => {
    try {
      const p = await call('/me/pass', { method: 'POST' });
      setSrc(await QRCode.toDataURL(p.code, { width: 520, margin: 1, errorCorrectionLevel: 'M' }));
      setTtl(p.ttl_seconds); setLeft(p.ttl_seconds); setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => {
    if (!active) return undefined;
    refresh();
    // a new one before the old one runs out, and none while the page is hidden
    timer.current = setInterval(() => { if (!document.hidden) refresh(); }, Math.max(10, Math.round(ttl * 0.7)) * 1000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer.current); document.removeEventListener('visibilitychange', onVisible); };
  }, [active, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (left <= 0) return undefined; const t = setTimeout(() => setLeft((l) => l - 1), 1000); return () => clearTimeout(t); }, [left]);
  return (
    <Card className="text-center">
      <h2 className="text-title font-semibold text-ink-900">Your pass</h2>
      <p className="text-small text-ink-500">Show this at the front desk or the gate.</p>
      {src ? <img src={src} alt="Your pass QR code" className={`mx-auto my-4 h-60 w-60 rounded-xl border border-line bg-white p-2 ${left <= 0 ? 'opacity-30' : ''}`} /> : <div className="mx-auto my-4 flex h-60 w-60 items-center justify-center rounded-xl bg-surface-3 text-small text-ink-500">Getting your pass…</div>}
      <p className="text-caption text-ink-500">{left > 0 ? `Renews itself in ${left}s. A screenshot stops working.` : 'This one has run out.'}</p>
      <Err>{error}</Err>
      {left <= 0 && <div className="mt-3"><Btn variant="secondary" onClick={refresh}>Get a fresh pass</Btn></div>}
    </Card>
  );
};

const CheckIn = ({ token, info, onDone }) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const key = useRef(null);
  const go = async () => {
    setBusy(true); setError('');
    key.current ||= crypto.randomUUID();   // a retry after a dropped connection is the same check-in
    try { const r = await call('/me/checkin', { method: 'POST', body: { token, daily_code: code || undefined, idempotency_key: key.current } }); key.current = null; setResult(r); onDone?.(); }
    catch (e) { if (e.status !== 0) key.current = null; setError(e.message); } finally { setBusy(false); }
  };
  if (result) {
    const ok = result.decision === 'APPROVED';
    return (
      <Card className={`text-center ${ok ? 'border-success/40 bg-success/10' : 'border-warning/50 bg-warning/10'}`}>
        <span aria-hidden="true" className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-surface ${ok ? 'text-success' : 'text-warning'}`}>{ok ? <Check className="h-9 w-9" /> : result.needs ? <ShieldAlert className="h-9 w-9" /> : <X className="h-9 w-9" />}</span>
        <h2 className="mt-3 text-title font-bold text-ink-900">{ok ? `Welcome, ${String(result.member?.name || '').split(' ')[0]}` : result.message}</h2>
        {ok && result.membership && <p className="mt-1 text-small text-ink-700">{result.membership.plan_name} · {result.membership.days_left} day{result.membership.days_left === 1 ? '' : 's'} left</p>}
        {!ok && result.needs && <p className="mt-1 text-small text-ink-700">{NEEDS[result.needs] || 'Please see the front desk.'}</p>}
        {!ok && !result.needs && <p className="mt-1 text-small text-ink-700">If you think this is wrong, please see the front desk.</p>}
        {!ok && result.needs === 'DAILY_CODE' && <div className="mt-4"><Btn variant="secondary" onClick={() => setResult(null)}>Try again</Btn></div>}
      </Card>
    );
  }
  return (
    <Card>
      <h2 className="text-title font-semibold text-ink-900">Check in at {info?.branch_name}</h2>
      {info?.daily_code_required && (
        <div className="mt-3">
          <label htmlFor="dc" className="block text-small font-medium text-ink-700">Today's code from the front desk</label>
          <input id="dc" inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="tabular mt-1 h-12 w-full rounded-xl border border-line-strong bg-surface px-4 text-center text-xl tracking-[0.4em]" />
        </div>
      )}
      <Err>{error}</Err>
      <div className="mt-4"><Btn onClick={go} disabled={busy || (info?.daily_code_required && code.length !== 4)}>{busy ? 'Checking…' : 'Check in'}</Btn></div>
    </Card>
  );
};

/* classes: the week's timetable, with a button to book or give up a place */
const Classes = () => {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState('');
  const load = useCallback(async () => { try { setRows(await call('/me/classes')); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (id, path, label) => {
    setBusy(id); setError(''); setNote('');
    try { const r = await call(path, { method: 'POST' }); setNote(label(r)); await load(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const when = (iso) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  if (!rows && !error) return <Card className="text-center text-small text-ink-500">Loading…</Card>;
  return (
    <Card>
      <h2 className="text-title font-semibold text-ink-900">Classes this week</h2>
      <Err>{error}</Err>
      {note && <p role="status" className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-small text-success">{note}</p>}
      {rows && rows.length === 0 && <p className="mt-3 text-small text-ink-500">No classes are scheduled this week.</p>}
      <ul className="mt-3 divide-y divide-line">
        {(rows || []).map((c) => (
          <li key={c.session_id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="font-semibold text-ink-900">{c.class_name}</p><p className="text-small text-ink-700">{when(c.starts_at)}</p><p className="text-caption text-ink-500">{[c.trainer && `with ${c.trainer}`, c.branch].filter(Boolean).join(' · ')}</p></div>
              {c.my_status === 'BOOKED' || c.my_status === 'WAITLISTED' ? (
                <button type="button" disabled={busy === c.session_id} onClick={() => act(c.session_id, `/me/bookings/${c.my_booking}/cancel`, (r) => (r.late_cancel ? 'Cancelled. It was close to the start, so a pack session may be kept.' : 'Cancelled.'))} className="min-h-10 shrink-0 rounded-lg border border-line-strong px-3 text-small font-medium">{c.my_status === 'WAITLISTED' ? 'Leave the list' : 'Cancel'}</button>
              ) : (
                <button type="button" disabled={busy === c.session_id} onClick={() => act(c.session_id, `/me/classes/${c.session_id}/book`, (r) => (r.status === 'BOOKED' ? 'You are booked in.' : `You are on the waitlist (number ${r.waitlist_position}).`))} className="min-h-10 shrink-0 rounded-lg bg-brand-500 px-3 text-small font-semibold text-white disabled:opacity-60">{c.seats_left > 0 ? 'Book' : 'Join the list'}</button>
              )}
            </div>
            <p className="mt-1 text-caption text-ink-500">{c.my_status === 'BOOKED' ? 'You are booked in. ' : c.my_status === 'WAITLISTED' ? 'You are on the waitlist. ' : ''}{c.seats_left > 0 ? `${c.seats_left} place${c.seats_left === 1 ? '' : 's'} left` : 'Full'}{c.needs_pack ? ' · uses a class pack' : ''}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
};

/* training: the member's own plan, goals, measurements and packs */
const Training = () => {
  const [t, setT] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { call('/me/training').then(setT).catch((e) => setError(e.message)); }, []);
  if (error) return <Card><Err>{error}</Err></Card>;
  if (!t) return <Card className="text-center text-small text-ink-500">Loading…</Card>;
  return (
    <div className="space-y-4">
      {t.packs.length > 0 && <Card><h2 className="text-title font-semibold text-ink-900">Your packs</h2><ul className="mt-2 divide-y divide-line text-small">{t.packs.map((p) => <li key={p.pack_id} className="flex justify-between py-2"><span>{p.plan_name}<span className="block text-caption text-ink-500">until {longDate(p.expires_on)}</span></span><span className="font-semibold text-ink-900">{p.sessions_left} of {p.sessions_total} left</span></li>)}</ul></Card>}
      <Card>
        <h2 className="text-title font-semibold text-ink-900">Your workout plan</h2>
        {t.workouts.length === 0 ? <p className="mt-2 text-small text-ink-500">Your trainer has not made you a plan yet.</p> : t.workouts.map((w) => (
          <div key={w.workout_id} className="mt-3"><p className="font-medium text-ink-900">{w.name}</p>{w.goal && <p className="text-caption text-ink-500">{w.goal}</p>}
            <ul className="mt-1 space-y-0.5 text-small text-ink-700">{w.items.map((i) => <li key={i.item_id}>Day {i.day_no}: {i.exercise_name}{i.sets ? `, ${i.sets} × ${i.reps || '?'}` : ''}{i.weight_kg ? `, ${i.weight_kg} kg` : ''}</li>)}</ul></div>
        ))}
      </Card>
      {(t.goals.length > 0 || t.measurements.length > 0) && (
        <Card>
          <h2 className="text-title font-semibold text-ink-900">Your progress</h2>
          <ul className="mt-2 text-small">{t.goals.map((g) => <li key={g.goal_id} className="flex justify-between py-1"><span>{g.description}</span><span className="text-ink-500">{g.status === 'ACTIVE' ? (g.moved != null ? `${g.moved > 0 ? '+' : ''}${g.moved} so far` : '') : g.status.toLowerCase()}</span></li>)}</ul>
          <ul className="mt-2 divide-y divide-line text-small">{t.measurements.slice(0, 5).map((x) => <li key={x.measurement_id} className="flex justify-between py-1"><span>{longDate(x.measured_on)}</span><span className="text-ink-700">{[x.weight_kg && `${x.weight_kg} kg`, x.waist_cm && `waist ${x.waist_cm}`].filter(Boolean).join(' · ')}</span></li>)}</ul>
        </Card>
      )}
    </div>
  );
};

const Member = ({ me, token, entrance, reload }) => {
  const [tab, setTab] = useState(token ? 'checkin' : 'pass');
  const classesOn = Boolean(me.features?.classes);
  const [out, setOut] = useState(false);
  const m = me.member;
  const current = me.memberships.find((x) => ['ACTIVE', 'GRACE', 'FROZEN'].includes(x.state)) || me.memberships.find((x) => x.state === 'UPCOMING') || me.memberships[0];
  const signOut = async () => { try { await call('/logout', { method: 'POST' }); } finally { setOut(true); reload(true); } };
  const switchTo = async (id) => { await call('/me/switch', { method: 'POST', body: { member_id: Number(id) } }); reload(); };
  if (out) return null;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="truncate text-title font-semibold text-ink-900">{m.name}</p><p className="tabular text-small text-ink-500">{m.member_code}</p></div>
          <button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 text-small text-ink-500 hover:text-ink-900"><LogOut aria-hidden="true" className="h-4 w-4" />Sign out</button>
        </div>
        {me.members.length > 1 && (
          <div className="mt-3"><label htmlFor="who" className="block text-caption text-ink-500">Signed in for</label>
            <select id="who" value={m.member_id} onChange={(e) => switchTo(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-small">{me.members.map((x) => <option key={x.member_id} value={x.member_id}>{x.name}</option>)}</select></div>
        )}
        {me.points && (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-2.5 text-small"><span className="font-medium text-brand-700">Reward points</span><span className="tabular text-body font-bold text-brand-700">{me.points.balance}</span></div>
        )}
        {current ? (
          <div className="mt-4 rounded-xl bg-surface-2 p-4">
            <div className="flex items-center justify-between gap-2"><p className="font-medium text-ink-900">{current.plan_name}</p><span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${STATE[current.state]?.[1]}`}>{STATE[current.state]?.[0]}</span></div>
            <p className="mt-1 text-small text-ink-700">{current.state === 'UPCOMING' ? `Starts ${longDate(current.start_date)}` : `Until ${longDate(current.end_date)}`}{current.days_left != null && current.state !== 'UPCOMING' ? ` · ${current.days_left} day${current.days_left === 1 ? '' : 's'} left` : ''}</p>
            {PAY[current.payment] && <p className="mt-1.5 text-small font-medium text-danger">{PAY[current.payment]}{current.amount_due > 0 ? `: ₹${current.amount_due}` : ''}. Please pay at the front desk.</p>}
            {(current.state === 'EXPIRED' || (current.days_left != null && current.days_left <= 7)) && <p className="mt-1.5 text-small text-ink-700">Renew at the front desk to keep training.</p>}
          </div>
        ) : <p className="mt-4 rounded-xl bg-surface-2 p-4 text-small text-ink-700">You have no membership yet. Ask at the front desk.</p>}
      </Card>

      <div role="tablist" aria-label="Sections" className="flex gap-1 rounded-xl bg-surface-3 p-1">
        {[...(token ? [['checkin', 'Check in']] : []), ['pass', 'My pass'], ...(classesOn ? [['classes', 'Classes'], ['training', 'Training']] : []), ['visits', 'Visits']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-10 flex-1 rounded-lg text-small font-medium ${tab === k ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500'}`}>{l}</button>
        ))}
      </div>
      {tab === 'checkin' && token && <CheckIn token={token} info={entrance} onDone={reload} />}
      {tab === 'pass' && <Pass active />}
      {tab === 'classes' && classesOn && <Classes />}
      {tab === 'training' && classesOn && <Training />}
      {tab === 'visits' && (
        <Card>
          <h2 className="text-title font-semibold text-ink-900">Your visits</h2>
          <p className="text-small text-ink-500">{me.stats.visits_30d} in the last 30 days · {me.stats.visits} in all</p>
          {me.recent_visits.length ? <ul className="mt-3 divide-y divide-line text-small">{me.recent_visits.map((v) => <li key={v.check_in_at} className="py-2">{dayTime(v.check_in_at)}</li>)}</ul> : <p className="mt-3 text-small text-ink-500">No visits yet.</p>}
        </Card>
      )}
    </div>
  );
};

export default function GymPortal() {
  const { slug: slugParam, token } = useParams();
  const [info, setInfo] = useState(null);       // { name, slug, branch_name, ... }
  const [me, setMe] = useState(undefined);      // undefined loading, null signed out
  const [problem, setProblem] = useState('');

  const loadMe = useCallback(async (signedOut) => {
    if (signedOut) { setMe(null); return; }
    try { setMe(await call('/me')); } catch (e) { if (e.status === 401) setMe(null); else setProblem(e.message); }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try { const g = await call(token ? `/in/${token}` : `/${slugParam}`); if (live) setInfo(g); }
      catch (e) { if (live) setProblem(e.status === 404 ? (token ? 'This QR code is no longer in use. Please ask the front desk for the new one.' : 'This gym page is not available.') : e.message); }
    })();
    loadMe();
    return () => { live = false; };
  }, [slugParam, token, loadMe]);

  const slug = info?.slug || slugParam;
  if (problem) return <Shell title="FlowXP"><Card className="text-center"><QrCode aria-hidden="true" className="mx-auto h-10 w-10 text-ink-400" /><p className="mt-3 text-body text-ink-900">{problem}</p></Card></Shell>;
  if (!info || me === undefined) return <Shell title=" "><Card className="text-center text-small text-ink-500">Loading…</Card></Shell>;
  return (
    <Shell title={info.name}>
      {token && <p className="mb-3 text-center text-small text-ink-500">{info.branch_name}</p>}
      {me ? <Member me={me} token={token} entrance={info} reload={loadMe} /> : <SignIn slug={slug} gymName={info.name} onDone={() => loadMe()} />}
    </Shell>
  );
}
