/*
 * A member's QR credentials: the printed card and the phone pass.
 *
 * Printed card  `FXG1.<192-bit random token>`. The token is shown ONCE, when the card is made, so it can be printed; the database keeps only its
 *               SHA-256. A lost card is not looked up and reprinted: it is replaced (the old one stops working at once) with a new token.
 * Phone pass    `FXD1.<token>`. A signed-in member asks for one and gets a token that works for `pass_ttl_seconds` and once. The pass screen asks
 *               for a new one before the old one runs out, so a screenshot of it is worthless.
 *
 * Neither holds a name, a phone number, a plan or a database id. At most one live card and one live phone pass per member (a unique index says so).
 */
import { GymError, getSettings, randomToken, sha256 } from './common.js';
import { sweepPassTokens } from './access.js';

const lock = (db, businessId, memberId) => db.query('SELECT pg_advisory_xact_lock($1, $2)', [businessId, memberId]);

const memberOrFail = async (db, businessId, memberId) => {
  const m = (await db.query(`SELECT member_id, status FROM gym_members WHERE member_id = $1 AND business_id = $2`, [memberId, businessId])).rows[0];
  if (!m) throw new GymError(404, 'Not found');
  if (m.status === 'ARCHIVED') throw new GymError(409, 'This member is archived');
  return m;
};

const publicCredential = (c) => ({
  credential_id: c.credential_id, member_id: c.member_id, kind: c.kind, status: c.status, issued_at: c.issued_at, revoked_at: c.revoked_at,
  revoke_reason: c.revoke_reason, last_used_at: c.last_used_at, expires_at: c.expires_at
});

export const listCredentials = async (db, businessId, memberId) =>
  (await db.query(`SELECT * FROM gym_credentials WHERE business_id = $1 AND member_id = $2 ORDER BY issued_at DESC, credential_id DESC LIMIT 50`, [businessId, memberId])).rows.map(publicCredential);

/**
 * Make a new printed card, replacing the member's current one. Returns { credential, code }: `code` is the text to put in the QR and is
 * not recoverable afterwards. Call inside a transaction.
 */
export const issueCard = async (db, { businessId, memberId, userId, reason = null, expiresAt = null }) => {
  await lock(db, businessId, memberId);
  await memberOrFail(db, businessId, memberId);
  const old = (await db.query(`SELECT credential_id FROM gym_credentials WHERE business_id = $1 AND member_id = $2 AND kind = 'CARD' AND status = 'ACTIVE' FOR UPDATE`, [businessId, memberId])).rows[0];
  if (old) await db.query(`UPDATE gym_credentials SET status = 'REPLACED', revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE credential_id = $1`, [old.credential_id, userId, reason ? String(reason).slice(0, 200) : 'Replaced']);
  const token = randomToken(24);
  const created = (await db.query(
    `INSERT INTO gym_credentials (business_id, member_id, kind, token_hash, issued_by, expires_at) VALUES ($1,$2,'CARD',$3,$4,$5) RETURNING *`,
    [businessId, memberId, sha256(token), userId, expiresAt])).rows[0];
  if (old) await db.query(`UPDATE gym_credentials SET replaced_by = $2 WHERE credential_id = $1`, [old.credential_id, created.credential_id]);
  return { credential: publicCredential(created), code: `FXG1.${token}`, replaced: old?.credential_id ?? null };
};

/** Stop a credential working. Revoking is final: to let the member in again, issue a new one. */
export const revoke = async (db, { businessId, credentialId, userId, reason }) => {
  const c = (await db.query(`SELECT * FROM gym_credentials WHERE credential_id = $1 AND business_id = $2 FOR UPDATE`, [credentialId, businessId])).rows[0];
  if (!c) throw new GymError(404, 'Not found');
  if (c.status !== 'ACTIVE') return publicCredential(c);
  const r = (await db.query(
    `UPDATE gym_credentials SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE credential_id = $1 RETURNING *`,
    [credentialId, userId, reason ? String(reason).slice(0, 200) : null])).rows[0];
  return publicCredential(r);
};

/** Stop every credential a member holds (an archived or merged member, a lost phone). */
export const revokeAll = async (db, { businessId, memberId, userId = null, reason }) =>
  (await db.query(
    `UPDATE gym_credentials SET status = 'REVOKED', revoked_at = now(), revoked_by = $3, revoke_reason = $4 WHERE business_id = $1 AND member_id = $2 AND status = 'ACTIVE'`,
    [businessId, memberId, userId, String(reason || '').slice(0, 200) || null])).rowCount;

/** A fresh phone pass token for a member: { code, expires_at, ttl }. Makes the member's digital credential if they have none live. */
export const issuePass = async (db, { businessId, memberId, now = new Date() }) => {
  await lock(db, businessId, memberId);
  await memberOrFail(db, businessId, memberId);
  const settings = await getSettings(db, businessId);
  let cred = (await db.query(`SELECT * FROM gym_credentials WHERE business_id = $1 AND member_id = $2 AND kind = 'DIGITAL' AND status = 'ACTIVE'`, [businessId, memberId])).rows[0];
  if (!cred) cred = (await db.query(`INSERT INTO gym_credentials (business_id, member_id, kind) VALUES ($1,$2,'DIGITAL') RETURNING *`, [businessId, memberId])).rows[0];
  // a member asking again and again does not pile up rows: spent and expired tokens go, and no more than a few unused ones stay
  await db.query(`DELETE FROM gym_pass_tokens WHERE credential_id = $1 AND (used_at IS NOT NULL OR expires_at < $2)`, [cred.credential_id, now]);
  await db.query(
    `DELETE FROM gym_pass_tokens WHERE credential_id = $1 AND token_hash NOT IN (SELECT token_hash FROM gym_pass_tokens WHERE credential_id = $1 ORDER BY created_at DESC LIMIT 4)`, [cred.credential_id]);
  const token = randomToken(24);
  const expires = new Date(now.getTime() + settings.pass_ttl_seconds * 1000);
  await db.query(`INSERT INTO gym_pass_tokens (token_hash, business_id, credential_id, expires_at) VALUES ($1,$2,$3,$4)`, [sha256(token), businessId, cred.credential_id, expires]);
  sweepPassTokens();
  return { code: `FXD1.${token}`, expires_at: expires.toISOString(), ttl_seconds: settings.pass_ttl_seconds };
};
