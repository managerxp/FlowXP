/*
 * Sign in with Google (OAuth 2.0 authorization code flow with PKCE, OpenID Connect), for people who ALREADY have a
 * FlowXP account: it is a second way to sign in, never a way to sign up (that stays on the free-trial form).
 *
 * What keeps it safe:
 *   - `state` ties the callback to the browser that started it, and `nonce` ties the ID token to this request; both,
 *     with the PKCE verifier, ride in a short-lived signed httpOnly cookie, so nothing is stored on the server.
 *   - the ID token comes straight from Google's token endpoint over TLS in exchange for our one-time code, so (as the
 *     OpenID spec allows) its claims are checked rather than its signature: issuer, audience, expiry, nonce, and
 *     that Google itself verified the email address.
 *   - the account is matched by that verified email, and only if the FlowXP account also verified its email (an
 *     unfinished sign-up could have been made by someone else with this address and a password of their choosing).
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import config from '../config/env.js';

export const STATE_COOKIE = 'flowxp_oauth';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const b64url = (buf) => buf.toString('base64url');

export const googleConfigured = () => Boolean(config.oauth.google.clientId && config.oauth.google.clientSecret);
export const redirectUri = () => config.oauth.google.redirectUri || `${config.appOrigin.replace(/\/$/, '')}/api/auth/google/callback`;

/** The address to send the browser to, and the signed cookie value that lets the callback prove it is the same browser. */
export const beginGoogle = () => {
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const params = new URLSearchParams({
    client_id: config.oauth.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  const cookie = jwt.sign({ purpose: 'oauth', state, nonce, verifier }, config.jwtSecret, { expiresIn: '10m', algorithm: 'HS256' });
  return { url: `${AUTH_URL}?${params}`, cookie };
};

/** Read the cookie back: { state, nonce, verifier }, or null when it is missing, forged or older than ten minutes. */
export const readState = (cookie) => {
  try {
    const p = jwt.verify(String(cookie ?? ''), config.jwtSecret, { algorithms: ['HS256'] });
    return p.purpose === 'oauth' ? p : null;
  } catch { return null; }
};

const sameText = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
export const stateMatches = (saved, fromQuery) => Boolean(saved?.state && fromQuery && sameText(saved.state, fromQuery));

/** Trade the one-time code for the person's identity: { email, emailVerified, name } or throws. */
export const identify = async ({ code, verifier, nonce }) => {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: config.oauth.google.clientId, client_secret: config.oauth.google.clientSecret,
      redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: verifier
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id_token) throw new Error(`Google refused the code (${payload.error || response.status})`);
  const claims = jwt.decode(payload.id_token);
  if (!claims) throw new Error('Google sent an unreadable ID token');
  if (!ISSUERS.includes(claims.iss)) throw new Error('ID token from the wrong issuer');
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(config.oauth.google.clientId)) throw new Error('ID token for another app');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('ID token has expired');
  if (!claims.nonce || !sameText(claims.nonce, nonce)) throw new Error('ID token nonce does not match');
  if (!claims.email) throw new Error('ID token has no email');
  return { email: String(claims.email).trim().toLowerCase(), emailVerified: claims.email_verified === true || claims.email_verified === 'true', name: claims.name || '' };
};
