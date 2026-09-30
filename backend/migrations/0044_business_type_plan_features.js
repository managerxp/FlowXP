/*
 * Business-type feature gating becomes plan-aware (owner's request,
 * 2026-09-29): instead of one switch per business type that applies to every
 * plan, each (business type, plan) pair gets its own — "Reservations off for
 * Retail" no longer has to mean "off for Retail on every plan too." This
 * sits alongside plans.feature_flags (the plan's own baseline, unchanged,
 * still edited from /superadmin/plans and shown in the Features "By plan"
 * tab) as a second, more specific source in effectiveFeatureFlags()'s
 * sources[] — same AND-together rule as before, just one more source.
 *
 * Any existing plan-agnostic row is expanded across the 3 public plans
 * (Starter/Growth/Enterprise) so current behaviour is preserved exactly
 * rather than silently reset; a fresh install has none to expand.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE business_type_features ADD COLUMN IF NOT EXISTS plan_code VARCHAR(20)`);
  // Drop the old single-column PK first — several rows per business_type (one per plan) need to
  // coexist during the expansion below, which the old PK (business_type alone) would refuse.
  await client.query(`ALTER TABLE business_type_features DROP CONSTRAINT IF EXISTS business_type_features_pkey`);

  await client.query(`
    INSERT INTO business_type_features (business_type, plan_code, feature_flags)
    SELECT btf.business_type, p.plan_code, btf.feature_flags
    FROM business_type_features btf, plans p
    WHERE btf.plan_code IS NULL AND p.is_public
  `);
  await client.query(`DELETE FROM business_type_features WHERE plan_code IS NULL`);

  await client.query(`ALTER TABLE business_type_features ALTER COLUMN plan_code SET NOT NULL`);
  await client.query(`ALTER TABLE business_type_features ADD PRIMARY KEY (business_type, plan_code)`);
  await client.query(`ALTER TABLE business_type_features ADD CONSTRAINT business_type_features_plan_fk FOREIGN KEY (plan_code) REFERENCES plans(plan_code)`);
};
