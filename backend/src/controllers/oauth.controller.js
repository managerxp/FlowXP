/*
 * Sign in with Google, for existing accounts (modules/oauth.js has the protocol and the reasoning).
 *
 *   GET /api/auth/oauth/providers       which providers are set up, so the sign-in page only shows a working button
 *   GET /api/auth/google/start          sends the browser to Google
 *   GET /api/auth/google/callback       Google sends it back here with a one-time code
 *
 * Every outcome is a redirect to a page of the app (this is a browser navigation, not an API call): the dashboard when
 * it worked, the sign-in page with ?oauth=<reason> when it did not, or the sign-in page with the two-step challenge in
 * the URL fragment when the account has an authenticator app (a fragment is never sent to a server or written to a log).
 */
import pool from '../config/database.js';
import config from '../config/env.js';
import { cookieValue, setSessionCookie, signChallenge, signToken } from '../middleware/auth.js';
import { alertNewDevice, recordLogin } from '../modules/security.js';
import { beginGoogle, googleConfigured, identify, readState, STATE_COOKIE, stateMatches } from '../modules/oauth.js';

const cookieOptions = () => ({ httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/api/auth' });
const back = (res, reason) => { res.clearCookie(STATE_COOKIE, cookieOptions()); res.redirect(`/login?oauth=${reason}`); };

export const providers = (_req, res) => res.json({ success: true, data: { google: googleConfigured() } });

export const googleStart = (_req, res) => {
  if (!googleConfigured()) return res.redirect('/login?oauth=unavailable');
  const { url, cookie } = beginGoogle();
  res.cookie(STATE_COOKIE, cookie, { ...cookieOptions(), maxAge: 10 * 60 * 1000 });
  res.redirect(url);
};

export const googleCallback = async (req, res) => {
  if (!googleConfigured()) return back(res, 'unavailable');
  if (req.query.error) return back(res, 'cancelled');           // the person pressed Cancel on Google's page

  const saved = readState(cookieValue(req, STATE_COOKIE));
  if (!saved || !stateMatches(saved, req.query.state) || !req.query.code) return back(res, 'failed');

  let who;
  try {
    who = await identify({ code: String(req.query.code), verifier: saved.verifier, nonce: saved.nonce });
  } catch (error) {
    console.error('[oauth] google sign-in failed:', error.message);
    return back(res, 'failed');
  }
  if (!who.emailVerified) return back(res, 'unverified_google');

  try {
    const user = (await pool.query(
      `SELECT user_id, name, email, email_verified, is_super_admin, token_version, totp_enabled FROM users WHERE email = $1`, [who.email])).rows[0];
    if (!user) return back(res, 'no_account');                    // sign-up stays on the free-trial form
    if (user.is_super_admin) return back(res, 'not_allowed');     // the platform console has its own sign-in
    if (!user.email_verified) return back(res, 'verify_first');   // see modules/oauth.js: an unfinished sign-up is not ours to trust

    res.clearCookie(STATE_COOKIE, cookieOptions());
    // an account with an authenticator app still needs its code: Google proves the email, not the second step
    if (user.totp_enabled) return res.redirect(`/login#second=${encodeURIComponent(signChallenge(user))}`);

    const { newDevice } = await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'SUCCESS', method: 'GOOGLE' });
    if (newDevice) alertNewDevice(user, req);
    pool.query(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1`, [user.user_id]).catch(() => {});
    setSessionCookie(res, signToken(user));
    return res.redirect('/app');
  } catch (error) {
    console.error('[oauth] google sign-in failed:', error.message);
    return back(res, 'failed');
  }
};
