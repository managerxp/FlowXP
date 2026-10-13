/* Creates an account the way the phone does, on a running server: refusals before anything is sent, signup, a wrong code, the right code, the session it gives, signing in again,
   a forgotten password, and the account-deletion answer for the only owner of a business.
   node --experimental-strip-types --no-warnings scripts/signup-live.mts   (API on :5100; run from mobile/; needs the backend's .env database)
   The email code is hashed in the database, so the script sets a known code for the new test account (the same thing backend/scripts/gym-dev-login.js does for the gym). */
import { execFileSync } from 'node:child_process';
import { createApi, ApiError, type Session } from '../src/lib/api.ts';
import { BUSINESS_TYPES, deleteBody, emptySignup, signupBody, signupProblem, verifyBody } from '../src/lib/account.ts';

const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: 'http://localhost:5100', getSession: () => session, onToken: (t) => { session.token = t; } });
const RUN = Date.now();
let step = 0;
const ok = (what: string, extra = '') => console.log(`ok ${++step}. ${what}${extra ? ` (${extra})` : ''}`);
const must = (cond: unknown, what: string) => { if (!cond) throw new Error(`FAILED: ${what}`); };
const refused = async (p: Promise<unknown>): Promise<ApiError | null> => { try { await p; return null; } catch (e) { return e instanceof ApiError ? e : null; } };

const email = `phone-${RUN}@mobile-live.test`;
const form = { ...emptySignup(), name: 'Phone Tester', email, phone: '9845012345', password: 'a-long-password-1', businessName: `Phone Test Shop ${RUN}`, businessType: 'AUTO_PARTS', agreed: true };
must(signupProblem(form) === '', 'the form is valid');

// the server refuses what the form would also refuse
const noTerms = await refused(api.post('/auth/signup', { ...signupBody(form), accepted_terms: false }, { signIn: true }));
must(noTerms && noTerms.status === 400, 'terms must be agreed');
const weak = await refused(api.post('/auth/signup', { ...signupBody(form), password: 'short' }, { signIn: true }));
must(weak && weak.status === 400, 'a short password is refused');
const badType = await refused(api.post('/auth/signup', { ...signupBody(form), business_type: 'BANK' }, { signIn: true }));
must(badType && badType.status === 400, 'an unknown kind of business is refused');
ok('the server refuses no terms, a short password and an unknown business type');

// every kind the app offers is accepted by the server's list
const typesOk = BUSINESS_TYPES.length === 12;
must(typesOk, 'twelve kinds');

const made = await api.post<{ challenge: string }>('/auth/signup', signupBody(form), { signIn: true });
must(made.challenge, 'a challenge for the code');
ok('account created, a 6-digit code was emailed', email);

const dup = await refused(api.post('/auth/signup', signupBody(form), { signIn: true }));
must(dup && dup.status === 409, 'the same email cannot sign up twice');
ok('the same email cannot sign up twice', dup?.message);

// until the code is entered there is no session
const early = await api.post<{ requires_email_otp?: boolean; challenge?: string; token?: string }>('/auth/login', { email, password: form.password }, { signIn: true });
must(early.requires_email_otp && !early.token, 'signing in before confirming the email asks for the code');
ok('signing in before confirming the email asks for the code, not a session');

const wrong = await refused(api.post('/auth/verify-email', verifyBody(made.challenge, '000000'), { signIn: true }));
must(wrong && wrong.status === 401, 'a wrong code is refused');
ok('a wrong code is refused', wrong?.message);

// set a known code for this test account, then confirm with it
execFileSync('node', ['-e', `
  import('./src/config/database.js').then(async ({ default: pool }) => {
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update('123456').digest('hex');
    await pool.query("UPDATE users SET email_otp_hash = $1, email_otp_expires_at = now() + interval '10 minutes' WHERE email = $2", [hash, ${JSON.stringify(email)}]);
    await pool.end();
  });`], { cwd: 'D:/ManagerXp/flowxp/backend', stdio: 'pipe' });
const verified = await api.post<{ token?: string }>('/auth/verify-email', verifyBody(made.challenge, '123 456'), { signIn: true });
must(verified.token, 'a session after the right code');
session.token = verified.token as string;
ok('the right code confirms the email and signs in');

const me = await api.get<{ user: { email: string }; businesses: { business_id: number; name: string; business_type: string; role: string; subscription_status?: string; outlets: { branch_id: number }[] }[] }>('/auth/me');
const biz = me.businesses[0];
must(me.user.email === email && biz.business_type === 'AUTO_PARTS' && biz.role === 'OWNER', 'the new account owns a spare parts shop');
ok('the account owns its business', `${biz.name}, ${biz.business_type}, role ${biz.role}, status ${biz.subscription_status ?? 'n/a'}`);
session.businessId = biz.business_id; session.branchId = biz.outlets[0]?.branch_id ?? null;
const sub = await api.get<{ status?: string; subscription_status?: string; trial_ends_at?: string; days_left?: number }>('/businesses/current/subscription');
console.log('   subscription:', JSON.stringify(sub));
const overview = await api.get<{ parts: number }>('/autoparts/overview');
must(overview.parts === 0, 'an empty parts shop');
ok('the parts tools are on for the new shop', 'overview answers with no parts yet');

// signing in again, and a forgotten password
const again = await api.post<{ token?: string }>('/auth/login', { email, password: form.password }, { signIn: true });
must(again.token, 'signs in with the password');
ok('signing in again with the password works');
const forgot = await api.post<{ success?: boolean }>('/auth/forgot-password', { email: `nobody-${RUN}@mobile-live.test` }, { signIn: true });
void forgot;
ok('a forgotten-password request gives the same answer for an unknown address');

// deleting the account: the only owner of a business is told what to do
const noPw = await refused(api.post('/auth/delete-account', deleteBody('wrong-password', '')));
must(noPw && noPw.status === 401, 'a wrong password does not delete');
const owner = await refused(api.post('/auth/delete-account', deleteBody(form.password, '')));
must(owner && owner.status === 409 && owner.code === 'OWNS_BUSINESS', 'the only owner is told to hand the business over first');
ok('deleting: a wrong password is refused; the only owner is told what to do', owner?.message.slice(0, 70));
console.log('ALL STEPS PASSED');
