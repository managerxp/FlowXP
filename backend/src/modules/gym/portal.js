/*
 * The member's own web access: sign in with a phone code, a session, and the gym's public addresses.
 *
 * A member is not a user of the business's app. They prove they hold their registered phone (a 6-digit code sent to it) and get a session cookie that
 * reaches only their own pass, attendance and bookings. The code and the session token are random; only a hash of each is stored.
 *
 * What an attacker is up against:
 *   guessing a code      5 tries per code, a code lives 10 minutes, and a new code replaces the old one (so the tries do not add up);
 *   finding who is a member   the answer to "send me a code" is the same for every number, member or not;
 *   spamming a member's phone   one code a minute and a few an hour per number, plus a limit per address at the router;
 *   replaying a session   it can be ended by the member or the gym, and it expires.
 */
import crypto from 'node:crypto';
import pool from '../../config/database.js';
import config from '../../config/env.js';
import { channelsAvailable, deliver } from '../messaging/provider.js';
import { render } from '../messaging/templates.js';
import { GymError, SQL_PHONE_KEY, getBranchSettings, getSettings, localParts, phoneKey, randomToken, safeEqual, sha256 } from './common.js';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_TRIES = 5;
const OTP_GAP_SECONDS = 60;
const OTP_PER_HOUR = 5;

/* ── the gym behind an address ────────────────────────────────────────────────────────────── */

const GYM_SQL = `
  SELECT b.business_id, b.name, b.status, b.business_type, b.receipt_settings->>'logo_url' AS logo_url,
         s.public_slug, s.self_checkin_enabled, s.self_checkin_daily_code, s.session_days,
         COALESCE(p.feature_flags, '{}'::jsonb) AS plan_feature_flags, btf.feature_flags AS type_feature_flags,
         COALESCE(bfo.overrides, '{}'::jsonb) AS feature_overrides`;
const GYM_FROM = `
  FROM gym_settings s JOIN businesses b ON b.business_id = s.business_id
  LEFT JOIN plans p ON p.plan_code = b.plan_code
  LEFT JOIN business_type_features btf ON btf.business_type = b.business_type AND btf.plan_code = b.plan_code
  LEFT JOIN LATERAL (SELECT jsonb_object_agg(feature_key, enabled) AS overrides FROM business_feature_overrides
                     WHERE business_id = b.business_id AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)) bfo ON true`;

/** Is the member web feature on for this business? Plan, business type and per-business override, the same three gates as everywhere. */
export const portalEnabled = async (row, feature = 'gym_self_checkin') => {
  const { effectiveFeatureFlags, hasPlanFeature } = await import('../planFeatures.js');
  const flags = effectiveFeatureFlags([row.plan_feature_flags, row.type_feature_flags], row.feature_overrides, row.business_type);
  return hasPlanFeature({ planFeatures: flags }, feature);
};

const usable = async (row) => (row && row.business_type === 'GYM' && row.status === 'ACTIVE' && await portalEnabled(row)) ? row : null;

export const gymBySlug = async (slug) => usable((await pool.query(`${GYM_SQL} ${GYM_FROM} WHERE lower(s.public_slug) = lower($1)`, [String(slug || '').slice(0, 40)])).rows[0]);
export const gymById = async (businessId) => usable((await pool.query(`${GYM_SQL} ${GYM_FROM} WHERE s.business_id = $1`, [businessId])).rows[0]);

/** The outlet an entrance QR points at, and its gym. Null when the token is unknown (a rotated poster). */
export const byCheckinToken = async (token) => {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(t)) return null;
  const row = (await pool.query(
    `${GYM_SQL}, bs.branch_id, br.name AS branch_name, br.status AS branch_status ${GYM_FROM} JOIN gym_branch_settings bs ON bs.business_id = b.business_id JOIN branches br ON br.branch_id = bs.branch_id
     WHERE bs.checkin_token = $1`, [t])).rows[0];
  if (!row || row.branch_status !== 'ACTIVE') return null;
  return usable(row);
};

/** Today's code for an outlet: four digits that change at the gym's midnight, shown at the front desk. */
export const dailyCode = (checkinToken, date) => {
  const mac = crypto.createHmac('sha256', config.jwtSecret).update(`gym-daily:${checkinToken}:${date}`).digest();
  return String(mac.readUInt32BE(0) % 10000).padStart(4, '0');
};

export const todaysCode = async (businessId, branchId, at = new Date()) => {
  const bs = await getBranchSettings(pool, businessId, branchId);
  return dailyCode(bs.checkin_token, (await localParts(pool, businessId, at)).date);
};

/* ── sign-in codes ────────────────────────────────────────────────────────────────────────── */

const codeHash = (businessId, key, code) => crypto.createHmac('sha256', config.jwtSecret).update(`gym-otp:${businessId}:${key}:${code}`).digest('hex');

