/*
 * Inputs the forecast can't infer: how long a supplier takes to deliver an
 * item, and known events that will move demand (a festival, a match night, a
 * promotion). Forecasts themselves are computed on read.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE products ADD COLUMN lead_time_days SMALLINT NOT NULL DEFAULT 1 CHECK (lead_time_days BETWEEN 0 AND 30)`);
  await client.query(`
    CREATE TABLE demand_events (
      event_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      event_date DATE NOT NULL,
      label VARCHAR(80) NOT NULL,
      -- 1.25 = expect 25% more than a normal day; 0.6 = 40% less.
      multiplier NUMERIC(4,2) NOT NULL CHECK (multiplier BETWEEN 0.1 AND 5),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_demand_events_business_date ON demand_events (business_id, event_date)`);
};
