/*
 * Security: two-step verification (authenticator app), password, ending every session, this person's sign-in
 * history, and, for owners and admins, the team's sign-ins and the switch that requires two-step verification.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, setToken } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Button, Card, Field, Input, ListState, Table, Td, Th, Thead, Tr, useToast } from '../components/ui.jsx';

const when = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const OUTCOME = { SUCCESS: ['Signed in', 'success'], BAD_PASSWORD: ['Wrong password', 'danger'], UNKNOWN_USER: ['Unknown address', 'danger'], LOCKED: ['Locked out', 'danger'], TWO_FACTOR_FAILED: ['Wrong code', 'danger'] };
const deviceName = (ua) => {
  if (!ua) return 'Unknown device';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [browser, os].filter(Boolean).join(' on ') || ua.slice(0, 40);
};

const Events = ({ rows, showWho }) => (
  <Table>
    <Thead><Th>When</Th>{showWho && <Th>Who</Th>}<Th>What</Th><Th>Device</Th><Th>Address</Th></Thead>
    <tbody>
      {rows.map((e) => {
        const [label, tone] = OUTCOME[e.outcome] || [e.outcome, 'neutral'];
        return (
          <Tr key={e.event_id}>
            <Td className="whitespace-nowrap text-xs text-ink-500">{when(e.at)}</Td>
            {showWho && <Td className="text-sm">{e.name || e.email}</Td>}
            <Td><Badge tone={tone}>{label}</Badge>{e.method === 'RECOVERY' && <span className="ml-1 text-xs text-amber-600">recovery code</span>}{e.new_device && <span className="ml-1 text-xs font-semibold text-amber-600">new device</span>}</Td>
            <Td className="text-xs text-ink-600">{deviceName(e.device)}</Td>
            <Td className="text-xs text-ink-500">{e.ip || '—'}</Td>
          </Tr>
        );
      })}
    </tbody>
  </Table>
);

const RecoveryCodes = ({ codes, onDone }) => (
  <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
    <p className="text-sm font-semibold text-ink-900">Save these recovery codes now</p>
    <p className="text-xs text-ink-600">Each works once if you lose your phone. They are shown only this time. Keep them somewhere safe, not on the same phone.</p>
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-ink-900 sm:grid-cols-5">{codes.map((c) => <span key={c}>{c}</span>)}</div>
    <div className="flex gap-2">
      <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>Copy</Button>
      <Button size="sm" onClick={onDone}>I have saved them</Button>
    </div>
  </div>
);

const TwoFactor = () => {
  const toast = useToast();
  const { refresh } = useAuth();
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);      // { secret, otpauth_url, qr }
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [off, setOff] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api('/auth/2fa').then(setStatus).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const run = async (fn) => { setBusy(true); setError(''); try { await fn(); } catch (caught) { setError(caught.message); } finally { setBusy(false); } };

  const start = () => run(async () => {
    const s = await api('/auth/2fa/setup', { method: 'POST' });
    setSetup({ ...s, qr: await QRCode.toDataURL(s.otpauth_url, { width: 200, margin: 1 }) });
  });
  const enable = () => run(async () => {
    const r = await api('/auth/2fa/enable', { method: 'POST', body: { code } });
    setToken(r.token); setSetup(null); setCode(''); setCodes(r.recovery_codes); load(); refresh();
  });
  const newCodes = () => { const pw = window.prompt('Enter your password to get new recovery codes. The old ones stop working.'); if (pw) run(async () => { setCodes((await api('/auth/2fa/recovery-codes', { method: 'POST', body: { password: pw } })).recovery_codes); load(); }); };
  const turnOff = () => run(async () => {
    const isRecovery = code.includes('-');
    const r = await api('/auth/2fa/disable', { method: 'POST', body: { password, ...(isRecovery ? { recovery_code: code } : { code }) } });
    setToken(r.token); setOff(false); setPassword(''); setCode(''); toast.success('Two-step verification is off'); load(); refresh();
  });

  if (!status) return <ListState loading={!error} error={error} />;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-ink-900">Two-step verification</h2>
        <Badge tone={status.enabled ? 'success' : 'warning'}>{status.enabled ? 'On' : 'Off'}</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-500">After your password, you enter a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password). A stolen password alone is then not enough to get into your business.</p>
      {status.required && !status.enabled && <p className="mt-3 rounded-lg bg-danger/10 p-3 text-sm text-danger">Your business requires two-step verification for owners and admins. Set it up to continue using FlowXP.</p>}
      <Alert>{error}</Alert>

      {codes && <div className="mt-4"><RecoveryCodes codes={codes} onDone={() => setCodes(null)} /></div>}

      {!status.enabled && !setup && !codes && <Button className="mt-4" onClick={start} disabled={busy}>Set up two-step verification</Button>}
      {setup && (
        <div className="mt-4 grid gap-5 sm:grid-cols-[200px_1fr]">
          <img src={setup.qr} alt="QR code to scan with your authenticator app" className="h-[200px] w-[200px] rounded-lg border border-line bg-white" />
          <div className="space-y-3 text-sm text-ink-700">
            <p><strong>1.</strong> Open your authenticator app and scan this code (or enter the key by hand).</p>
            <p className="break-all rounded bg-surface-2 p-2 font-mono text-xs">{setup.secret}</p>
            <p><strong>2.</strong> Enter the 6-digit code it shows to confirm.</p>
            <div className="flex gap-2"><Input className="!w-36" inputMode="numeric" maxLength={7} placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code from your app" autoComplete="one-time-code" /><Button onClick={enable} disabled={busy || code.replace(/\s/g, '').length !== 6}>Turn on</Button><Button variant="ghost" onClick={() => setSetup(null)}>Cancel</Button></div>
          </div>
        </div>
      )}

      {status.enabled && !codes && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-ink-600">{status.recovery_codes_left} recovery code{status.recovery_codes_left === 1 ? '' : 's'} left{status.recovery_codes_left <= 2 && <span className="text-amber-600"> · get new ones soon</span>}.</p>
          <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={newCodes}>New recovery codes</Button>{!status.required && <Button variant="ghost" size="sm" onClick={() => setOff((v) => !v)}>Turn off…</Button>}</div>
          {off && (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field id="off-pw" label="Your password"><Input id="off-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
              <Field id="off-code" label="A code, or a recovery code"><Input id="off-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" /></Field>
              <Button variant="secondary" onClick={turnOff} disabled={busy || !password || !code}>Turn off</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

const Password = () => {
  const toast = useToast();
  const [form, setForm] = useState({ current_password: '', new_password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await api('/auth/change-password', { method: 'POST', body: form }); setToken(r.token); setForm({ current_password: '', new_password: '' }); toast.success('Password changed. Your other devices were signed out.'); }
    catch (caught) { setError(caught.message); } finally { setBusy(false); }
  };
  const out = async () => {
    if (!window.confirm('Sign out of every device, including this one\'s other tabs? You stay signed in here.')) return;
    try { const r = await api('/auth/sign-out-everywhere', { method: 'POST' }); setToken(r.token); toast.success('Every other device was signed out'); } catch (caught) { setError(caught.message); }
  };
  return (
    <Card className="p-5">
      <h2 className="text-base font-bold text-ink-900">Password and devices</h2>
      <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field id="pw-cur" label="Current password"><Input id="pw-cur" type="password" value={form.current_password} onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))} autoComplete="current-password" required /></Field>
        <Field id="pw-new" label="New password" hint="At least 8 characters"><Input id="pw-new" type="password" value={form.new_password} onChange={(e) => setForm((f) => ({ ...f, new_password: e.target.value }))} autoComplete="new-password" required /></Field>
        <Button type="submit" disabled={busy}>Change</Button>
      </form>
      <Alert>{error}</Alert>
      <div className="mt-4 border-t border-line pt-4">
        <p className="text-sm text-ink-600">Lost a phone, or used a shared computer? End every other session at once.</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={out}>Sign out everywhere else</Button>
      </div>
    </Card>
  );
};

const Team = () => {
  const toast = useToast();
  const { business } = useAuth();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const load = () => api('/security/team').then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (!d) return <ListState loading={!error} error={error} />;
  const toggle = async (on) => { setError(''); try { await api('/security/policy', { method: 'PUT', body: { require_2fa_admins: on } }); toast.success(on ? 'Owners and admins must now use two-step verification' : 'Policy switched off'); load(); } catch (caught) { setError(caught.message); } };
  return (
    <Card className="p-5">
      <h2 className="text-base font-bold text-ink-900">Your team's sign-ins</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3 text-sm">
        <p className="rounded-lg bg-surface-2 p-3"><span className="block text-xl font-semibold text-ink-900">{d.summary.failed_7d}</span>failed attempts in the last 7 days</p>
        <p className="rounded-lg bg-surface-2 p-3"><span className="block text-xl font-semibold text-ink-900">{d.summary.new_devices_7d}</span>sign-ins from new devices</p>
        <p className={`rounded-lg p-3 ${d.summary.privileged_without_2fa ? 'bg-amber-500/10' : 'bg-surface-2'}`}><span className="block text-xl font-semibold text-ink-900">{d.summary.privileged_without_2fa}</span>owners/admins without two-step</p>
      </div>
      <Alert>{error}</Alert>
      {business?.role === 'OWNER' && (
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={d.require_2fa_admins} onChange={(e) => toggle(e.target.checked)} />
          <span><span className="font-medium text-ink-900">Require two-step verification for owners and admins</span><span className="block text-xs text-ink-500">Until they set it up, they cannot use the app. Turn on your own first.</span></span>
        </label>
      )}
      <div className="mt-4"><Table>
        <Thead><Th>Person</Th><Th>Role</Th><Th>Two-step</Th></Thead>
        <tbody>{d.members.map((m) => <Tr key={m.user_id}><Td>{m.name}<span className="block text-xs text-ink-400">{m.email}</span></Td><Td className="text-xs">{m.role}</Td><Td>{m.two_factor ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>}</Td></Tr>)}</tbody>
      </Table></div>
      <h3 className="mb-2 mt-6 text-sm font-semibold text-ink-900">Recent activity</h3>
      {d.events.length ? <Events rows={d.events.slice(0, 50)} showWho /> : <p className="text-sm text-ink-400">Nothing yet.</p>}
    </Card>
  );
};

const SecurityPage = () => {
  const { business } = useAuth();
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/auth/login-history').then(setHistory).catch((e) => setError(e.message)); }, []);
  const canSeeTeam = ['OWNER', 'ADMIN'].includes(business?.role);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div><h1 className="text-h3 font-semibold text-ink-900">Security</h1><p className="mt-1 text-sm text-ink-500">Keep your account and your business safe.</p></div>
      <TwoFactor />
      <Password />
      <Card className="p-5">
        <h2 className="text-base font-bold text-ink-900">Your recent sign-ins</h2>
        <p className="mb-3 text-xs text-ink-500">If you see one you don't recognise, change your password and sign out everywhere.</p>
        <Alert>{error}</Alert>
        {history ? <Events rows={history} /> : <ListState loading={!error} />}
      </Card>
      {canSeeTeam && <Team />}
    </div>
  );
};

export default SecurityPage;
