/* When the current paid subscription started, so the Super Admin can show start and end side by side. Existing paying clients: counted back from their next billing date. */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ`);
  await client.query(`UPDATE businesses SET subscription_started_at = next_billing_date - (CASE WHEN billing_cycle = 'YEARLY' THEN INTERVAL '365 days' ELSE INTERVAL '30 days' END)
                      WHERE subscription_status = 'ACTIVE' AND next_billing_date IS NOT NULL AND subscription_started_at IS NULL`);
};
