/*
 * Sign up, sign in, and password recovery.
 *
 * Four screens in one file because they share a layout, a submit pattern and
 * an error style. Four files would mean four copies of the same twelve lines
 * of form plumbing, and the copies would drift.
 */
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import LanguageSelect from '../i18n/LanguageSelect.jsx';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { suggestEmail } from '../lib/emailTypos.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Field, Input, Logo } from '../components/ui.jsx';
import { Check, Shot } from '../site/parts.jsx';

/* Mirrors SIGNUP_TYPES in the API (backend/src/utils/validate.js): only the businesses FlowXP is built for. Older accounts of other types keep working.
   The API validates against it. A mismatch here is a 400 the
   user cannot fix, so the two lists must be changed together. */
const BUSINESS_TYPES = ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'HOTEL', 'RETAIL', 'SUPERMARKET', 'PHARMACY', 'SALON', 'GYM', 'GAMING_CAFE', 'AUTO_PARTS', 'WHOLESALE'];   // labels: auth:types.<CODE>

/* Why a first-time visitor can trust this screen, shown beside the form. */
const ASIDES = {   // text: auth:aside.<name>.title / p1..p3 / alt
  signup: {
    src: '/product/pos-main.webp'
  },
  /* Invoices, not a restaurant-only screen like the kitchen display: every
     business type signs in here, and every one of them raises bills. */
  login: {
    src: '/product/invoices-main.webp'
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
  const { t } = useTranslation('auth');
  const side = ASIDES[aside];
  return (
    <div className="grid min-h-full bg-surface lg:grid-cols-2">
      <div className="flex flex-col px-5 py-5 sm:px-10 sm:py-6">
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Link to="/" aria-label={t('layout.homeAria')}><Logo /></Link>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {top && <p className="text-small text-ink-500">{top}</p>}
            <LanguageSelect compact />
          </div>
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
          <Link to="/privacy" className="hover:text-ink-900">{t('layout.privacy')}</Link> ·{' '}
          <Link to="/terms" className="hover:text-ink-900">{t('layout.terms')}</Link>
        </p>
      </div>

      <aside aria-label={t('layout.asideAria')} className="hidden border-l border-line bg-brand-50 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:justify-center lg:self-start lg:overflow-hidden lg:px-12 xl:px-16">
        <div className="w-full max-w-xl">
          <div className="rise" style={{ '--d': '160ms' }}>
            <p className="text-h3 font-semibold text-ink-900">{t(`aside.${aside}.title`)}</p>
            <ul className="mt-5 space-y-2.5">
              {['p1', 'p2', 'p3'].map((p) => (
                <li key={p} className="flex gap-2.5 text-body text-ink-700"><Check />{t(`aside.${aside}.${p}`)}</li>
              ))}
            </ul>
          </div>
          <Shot src={side.src} alt={t(`aside.${aside}.alt`)} eager className="rise mt-10" style={{ '--d': '320ms' }} />
        </div>
      </aside>
    </div>
  );
};

/* A password box with a Show / Hide switch, so a mistyped password on a
   phone keyboard can be checked before submitting. */
const PasswordInput = ({ id, ...rest }) => {
  const { t } = useTranslation('auth');
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={shown ? 'text' : 'password'} className="pr-16" {...rest} />
      <button type="button" onClick={() => setShown((v) => !v)} aria-controls={id} aria-pressed={shown}
              className="absolute inset-y-0 right-0 px-3 text-small font-medium text-brand-600 hover:text-brand-700">
        {shown ? t('password.hide') : t('password.show')}
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
  const { t } = useTranslation('errors');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event, action) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('network'));
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
  const { t } = useTranslation('auth');
  const { t: te } = useTranslation('errors');
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
        ? (caught.status === 401 ? te('pageTooOld') : caught.message)
        : te('networkRetry'));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      aside={aside}
      title={t('emailCode.title')}
      lead={email ? <Trans t={t} i18nKey="emailCode.lead" values={{ email }} components={{ strong: <strong className="font-semibold text-ink-900 [overflow-wrap:anywhere]" /> }} /> : t('emailCode.leadNoEmail')}
      footer={onBack && <button type="button" className="font-medium text-brand-600 hover:text-brand-700" onClick={onBack}>{email ? t('emailCode.wrongEmail') : t('emailCode.back')}</button>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Alert>{error || resendError}</Alert>
        {resent && <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5 text-sm text-success">{t('emailCode.resent')}</p>}
        <Field id="code" label={t('emailCode.code')}>
          <CodeField id="code" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? t('emailCode.checking') : t('emailCode.verify')}</Button>
        <button type="button" disabled={resending || wait > 0} aria-disabled={resending || wait > 0}
                className="text-small font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-ink-400 disabled:hover:text-ink-400" onClick={resend}>
          {resending ? t('emailCode.sending') : wait > 0 ? t('emailCode.resendIn', { s: wait }) : t('emailCode.resend')}
        </button>
      </form>
    </AuthLayout>
  );
};

