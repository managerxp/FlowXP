/*
 * Bug reports from the app, for the admin console. app_errors already holds the crashes the app sends by itself (no person, no business). It now also holds what a person
 * TYPES when they tap "Report a problem": what went wrong, in their words, with who they are (so support can reply) and which business. Each row has a status the admin moves
 * through NEW, SEEN, FIXED or IGNORED, with a note. A crash that happens again after it was marked FIXED comes back as NEW (the group's status is its newest row's).
 * Crash rows are still deleted after 30 days; written reports are kept for 180. Forward only.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE app_errors ADD COLUMN IF NOT EXISTS kind VARCHAR(8) NOT NULL DEFAULT 'CRASH' CHECK (kind IN ('CRASH','REPORT'))`);
  await client.query(`ALTER TABLE app_errors ADD COLUMN IF NOT EXISTS category VARCHAR(20)`);
  await client.query(`ALTER TABLE app_errors ADD COLUMN IF NOT EXISTS description TEXT`);
  await client.query(`ALTER TABLE app_errors ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE app_errors ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(business_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE app_errors ADD COLUMN IF NOT EXISTS status VARCHAR(8) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','SEEN','FIXED','IGNORED'))`);
  await client.query(`ALTER TABLE app_errors ADD COLUMN IF NOT EXISTS note VARCHAR(300)`);
  await client.query(`ALTER TABLE app_errors ADD COLUMN IF NOT EXISTS handled_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE app_errors ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_app_errors_kind ON app_errors (kind, status, created_at DESC)`);
};
