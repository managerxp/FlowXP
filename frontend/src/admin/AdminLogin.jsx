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
      const data = await adminApi('/login', { method: 'POST', body: { email, password } });
      signIn(data.token, data.admin);
      navigate(location.state?.from || '/superadmin', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not sign you in');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glow-brand flex min-h-full flex-col items-center justify-center px-5 py-14">
      <Logo showTagline />
      <p className="mb-9 mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">
        Platform administration
      </p>

      <div className="glass w-full max-w-sm rounded-[--radius-card] p-7 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Super admin sign in</h1>
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
