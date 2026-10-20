/*
 * The front desk. Three ways to put a member through the door, all asking the same server-side rule ("may this person come in right now?"):
 *   a scanner  a USB or Bluetooth scanner types the code like a keyboard, so one focused box is all it needs;
 *   a camera   this device's camera reads the QR on a printed card or on the member's phone;
 *   a lookup   find the member by name or number and confirm it is them (no card needed).
 *
 * The screen is often in view of other members, so a result shows the member for a few seconds and then folds down to one line, and the list of
 * recent entries shows first names only. Nothing is decided here: if the connection or the server fails, nobody is let in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CameraOff, Check, DoorOpen, ScanLine, Search, ShieldCheck, TriangleAlert, UserRound, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { REASON, MEMBER_STATE, firstName, longDate, qs, useDebounced, useLoad, clockTime } from '../../lib/gym.js';
import { createScanGate } from '../../lib/scanGate.js';
import { beep, cameraProblem, listCameras, soundOn, startScanner, vibrate } from '../../lib/scanner.js';
import { Alert, Avatar, Badge, Button, Input, PageHeader, Select, StatCard, useDialog } from '../../components/ui.jsx';
import { Segmented } from '../salon/parts.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { T, useT } from '../../i18n/useT.js';

const SHOW_MS = 8000;
const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const TONE_CLASS = {
  success: 'border-success/40 bg-success/10 text-success', warning: 'border-warning/50 bg-warning/10 text-warning',
  danger: 'border-danger/40 bg-danger/10 text-danger', neutral: 'border-line bg-surface-2 text-ink-700'
};

/* The camera, as a panel on this page. */
const CameraPanel = ({ onCode, onClose }) => {
  const tr = useT();
  const video = useRef(null);
  const handler = useRef(onCode); handler.current = onCode;
  const gate = useMemo(() => createScanGate({ presentGapMs: 2500, minGapMs: 600 }), []);
  const [problem, setProblem] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  const engine = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const started = await startScanner({ video: video.current, kind: 'qr', deviceId, onCode: (code) => { if (gate(code)) handler.current(code); } });
        if (cancelled) { started.stop(); return; }
        engine.current = started;
        setCameras(await listCameras());
      } catch (error) { if (!cancelled) setProblem(cameraProblem(error)); }
    })();
    return () => { cancelled = true; engine.current?.stop(); engine.current = null; };
  }, [deviceId, gate]);

  const PROBLEMS = {
    denied: ['The camera is blocked', 'Allow the camera for this site in the browser (the lock or camera icon beside the address), then try again. A USB scanner or the member lookup works meanwhile.'],
    none: ['No camera found', 'Use a USB scanner, or look the member up by name.'],
    busy: ['The camera is in use', 'Another app or tab has it. Close that, then try again.'],
    error: ['The camera could not start', 'Try again, or use a USB scanner or the lookup.']
  };

  return (
    <div className="overflow-hidden rounded-(--radius-card) border border-line bg-ink-900">
      {problem ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-white">
          <CameraOff aria-hidden="true" className="h-10 w-10 text-white/70" />
          <p className="text-body font-semibold">{PROBLEMS[problem][0]}</p>
          <p className="max-w-sm text-small text-white/75">{PROBLEMS[problem][1]}</p>
          <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => { setProblem(null); setDeviceId(deviceId); }}>{tr('Try again')}</Button><Button size="sm" variant="secondary" onClick={onClose}>{tr('Close')}</Button></div>
        </div>
      ) : (
        <div className="relative">
          <video ref={video} muted playsInline aria-label={tr('Camera view: hold the QR code inside the frame')} className="aspect-[4/3] w-full object-cover" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="h-2/3 w-2/3 max-w-72 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" /></div>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/55 p-2">
            {cameras.length > 1 ? (
              <Select aria-label={tr('Camera')} value={deviceId || ''} onChange={(e) => setDeviceId(e.target.value || null)} className="max-w-56 text-small">
                <option value="">{tr('Default camera')}</option>
                {cameras.map((c) => <option key={c.id} value={c.id}>{tr(c.label)}</option>)}
              </Select>
            ) : <span className="px-2 text-caption text-white/80">{tr('Hold the QR inside the frame')}</span>}
            <Button size="sm" variant="secondary" onClick={onClose}>{tr('Close camera')}</Button>
          </div>
        </div>
      )}
    </div>
  );
};

