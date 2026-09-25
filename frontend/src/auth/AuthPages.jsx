/*
 * Sign up, sign in, and password recovery.
 *
 * Four screens in one file because they share a layout, a submit pattern and
 * an error style. Four files would mean four copies of the same twelve lines
 * of form plumbing, and the copies would drift.
 */
import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { fadeUp } from '../animations/reveal.js';
import { Alert, Button, Field, Input, Logo, Select } from '../components/ui.jsx';

/* Mirrors the list the API validates against. A mismatch here is a 400 the
   user cannot fix, so the two lists must be changed together. */
const BUSINESS_TYPES = [
  ['RESTAURANT', 'Restaurant'], ['CAFE', 'Café'], ['RETAIL', 'Retail'],
  ['SUPERMARKET', 'Supermarket'], ['PHARMACY', 'Pharmacy'], ['SALON', 'Salon'],
  ['SERVICES', 'Services'], ['ELECTRONICS', 'Electronics'], ['CLOTHING', 'Clothing'],
  ['GAMING_CAFE', 'Gaming café'], ['RACING', 'Racing'], ['WHOLESALE', 'Wholesale'],
  ['DISTRIBUTOR', 'Distributor'], ['OTHER', 'Other']
];

/*
 * Deliberately restrained per the brief ("do not overdesign the
 * authentication screen"): the card and the logo above it fade up together,
 * once, on mount. No stagger, no scroll-trigger — a login form is a task,
 * not a page to be impressed by.
 */
const AuthLayout = ({ title, lead, children, footer }) => {
  const scope = useRef(null);

  useGSAP(() => {
    fadeUp('[data-auth-reveal]', { each: 0.08, stagger: 0.08 });
  }, { scope });

  return (
    <div ref={scope} className="glow-brand flex min-h-full flex-col items-center justify-center px-5 py-14">
      <Link to="/" aria-label="FlowXP home" className="mb-9" data-auth-reveal><Logo showTagline /></Link>

      <div data-auth-reveal className="glass w-full max-w-md rounded-[--radius-card] p-7 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
        {lead && <p className="mt-2 text-sm text-ink-500">{lead}</p>}
        <div className="mt-7">{children}</div>
      </div>

      {footer && <p data-auth-reveal className="mt-6 text-sm text-ink-500">{footer}</p>}
    </div>
  );
};

/*
 * Every form here submits the same way: disable, call, show the server's
 * message on failure. Written once rather than in each of the four.
 */
const useSubmit = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event, action) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reach FlowXP. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, submit };
};

/* ==========================================================================
   Signup
   ========================================================================== */
export const Signup = () => {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { busy, error, submit } = useSubmit();
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '', business_name: '', business_type: ''
  });

  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));

  const onSubmit = (event) => submit(event, async () => {
    const data = await api('/auth/signup', { method: 'POST', body: form });
    signIn(data.token, data.user, [data.business]);
    // Straight into onboarding — the brief's five-minute target starts here.
    navigate('/app/onboarding', { replace: true });
  });

  return (
    <AuthLayout
      title="Start your 7-day free trial"
      lead="No credit card. No sales call. About forty seconds."
      footer={<>Already have an account? <Link to="/login" className="font-semibold text-brand-600">Sign in</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Alert>{error}</Alert>

        <Field id="name" label="Your name">
          <Input id="name" value={form.name} onChange={set('name')} autoComplete="name" required />
        </Field>

        <Field id="email" label="Email">
          <Input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </Field>

        <Field id="phone" label="Phone" hint="Optional — used for invoice delivery and account recovery.">
          <Input id="phone" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />
        </Field>

        <Field id="password" label="Password" hint="At least 8 characters.">
          <Input id="password" type="password" value={form.password} onChange={set('password')}
                 autoComplete="new-password" minLength={8} required />
        </Field>

        <Field id="business_name" label="Business name">
          <Input id="business_name" value={form.business_name} onChange={set('business_name')}
                 autoComplete="organization" required />
        </Field>

        <Field id="business_type" label="Business type"
               hint="This decides which screens FlowXP shows you. You can change it later.">
          <Select id="business_type" value={form.business_type} onChange={set('business_type')} required>
            <option value="" disabled>Choose one…</option>
            {BUSINESS_TYPES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? 'Creating your workspace…' : 'Start free trial'}
        </Button>

        <p className="text-center text-xs text-ink-400">
          By signing up you agree to our{' '}
          <Link to="/terms" className="underline">Terms</Link> and{' '}
          <Link to="/privacy" className="underline">Privacy policy</Link>.
        </p>
      </form>
    </AuthLayout>
  );
};

