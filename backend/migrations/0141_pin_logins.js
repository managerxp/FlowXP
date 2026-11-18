/*
 * PIN sign-in on a known computer (owner, 2026-11-18). After one sign-in with the password, a person can set a 4-digit PIN for this computer;
 * from then on they pick their name and type the PIN.
 *  - The computer is known by a random device key in an httpOnly cookie; only its SHA-256 is stored (device_hash), so the table alone opens nothing.
 *  - The PIN is stored as a bcrypt hash per person per computer, checked only on the server.
 *  - token_version is copied from the person: a password change or "sign out everywhere" raises it, which ends every PIN they set.
 *  - 5 wrong PINs in a row revoke it; after 90 days unused it expires. Either way the password is needed again.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS pin_logins (
      pin_login_id SERIAL PRIMARY KEY,
      device_hash CHAR(64) NOT NULL,
      user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      pin_hash TEXT NOT NULL,
      token_version INT NOT NULL,
      device_label VARCHAR(120),
      failed_attempts INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TIMESTAMPTZ,
      UNIQUE (device_hash, user_id)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_pin_logins_user ON pin_logins (user_id)`);
  // a wrong PIN is logged as its own outcome: it does not count towards locking the password (the PIN has its own five tries)
  await client.query(`ALTER TABLE login_events DROP CONSTRAINT IF EXISTS login_events_outcome_check`);
  await client.query(`ALTER TABLE login_events ADD CONSTRAINT login_events_outcome_check CHECK (outcome IN ('SUCCESS','BAD_PASSWORD','UNKNOWN_USER','LOCKED','TWO_FACTOR_FAILED','EMAIL_OTP_FAILED','PASSWORD_RESET_FAILED','BAD_PIN'))`);
};
