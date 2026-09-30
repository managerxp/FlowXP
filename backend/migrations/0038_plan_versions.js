/*
 * Plan versioning and grandfathering (owner-approved scope, 2026-09-28, from
 * the Super Admin audit — see brain.md). The problem this solves: today,
 * editing a plan's price or feature_flags changes it for every business on
 * that plan immediately, including ones already paying the old price. The
 * spec's own example: "Professional: v1 ₹999/mo, v2 ₹1,199/mo — existing
 * customers stay on v1, new customers get v2."
 *
 * `plans` keeps its existing columns and stays what a NEW signup or a fresh
 * admin plan-assignment sees (and what the public pricing page reads) — it
 * always mirrors the CURRENT version. `plan_versions` is the history: one row
 * per version, `effective_to IS NULL` marking the live one. A business is
 * pinned to the version it joined on (`businesses.plan_version_id`); admin
 * price/feature changes close the current version and open a new one rather
 * than mutating history, so a pinned business's bill never silently changes.
 *
 * No new UI is required for this to work — updatePlan() already existed;
 * it now cuts a version under the hood when the billing-relevant fields
 * (price, feature_flags) change, and every business already has a version to
 * pin to after this migration's backfill, so nothing observable changes today.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS plan_versions (
      plan_version_id BIGSERIAL PRIMARY KEY,
      plan_code VARCHAR(32) NOT NULL REFERENCES plans(plan_code),
      version_number SMALLINT NOT NULL,
      price_monthly_paise BIGINT NOT NULL,
      price_yearly_paise BIGINT NOT NULL,
      limits JSONB NOT NULL DEFAULT '{}'::jsonb,
      feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
      effective_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      effective_to TIMESTAMPTZ, -- NULL = the current/live version for this plan_code
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (plan_code, version_number)
    )
  `);
  // At most one live (effective_to IS NULL) version per plan — the invariant every read relies on.
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_versions_live ON plan_versions (plan_code) WHERE effective_to IS NULL
  `);

  // Version 1 of every existing plan = today's live values. Not real history
  // (we don't have any before this migration) — just an honest starting point.
  await client.query(`
    INSERT INTO plan_versions (plan_code, version_number, price_monthly_paise, price_yearly_paise, limits, feature_flags)
    SELECT plan_code, 1, price_monthly_paise, price_yearly_paise, limits, feature_flags FROM plans
    ON CONFLICT (plan_code, version_number) DO NOTHING
  `);

  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS plan_version_id BIGINT REFERENCES plan_versions(plan_version_id)`);

  // Pin every existing business to its plan's version 1 — identical to what it already had, so this
  // backfill changes nothing observable today; it only makes the NEXT plan edit stop affecting them.
  await client.query(`
    UPDATE businesses b SET plan_version_id = pv.plan_version_id
    FROM plan_versions pv
    WHERE pv.plan_code = b.plan_code AND pv.version_number = 1 AND b.plan_version_id IS NULL
  `);
};
