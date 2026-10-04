/*
 * Two-step verification for the platform console: an authenticator app plus single-use recovery codes. It uses the same
 * /api/auth/2fa endpoints every account has, called with the admin session. Turning it on moves the account to a new
 * session (the server ends every older one), so the new token it returns replaces the stored one here.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { adminApi, setAdminToken } from '../lib/adminApi.js';
import { useAdminAuth } from './AdminAuthContext.jsx';
import { Alert, Button, Card, Field, Input, PageHeader, PageLoader } from '../components/ui.jsx';

const AUTH = { root: '/api/auth' };

const AdminSecurity = () => {
  const { refresh } = useAdminAuth();
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);       // { secret, qr }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState(null);       // recovery codes, shown once
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => adminApi('/2fa', AUTH).then(setStatus).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const run = async (fn) => {
    setError(''); setBusy(true);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const start = () => run(async () => {
    const s = await adminApi('/2fa/setup', { ...AUTH, method: 'POST' });
    setSetup({ secret: s.secret, qr: await QRCode.toDataURL(s.otpauth_url, { width: 200, margin: 1 }) });
  });
  const enable = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await adminApi('/2fa/enable', { ...AUTH, method: 'POST', body: { code } });
      if (r.token) setAdminToken(r.token);
      setCodes(r.recovery_codes); setSetup(null); setCode('');
      await load(); await refresh?.();
    });
  };
  const disable = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await adminApi('/2fa/disable', { ...AUTH, method: 'POST', body: { password, code } });
      if (r?.token) setAdminToken(r.token);
      setPassword(''); setCode(''); await load(); await refresh?.();
    });
  };

  if (!status && !error) return <PageLoader compact />;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title="Security" lead="Protect the platform console with a code from an authenticator app, on top of the password." />
      <Alert>{error}</Alert>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">Two-step verification</h2>
            <p className="mt-1 text-sm text-ink-500">{status?.enabled ? 'On. Signing in needs a code from your authenticator app.' : 'Off. Anyone with the password can sign in.'}</p>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status?.enabled ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{status?.enabled ? 'On' : 'Off'}</span>
        </div>

        {!status?.enabled && !setup && <Button className="mt-4" onClick={start} disabled={busy}>Set up two-step verification</Button>}

        {setup && (
          <form onSubmit={enable} className="mt-5 space-y-4">
            <p className="text-sm text-ink-700">Scan this with Google Authenticator, Authy or a similar app, then type the 6-digit code it shows.</p>
            <img src={setup.qr} alt="QR code to scan with your authenticator app" className="h-[200px] w-[200px] rounded-lg border border-line bg-white" />
            <p className="text-xs text-ink-500">Can’t scan? Enter this key by hand: <span className="select-all font-mono text-ink-900">{setup.secret}</span></p>
            <Field id="admin-2fa-code" label="Code from the app">
              <Input id="admin-2fa-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} required />
            </Field>
            <Button type="submit" disabled={busy || code.length < 6}>Turn on</Button>
          </form>
        )}

        {status?.enabled && (
          <form onSubmit={disable} className="mt-5 space-y-3 border-t border-line pt-4">
            <p className="text-sm text-ink-500">To turn it off, confirm with your password and a current code. {status.recovery_codes_left} recovery code{status.recovery_codes_left === 1 ? '' : 's'} left.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="admin-2fa-pw" label="Password"><Input id="admin-2fa-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
              <Field id="admin-2fa-off" label="Code"><Input id="admin-2fa-off" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} required /></Field>
            </div>
            <Button type="submit" variant="secondary" disabled={busy}>Turn off</Button>
          </form>
        )}
      </Card>

      {codes && (
        <Card className="border-warning/40">
          <h2 className="text-sm font-semibold text-ink-900">Your recovery codes</h2>
          <p className="mt-1 text-sm text-ink-500">Each works once, if you lose your phone. Save them somewhere safe now. They are not shown again.</p>
          <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-ink-900">{codes.map((c) => <li key={c} className="rounded bg-surface-2 px-2 py-1">{c}</li>)}</ul>
        </Card>
      )}
    </div>
  );
};

export default AdminSecurity;
