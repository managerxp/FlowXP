/*
 * Sign-in security: a record of every sign-in attempt, two-step verification (an authenticator app, with recovery
 * codes), a way to end every session at once, and an owner switch that requires two-step verification for owners
 * and admins.
 *
 * login_events deliberately has no foreign key to users: a failed attempt for an address that isn't an account
 * still belongs in the record, and the insert must never lock a users row that a sign-in is holding.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`);          // raising it ends every session
  await client.query(`ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE users ADD COLUMN totp_secret_enc TEXT`);                                // AES-GCM, never the plain secret
  await client.query(`ALTER TABLE users ADD COLUMN totp_pending_enc TEXT`);                               // set up but not yet confirmed
  await client.query(`ALTER TABLE users ADD COLUMN totp_last_step BIGINT`);                               // a code can't be used twice
  await client.query(`ALTER TABLE users ADD COLUMN totp_enabled_at TIMESTAMPTZ`);

  await client.query(`
    CREATE TABLE recovery_codes (
      code_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      code_hash CHAR(64) NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_recovery_codes_user ON recovery_codes (user_id) WHERE used_at IS NULL`);

  await client.query(`
    CREATE TABLE login_events (
      event_id BIGSERIAL PRIMARY KEY,
      user_id INTEGER,
      email VARCHAR(160) NOT NULL,
      outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('SUCCESS','BAD_PASSWORD','UNKNOWN_USER','LOCKED','TWO_FACTOR_FAILED')),
      method VARCHAR(10),                                   -- PASSWORD, 2FA or RECOVERY for a success
      ip VARCHAR(64),
      user_agent VARCHAR(200),
      new_device BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_login_events_user ON login_events (user_id, created_at DESC)`);
  await client.query(`CREATE INDEX idx_login_events_email ON login_events (email, created_at DESC)`);

  await client.query(`ALTER TABLE businesses ADD COLUMN require_2fa_admins BOOLEAN NOT NULL DEFAULT FALSE`);
};
