/*
 * Sign-in security in one place: authenticator-app codes (TOTP, RFC 6238), recovery codes, the record of every
 * sign-in attempt, and the lockout after repeated failures.
 *
 * TOTP is built on Node's crypto (HMAC-SHA1, 30-second steps, 6 digits, one step of clock drift allowed either
 * way), which every authenticator app speaks. A code that has been used is refused, so it can't be replayed
 * within its window. Secrets are stored encrypted, so a copy of the database alone does not hand out the codes.
 */
import crypto from 'node:crypto';
import { sendMail } from './mailer.js';
import { encrypt, decrypt } from './crypto.js';

/* ── TOTP ───────────────────────────────────────────────────────────────── */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const toBase32 = (buf) => {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};
export const fromBase32 = (text) => {
  let bits = 0; let value = 0; const out = [];
  for (const ch of String(text).toUpperCase().replace(/[^A-Z2-7]/g, '')) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
};

export const newSecret = () => toBase32(crypto.randomBytes(20));

const hotp = (key, counter, digits = 6) => {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[19] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
};

export const STEP_SECONDS = 30;
export const totpNow = (secret, now = Date.now()) => hotp(fromBase32(secret), Math.floor(now / 1000 / STEP_SECONDS));

/** The step number the code belongs to (so it can be remembered and never reused), or null when it is wrong or already used. */
export const verifyTotp = (secret, code, { now = Date.now(), lastStep = null } = {}) => {
  const given = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const key = fromBase32(secret);
  const step = Math.floor(now / 1000 / STEP_SECONDS);
  for (const drift of [0, -1, 1]) {
    const s = step + drift;
    if (lastStep != null && s <= Number(lastStep)) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(given))) return s;
  }
  return null;
};

export const otpauthUrl = ({ secret, email, issuer = 'FlowXP' }) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

/* ── encrypting the secret ──────────────────────────────────────────────── */

export const encryptSecret = (plain) => encrypt(plain, 'flowxp-2fa');
export const decryptSecret = (stored) => decrypt(stored, 'flowxp-2fa');

/* ── recovery codes ─────────────────────────────────────────────────────── */

const hashCode = (code) => crypto.createHash('sha256').update(String(code).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

export const newRecoveryCodes = (n = 10) => Array.from({ length: n }, () => { const c = toBase32(crypto.randomBytes(7)).toLowerCase().slice(0, 10); return `${c.slice(0, 5)}-${c.slice(5)}`; });

/** Replace the user's recovery codes with a fresh set; returns the codes (shown once, only hashes are kept). */
export const issueRecoveryCodes = async (db, userId) => {
  const codes = newRecoveryCodes();
  await db.query(`DELETE FROM recovery_codes WHERE user_id = $1`, [userId]);
  for (const c of codes) await db.query(`INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1,$2)`, [userId, hashCode(c)]);
  return codes;
};

/** Spend one recovery code. True when it was valid and unused. */
export const useRecoveryCode = async (db, userId, code) => {
  const { rowCount } = await db.query(
    `UPDATE recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE code_id = (SELECT code_id FROM recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL LIMIT 1)`,
    [userId, hashCode(code)]);
  return rowCount === 1;
};
export const recoveryCodesLeft = async (db, userId) => Number((await db.query(`SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [userId])).rows[0].n);

/* ── the record of sign-ins, and lockout ────────────────────────────────── */

export const LOCK_AFTER = 5;
export const LOCK_MINUTES = 15;

/** Record one attempt. For a success, says whether it came from a device this person hasn't signed in from before. */
export const recordLogin = async (db, { userId = null, email, req, outcome, method = null }) => {
  const ua = String(req?.headers?.['user-agent'] ?? '').slice(0, 200);
  let newDevice = false;
  if (outcome === 'SUCCESS' && userId) {
    const seen = (await db.query(`SELECT COUNT(*) FILTER (WHERE user_agent = $2)::int AS same, COUNT(*)::int AS any FROM login_events WHERE user_id = $1 AND outcome = 'SUCCESS'`, [userId, ua])).rows[0];
    newDevice = seen.any > 0 && seen.same === 0;          // the very first sign-in is not "new"
  }
  await db.query(
    `INSERT INTO login_events (user_id, email, outcome, method, ip, user_agent, new_device) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [userId, String(email).toLowerCase().slice(0, 160), outcome, method, String(req?.ip ?? '').slice(0, 64) || null, ua || null, newDevice]
  );
  return { newDevice };
};

/** Minutes left on a lockout (the address has failed too many times recently), or 0. A success clears the count. */
export const lockedMinutes = async (db, email, now = Date.now()) => {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS fails, MAX(created_at) AS last
     FROM login_events
     WHERE email = $1 AND outcome IN ('BAD_PASSWORD','UNKNOWN_USER','TWO_FACTOR_FAILED','EMAIL_OTP_FAILED','PASSWORD_RESET_FAILED')
       AND created_at > GREATEST(
             CURRENT_TIMESTAMP - make_interval(mins => $2::int),
             COALESCE((SELECT MAX(created_at) FROM login_events WHERE email = $1 AND outcome = 'SUCCESS'), '-infinity'))`,
    [String(email).toLowerCase(), LOCK_MINUTES]);
  if (rows[0].fails < LOCK_AFTER) return 0;
  const until = new Date(rows[0].last).getTime() + LOCK_MINUTES * 60000;
  return Math.max(1, Math.ceil((until - now) / 60000));
};

/** Tell the person their account was just used from somewhere new (never blocks the sign-in). */
export const alertNewDevice = (user, req) => {
  const ua = String(req?.headers?.['user-agent'] ?? 'an unknown device').slice(0, 120);
  sendMail({
    to: user.email,
    subject: 'New sign-in to your FlowXP account',
    text: `Hi ${user.name},\n\nYour FlowXP account was just signed in to from a device we haven't seen before.\n\nDevice: ${ua}\nAddress: ${req?.ip ?? 'unknown'}\nTime: ${new Date().toUTCString()}\n\nIf this was you, there is nothing to do. If it wasn't, sign in, open Security, choose "Sign out everywhere" and change your password.`
  }).catch(() => {});
};
