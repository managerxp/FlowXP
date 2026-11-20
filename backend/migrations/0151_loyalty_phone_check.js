/* "Check the mobile number" on scan-the-bill claims: one-time WhatsApp codes, and a proof kept on the customer's phone so the code is asked once, not every scan. */
export const up = async (client) => {
  await client.query(`CREATE TABLE loyalty_phone_codes (
    code_id BIGSERIAL PRIMARY KEY,
    phone_key VARCHAR(10) NOT NULL,
    code_hash CHAR(64) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE INDEX loyalty_phone_codes_phone ON loyalty_phone_codes (phone_key, created_at DESC)`);
  await client.query(`CREATE TABLE loyalty_phone_proofs (
    proof_id BIGSERIAL PRIMARY KEY,
    phone_key VARCHAR(10) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE INDEX loyalty_phone_proofs_phone ON loyalty_phone_proofs (phone_key)`);
};