/* What came back from the server, for the person at the desk. */
const ResultCard = ({ result, onConfirm, onDismiss, busy }) => {
  const tr = useT();
  const info = REASON[result.reason] || { tone: 'neutral', title: result.reason, next: '' };
  const m = result.member; const ms = result.membership;
  const needsConfirm = result.reason === 'VERIFICATION_REQUIRED' && m;
  return (
    <div role="status" aria-live="polite" className={`rounded-(--radius-panel) border-2 p-5 ${TONE_CLASS[info.tone]}`}>
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface">
          {result.decision === 'APPROVED' ? <Check className="h-7 w-7 text-success" /> : needsConfirm ? <ShieldCheck className="h-7 w-7" /> : <X className="h-7 w-7" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-h3 font-semibold leading-tight">{tr(info.title)}</p>
          {result.message && result.message !== info.title && <p className="mt-0.5 text-small opacity-90">{result.message}</p>}
          {info.next && <p className="mt-1 text-small opacity-90">{info.next}</p>}
          {result.in_grace && <p className="mt-1 text-small font-medium">{tr('The membership has run out but is inside its grace days.')}</p>}
        </div>
        <button type="button" onClick={onDismiss} aria-label={tr('Clear this result')} className="rounded-md p-1 opacity-70 hover:opacity-100"><X aria-hidden="true" className="h-5 w-5" /></button>
      </div>
      {m && (
        <div className="mt-4 flex items-center gap-3 rounded-(--radius-card) bg-surface p-3 text-ink-900">
          {m.photo_url ? <img src={m.photo_url} alt="" className="h-16 w-16 rounded-full object-cover" /> : <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xl font-bold text-white">{initials(m.name)}</span>}
          <div className="min-w-0">
            <p className="truncate text-body font-semibold">{m.name}</p>
            <p className="text-caption text-ink-500">{m.member_code}</p>
            {ms && <p className="text-small text-ink-700">{ms.plan_name} · {ms.days_left >= 0 ? `${ms.days_left} day${ms.days_left === 1 ? '' : 's'} left` : 'ended'} · until {longDate(ms.end_date)}</p>}
          </div>
        </div>
      )}
      {needsConfirm && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={onConfirm} loading={busy}><ShieldCheck aria-hidden="true" className="h-4 w-4" />{tr('It is them: let in')}</Button>
          <Button variant="secondary" onClick={onDismiss}>{tr('Not them')}</Button>
        </div>
      )}
    </div>
  );
};

export default function GymReception() {
  const tr = useT();
  const { outletId } = useAuth();
  const dialog = useDialog();
  const [mode, setMode] = useState('scan');          // scan | find
  const [action, setAction] = useState('IN');
  const [camera, setCamera] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [shown, setShown] = useState(false);          // the full result card is on screen
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');
  const input = useRef(null);
  const timer = useRef(null);
  const keys = useRef(new Map());                     // one key per attempt, kept if the connection drops, so a retry cannot record twice

  const settings = useLoad('/gym/settings');
  const dash = useLoad('/gym/dashboard');
  const code = useLoad('/gym/access/daily-code');
  const checkout = Boolean(settings.data?.checkout_enabled);

  const focus = useCallback(() => { if (mode === 'scan' && !camera) input.current?.focus(); }, [mode, camera]);
  useEffect(() => { focus(); }, [focus, result]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const record = (r, label) => {
    setRecent((list) => [{ at: Date.now(), decision: r.decision, reason: r.reason, who: r.member ? firstName(r.member.name) : label, action: r.action }, ...list].slice(0, 10));
    if (soundOn()) beep(r.decision === 'APPROVED');
    vibrate(r.decision === 'APPROVED' ? 35 : [60, 40, 60]);
    setResult(r); setShown(true);
    clearTimeout(timer.current);
    // the member's details do not stay up for the next person in the queue to read
    if (r.reason !== 'VERIFICATION_REQUIRED') timer.current = setTimeout(() => setShown(false), SHOW_MS);
    if (r.decision === 'APPROVED') dash.reload();
  };

  const submit = async (path, body, label, again = false) => {
    setBusy(true); setError('');
    const sig = JSON.stringify([path, body.code || body.member_id, body.action, body.confirm === true]);
    const key = keys.current.get(sig) || crypto.randomUUID();
    keys.current.set(sig, key);
    try {
      const out = await api(path, { method: 'POST', body: { ...body, idempotency_key: key } });
      keys.current.delete(sig);
      record({ ...out, code: again ? body.code : undefined, _body: body, _path: path }, label);
    } catch (e) {
      if (e.status === 503) { keys.current.delete(sig); record({ decision: 'DENIED', reason: 'SERVICE_UNAVAILABLE', message: e.message, action: body.action }, label); }
      else if (e instanceof TypeError) setError(tr('No connection to FlowXP. Nobody can be checked in until it is back. Try again.'));
      else { keys.current.delete(sig); setError(e.message); }
    } finally { setBusy(false); }
  };

  const scan = (value) => { const v = String(value || '').trim(); if (v) submit('/gym/access/scan', { code: v, action }, 'Scan'); };
  const onSubmit = (e) => { e.preventDefault(); const v = text; setText(''); scan(v); };
  const confirm = () => result?._body && submit(result._path, { ...result._body, confirm: true }, 'Confirmed');

  const [lookup, setLookup] = useState('');
  const q = useDebounced(lookup, 250);
  const found = useLoad(mode === 'find' && q.trim().length >= 2 ? `/gym/members${qs({ q: q.trim(), limit: 8 })}` : null, { paged: true });
  const pick = async (member) => {
    const ok = await dialog.confirm({
      title: `Is this ${member.name}?`, body: `Look at who is in front of you. Check them in as ${member.name} (${member.member_code}) only if it is them.`,
      confirmLabel: action === 'IN' ? 'Yes, check in' : 'Yes, check out', cancelLabel: tr('Not sure')
    });
    if (ok) submit('/gym/access/manual', { member_id: member.member_id, action, confirm: true }, 'Lookup');
  };

  const d = dash.data;
  return (
    <div>
      <PageHeader title={tr('Front desk')} lead={tr('Put members through the door. Every check-in uses the same rule as the phone and the gates.')}
        action={<Button to="/app/gym/members" variant="secondary"><UserRound aria-hidden="true" className="h-4 w-4" />{tr('Members')}</Button>} />
      {outletId == null && settings.data?.branches?.length > 1 && <Alert>{tr('Choose an outlet at the top of the screen. The front desk works for one outlet at a time.')}</Alert>}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={tr('In the gym now')} value={d ? d.visits.open_now : '–'} note={checkout ? 'Checked in, not out yet' : 'Check-out is off, so this is every visit today'} />
        <StatCard label={tr('Visits today')} value={d ? d.visits.today : '–'} note={d ? `${d.visits.today_unique} different members` : ''} />
        <StatCard label={tr('Turned away today')} value={d ? d.denied_today.reduce((s, x) => s + x.n, 0) : '–'} tone={d?.denied_today?.length ? 'warning' : undefined} note={d?.denied_today?.[0] ? `Mostly: ${(REASON[d.denied_today[0].reason_code]?.title || '').toLowerCase()}` : ''} />
        <StatCard label={tr('Today\'s member code')} value={code.data?.code ?? '–'} note={code.data ? 'For members checking in on their phone' : 'Phone check-in is not on for this gym'} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented label={tr('How to check in')} value={mode} onChange={setMode} options={[{ value: 'scan', label: T('Scan a card or phone') }, { value: 'find', label: T('Find a member') }]} />
            {checkout && <Segmented label={tr('Coming or going')} value={action} onChange={setAction} options={[{ value: 'IN', label: T('Check in') }, { value: 'OUT', label: T('Check out') }]} />}
          </div>

          {mode === 'scan' ? (
            <>
              <form onSubmit={onSubmit} className="flex gap-2">
                <div className="relative flex-1">
                  <ScanLine aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-400" />
                  <Input ref={input} aria-label={tr('Scan a card or phone pass')} placeholder={tr('Scan with the scanner, or paste a code here')} autoComplete="off" autoCapitalize="off" spellCheck="false"
                         value={text} onChange={(e) => setText(e.target.value)} className="h-12 pl-9" />
                </div>
                <Button type="submit" size="lg" loading={busy} disabled={!text.trim()}>{tr('Check')}</Button>
                <Button type="button" variant={camera ? 'primary' : 'secondary'} size="lg" onClick={() => setCamera((c) => !c)} aria-pressed={camera}><Camera aria-hidden="true" className="h-4 w-4" /><span className="hidden sm:inline">{camera ? tr('Camera on') : tr('Camera')}</span></Button>
              </form>
              {camera && <CameraPanel onCode={scan} onClose={() => setCamera(false)} />}
            </>
          ) : (
            <div>
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-400" />
                <Input aria-label={tr('Find a member')} autoFocus placeholder={tr('Name, phone or member number')} value={lookup} onChange={(e) => setLookup(e.target.value)} className="h-12 pl-9" />
              </div>
              <ul className="mt-2 divide-y divide-line rounded-(--radius-card) border border-line bg-surface">
                {(found.data || []).map((m) => (
                  <li key={m.member_id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={m.name} />
                    <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink-900">{m.name}</p><p className="text-caption text-ink-500">{m.member_code} · {m.plan_name || 'No plan'}{m.expires_on ? ` · to ${longDate(m.expires_on)}` : ''}</p></div>
                    <Badge tone={MEMBER_STATE[m.state]?.tone}>{MEMBER_STATE[m.state]?.label}</Badge>
                    <Button size="sm" onClick={() => pick(m)} loading={busy}><DoorOpen aria-hidden="true" className="h-4 w-4" />{action === 'IN' ? tr('Check in') : tr('Check out')}</Button>
                  </li>
                ))}
                {q.trim().length >= 2 && !found.loading && !(found.data || []).length && <li className="px-4 py-6 text-center text-small text-ink-500">No member matches. <a className="text-brand-600 hover:underline" href="/app/gym/members?new=1">{tr('Add one')}</a></li>}
                {q.trim().length < 2 && <li className="px-4 py-6 text-center text-small text-ink-500">{tr('Type at least two letters or digits.')}</li>}
              </ul>
            </div>
          )}

          {error && <Alert>{error}</Alert>}
          {result && shown && <ResultCard result={result} busy={busy} onConfirm={confirm} onDismiss={() => setShown(false)} />}
          {result && !shown && (
            <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-4 py-3 text-small text-ink-500"><TriangleAlert aria-hidden="true" className="h-4 w-4" />Last: {REASON[result.reason]?.title || result.reason}. Details are hidden from the screen.</p>
          )}
        </div>

        <aside aria-label={tr('Recent entries')} className="rounded-(--radius-card) border border-line bg-surface p-4">
          <h2 className="text-small font-semibold text-ink-900">{tr('This session')}</h2>
          {recent.length === 0 ? <p className="mt-2 text-small text-ink-500">{tr('Nothing yet. The first scan appears here.')}</p> : (
            <ul className="mt-2 space-y-2">
              {recent.map((r) => (
                <li key={r.at} className="flex items-center gap-2 text-small">
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${r.decision === 'APPROVED' ? 'bg-success' : 'bg-danger'}`} />
                  <span className="min-w-0 flex-1 truncate text-ink-900">{r.who}</span>
                  <span className="shrink-0 text-caption text-ink-500">{r.decision === 'APPROVED' ? (r.action === 'OUT' ? 'out' : 'in') : (REASON[r.reason]?.title || r.reason)}</span>
                  <span className="tabular shrink-0 text-caption text-ink-400">{clockTime(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
