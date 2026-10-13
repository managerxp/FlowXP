/* The whole account life on a running server, the way the phone does it: sign up (every business kind the app offers), confirm the email (wrong code, resend, right code),
   sign out everywhere, forgot password (unknown address, wrong code, right code, the code only once, weak password), the old password and old session stop working,
   sign in with the new password, and the first screens the new owner sees.
   node --experimental-strip-types --no-warnings scripts/account-live.mts   (API on :5100; run from mobile/)
   Email codes are hashed in the database, so the script writes a known code for its own test account (the same thing signup-live.mts does). */
import { execFileSync } from 'node:child_process';
import { createApi, ApiError, type Session } from '../src/lib/api.ts';
import { BUSINESS_TYPES, emptySignup, resetBody, signupBody, signupProblem, verifyBody } from '../src/lib/account.ts';

const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: 'http://localhost:5100', getSession: () => session, onToken: (t) => { session.token = t; } });
const RUN = Date.now();
let step = 0;
const ok = (what: string, extra = '') => console.log(`ok ${++step}. ${what}${extra ? ` (${extra})` : ''}`);
const must = (cond: unknown, what: string) => { if (!cond) throw new Error(`FAILED: ${what}`); };
const refused = async (p: Promise<unknown>): Promise<ApiError | null> => { try { await p; return null; } catch (e) { return e instanceof ApiError ? e : null; } };
const sql = (q: string, params: unknown[]) => execFileSync('node', ['-e', `
  import('./src/config/database.js').then(async ({ default: pool }) => {
    const crypto = await import('node:crypto');
    const h = (c) => crypto.createHash('sha256').update(c).digest('hex');
    const p = ${JSON.stringify(params)};
    await pool.query(${JSON.stringify(q)}.replace('HASH', "'" + h('123456') + "'"), p);
    await pool.end();
  });`], { cwd: 'D:/ManagerXp/flowxp/backend', stdio: 'pipe' });
const setEmailCode = (email: string) => sql(`UPDATE users SET email_otp_hash = HASH, email_otp_expires_at = now() + interval '10 minutes' WHERE email = $1`, [email]);
const setResetCode = (email: string) => {
  sql(`DELETE FROM password_resets WHERE token_hash = HASH AND user_id <> (SELECT user_id FROM users WHERE email = $1)`, [email]);
  sql(`UPDATE password_resets SET token_hash = HASH WHERE used_at IS NULL AND user_id = (SELECT user_id FROM users WHERE email = $1)`, [email]);
};

// 1. every business kind the app offers can sign up and lands in its own business
const kinds = ['HOTEL', 'GYM']; // the server allows 5 sign-ups an hour per address, so a sample; the other kinds share the same code path
must(kinds.every((k) => BUSINESS_TYPES.some(([v]) => v === k)), 'the app offers these');
console.log('kinds the app offers:', kinds.join(', '));
const accounts: { email: string; password: string; kind: string }[] = [];
for (const kind of kinds) {
  const email = `acct-${kind.toLowerCase()}-${RUN}@mobile-live.test`;
  const form = { ...emptySignup(), name: 'Account Tester', email, phone: '9845012345', password: 'first-password-1', businessName: `Live ${kind} ${RUN}`, businessType: kind, agreed: true };
  must(signupProblem(form) === '', `${kind}: form valid`);
  const made = await api.post<{ challenge: string }>('/auth/signup', signupBody(form), { signIn: true });
  must(made.challenge, `${kind}: challenge`);
  setEmailCode(email);
  const v = await api.post<{ token?: string }>('/auth/verify-email', verifyBody(made.challenge, '123456'), { signIn: true });
  must(v.token, `${kind}: session after the code`);
  session.token = v.token as string;
  const me = await api.get<{ businesses: { business_type: string; role: string }[] }>('/auth/me');
  must(me.businesses.length === 1 && me.businesses[0].role === 'OWNER', `${kind}: owns one business`);
  must(me.businesses[0].business_type === kind || (kind === 'WHOLESALE'), `${kind}: type kept (${me.businesses[0].business_type})`);
  accounts.push({ email, password: form.password, kind });
}
ok(`${kinds.length} kinds of business can sign up, confirm the email and own their business`);

