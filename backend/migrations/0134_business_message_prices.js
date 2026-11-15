/* A business can have its own WhatsApp message prices (paise). Empty means the platform price from Settings, Messaging. */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS wa_rate_utility_paise INTEGER CHECK (wa_rate_utility_paise IS NULL OR wa_rate_utility_paise >= 0)`);
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS wa_rate_marketing_paise INTEGER CHECK (wa_rate_marketing_paise IS NULL OR wa_rate_marketing_paise >= 0)`);
};
