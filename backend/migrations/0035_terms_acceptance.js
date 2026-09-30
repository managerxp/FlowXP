/*
 * Evidence that the "Acceptance" clause in the Terms and Privacy Policy was
 * actually agreed to, not just presented: signup now refuses to create an
 * account unless the checkbox was ticked (checked server-side, not only in
 * the signup form — a direct API call must not be able to skip it), and the
 * moment it happened is recorded here.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ`);
};
