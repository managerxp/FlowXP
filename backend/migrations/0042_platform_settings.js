/*
 * Platform-wide settings, admin-managed instead of env-only (owner's request,
 * 2026-09-29): which payment gateway is live and its keys, and which
 * email/SMS/WhatsApp provider is live and its credentials. One row per
 * setting group; `value` holds the whole config as JSONB so a new provider's
 * fields don't need a new migration. Secret fields inside `value` are
 * encrypted at rest (see modules/crypto.js) — never stored or logged plain.
 *
 * DB row wins over the .env value when present, so a working install with no
 * rows here behaves exactly as before (env-only, zero config needed).
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      setting_key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};
