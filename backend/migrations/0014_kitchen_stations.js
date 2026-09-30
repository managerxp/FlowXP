/*
 * Kitchen stations, item routing and kitchen timing.
 *
 * A dish is routed to a station (Tandoor, Curry, Cold...). The station and the
 * expected preparation time are copied onto each order line when it is added,
 * so changing a dish's routing later never moves tickets already in the
 * kitchen, and old orders keep the expectation they were measured against.
 *
 * Timestamps on the line (sent / ready / served / cancelled) are what make
 * "how long did Biryani take" and "which orders are late" answerable.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE kitchen_stations (
      station_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(60) NOT NULL,
      sort_order SMALLINT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_kitchen_station_name ON kitchen_stations (business_id, lower(name)) WHERE is_active`);

  await client.query(`ALTER TABLE products ADD COLUMN station_id INTEGER REFERENCES kitchen_stations(station_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE products ADD COLUMN prep_minutes SMALLINT CHECK (prep_minutes IS NULL OR prep_minutes BETWEEN 1 AND 240)`);
  // Used when a dish has no time of its own.
  await client.query(`ALTER TABLE businesses ADD COLUMN kitchen_default_prep_minutes SMALLINT NOT NULL DEFAULT 15 CHECK (kitchen_default_prep_minutes BETWEEN 1 AND 240)`);

  await client.query(`ALTER TABLE order_items ADD COLUMN station_id INTEGER REFERENCES kitchen_stations(station_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE order_items ADD COLUMN expected_minutes SMALLINT`);
  await client.query(`ALTER TABLE order_items ADD COLUMN sent_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE order_items ADD COLUMN ready_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE order_items ADD COLUMN served_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE order_items ADD COLUMN cancelled_at TIMESTAMPTZ`);
  // Anything already sent to the kitchen keeps a sensible start time.
  await client.query(`UPDATE order_items SET sent_at = created_at WHERE kot_id IS NOT NULL`);
  await client.query(`UPDATE order_items SET cancelled_at = created_at WHERE status = 'CANCELLED'`);
  await client.query(`CREATE INDEX idx_order_items_timing ON order_items (sent_at) WHERE sent_at IS NOT NULL`);

  await client.query(`ALTER TABLE kot_tickets ADD COLUMN priority VARCHAR(6) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL','RUSH'))`);
};
