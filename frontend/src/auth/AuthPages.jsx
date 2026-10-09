/*
 * Sign up, sign in, and password recovery.
 *
 * Four screens in one file because they share a layout, a submit pattern and
 * an error style. Four files would mean four copies of the same twelve lines
 * of form plumbing, and the copies would drift.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { suggestEmail } from '../lib/emailTypos.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Field, Input, Logo } from '../components/ui.jsx';
import { Check, Shot } from '../site/parts.jsx';

/* Mirrors SIGNUP_TYPES in the API (backend/src/utils/validate.js): only the businesses FlowXP is built for. Older accounts of other types keep working.
   The API validates against it. A mismatch here is a 400 the
   user cannot fix, so the two lists must be changed together. */
const BUSINESS_TYPES = [
  ['RESTAURANT', 'Restaurant'], ['CAFE', 'Café'], ['CLOUD_KITCHEN', 'Cloud kitchen'], ['RETAIL', 'Retail'],
  ['SUPERMARKET', 'Supermarket'], ['PHARMACY', 'Pharmacy'], ['SALON', 'Salon'],
  ['WHOLESALE', 'Wholesale'], ['DISTRIBUTOR', 'Distributor']
];

/* Why a first-time visitor can trust this screen, shown beside the form. */
const ASIDES = {
  signup: {
    title: 'Your first GST bill in a few minutes.',
    points: ['Seven days free, with every feature on', 'No credit card, no sales call', 'Your data stays yours, even if you stop paying'],
    src: '/product/pos-main.webp',
    alt: 'The FlowXP billing screen with items, GST and a Charge button.'
  },
  /* Invoices, not a restaurant-only screen like the kitchen display: every
     business type signs in here, and every one of them raises bills. */
  login: {
    title: 'Your bills, stock and insights are waiting.',
    points: ['Keeps billing when the internet drops', 'Two-step login keeps your account safe', 'Staff see only what their role allows'],
    src: '/product/invoices-main.webp',
    alt: 'The FlowXP invoices list: bill numbers, customers, totals and payment status.'
  }
};

/*
 * A split screen: the task on the left, a real FlowXP screen and three
 * reassurances on the right (wide screens only; on a phone the form is all
 * there is). The form rises in once; nothing else moves. A sign-in form is
 * a task, not a page to be impressed by.
 *
 * Spacing: on a phone the form sits a fixed distance under the header and
 * the legal line follows it, rather than being pinned to the bottom with an
 * empty screen in between. On a desktop both columns centre vertically in
 * the space between the header and the footer — a short form (login) and a
 * long one (signup, which can still run past the fold and scroll) both sit
 * in the middle of the screen rather than stranded near the top with a
 * growing void underneath. The screenshot is shown whole — a cropped screen
 * looks like a layout bug, not a design.
 */
const AuthLayout = ({ title, lead, children, footer, aside = 'login', top }) => {
  const side = ASIDES[aside];
  return (
    <div className="grid min-h-full bg-surface lg:grid-cols-2">
      <div className="flex flex-col px-5 py-5 sm:px-10 sm:py-6">
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Link to="/" aria-label="FlowXP home"><Logo /></Link>
          {top && <p className="text-small text-ink-500">{top}</p>}
        </div>

        <main className="flex justify-center pb-12 pt-10 sm:pt-16 lg:flex-1 lg:items-center">
          <div className="rise w-full max-w-[400px]">
            <h1 className="text-h2 font-semibold text-ink-900">{title}</h1>
            {lead && <p className="mt-2 text-body text-ink-500">{lead}</p>}
            <div className="mt-8">{children}</div>
            {footer && <p className="mt-6 text-small text-ink-500">{footer}</p>}
          </div>
        </main>

        <p className="border-t border-line pt-5 text-caption text-ink-500 lg:mt-auto lg:border-0 lg:pt-0">
          © {new Date().getFullYear()} ManagerXP ·{' '}
          <Link to="/privacy" className="hover:text-ink-900">Privacy</Link> ·{' '}
          <Link to="/terms" className="hover:text-ink-900">Terms</Link>
        </p>
      </div>

      <aside aria-label="About FlowXP" className="hidden border-l border-line bg-brand-50 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:justify-center lg:self-start lg:overflow-hidden lg:px-12 xl:px-16">
        <div className="w-full max-w-xl">
          <div className="rise" style={{ '--d': '160ms' }}>
            <p className="text-h3 font-semibold text-ink-900">{side.title}</p>
            <ul className="mt-5 space-y-2.5">
              {side.points.map((p) => (
                <li key={p} className="flex gap-2.5 text-body text-ink-700"><Check />{p}</li>
              ))}
            </ul>
          </div>
          <Shot src={side.src} alt={side.alt} eager className="rise mt-10" style={{ '--d': '320ms' }} />
        </div>
      </aside>
    </div>
  );
};