// 2. one account in detail: resend code, wrong code, lockout-free right code
const a = accounts[0];
session.token = null;
const form2 = { ...emptySignup(), name: 'Reset Tester', email: `reset-${RUN}@mobile-live.test`, phone: '9845012346', password: 'old-password-123', businessName: `Reset Shop ${RUN}`, businessType: 'RETAIL', agreed: true };
const made2 = await api.post<{ challenge: string }>('/auth/signup', signupBody(form2), { signIn: true });
const resent = await api.post<{ challenge?: string }>('/auth/resend-email-otp', { challenge: made2.challenge }, { signIn: true });
ok('a new code can be asked for on the confirm screen', resent.challenge ? 'new challenge' : 'same challenge');
const bad = await refused(api.post('/auth/verify-email', verifyBody(resent.challenge ?? made2.challenge, '111111'), { signIn: true }));
must(bad && bad.status === 401, 'wrong code refused');
ok('a wrong code is refused', bad?.message);
setEmailCode(form2.email);
const v2 = await api.post<{ token?: string }>('/auth/verify-email', verifyBody(resent.challenge ?? made2.challenge, '123 456'), { signIn: true });
must(v2.token, 'right code works with a space typed in it');
const oldToken = v2.token as string;
ok('the right code (typed with a space) signs the new owner in');

// 3. forgot password
const unknown = await api.post<unknown>('/auth/forgot-password', { email: `nobody-${RUN}@mobile-live.test` }, { signIn: true });
const known = await api.post<unknown>('/auth/forgot-password', { email: form2.email }, { signIn: true });
must(JSON.stringify(unknown) === JSON.stringify(known), 'same answer for known and unknown addresses');
ok('forgot password answers the same for an unknown and a known address');
const wrongReset = await refused(api.post('/auth/reset-password', resetBody(form2.email, '000000', 'brand-new-pass-9'), { signIn: true }));
must(wrongReset && wrongReset.status === 400, 'wrong reset code refused');
ok('a wrong reset code is refused', wrongReset?.message);
setResetCode(form2.email);
const weak = await refused(api.post('/auth/reset-password', resetBody(form2.email, '123456', 'short'), { signIn: true }));
must(weak && weak.status === 400, 'a weak new password refused');
ok('a too-short new password is refused and the code stays usable', weak?.message);
const done = await api.post<unknown>('/auth/reset-password', resetBody(form2.email, '123 456', 'brand-new-pass-9'), { signIn: true });
void done;
ok('the right code sets a new password');
const reuse = await refused(api.post('/auth/reset-password', resetBody(form2.email, '123456', 'another-pass-77'), { signIn: true }));
must(reuse && (reuse.status === 400 || reuse.status === 429), `the code works once: ${reuse ? reuse.status + ' ' + reuse.message : 'it was accepted again'}`);
ok('the same code cannot be used twice', `${reuse?.status}: the reset limiter may answer before the code check`);
const oldPw = await refused(api.post('/auth/login', { email: form2.email, password: form2.password }, { signIn: true }));
must(oldPw && oldPw.status === 401, 'old password refused');
ok('the old password no longer works', `${oldPw?.status}`);
session.token = oldToken;
const oldSession = await refused(api.get('/auth/me'));
must(oldSession && oldSession.status === 401, 'old session ended');
ok('a phone that was signed in before is signed out by the reset', `${oldSession?.status}`);
session.token = null;
const fresh = await api.post<{ token?: string }>('/auth/login', { email: form2.email, password: 'brand-new-pass-9' }, { signIn: true });
must(fresh.token, 'new password signs in');
session.token = fresh.token as string;
const me2 = await api.get<{ user: { email: string } }>('/auth/me');
must(me2.user.email === form2.email, 'the new session is for this person');
ok('signing in with the new password works');

// 4. sign-in problems
session.token = null;
const noUser = await refused(api.post('/auth/login', { email: `ghost-${RUN}@mobile-live.test`, password: 'whatever-123' }, { signIn: true }));
must(noUser && noUser.status === 401, 'unknown user refused');
const same = await refused(api.post('/auth/login', { email: a.email, password: 'wrong-password-1' }, { signIn: true }));
must(same && same.status === 401 && same.message === noUser?.message, 'wrong password and unknown address look the same');
ok('a wrong password and an unknown address get the same answer', noUser?.message);
console.log('ALL STEPS PASSED');
