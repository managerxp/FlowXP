/*
 * Crash and error reports from the mobile app (MOBILE.md phase 4). The app posts them without signing in (a crash can happen before
 * sign-in), so the table holds only what the app itself says: its version, platform, screen and the error, never a person or a business.
 * A platform admin reads them in the console. Kept 30 days.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_errors (
      error_id   BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      app        VARCHAR(20) NOT NULL DEFAULT 'mobile',
      version    VARCHAR(40),
      platform   VARCHAR(20),
      os_version VARCHAR(40),
      device     VARCHAR(20),
      screen     VARCHAR(120),
      fatal      BOOLEAN NOT NULL DEFAULT FALSE,
      message    VARCHAR(500) NOT NULL,
      stack      TEXT
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_app_errors_created ON app_errors (created_at DESC)`);
};
