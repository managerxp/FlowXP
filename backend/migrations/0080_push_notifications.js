/*
 * Phone notifications. Each phone the app is signed in on registers a token (Expo's push address for that install); the server sends to the tokens of the people a
 * notification is for. A person can switch push off per category, so notification_preferences gets a `push` column (NULL = the category's own default).
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS push_devices (
      device_id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      token VARCHAR(200) NOT NULL,
      platform VARCHAR(12) NOT NULL DEFAULT 'android',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  // one row per phone install, whoever is signed in on it: signing in as someone else on the same phone moves the token to them
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_push_devices_token ON push_devices (token)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices (user_id)`);
  await client.query(`ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push BOOLEAN`);
};
