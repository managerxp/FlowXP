/* Offline bill numbers. Each phone gets its own short series (M1, M2, ...) while it is online, and numbers the bills it makes with no connection from it,
   so two phones billing at once can never print the same number. last_number is the highest one the server has accepted. */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS offline_series (
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      device_uid VARCHAR(64) NOT NULL,
      code VARCHAR(8) NOT NULL,
      last_number INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (business_id, device_uid),
      UNIQUE (business_id, code)
    )
  `);
};
