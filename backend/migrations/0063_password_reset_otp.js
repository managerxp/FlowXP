/*
 * Password reset moves from an emailed link to an emailed 6-digit code, entered on the same screen that
 * asked for it (no separate page to land on, same shape as the email-verification step in
 * 0062_email_otp.js). The password_resets table itself needs no schema change — token_hash already just
 * holds a SHA-256 hex digest, and a 6-digit code hashes into exactly the same column a 32-byte token did.
 *
 * What a 6-digit code DOES need that a 32-byte token didn't: brute-force protection beyond "it's long
 * enough to never guess" — this widens the same login-lockout mechanism (login_events + lockedMinutes in
 * modules/security.js) that already covers bad passwords and bad 2FA/email-OTP codes.
 */
export const up = async (client) => {
  // 'PASSWORD_RESET_FAILED' is 21 characters — one past the column's original VARCHAR(20) limit, so the
  // column itself has to widen, not just the CHECK constraint naming the value.
  await client.query(`ALTER TABLE login_events ALTER COLUMN outcome TYPE VARCHAR(24)`);
  await client.query(`ALTER TABLE login_events DROP CONSTRAINT IF EXISTS login_events_outcome_check`);
  await client.query(`
    ALTER TABLE login_events ADD CONSTRAINT login_events_outcome_check
      CHECK (outcome IN ('SUCCESS','BAD_PASSWORD','UNKNOWN_USER','LOCKED','TWO_FACTOR_FAILED','EMAIL_OTP_FAILED','PASSWORD_RESET_FAILED'))
  `);
};