/* A password box with a Show / Hide switch, so a mistyped password on a
   phone keyboard can be checked before submitting. */
const PasswordInput = ({ id, ...rest }) => {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={shown ? 'text' : 'password'} className="pr-16" {...rest} />
      <button type="button" onClick={() => setShown((v) => !v)} aria-controls={id} aria-pressed={shown}
              className="absolute inset-y-0 right-0 px-3 text-small font-medium text-brand-600 hover:text-brand-700">
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
};

/* A 6-digit code input, the shape every one-time code on this page shares (2FA, email verification). */
const CodeField = (props) => (
  <Input inputMode="numeric" autoComplete="one-time-code" autoFocus required placeholder="000 000" maxLength={7}
         className="tabular text-center text-xl tracking-[0.3em]" {...props} />
);

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

/* What every successful sign-in (password, 2FA, email code) ends with: a session, and the wizard if setup
   never finished rather than a dashboard with nothing on it yet. */
const useFinishAuth = () => {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  return (data) => {
    signIn(data.token, data.user, data.businesses);
    const first = data.businesses[0];
    navigate(first && first.onboarding_step < 10 ? '/app/onboarding' : '/app', { replace: true });
  };
};

/*
 * The "enter the code we emailed you" step — shared by Signup (verifying a brand new account) and Login
 * (an earlier signup that never finished verifying). Both end the same way: the session this challenge was
 * one step away from, handed to `onDone`.
 */
const RESEND_WAIT_S = 30;

