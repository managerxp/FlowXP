/*
 * The super admin sign-in — deliberately its own page, not a mode toggle on
 * the regular /login. A platform operator account and a business account are
 * different trust levels; keeping them on visibly different screens (no nav,
 * no "start free trial" noise) is part of not confusing the two.
 *
 * Two doors. Staff (Onboarding, Accounts, Support) have no password: the first time on a computer a code is emailed to them, then they set a 4 digit PIN there
 * and afterwards type only their email or phone number and the PIN (the browser remembers which one they used). The owner keeps the password and authenticator app.
 */
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
import { useAdminAuth } from './AdminAuthContext.jsx';
import { Alert, Button, Field, Input, Logo } from '../components/ui.jsx';

const REMEMBER = 'flowxp.admin.who';
const remembered = () => { try { return localStorage.getItem(REMEMBER) || ''; } catch { return ''; } };
const remember = (v) => { try { localStorage.setItem(REMEMBER, v); } catch { /* private window: it just asks again */ } };

const StaffSignIn = ({ onDone, onOwner }) => {
  const [who, setWho] = useState(remembered());
  const [pin, setPin] = useState('');
  const [step, setStep] = useState('pin');   // pin | code
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn) => { setBusy(true); setError(''); try { await fn(); } catch (err) { setError(err.message || 'Could not sign you in'); } finally { setBusy(false); } };
  const signedIn = (data) => { remember(who.trim()); onDone(data); };

  const withPin = (e) => { e.preventDefault(); run(async () => signedIn(await adminApi('/login/pin', { method: 'POST', body: { identifier: who, pin } }))); };
  const askCode = () => run(async () => {
    if (!who.trim()) throw new Error('Enter your email or phone number first.');
    await adminApi('/login/code', { method: 'POST', body: { identifier: who } });
    setNote('If that is a staff sign-in, a code is on its way to its email. It lasts 10 minutes.');
    setCode(''); setStep('code');
  });
  const withCode = (e) => { e.preventDefault(); run(async () => signedIn(await adminApi('/login/verify', { method: 'POST', body: { identifier: who, code } }))); };

  return (
    <form onSubmit={step === 'pin' ? withPin : withCode} className="mt-7 space-y-4">
      <Field id="who" label="Email or phone number">
        <Input id="who" autoComplete="username" inputMode="email" value={who} onChange={(e) => setWho(e.target.value)} required autoFocus={!who} />
      </Field>

      {step === 'pin' ? (
        <Field id="pin" label="PIN" hint="The 4 digit PIN you set on this computer.">
          <Input id="pin" type="password" inputMode="numeric" autoComplete="current-password" pattern="\d{4}" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required autoFocus={Boolean(who)} />
        </Field>
      ) : (
        <>
          {note && <p className="text-sm text-ink-500">{note}</p>}
          <Field id="code" label="Code from your email">
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
          </Field>
        </>
      )}

      <Alert>{error}</Alert>
      <Button as="button" type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>

      <div className="flex flex-col gap-2 text-sm">
        {step === 'pin'
          ? <button type="button" onClick={askCode} className="text-left text-brand-600 hover:underline">First time on this computer, or forgot your PIN? Email me a code</button>
          : <button type="button" onClick={() => { setStep('pin'); setError(''); }} className="text-left text-brand-600 hover:underline">Back to PIN</button>}
        <button type="button" onClick={onOwner} className="text-left text-ink-500 hover:underline">Owner? Sign in with a password</button>
      </div>
    </form>
  );
};

const OwnerSignIn = ({ onDone, onStaff }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [needCode, setNeedCode] = useState(false);   // the password was right and this account has two-step verification on
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const second = needCode ? (useRecovery ? { recovery_code: code.trim() } : { code: code.trim() }) : {};
      onDone(await adminApi('/login', { method: 'POST', body: { email, password, ...second } }));
    } catch (err) {
      if (err.payload?.requires_2fa) setNeedCode(true);
      // the first ask for the code is not an error: the code box appearing is the message
      setError(err.payload?.requires_2fa && !needCode ? '' : (err.message || 'Could not sign you in'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mt-7 space-y-4">
      <Field id="email" label="Email">
        <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field id="password" label="Password">
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>

      {needCode && (
        <>
          <Field id="admin-code" label={useRecovery ? 'Recovery code' : 'Code from your authenticator app'}>
            <Input id="admin-code" inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
          </Field>
          <button type="button" onClick={() => { setUseRecovery((v) => !v); setCode(''); setError(''); }} className="text-sm text-brand-600 hover:underline">
            {useRecovery ? 'Use the authenticator app instead' : 'Lost your phone? Use a recovery code'}
          </button>
        </>
      )}

      <Alert>{error}</Alert>
      <Button as="button" type="submit" className="w-full" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</Button>
      <button type="button" onClick={onStaff} className="text-left text-sm text-ink-500 hover:underline">Staff? Sign in with your PIN or a code</button>
    </form>
  );
};

const AdminLogin = () => {
  const { admin, loading, signIn } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [owner, setOwnerNow] = useState(() => { try { return localStorage.getItem('flowxp.admin.mode') === 'owner'; } catch { return false; } });   // the door used last
  const setOwner = (v) => { setOwnerNow(v); try { localStorage.setItem('flowxp.admin.mode', v ? 'owner' : 'staff'); } catch { /* ignore */ } };

  if (!loading && admin) {
    return <Navigate to={location.state?.from || '/superadmin'} replace />;
  }

  const done = (data) => { signIn(data.token, data.admin); navigate(location.state?.from || '/superadmin', { replace: true }); };

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-5 py-14">
      <Logo showTagline />
      <p className="mb-9 mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">
        Platform administration
      </p>

      <div className="border border-line bg-surface w-full max-w-sm rounded-(--radius-card) p-7 sm:p-8">
        <h1 className="font-display text-h3 font-semibold text-ink-900">{owner ? 'Owner sign in' : 'Super admin sign in'}</h1>
        <p className="mt-2 text-sm text-ink-500">Manage every FlowXP tenant from here.</p>
        {owner ? <OwnerSignIn onDone={done} onStaff={() => setOwner(false)} /> : <StaffSignIn onDone={done} onOwner={() => setOwner(true)} />}
      </div>
    </div>
  );
};

export default AdminLogin;
