/*
 * Email OTP verification, for the first sign-in on a new account.
 *
 * Reuses the account's own row for the pending code (one row, nothing to clean up — the same reasoning
 * password_resets would need a whole table for, except an OTP never needs history, only the current one) and
 * reuses the existing login lockout mechanism (login_events + lockedMinutes in modules/security.js) for
 * brute-force protection, rather than a second attempts counter next to it.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE users ADD COLUMN email_otp_hash CHAR(64)`);
  await client.query(`ALTER TABLE users ADD COLUMN email_otp_expires_at TIMESTAMPTZ`);

  await client.query(`ALTER TABLE login_events DROP CONSTRAINT IF EXISTS login_events_outcome_check`);
  await client.query(`
    ALTER TABLE login_events ADD CONSTRAINT login_events_outcome_check
      CHECK (outcome IN ('SUCCESS','BAD_PASSWORD','UNKNOWN_USER','LOCKED','TWO_FACTOR_FAILED','EMAIL_OTP_FAILED'))
  `);
};