/* ==========================================================================
   Login
   ========================================================================== */
export const Login = () => {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { busy, error, submit } = useSubmit();
  const [form, setForm] = useState({ email: '', password: '' });

  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));

  const onSubmit = (event) => submit(event, async () => {
    const data = await api('/auth/login', { method: 'POST', body: form });
    signIn(data.token, data.user, data.businesses);

    /* Somebody who never finished setting up lands back in the wizard rather
       than on a dashboard with nothing on it. */
    const first = data.businesses[0];
    navigate(first && first.onboarding_step < 10 ? '/app/onboarding' : '/app', { replace: true });
  });

  return (
    <AuthLayout
      title="Sign in"
      lead="Welcome back."
      footer={<>New to FlowXP? <Link to="/signup" className="font-semibold text-brand-600">Start a free trial</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Alert>{error}</Alert>

        <Field id="email" label="Email">
          <Input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </Field>

        <Field id="password" label="Password">
          <Input id="password" type="password" value={form.password} onChange={set('password')}
                 autoComplete="current-password" required />
        </Field>

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-xs font-medium text-brand-600">Forgot password?</Link>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? 'Signing you in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
};

/* ==========================================================================
   Forgot password
   ========================================================================== */
export const ForgotPassword = () => {
  const { busy, error, submit } = useSubmit();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const onSubmit = (event) => submit(event, async () => {
    await api('/auth/forgot-password', { method: 'POST', body: { email } });
    setSent(true);
  });

  return (
    <AuthLayout
      title="Reset your password"
      lead={sent ? undefined : 'We will email you a link. It works for one hour.'}
      footer={<Link to="/login" className="font-semibold text-brand-600">Back to sign in</Link>}
    >
      {sent ? (
        /* The same words whether or not the address is registered — the API
           deliberately does not say, and neither should this. */
        <p className="text-sm leading-relaxed text-ink-500">
          If <span className="font-medium text-ink-900">{email}</span> has a FlowXP account,
          a reset link is on its way. Check your spam folder if it has not arrived in a
          few minutes.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Alert>{error}</Alert>
          <Field id="email" label="Email">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                   autoComplete="email" required />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};

/* ==========================================================================
   Reset password
   ========================================================================== */
export const ResetPassword = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { busy, error, submit } = useSubmit();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState('');

  const token = params.get('token') || '';

  const onSubmit = (event) => {
    /* Checked here rather than at the API: the server never needs the second
       copy, and asking it to compare two strings is a round trip to tell the
       user something the browser already knows. */
    if (password !== confirm) {
      event.preventDefault();
      setMismatch('Both passwords must match');
      return;
    }
    setMismatch('');
    submit(event, async () => {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      navigate('/login?reset=1', { replace: true });
    });
  };

  if (!token) {
    return (
      <AuthLayout title="This link is not valid" lead="Reset links expire after an hour.">
        <Button to="/forgot-password" size="lg" className="w-full">Request a new link</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" lead="At least 8 characters.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Alert>{error}</Alert>

        <Field id="password" label="New password">
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 autoComplete="new-password" minLength={8} required />
        </Field>

        <Field id="confirm" label="Confirm new password" error={mismatch}>
          <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                 autoComplete="new-password" minLength={8} required />
        </Field>

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Set new password'}
        </Button>
      </form>
    </AuthLayout>
  );
};
