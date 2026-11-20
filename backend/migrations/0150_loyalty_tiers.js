/* Tiers on the loyalty programmes (Silver, Gold...): a member's tier follows what they have earned in all, and earns faster. One set of tiers per programme. */
export const up = async (client) => {
  await client.query(`CREATE TABLE loyalty_tiers (
    tier_id SERIAL PRIMARY KEY,
    business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
    programme_id INTEGER NOT NULL REFERENCES loyalty_programmes(programme_id) ON DELETE CASCADE,
    name VARCHAR(30) NOT NULL,
    min_points INTEGER NOT NULL CHECK (min_points >= 0),
    multiplier NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (multiplier >= 1 AND multiplier <= 10),
    UNIQUE (programme_id, min_points)
  )`);
  await client.query(`CREATE INDEX loyalty_tiers_programme ON loyalty_tiers (programme_id, min_points)`);
};
