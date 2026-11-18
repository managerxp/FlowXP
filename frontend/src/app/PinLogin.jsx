/*
 * PIN sign-in on a known computer (backend controllers/pinLogin.controller.js):
 *  - PinOffer: after a sign-in with the password, a one-line offer to set a PIN for this computer (asked once per computer; "Not now" remembers).
 *  - PinLoginCard: Security page: set, change or remove my PIN here, and the other computers I have a PIN on.
 *  - TeamPinDevices: Security page, owners and admins: everyone's PIN computers, with Remove (a sold laptop, someone who left).
 */
import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDate } from '../lib/display.js';
import { Alert, Button, Card, Field, Input, Modal, useToast } from '../components/ui.jsx';
import { useT } from '../i18n/useT.js';

const SKIP = 'flowxp.pin.offer';
const pinBox = 'w-40 text-center text-2xl tracking-[0.6em]';

/** Set or change the PIN for this computer. */
function SetPin({ onClose, onSaved }) {
  const tr = useT();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setError('');
    if (!/^\d{4}$/.test(pin)) return setError(tr('Enter 4 digits'));
    if (pin !== again) return setError(tr('The two PINs are not the same'));
    setBusy(true);
    try { await api('/auth/pin', { method: 'POST', body: { pin } }); onSaved(); } catch (caught) { setError(caught.message); } finally { setBusy(false); }
  };
  const digits = (setter) => (e) => setter(e.target.value.replace(/\D/g, '').slice(0, 4));
  return (
    <Modal open title={tr('PIN for this computer')} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-small text-ink-500">{tr('Next time, pick your name and type this PIN instead of your email and password. It works only on this computer.')}</p>
        <Alert>{error}</Alert>
        <div className="flex flex-wrap gap-4">
          <Field id="pin_new" label={tr('New PIN')}><Input id="pin_new" type="password" inputMode="numeric" autoComplete="new-password" autoFocus maxLength={4} value={pin} onChange={digits(setPin)} className={pinBox} /></Field>
          <Field id="pin_again" label={tr('Type it again')}><Input id="pin_again" type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={again} onChange={digits(setAgain)} className={pinBox} /></Field>
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button type="submit" loading={busy}>{tr('Save PIN')}</Button></div>
      </form>
    </Modal>
  );
}

export function PinOffer() {
  const tr = useT();
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let skipped = false; try { skipped = localStorage.getItem(SKIP) === 'no'; } catch { /* asked again next time */ }
    if (!skipped && window.matchMedia?.('(pointer: fine)').matches) api('/auth/pin').then((d) => setShow(!d?.has_pin)).catch(() => {});
  }, []);
  if (!show) return null;
  const later = () => { try { localStorage.setItem(SKIP, 'no'); } catch { /* fine */ } setShow(false); };
  return (
    <>
      <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-small text-ink-800 print:hidden">
        <KeyRound aria-hidden="true" className="size-4 text-brand-600" />
        <span className="min-w-0 flex-1">{tr('Sign in faster on this computer: set a 4-digit PIN and skip the password next time.')}</span>
        <Button size="sm" onClick={() => setOpen(true)}>{tr('Set a PIN')}</Button>
        <Button size="sm" variant="secondary" onClick={later}>{tr('Not now')}</Button>
      </div>
      {open && <SetPin onClose={() => setOpen(false)} onSaved={() => { setOpen(false); setShow(false); toast.success(tr('PIN saved for this computer')); }} />}
    </>
  );
}

const DeviceList = ({ rows, onRemove, showName }) => {
  const tr = useT();
  if (!rows.length) return <p className="text-small text-ink-500">{tr('No computers yet.')}</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
          <span className="min-w-0 flex-1 text-small">
            <span className="font-medium text-ink-900">{showName ? `${d.name} · ` : ''}{d.device}{d.this_computer ? ` (${tr('this computer')})` : ''}</span>
            <span className="block text-caption text-ink-500">{tr('Last used {{date}}', { date: formatDate(d.last_used_at) })}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => onRemove(d)}>{tr('Remove')}</Button>
        </li>
      ))}
    </ul>
  );
};

export function PinLoginCard() {
  const tr = useT();
  const toast = useToast();
  const [here, setHere] = useState(null);
  const [devices, setDevices] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const load = () => {
    api('/auth/pin').then((d) => setHere(Boolean(d?.has_pin))).catch((e) => setError(e.message));
    api('/auth/pin/devices').then(setDevices).catch(() => {});
  };
  useEffect(load, []);
  const remove = async (d) => { try { await api(`/auth/pin/devices/${d.id}`, { method: 'DELETE' }); load(); } catch (e) { setError(e.message); } };
  return (
    <Card className="p-5">
      <h2 className="text-base font-bold text-ink-900">{tr('PIN sign-in')}</h2>
      <p className="mt-1 text-xs text-ink-500">{tr('On a computer you use every day, sign in with a 4-digit PIN instead of your password. Five wrong PINs, a password change or signing out everywhere turn it off, and then the password is needed again.')}</p>
      <Alert>{error}</Alert>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setOpen(true)}>{here ? tr('Change PIN on this computer') : tr('Set a PIN on this computer')}</Button>
        {here && <Button size="sm" variant="secondary" onClick={async () => { await api('/auth/pin', { method: 'DELETE' }).catch(() => {}); load(); }}>{tr('Remove PIN from this computer')}</Button>}
      </div>
      {devices.length > 0 && <div className="mt-4"><h3 className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">{tr('Computers with your PIN')}</h3><DeviceList rows={devices} onRemove={remove} /></div>}
      {open && <SetPin onClose={() => setOpen(false)} onSaved={() => { setOpen(false); toast.success(tr('PIN saved for this computer')); load(); }} />}
    </Card>
  );
}

export function TeamPinDevices() {
  const tr = useT();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = () => api('/business/pin-devices').then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const remove = async (d) => { try { await api(`/business/pin-devices/${d.id}`, { method: 'DELETE' }); load(); } catch (e) { setError(e.message); } };
  return (
    <Card className="p-5">
      <h2 className="text-base font-bold text-ink-900">{tr('Your team\'s PIN computers')}</h2>
      <p className="mt-1 mb-3 text-xs text-ink-500">{tr('Remove a computer that was sold or lost, or one used by someone who has left.')}</p>
      <Alert>{error}</Alert>
      {rows && <DeviceList rows={rows} onRemove={remove} showName />}
    </Card>
  );
}
