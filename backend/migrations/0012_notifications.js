/*
 * Notifications, delivery preferences, and a small Postgres-backed job queue.
 *
 * One row per recipient, so "read" is personal and each person's history is
 * their own. dedupe_key makes a repeating condition (the same item still low
 * at every hourly check) produce one notification per period, not one per check.
 *
 * jobs is deliberately Postgres, not Redis: emails and scheduled scans need
 * durability and retries, not throughput, and this adds no infrastructure.
 * Workers claim rows with FOR UPDATE SKIP LOCKED, so two API processes never
 * take the same job.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE notifications (
      notification_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      category VARCHAR(20) NOT NULL,
      type VARCHAR(40) NOT NULL,
      severity VARCHAR(14) NOT NULL DEFAULT 'informational' CHECK (severity IN ('informational','warning','critical','positive')),
      title VARCHAR(160) NOT NULL,
      body TEXT,
      link VARCHAR(200),
      dedupe_key VARCHAR(160),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_notifications_user ON notifications (business_id, user_id, created_at DESC)`);
  await client.query(`CREATE INDEX idx_notifications_unread ON notifications (business_id, user_id) WHERE read_at IS NULL`);
  await client.query(`CREATE UNIQUE INDEX uq_notifications_dedupe ON notifications (business_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL`);

  await client.query(`
    CREATE TABLE notification_preferences (
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      category VARCHAR(20) NOT NULL,
      in_app BOOLEAN NOT NULL DEFAULT TRUE,
      email BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (business_id, user_id, category)
    )
  `);

  await client.query(`
    CREATE TABLE jobs (
      job_id BIGSERIAL PRIMARY KEY,
      type VARCHAR(30) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
      run_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      attempts SMALLINT NOT NULL DEFAULT 0,
      last_error TEXT,
      locked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMPTZ
    )
  `);
  await client.query(`CREATE INDEX idx_jobs_due ON jobs (run_at) WHERE status = 'PENDING'`);

  // Last run of each recurring scan per business; claimed atomically so two processes don't both run it.
  await client.query(`
    CREATE TABLE scan_state (
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      scan VARCHAR(20) NOT NULL,
      last_run_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (business_id, scan)
    )
  `);
};
