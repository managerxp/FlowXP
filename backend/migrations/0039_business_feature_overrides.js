/*
 * Business-specific feature overrides (owner-approved scope, 2026-09-28, from
 * the Super Admin audit — see brain.md). "Business X stays on Basic but also
 * gets Advanced Reports until 31 Dec" — without inventing a one-off plan for
 * them, and without touching their plan or business type at all.
 *
 * One row per (business, feature): setting a new override for the same
 * feature replaces it rather than appending, since only the CURRENT state
 * matters for gating — the history of who changed what is already the
 * admin's own audit_log (recordAudit), not duplicated here.
 *
 * `enabled = true` forces a feature ON even if the plan or business type say
 * off; `enabled = false` forces it OFF even if they say on (e.g. temporarily
 * disabling something for a single abusive account without suspending it
 * outright). `expires_at` NULL = permanent until an admin removes it; an
 * expired override is treated as if it doesn't exist — derived on read, the
 * same pattern trial expiry already uses, so nothing needs to be scheduled.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS business_feature_overrides (
      override_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      feature_key VARCHAR(32) NOT NULL,
      enabled BOOLEAN NOT NULL,
      reason TEXT,
      expires_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (business_id, feature_key)
    )
  `);
};
