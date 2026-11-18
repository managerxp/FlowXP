/*
 * The screen lock's cover (mounted once in AppShell) and its settings card (Settings > Business). The rules are in lib/screenLock.js.
 */
import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button, Card, Field, Input, Select } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/useT.js';
import { MINUTES, STORAGE_KEYS, checkPin, clearLock, lockNow, lockSettings, lockState, setLockMinutes, setLockPin, setLockServer, shouldBeLocked, touch, unlock, validPin } from '../lib/screenLock.js';
import { api } from '../lib/api.js';

const ACTIVITY = ['pointerdown', 'keydown', 'mousemove', 'touchstart', 'wheel'];
const pinBox = 'w-40 text-center text-2xl tracking-[0.6em]';

/** Covers the app while locked. Watches for activity, checks every few seconds, and follows a lock or unlock in another tab. */
export function ScreenLockGate() {
  const tr = useT();
  const { signOut } = useAuth();
  const [locked, setLocked] = useState(() => shouldBeLocked(lockSettings(), lockState(), Date.now()));
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    const check = () => {
      const now = shouldBeLocked(lockSettings(), lockState(), Date.now());
      if (now && !lockState()?.locked) lockNow();
      setLocked(now);
    };
    const onActivity = () => { if (!shouldBeLocked(lockSettings(), lockState(), Date.now())) touch(); };
    ACTIVITY.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const onStorage = (e) => { if (STORAGE_KEYS.includes(e.key)) check(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('flowxp-lock', check);
    const timer = setInterval(check, 5000);
    if (!shouldBeLocked(lockSettings(), lockState(), Date.now())) touch(Date.now(), true);   // opening the app counts as using it, unless it should be locked already
    return () => { ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity)); window.removeEventListener('storage', onStorage); window.removeEventListener('flowxp-lock', check); clearInterval(timer); };
  }, []);

  if (!locked) return null;
  const change = async (v) => {
    const d = v.replace(/\D/g, '').slice(0, 4);
    setPin(d); setWrong(false);
    if (d.length !== 4) return;
    let ok = false;
    if (lockSettings()?.server) {
      // the sign-in PIN of this computer, checked by the server (its five tries count; when it is gone, signing out is the way back)
      const r = await api('/auth/pin/check', { method: 'POST', body: { pin: d } }).catch(() => null);
      ok = Boolean(r?.ok);
      if (r && !r.has_pin) { forgot(); return; }
      if (ok) unlock();
    } else ok = await checkPin(d);
    if (ok) { setLocked(false); setPin(''); } else { setWrong(true); setPin(''); }
  };
  const forgot = () => { clearLock(); signOut(); };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="lock-title" className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-page p-6 print:hidden">
      <Lock aria-hidden="true" className="size-10 text-brand-600" />
      <h1 id="lock-title" className="text-h4 font-semibold text-ink-900">{tr('Enter your PIN')}</h1>
      <Input aria-label={tr('PIN')} type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={4} value={pin} onChange={(e) => { void change(e.target.value); }} className={pinBox} />
      <p role="alert" className="min-h-5 text-small text-danger">{wrong ? tr('That PIN is not right') : ''}</p>
      <Button variant="secondary" onClick={forgot}>{tr('Forgot PIN? Sign out')}</Button>
    </div>
  );
}

/** Settings card: turn the lock on with a PIN, choose the idle time, lock now, or turn it off. Kept in this browser only. */
export default function ScreenLockSettings() {
  const tr = useT();
  const [settings, setSettings] = useState(lockSettings);
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [minutes, setMinutes] = useState(settings?.minutes ?? 5);
  const [error, setError] = useState('');
  // with a sign-in PIN on this computer, the screen lock just uses it: one PIN to remember
  const [signInPin, setSignInPin] = useState(false);
  useEffect(() => { api('/auth/pin').then((d) => setSignInPin(Boolean(d?.has_pin))).catch(() => {}); }, []);
  const save = async () => {
    if (!validPin(pin)) { setError(tr('Enter 4 digits')); return; }
    await setLockPin(pin, minutes); setSettings(lockSettings()); setOpen(false); setPin(''); setError('');
  };
  return (
    <Card className="mt-6">
      <h2 className="text-base font-bold text-ink-900">{tr('Screen lock')}</h2>
      <p className="mt-1 text-sm text-ink-500">{tr('Cover the app with a 4-digit PIN when this computer is left alone for a while. The PIN is kept in this browser only.')}</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {(open || settings) && (
          <Field id="lock_min" label={tr('Lock after')}>
            <Select id="lock_min" value={minutes} onChange={(e) => { const m = Number(e.target.value); setMinutes(m); if (settings && !open) { setLockMinutes(m); setSettings(lockSettings()); } }}>
              {MINUTES.map((m) => <option key={m} value={m}>{tr('{{n}} minutes away', { n: m })}</option>)}
            </Select>
          </Field>
        )}
        {open ? (
          <>
            <Field id="lock_pin" label={tr('New PIN')} error={error}>
              <Input id="lock_pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} className={pinBox} />
            </Field>
            <Button onClick={() => { void save(); }}>{tr('Save PIN')}</Button>
            <Button variant="secondary" onClick={() => { setOpen(false); setPin(''); setError(''); }}>{tr('Cancel')}</Button>
          </>
        ) : (
          <>
            {!settings && signInPin
              ? <Button variant="secondary" onClick={() => { setLockServer(minutes); setSettings(lockSettings()); }}>{tr('Turn on screen lock with my sign-in PIN')}</Button>
              : !settings?.server && <Button variant="secondary" onClick={() => setOpen(true)}>{settings ? tr('Change PIN') : tr('Turn on screen lock')}</Button>}
            {settings && <Button variant="secondary" onClick={() => { lockNow(); window.dispatchEvent(new Event('flowxp-lock')); }}>{tr('Lock now')}</Button>}
            {settings && <Button variant="secondary" onClick={() => { clearLock(); setSettings(null); }}>{tr('Turn off screen lock')}</Button>}
          </>
        )}
      </div>
    </Card>
  );
}
