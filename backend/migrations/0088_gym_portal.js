/*
 * The gym module, part 2: the member's own web access.
 *
 *   gym_pass_tokens     the short-lived, single-use tokens behind a phone pass QR (only a hash is kept; a token works once and for a minute)
 *   gym_member_otps     one-time codes sent to a member's phone to sign them in (only a hash is kept; limited sends and tries)
 *   gym_member_sessions a signed-in member's browser session (only a hash of the cookie value is kept; can be ended from either side)
 *
 * Members are not users of the business's app: they have no business_users row and can reach nothing but their own pass, attendance and bookings.
 * Forward only. To undo by hand: drop these three tables.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE gym_pass_tokens (
      token_hash CHAR(64) PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      credential_id INTEGER NOT NULL REFERENCES gym_credentials(credential_id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_gym_pass_tokens_expiry ON gym_pass_tokens (expires_at)`);

  await client.query(`
    CREATE TABLE gym_member_otps (
      otp_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      phone_key VARCHAR(15) NOT NULL,
      code_hash CHAR(64) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts SMALLINT NOT NULL DEFAULT 0,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_gym_otps_phone ON gym_member_otps (business_id, phone_key, created_at DESC)`);

  await client.query(`
    CREATE TABLE gym_member_sessions (
      token_hash CHAR(64) PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      -- the member the session is acting as; it may switch to any other live member on the same phone number (a couple, a parent and child)
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      phone_key VARCHAR(15) NOT NULL,
      otp_verified_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_gym_sessions_member ON gym_member_sessions (member_id)`);
};
