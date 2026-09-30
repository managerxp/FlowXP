/*
 * The second axis of the feature gate (owner's request, 2026-09-28): not just
 * "does this plan include Reservations", but "does this apply to a Salon at
 * all". One row per business_type, same shape and same "missing key = on"
 * convention as plans.feature_flags — see modules/planFeatures.js's
 * effectiveFeatureFlags(), which combines both into what a request actually
 * gets. No rows need seeding: every business type behaves exactly as before
 * (every feature on) until an admin switches one off for that type.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS business_type_features (
      business_type VARCHAR(32) PRIMARY KEY,
      feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
};