/* ==========================================================================
   Signup
   ========================================================================== */
export const Signup = () => {
  const { t } = useTranslation('auth');
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
      top={<Trans t={t} i18nKey="signup.haveAccount" components={{ link: <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700" /> }} />}
      title={t('signup.title')}
      lead={t('signup.lead')}
    >
      <form onSubmit={onSubmit} className="space-y-8">
        <Alert>{error}</Alert>

        <fieldset className="space-y-4">
          <legend className="mb-4 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">{t('signup.aboutYou')}</legend>
          <Field id="name" label={t('signup.name')}>
            <Input id="name" value={form.name} onChange={set('name')} autoComplete="name" required />
          </Field>
          <Field id="email" label={t('signup.email')} hint={t('signup.emailHint')}>
            <Input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required
                   aria-describedby={emailSuggestion ? 'email-suggestion' : undefined} />
            {emailSuggestion && (
              <p id="email-suggestion" role="status" className="mt-1.5 rounded-lg bg-warning/10 px-3 py-2 text-small text-ink-700">
                <Trans t={t} i18nKey="signup.didYouMean" values={{ email: emailSuggestion }} components={{ strong: <strong className="font-semibold text-ink-900" /> }} />{' '}
                <button type="button" onClick={() => setForm((f) => ({ ...f, email: emailSuggestion }))} className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">{t('signup.useIt')}</button>
              </p>
            )}
          </Field>
          <Field id="phone" label={t('signup.phone')} hint={t('signup.phoneHint')}>
            <Input id="phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />
          </Field>
          <Field id="password" label={t('signup.password')} hint={t('signup.passwordHint')}>
            <PasswordInput id="password" value={form.password} onChange={set('password')} autoComplete="new-password" minLength={10} required />
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-4 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">{t('signup.yourBusiness')}</legend>
          <Field id="business_name" label={t('signup.businessName')}>
            <Input id="business_name" value={form.business_name} onChange={set('business_name')} autoComplete="organization" required />
          </Field>
          <div role="radiogroup" aria-labelledby="type-label" aria-describedby="type-hint">
            <p id="type-label" className="text-sm font-medium text-ink-700">{t('signup.kindQ')}</p>
            <p id="type-hint" className="mt-1 text-xs text-ink-500">{t('signup.kindHint')}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BUSINESS_TYPES.map((value) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2.5 text-center text-small font-medium transition-colors duration-(--duration-fast) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500 ${form.business_type === value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}
                >
                  <input type="radio" name="business_type" value={value} checked={form.business_type === value} onChange={set('business_type')} required className="sr-only" />
                  {t(`types.${value}`)}
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
              <Trans t={t} i18nKey="signup.agree" components={{ terms: <Link to="/terms" target="_blank" className="underline hover:text-ink-900" />, privacy: <Link to="/privacy" target="_blank" className="underline hover:text-ink-900" /> }} />
            </span>
          </label>
          <Button type="submit" size="lg" className="w-full" disabled={busy || !agreed} title={agreed ? undefined : t('signup.agreeFirst')}>
            {busy ? t('signup.creating') : t('signup.submit')}
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
const GOOGLE_PROBLEMS = ['no_account', 'verify_first', 'unverified_google', 'not_allowed', 'cancelled', 'unavailable', 'failed'];   // text: auth:google.<reason>

const GoogleLogo = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]">
    <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.86c2.26-2.08 3.58-5.15 3.58-8.81z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.86-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.63H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.37l3.98-3.09z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.63l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
  </svg>
);

export const Login = () => {
  const { t } = useTranslation('auth');
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
  const googleReason = GOOGLE_PROBLEMS.includes(params.get('oauth')) ? params.get('oauth') : '';
  const googleProblem = googleReason ? t(`google.${googleReason}`) : '';

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
      <AuthLayout title={t('twofa.title')} lead={useRecovery ? t('twofa.leadRecovery') : t('twofa.leadApp')}
        footer={<button type="button" className="font-medium text-brand-600 hover:text-brand-700" onClick={() => { setSecond(null); setCode(''); setUseRecovery(false); }}>{t('twofa.back')}</button>}>
        <form onSubmit={onCode} className="space-y-4">
          <Alert>{error}</Alert>
          <Field id="code" label={useRecovery ? t('twofa.recoveryCode') : t('emailCode.code')}>
            {useRecovery
              ? <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoFocus required placeholder="xxxxx-xxxxx" maxLength={24} />
              : <CodeField id="code" value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? t('emailCode.checking') : t('login.submit')}</Button>
          <button type="button" className="text-small font-medium text-brand-600 hover:text-brand-700" onClick={() => { setUseRecovery((v) => !v); setCode(''); }}>{useRecovery ? t('twofa.useApp') : t('twofa.useRecovery')}</button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('login.title')}
      lead={t('login.lead')}
      top={<Trans t={t} i18nKey="login.newHere" components={{ link: <Link to="/signup" className="font-medium text-brand-600 hover:text-brand-700" /> }} />}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {googleProblem && !error && <Alert>{googleProblem}</Alert>}
        {justReset && !error && (
          <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5 text-sm text-success">
            {t('login.reset')}
          </p>
        )}
        <Alert>{error}</Alert>

        <Field id="email" label={t('login.email')}>
          <Input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" autoFocus required />
        </Field>

        <Field id="password" label={t('login.password')}>
          <PasswordInput id="password" value={form.password} onChange={set('password')} autoComplete="current-password" required />
        </Field>

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-small font-medium text-brand-600 hover:text-brand-700">{t('login.forgot')}</Link>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? t('login.signingIn') : t('login.submit')}
        </Button>
      </form>

      {googleOn && (
        <>
          <div className="my-5 flex items-center gap-3 text-caption text-ink-400" aria-hidden="true"><span className="h-px flex-1 bg-line" />{t('login.or')}<span className="h-px flex-1 bg-line" /></div>
          {/* A full page navigation, not an API call: the browser goes to Google and comes back signed in. */}
          <a href="/api/auth/google/start" className="flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-line-strong bg-surface text-body font-medium text-ink-900 transition-colors hover:bg-surface-2 active:scale-[0.99]">
            <GoogleLogo />{t('login.google')}
          </a>
          <p className="mt-2 text-center text-caption text-ink-500">{t('login.googleNote')}</p>
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
  const { t } = useTranslation('auth');
  const { t: te } = useTranslation('errors');
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
    catch (caught) { setResendError(caught instanceof ApiError ? caught.message : te('networkRetry')); }
  };

  const onReset = (event) => {
    // Checked here rather than at the API: the server never needs the second copy, and asking it to
    // compare two strings is a round trip to tell the user something the browser already knows.
    if (password !== confirm) {
      event.preventDefault();
      setMismatch(t('forgot.mismatch'));
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
        title={t('twofa.title')}
        lead={t('forgot.sentLead', { email })}
        footer={<button type="button" className="font-medium text-brand-600 hover:text-brand-700" onClick={() => { setSent(false); setCode(''); setPassword(''); setConfirm(''); }}>{t('forgot.differentEmail')}</button>}
      >
        <form onSubmit={onReset} className="space-y-4">
          <Alert>{error || resendError}</Alert>
          {resent && <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5 text-sm text-success">{t('emailCode.resent')}</p>}
          <Field id="code" label={t('emailCode.code')}>
            <CodeField id="code" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field id="password" label={t('forgot.newPassword')} hint={t('signup.passwordHint')}>
            <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={10} required />
          </Field>
          <Field id="confirm" label={t('forgot.confirm')} error={mismatch}>
            <PasswordInput id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={10} required />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? t('forgot.saving') : t('forgot.setNew')}</Button>
          <button type="button" className="text-small font-medium text-brand-600 hover:text-brand-700" onClick={resend}>{t('emailCode.resend')}</button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('forgot.title')}
      lead={t('forgot.lead')}
      footer={<Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">{t('forgot.back')}</Link>}
    >
      <form onSubmit={onRequest} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="email" label={t('forgot.email')}>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                 autoComplete="email" autoFocus required />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? t('forgot.sending') : t('forgot.send')}
        </Button>
      </form>
    </AuthLayout>
  );
};
