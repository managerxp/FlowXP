/*
 * Table reservations and the walk-in waitlist.
 *
 * A reservation holds a time slot (reserved_at .. reserved_at + duration) and
 * optionally a table; two live reservations can't overlap on the same table.
 * The waitlist is the walk-in queue: no time, just an order of arrival.
 * Both are per outlet and link to a customer by mobile when one exists.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE reservations (
      reservation_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      table_id INTEGER REFERENCES dining_tables(table_id) ON DELETE SET NULL,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      guest_name VARCHAR(120) NOT NULL,
      phone VARCHAR(20),
      party_size INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 100),
      reserved_at TIMESTAMPTZ NOT NULL,
      duration_min INTEGER NOT NULL DEFAULT 90 CHECK (duration_min BETWEEN 15 AND 480),
      status VARCHAR(12) NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','SEATED','COMPLETED','CANCELLED','NO_SHOW')),
      notes VARCHAR(300),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_reservations_outlet_time ON reservations (business_id, branch_id, reserved_at)`);
  await client.query(`CREATE INDEX idx_reservations_table ON reservations (table_id, reserved_at) WHERE status IN ('BOOKED','SEATED')`);

  await client.query(`
    CREATE TABLE waitlist_entries (
      entry_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      guest_name VARCHAR(120) NOT NULL,
      phone VARCHAR(20),
      party_size INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 100),
      quoted_wait_min INTEGER,
      status VARCHAR(10) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','NOTIFIED','SEATED','LEFT')),
      table_id INTEGER REFERENCES dining_tables(table_id) ON DELETE SET NULL,
      notified_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMPTZ
    )
  `);
  await client.query(`CREATE INDEX idx_waitlist_outlet ON waitlist_entries (business_id, branch_id, status, created_at)`);
};
