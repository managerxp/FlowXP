/*
 * The super admin sign-in — deliberately its own page, not a mode toggle on
 * the regular /login. A platform operator account and a business account are
 * different trust levels; keeping them on visibly different screens (no nav,
 * no "start free trial" noise) is part of not confusing the two.
 */
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
import { useAdminAuth } from './AdminAuthContext.jsx';
import { Alert, Button, Field, Input, Logo } from '../components/ui.jsx';

const AdminLogin = () => {
  const { admin, loading, signIn } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [needCode, setNeedCode] = useState(false);   // the password was right and this account has two-step verification on
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && admin) {
    return <Navigate to={location.state?.from || '/superadmin'} replace />;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const second = needCode ? (useRecovery ? { recovery_code: code.trim() } : { code: code.trim() }) : {};
      const data = await adminApi('/login', { method: 'POST', body: { email, password, ...second } });
      signIn(data.token, data.admin);
      navigate(location.state?.from || '/superadmin', { replace: true });
    } catch (err) {
      if (err.payload?.requires_2fa) setNeedCode(true);
      // the first ask for the code is not an error: the code box appearing is the message
      setError(err.payload?.requires_2fa && !needCode ? '' : (err.message || 'Could not sign you in'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-5 py-14">
      <Logo showTagline />
      <p className="mb-9 mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">
        Platform administration
      </p>

      <div className="border border-line bg-surface w-full max-w-sm rounded-(--radius-card) p-7 sm:p-8">
        <h1 className="text-h3 font-semibold text-ink-900">Super admin sign in</h1>
        <p className="mt-2 text-sm text-ink-500">Manage every FlowXP tenant from here.</p>

        <form onSubmit={onSubmit} className="mt-7 space-y-4">
          <Field id="email" label="Email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field id="password" label="Password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
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

          <Button as="button" type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default AdminLogin;
