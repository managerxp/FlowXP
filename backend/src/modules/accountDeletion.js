/*
 * Deleting a person's account (see migrations/0081_account_deletion.js for the rules).
 *
 *   soleOwnerOf(db, userId)         the businesses this person is the only active owner of; while there are any, they cannot just leave
 *   anonymiseUser(client, userId)   wipe the person's details and sessions and remove them from every business
 *   openRequest(...)                a request for support to act on
 */
import crypto from 'node:crypto';
import pool from '../config/database.js';

export const soleOwnerOf = async (db, userId) => (await db.query(
  `SELECT b.business_id, b.name FROM business_users bu JOIN businesses b ON b.business_id = bu.business_id
   WHERE bu.user_id = $1 AND bu.role = 'OWNER' AND bu.status = 'ACTIVE' AND b.status <> 'CLOSED'
     AND NOT EXISTS (SELECT 1 FROM business_users o WHERE o.business_id = bu.business_id AND o.role = 'OWNER' AND o.status = 'ACTIVE' AND o.user_id <> bu.user_id)`,
  [userId])).rows;

/** Wipes who this person was. The row stays (old bills point to it) but holds nothing about them; their sessions end because the token version moves on. */
export const anonymiseUser = async (client, userId) => {
  const unusable = `!${crypto.randomBytes(24).toString('hex')}`;   // not a bcrypt hash of anything: no password can ever match it
  await client.query(
    `UPDATE users SET name = 'Former team member', email = $2, phone = NULL, password_hash = $3, email_verified = FALSE, is_super_admin = FALSE,
            totp_enabled = FALSE, totp_secret_enc = NULL, totp_pending_enc = NULL, totp_last_step = NULL, totp_enabled_at = NULL,
            email_otp_hash = NULL, email_otp_expires_at = NULL, approval_pin_hash = NULL, approval_pin_set_at = NULL,
            token_version = token_version + 1, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND is_super_admin = FALSE`,
    [userId, `deleted-${userId}@deleted.flowxp.invalid`, unusable]);
  await client.query(`UPDATE business_users SET status = 'DISABLED' WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM push_devices WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM notifications WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM notification_preferences WHERE user_id = $1`, [userId]);
};

export const openRequest = async ({ userId = null, email, source = 'WEBSITE', note = null }, db = pool) =>
  (await db.query(
    `INSERT INTO deletion_requests (user_id, email, source, note) VALUES ($1,$2,$3,$4) RETURNING request_id`,
    [userId, String(email).slice(0, 255), source, note ? String(note).slice(0, 1000) : null])).rows[0].request_id;