const EmailCodeStep = ({ challenge: initialChallenge, email, aside, onDone, onBack }) => {
  const { busy, error, submit } = useSubmit();
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(initialChallenge);   // renewed by every resend
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState('');
  const [wait, setWait] = useState(0);                            // seconds until Resend can be pressed again

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const onSubmit = (event) => submit(event, async () => {
    onDone(await api('/auth/verify-email', { method: 'POST', body: { challenge, code } }));
  });
  const resend = async () => {
    if (resending || wait > 0) return;
    setResent(false); setResendError(''); setResending(true);
    try {
      const data = await api('/auth/resend-email-otp', { method: 'POST', body: { challenge } });
      if (data?.challenge) setChallenge(data.challenge);
      setResent(true); setCode(''); setWait(RESEND_WAIT_S);
    } catch (caught) {
      // say what happened: an expired sign-up session or the rate limit looked like "the button does nothing"
      setResendError(caught instanceof ApiError
        ? (caught.status === 401 ? 'This page has been open too long. Go back and sign in again to get a new code.' : caught.message)
        : 'Could not reach FlowXP. Check your connection and try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      aside={aside}
      title="Check your email"
      lead={email ? <>We sent a 6-digit code to <strong className="font-semibold text-ink-900 [overflow-wrap:anywhere]">{email}</strong>. It expires in 10 minutes.</> : 'Enter the 6-digit code we just sent you. It expires in 10 minutes.'}
      footer={onBack && <button type="button" className="font-medium text-brand-600 hover:text-brand-700" onClick={onBack}>{email ? 'Wrong email? Go back' : '← Back'}</button>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Alert>{error || resendError}</Alert>
        {resent && <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5 text-sm text-success">A new code is on its way. It can take a minute; check your spam folder too.</p>}
        <Field id="code" label="Code">
          <CodeField id="code" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Checking…' : 'Verify and continue'}</Button>
        <button type="button" disabled={resending || wait > 0} aria-disabled={resending || wait > 0}
                className="text-small font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-ink-400 disabled:hover:text-ink-400" onClick={resend}>
          {resending ? 'Sending…' : wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
        </button>
      </form>
    </AuthLayout>
  );
};

/* ==========================================================================
   Signup
   ========================================================================== */
export const Signup = () => {
  const finish = useFinishAuth();
  const { busy, error, submit } = useSubmit();
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '', business_name: '', business_type: ''
  });
  const [agreed, setAgreed] = useState(false);
  const [challenge, setChallenge] = useState(null);   // set once the account exists and a code has been emailed

  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));
  const emailSuggestion = suggestEmail(form.email);

  const onSubmit = (event) => submit(event, async () => {
    const data = await api('/auth/signup', { method: 'POST', body: { ...form, accepted_terms: agreed } });
    setChallenge(data.challenge);
  });

  // The brief's five-minute-to-first-bill target starts once this code is entered, not before —
  // an unverified email is not yet an account that can sign in.
  if (challenge) return <EmailCodeStep aside="signup" challenge={challenge} email={form.email.trim()} onBack={() => setChallenge(null)} onDone={finish} />;

  return (
    <AuthLayout
      aside="signup"
      top={<>Have an account? <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">Sign in</Link></>}
      title="Start your free trial"
      lead="Seven days free. No card, no sales call. It takes about a minute."
    >
      <form onSubmit={onSubmit} className="space-y-8">
        <Alert>{error}</Alert>

        <fieldset className="space-y-4">
          <legend className="mb-4 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">About you</legend>
          <Field id="name" label="Your name">
            <Input id="name" value={form.name} onChange={set('name')} autoComplete="name" required />
          </Field>
          <Field id="email" label="Email" hint="We send a 6-digit code here to confirm it is yours.">
            <Input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required
                   aria-describedby={emailSuggestion ? 'email-suggestion' : undefined} />
            {emailSuggestion && (
              <p id="email-suggestion" role="status" className="mt-1.5 rounded-lg bg-warning/10 px-3 py-2 text-small text-ink-700">
                Did you mean <strong className="font-semibold text-ink-900">{emailSuggestion}</strong>?{' '}
                <button type="button" onClick={() => setForm((f) => ({ ...f, email: emailSuggestion }))} className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">Use it</button>
              </p>
            )}
          </Field>
          <Field id="phone" label="Mobile number (optional)" hint="For account recovery and bill delivery.">
            <Input id="phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />
          </Field>
          <Field id="password" label="Password" hint="At least 10 characters.">
            <PasswordInput id="password" value={form.password} onChange={set('password')} autoComplete="new-password" minLength={10} required />
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-4 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Your business</legend>
          <Field id="business_name" label="Business name">
            <Input id="business_name" value={form.business_name} onChange={set('business_name')} autoComplete="organization" required />
          </Field>
          <div role="radiogroup" aria-labelledby="type-label" aria-describedby="type-hint">
            <p id="type-label" className="text-sm font-medium text-ink-700">What kind of business is it?</p>
            <p id="type-hint" className="mt-1 text-xs text-ink-500">FlowXP switches on the tools this kind of business needs.</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BUSINESS_TYPES.map(([value, label]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2.5 text-center text-small font-medium transition-colors duration-(--duration-fast) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500 ${form.business_type === value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}
                >
                  <input type="radio" name="business_type" value={value} checked={form.business_type === value} onChange={set('business_type')} required className="sr-only" />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <div className="space-y-3">
          <label className="flex items-start gap-2.5 text-xs text-ink-500">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              required
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong text-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            />
            <span>
              I agree to the{' '}
              <Link to="/terms" target="_blank" className="underline hover:text-ink-900">Terms</Link> and{' '}
              <Link to="/privacy" target="_blank" className="underline hover:text-ink-900">Privacy policy</Link>.
            </span>
          </label>
          <Button type="submit" size="lg" className="w-full" disabled={busy || !agreed} title={agreed ? undefined : 'Agree to the Terms and Privacy policy first'}>
            {busy ? 'Creating your account…' : 'Start free trial'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
};

/* ==========================================================================
   Login
   ========================================================================== */

/* What the page says when "Continue with Google" sent the person back without signing them in (?oauth=<reason>). */
const GOOGLE_PROBLEMS = {
  no_account: 'There is no FlowXP account for that Google address. Sign in with the email you signed up with, or start a free trial.',
  verify_first: 'Finish verifying your email first: sign in once with your password and enter the code we email you. Then Google works too.',
  unverified_google: 'Google has not verified that email address, so we cannot use it to sign you in.',
  not_allowed: 'That account does not sign in this way.',
  cancelled: 'Google sign-in was cancelled.',
  unavailable: 'Google sign-in is not available right now. Use your password instead.',
  failed: 'Google sign-in did not work. Please try again, or use your password.'
};

const GoogleLogo = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]">
    <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.86c2.26-2.08 3.58-5.15 3.58-8.81z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.86-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.63H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.37l3.98-3.09z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.63l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
  </svg>
);

export const Login = () => {
  const finish = useFinishAuth();
  const [params] = useSearchParams();
  const justReset = params.get('reset') === '1';
  const { busy, error, submit } = useSubmit();
  const [form, setForm] = useState({ email: '', password: '' });
  const [second, setSecond] = useState(null);         // { challenge } once the password was right and a 2FA code is needed
  const [otpChallenge, setOtpChallenge] = useState(null);   // set instead, when the account's email isn't verified yet
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [googleOn, setGoogleOn] = useState(false);     // the server has Google sign-in set up
  const googleProblem = GOOGLE_PROBLEMS[params.get('oauth')] || '';

  useEffect(() => { api('/auth/oauth/providers').then((p) => setGoogleOn(Boolean(p?.google))).catch(() => {}); }, []);
  // An account with an authenticator app comes back from Google with its two-step challenge in the URL fragment.
  useEffect(() => {
    const m = /^#second=(.+)$/.exec(window.location.hash);
    if (!m) return;
    setSecond({ challenge: decodeURIComponent(m[1]) });
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));

  const onCode = (event) => submit(event, async () => {
    finish(await api('/auth/login/2fa', { method: 'POST', body: { challenge: second.challenge, ...(useRecovery ? { recovery_code: code } : { code }) } }));
  });

  const onSubmit = (event) => submit(event, async () => {
    const data = await api('/auth/login', { method: 'POST', body: form });
    // Checked before 2FA: an account that never finished verifying its email can't have set 2FA up yet
    // either, but if it somehow had both pending, finishing email verification is the one that unblocks it.
    if (data.requires_email_otp) { setOtpChallenge(data.challenge); return; }
    if (data.requires_2fa) { setSecond({ challenge: data.challenge }); return; }
    finish(data);
  });

  if (otpChallenge) return <EmailCodeStep challenge={otpChallenge} email={form.email.trim()} onBack={() => setOtpChallenge(null)} onDone={finish} />;

  if (second) {
    return (
      <AuthLayout title="Enter your code" lead={useRecovery ? 'Enter one of your recovery codes.' : 'Open your authenticator app and enter the 6-digit code.'}
        footer={<button type="button" className="font-medium text-brand-600 hover:text-brand-700" onClick={() => { setSecond(null); setCode(''); setUseRecovery(false); }}>← Back to sign in</button>}>
        <form onSubmit={onCode} className="space-y-4">
          <Alert>{error}</Alert>
          <Field id="code" label={useRecovery ? 'Recovery code' : 'Code'}>
            {useRecovery
              ? <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoFocus required placeholder="xxxxx-xxxxx" maxLength={24} />
              : <CodeField id="code" value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</Button>
          <button type="button" className="text-small font-medium text-brand-600 hover:text-brand-700" onClick={() => { setUseRecovery((v) => !v); setCode(''); }}>{useRecovery ? 'Use my authenticator app instead' : 'I lost my phone: use a recovery code'}</button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in to FlowXP"
      lead="Welcome back. Use the email you signed up with."
      top={<>New here? <Link to="/signup" className="font-medium text-brand-600 hover:text-brand-700">Start free trial</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {googleProblem && !error && <Alert>{googleProblem}</Alert>}
        {justReset && !error && (
          <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5 text-sm text-success">
            Your password was changed. Sign in with the new one.
          </p>
        )}
        <Alert>{error}</Alert>

        <Field id="email" label="Email">
          <Input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" autoFocus required />
        </Field>

        <Field id="password" label="Password">
          <PasswordInput id="password" value={form.password} onChange={set('password')} autoComplete="current-password" required />
        </Field>

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-small font-medium text-brand-600 hover:text-brand-700">Forgot password?</Link>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? 'Signing you in…' : 'Sign in'}
        </Button>
      </form>

      {googleOn && (
        <>
          <div className="my-5 flex items-center gap-3 text-caption text-ink-400" aria-hidden="true"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
          {/* A full page navigation, not an API call: the browser goes to Google and comes back signed in. */}
          <a href="/api/auth/google/start" className="flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-line-strong bg-surface text-body font-medium text-ink-900 transition-colors hover:bg-surface-2 active:scale-[0.99]">
            <GoogleLogo />Continue with Google
          </a>
          <p className="mt-2 text-center text-caption text-ink-500">For accounts you have already created. New here? Start a free trial above.</p>
        </>
      )}
    </AuthLayout>
  );
};

/* ==========================================================================
   Forgot password — a 6-digit emailed code, entered on this same screen,
   rather than a link to a separate page. Two steps in one component for the
   same reason Login's 2FA step is: one shared submit/error pattern, no route
   for a "reset-password" page that a code-based flow never navigates to.
   ========================================================================== */
export const ForgotPassword = () => {
  const navigate = useNavigate();
  const { busy, error, submit } = useSubmit();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState('');
  const [resent, setResent] = useState(false);

  const onRequest = (event) => submit(event, async () => {
    await api('/auth/forgot-password', { method: 'POST', body: { email } });
    setSent(true);
  });

  const [resendError, setResendError] = useState('');
  const resend = async () => {
    setResent(false); setResendError('');
    try { await api('/auth/forgot-password', { method: 'POST', body: { email } }); setResent(true); }
    catch (caught) { setResendError(caught instanceof ApiError ? caught.message : 'Could not reach FlowXP. Check your connection and try again.'); }
  };

  const onReset = (event) => {
    // Checked here rather than at the API: the server never needs the second copy, and asking it to
    // compare two strings is a round trip to tell the user something the browser already knows.
    if (password !== confirm) {
      event.preventDefault();
      setMismatch('Both passwords must match');
      return;
    }
    setMismatch('');
    submit(event, async () => {
      await api('/auth/reset-password', { method: 'POST', body: { email, code, password } });
      navigate('/login?reset=1', { replace: true });
    });
  };

  if (sent) {
    return (
      <AuthLayout
        title="Enter your code"
        lead={`If ${email} has a FlowXP account, a code is on its way. It expires in 10 minutes.`}
        footer={<button type="button" className="font-medium text-brand-600 hover:text-brand-700" onClick={() => { setSent(false); setCode(''); setPassword(''); setConfirm(''); }}>← Use a different email</button>}
      >
        <form onSubmit={onReset} className="space-y-4">
          <Alert>{error || resendError}</Alert>
          {resent && <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5 text-sm text-success">A new code is on its way. It can take a minute; check your spam folder too.</p>}
          <Field id="code" label="Code">
            <CodeField id="code" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field id="password" label="New password" hint="At least 10 characters.">
            <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={10} required />
          </Field>
          <Field id="confirm" label="Confirm new password" error={mismatch}>
            <PasswordInput id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={10} required />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</Button>
          <button type="button" className="text-small font-medium text-brand-600 hover:text-brand-700" onClick={resend}>Resend code</button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      lead="We will email you a 6-digit code to reset it with."
      footer={<Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">← Back to sign in</Link>}
    >
      <form onSubmit={onRequest} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="email" label="Email">
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                 autoComplete="email" autoFocus required />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? 'Sending…' : 'Send code'}
        </Button>
      </form>
    </AuthLayout>
  );
};
