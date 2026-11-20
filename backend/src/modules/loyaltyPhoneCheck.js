/*
 * "Check the mobile number" for scan-the-bill claims. The customer proves the number is theirs with a one-time WhatsApp code, ONCE: the right code
 * also gives their phone a long-lived proof for that number, so later scans from the same phone skip the code. A new phone or a different number is asked again.
 *
 * Codes are 6 digits, kept only as a keyed hash, valid 10 minutes, five tries, a few per hour per number. Proofs are random, kept only as a hash.
 * The code goes out on FlowXP's own WhatsApp number as the free 'OTP' message kind, so it costs the business nothing.
 */
import crypto from 'node:crypto';
import config from '../config/env.js';
import { channelsAvailable, deliver } from './messaging/provider.js';
import { render } from './messaging/templates.js';
import { LoyaltyError } from './loyaltyEngine.js';

export const CODE_MINUTES = 10, MAX_TRIES = 5, PER_HOUR = 5, GAP_SECONDS = 30, PROOF_DAYS = 365;
const hash = (kind, value) => crypto.createHmac('sha256', config.jwtSecret).update(`loyalty-phone-${kind}:${value}`).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The channel a code can go on, or null when no provider is connected (the check is then skipped and the claim counts as unverified). */
export const channel = async () => { const c = await channelsAvailable(); return c.includes('WHATSAPP') ? 'WHATSAPP' : c.includes('SMS') ? 'SMS' : null; };

const proofValid = async (db, phone, proof, now) => {
  if (typeof proof !== 'string' || proof.length < 20 || proof.length > 100) return false;
  return (await db.query(`SELECT 1 FROM loyalty_phone_proofs WHERE phone_key = $1 AND token_hash = $2 AND expires_at > $3::timestamptz`, [phone, hash('proof', proof), now])).rows.length > 0;
};

const sendCode = async (db, phone, business, now) => {
  const recent = (await db.query(`SELECT COUNT(*)::int AS n, MAX(created_at) AS last FROM loyalty_phone_codes WHERE phone_key = $1 AND created_at > $2::timestamptz - interval '1 hour'`, [phone, now])).rows[0];
  if (recent.n >= PER_HOUR || (recent.last && (now - new Date(recent.last)) / 1000 < GAP_SECONDS)) return;   // quietly: the code already sent is still good
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await db.query(`UPDATE loyalty_phone_codes SET consumed_at = $2 WHERE phone_key = $1 AND consumed_at IS NULL`, [phone, now]);
  await db.query(`INSERT INTO loyalty_phone_codes (phone_key, code_hash, expires_at, created_at) VALUES ($1,$2,$3,$4)`, [phone, hash('code', `${phone}:${code}`), new Date(now.getTime() + CODE_MINUTES * 60000), now]);
  const message = render('OTP', { business, code });
  try { await deliver({ channel: await channel(), to: `${config.messaging.countryCode}${phone}`, kind: 'OTP', text: message.text, template: message.template }); }
  catch (e) { console.error('[loyalty] phone code not sent:', e.message); throw new LoyaltyError('We could not send the code. Try again in a moment.', 503); }
};

const useCode = async (db, phone, given, now) => {
  const row = (await db.query(   // the try is counted before the comparison, so a wrong guess is not free
    `UPDATE loyalty_phone_codes SET attempts = attempts + 1
     WHERE code_id = (SELECT code_id FROM loyalty_phone_codes WHERE phone_key = $1 AND consumed_at IS NULL AND expires_at > $2::timestamptz AND attempts < $3 ORDER BY created_at DESC LIMIT 1 FOR UPDATE)
     RETURNING code_id, code_hash`, [phone, now, MAX_TRIES])).rows[0];
  if (!row || !same(row.code_hash, hash('code', `${phone}:${given}`))) return false;
  return (await db.query(`UPDATE loyalty_phone_codes SET consumed_at = $2 WHERE code_id = $1 AND consumed_at IS NULL RETURNING code_id`, [row.code_id, now])).rows.length > 0;
};

/**
 * Proves `phone` for this scan. Returns { proof } when proven (a fresh proof after a right code; the same one when it was still good).
 * Throws 428 after sending a code (the page shows the code box), 400 for a wrong or old code.
 */
export const prove = async (db, { phone, business, code = '', proof = '', now = new Date() }) => {
  if (await proofValid(db, phone, proof, now)) return { proof };
  const given = String(code || '').trim();
  if (given) {
    if (!/^\d{6}$/.test(given) || !(await useCode(db, phone, given, now))) throw new LoyaltyError('That code is not right or has expired. Ask for a new one', 400);
    const fresh = crypto.randomBytes(32).toString('base64url');
    await db.query(`INSERT INTO loyalty_phone_proofs (phone_key, token_hash, expires_at) VALUES ($1,$2,$3)`, [phone, hash('proof', fresh), new Date(now.getTime() + PROOF_DAYS * 86400000)]);
    return { proof: fresh };
  }
  await sendCode(db, phone, business, now);
  throw new LoyaltyError('We sent a code to your WhatsApp. Enter it to add your stamp.', 428);
};