/** Send the member's phone a code, if it belongs to a member. Always returns the same, so the caller learns nothing about who is a member. */
export const requestCode = async (gym, phone, { now = new Date() } = {}) => {
  const key = phoneKey(phone);
  if (key.length < 10) return { sent: true };
  const people = (await pool.query(
    `SELECT gm.member_id FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id
     WHERE gm.business_id = $1 AND gm.status <> 'ARCHIVED' AND ${SQL_PHONE_KEY('c.phone')} = $2 ORDER BY gm.member_id LIMIT 1`, [gym.business_id, key])).rows;
  if (!people.length) return { sent: true };
  const recent = (await pool.query(
    `SELECT COUNT(*)::int AS n, MAX(created_at) AS last FROM gym_member_otps WHERE business_id = $1 AND phone_key = $2 AND created_at > $3::timestamptz - interval '1 hour'`, [gym.business_id, key, now])).rows[0];
  if (recent.n >= OTP_PER_HOUR) return { sent: true };
  if (recent.last && (now - new Date(recent.last)) / 1000 < OTP_GAP_SECONDS) return { sent: true };
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await pool.query(`UPDATE gym_member_otps SET consumed_at = $3 WHERE business_id = $1 AND phone_key = $2 AND consumed_at IS NULL`, [gym.business_id, key, now]);
  await pool.query(
    `INSERT INTO gym_member_otps (business_id, member_id, phone_key, code_hash, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [gym.business_id, people[0].member_id, key, codeHash(gym.business_id, key, code), new Date(now.getTime() + OTP_TTL_MINUTES * 60000), now]);
  // handed to the provider and forgotten: not awaited by the caller, never stored, never logged
  sendCode(gym, phone, code).catch((error) => console.error('[gym] sign-in code not sent:', error.message));
  return { sent: true };
};

const sendCode = async (gym, phone, code) => {
  const channels = await channelsAvailable();
  const channel = channels.includes('SMS') ? 'SMS' : channels[0];
  if (!channel) throw new Error('no messaging provider is set up');
  const message = render('GYM_OTP', { business: gym.name, code });
  const digits = String(phone).replace(/\D/g, '');
  await deliver({ channel, to: digits.length === 10 ? `${config.messaging.countryCode}${digits}` : digits, kind: 'GYM_OTP', text: message.text, template: message.template });
};

/**
 * Check a code. On success the code is used up and a session is made. Every failure is the same answer.
 * Returns { token, session } (the token goes in the cookie; only its hash is kept).
 */
export const verifyCode = async (gym, phone, code, { now = new Date() } = {}) => {
  const fail = () => new GymError(400, 'That code is not right or has expired. Ask for a new one');
  const key = phoneKey(phone);
  const given = String(code ?? '').trim();
  if (key.length < 10 || !/^\d{6}$/.test(given)) throw fail();
  // one attempt is counted before the comparison, so a wrong guess cannot be retried for free
  const row = (await pool.query(
    `UPDATE gym_member_otps SET attempts = attempts + 1
     WHERE otp_id = (SELECT otp_id FROM gym_member_otps WHERE business_id = $1 AND phone_key = $2 AND consumed_at IS NULL AND expires_at > $3::timestamptz AND attempts < $4 ORDER BY created_at DESC LIMIT 1 FOR UPDATE)
     RETURNING otp_id, member_id, code_hash`, [gym.business_id, key, now, OTP_MAX_TRIES])).rows[0];
  if (!row || !safeEqual(row.code_hash, codeHash(gym.business_id, key, given))) throw fail();
  const used = await pool.query(`UPDATE gym_member_otps SET consumed_at = $2 WHERE otp_id = $1 AND consumed_at IS NULL RETURNING otp_id`, [row.otp_id, now]);
  if (!used.rows.length) throw fail();
  const settings = await getSettings(pool, gym.business_id);
  const token = randomToken(32);
  await pool.query(
    `INSERT INTO gym_member_sessions (token_hash, business_id, member_id, phone_key, otp_verified_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [sha256(token), gym.business_id, row.member_id, key, now, new Date(now.getTime() + settings.session_days * 86400000)]);
  return { token, days: settings.session_days };
};

/** A session from its cookie value, or null. Also names the members on that phone number. */
export const readSession = async (token, { now = new Date() } = {}) => {
  if (!token || typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const s = (await pool.query(
    `SELECT s.*, b.name AS business_name FROM gym_member_sessions s JOIN businesses b ON b.business_id = s.business_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2::timestamptz AND b.status = 'ACTIVE'`, [sha256(token), now])).rows[0];
  if (!s) return null;
  const members = (await pool.query(
    `WITH base AS (SELECT gm.member_id FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id
                   WHERE gm.business_id = $1 AND gm.status <> 'ARCHIVED' AND ${SQL_PHONE_KEY('c.phone')} = $2)
     SELECT gm.member_id, gm.member_code, gm.status, c.name FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id
     WHERE gm.business_id = $1 AND gm.status <> 'ARCHIVED'
       AND (gm.member_id IN (SELECT member_id FROM base) OR gm.head_member_id IN (SELECT member_id FROM base) OR gm.member_id = $3) ORDER BY gm.member_id`, [s.business_id, s.phone_key, s.member_id])).rows;
  const active = members.find((m) => m.member_id === s.member_id) || members[0];
  if (!active) return null;
  return { ...s, members, active_member_id: active.member_id };
};

export const endSession = (token) => pool.query(`UPDATE gym_member_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sha256(String(token || ''))]);

/** End every session of a member (a lost phone, an archived member). */
export const endMemberSessions = (db, businessId, memberId) =>
  db.query(`UPDATE gym_member_sessions SET revoked_at = now() WHERE business_id = $1 AND member_id = $2 AND revoked_at IS NULL`, [businessId, memberId]);

export const switchMember = async (token, memberId, session) => {
  if (!session.members.some((m) => m.member_id === Number(memberId))) throw new GymError(404, 'Not found');
  await pool.query(`UPDATE gym_member_sessions SET member_id = $2 WHERE token_hash = $1`, [sha256(token), Number(memberId)]);
};

/** Ends sessions and unused codes older than a day. Cheap, and run as people sign in. */
export const sweepSessions = () =>
  pool.query(`DELETE FROM gym_member_otps WHERE created_at < now() - interval '1 day'`).then(() =>
    pool.query(`DELETE FROM gym_member_sessions WHERE expires_at < now() - interval '1 day' OR revoked_at < now() - interval '30 days'`)).catch(() => {});
