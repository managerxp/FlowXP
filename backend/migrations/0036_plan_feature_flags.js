/*
 * Real, enforced plan-level feature gating (owner's request, 2026-09-28) —
 * `plans.features` stays as it was, a marketing bullet list shown on the
 * pricing page only. This is the machine-readable, keyed twin that
 * middleware/auth.js's requirePlanFeature() actually checks.
 *
 * Seeded to match what the plans already advertise, so nothing already
 * working changes for an existing paying business: Starter loses nothing it
 * didn't already claim to have, Growth/Business/Enterprise keep everything
 * (an empty object = every feature on, see modules/planFeatures.js).
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb`);

  await client.query(`
    UPDATE plans SET feature_flags = '{"loyalty":false,"messaging":false,"reservations":false,"purchases":false,"expenses":false,"ai":false,"advanced_reports":false}'::jsonb
    WHERE plan_code = 'STARTER'
  `);
  await client.query(`
    UPDATE plans SET feature_flags = '{"loyalty":false,"messaging":false,"reservations":false,"advanced_reports":false}'::jsonb
    WHERE plan_code = 'GROWTH'
  `);
  // TRIAL, BUSINESS and ENTERPRISE keep the default {} — every feature on.
};
