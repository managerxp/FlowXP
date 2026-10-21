/*
 * The shop's list of services it charges for (oil change, wheel alignment, brake pad fitting...), so a job card takes labour with one tap instead of typing it each time.
 * A service has a name and a charge; the GST rate is the shop's labour rate unless the service sets its own. Forward only; nothing else changes.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS workshop_services (
      service_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
      tax_rate NUMERIC(5,2) CHECK (tax_rate IS NULL OR tax_rate BETWEEN 0 AND 100),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_workshop_services_name ON workshop_services (business_id, lower(name)) WHERE is_active`);
};
