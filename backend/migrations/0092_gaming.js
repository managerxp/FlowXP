/*
 * The gaming lounge module (business type GAMING_CAFE), part 1: stations, rates and timed sessions.
 *
 * A PS5 / console lounge or a pool / snooker hall. A STATION IS A TABLE and a SESSION IS THAT TABLE'S TAB: every station owns a
 * `dining_tables` row, so food and drink ordered for the station (by staff, or from the station's QR menu) sit on the same `orders` tab as the
 * time, and one invoice bills both. The time itself is a line on the tab (a catalogue product of kind SERVICE), written when the session stops.
 *
 *   gaming_settings          per business: alert minutes, booking hold, the "Gaming time" product the time lines use
 *   gaming_zones             the groups on the board (Console lounge, Private rooms, Pool and snooker ...)
 *   gaming_stations          a console, a room or a table: kind, zone, max players, the linked dining table
 *   gaming_rates             what time costs: by number of players, peak bands, rounding, minimum, a per-frame price for pool.
 *                            Applies to a kind, a zone or one station (the most specific wins), or to everything
 *   gaming_bundles           fixed-time offers ("3 hours for Rs 200") and prepaid hour packs
 *   gaming_games             a short list of games (FIFA, Tekken ...) to note on a session
 *   gaming_sessions          one sitting at a station. Time is derived from timestamps (never a ticking counter), so it survives a restart
 *   gaming_session_segments  the stretches that count: a pause ends one, a change of players or a transfer starts the next, so the charge is exact
 *   gaming_bookings          a station reserved for a time (part 3: no two overlapping bookings are allowed on one station)
 *   gaming_session_events    what was done to a session and by whom (start, pause, players, frames, transfer, stop, void ...)
 *
 * Every reference between these tables and the business's own rows cascades, because deleting a business (account deletion) deletes them all and a cascaded
 * delete checks each foreign key as it goes.
 *
 * Forward only. To undo by hand (never on a live lounge): drop the tables above in reverse order and restore business_users_role_check without
 * GAMING_ATTENDANT. Nothing here changes an existing table except that role constraint.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE business_users DROP CONSTRAINT IF EXISTS business_users_role_check`);
  await client.query(`
    ALTER TABLE business_users ADD CONSTRAINT business_users_role_check CHECK (role IN (
      'OWNER','ADMIN','MANAGER','CASHIER','STAFF','WAITER','KITCHEN','INVENTORY_MANAGER','DELIVERY','RECEPTIONIST','STYLIST','ACCOUNTANT',
      'SALES_MANAGER','SALES_EXECUTIVE','WAREHOUSE_MANAGER','WAREHOUSE_STAFF','PURCHASE_MANAGER','DISTRIBUTOR_ADMIN','FIELD_SALES',
      'COLLECTION_EXECUTIVE','DELIVERY_MANAGER','PHARMACIST','SALES_STAFF','GRN_MANAGER','AUDITOR',
      'FRONT_DESK','HOUSEKEEPER','HOUSEKEEPING_SUPERVISOR','NIGHT_AUDITOR','BANQUET_MANAGER','HR_MANAGER',
      'GYM_RECEPTIONIST','TRAINER','GAMING_ATTENDANT'))`);

  await client.query(`
    CREATE TABLE gaming_settings (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      -- the minutes left at which a timed session shows "ending soon" (and sends a staff notification)
      alert_minutes SMALLINT NOT NULL DEFAULT 5 CHECK (alert_minutes BETWEEN 1 AND 60),
      -- a station booked to start inside this many minutes cannot be started for someone else without an override
      hold_minutes SMALLINT NOT NULL DEFAULT 15 CHECK (hold_minutes BETWEEN 0 AND 240),
      -- a booking not seated this many minutes after its start can be marked a no-show
      noshow_minutes SMALLINT NOT NULL DEFAULT 15 CHECK (noshow_minutes BETWEEN 0 AND 240),
      -- the catalogue products the time and frame lines on a tab use, made on first use
      time_product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
      tournament_product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
      gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18 CHECK (gst_rate BETWEEN 0 AND 40),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  await client.query(`
    CREATE TABLE gaming_zones (
      zone_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      name VARCHAR(60) NOT NULL,
      sort_order SMALLINT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gaming_zone_name ON gaming_zones (branch_id, lower(name)) WHERE is_active`);

  await client.query(`
    CREATE TABLE gaming_stations (
      station_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      zone_id INTEGER REFERENCES gaming_zones(zone_id) ON DELETE SET NULL,
      name VARCHAR(60) NOT NULL,
      kind VARCHAR(12) NOT NULL CHECK (kind IN ('CONSOLE','VR','POOL','SNOOKER','TABLE_GAME','OTHER')),
      -- the model or what it is, shown on the tile: "PS5", "Xbox Series X", "8-ball", "Foosball"
      label VARCHAR(40),
      max_players SMALLINT NOT NULL DEFAULT 4 CHECK (max_players BETWEEN 1 AND 20),
      table_id INTEGER NOT NULL REFERENCES dining_tables(table_id) ON DELETE CASCADE,
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','OUT_OF_SERVICE','ARCHIVED')),
      status_note VARCHAR(120),
      sort_order SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gaming_station_name ON gaming_stations (branch_id, lower(name)) WHERE status <> 'ARCHIVED'`);
  await client.query(`CREATE UNIQUE INDEX uq_gaming_station_table ON gaming_stations (table_id)`);
  await client.query(`CREATE INDEX idx_gaming_stations_business ON gaming_stations (business_id, branch_id)`);

  await client.query(`
    CREATE TABLE gaming_rates (
      rate_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      -- where it applies; at most one of these is set, none = every station. The most specific rate wins: station, then zone, then kind, then all
      kind VARCHAR(12) CHECK (kind IN ('CONSOLE','VR','POOL','SNOOKER','TABLE_GAME','OTHER')),
      zone_id INTEGER REFERENCES gaming_zones(zone_id) ON DELETE CASCADE,
      station_id INTEGER REFERENCES gaming_stations(station_id) ON DELETE CASCADE,
      -- false = a table charged only per frame or game, no clock charge
      bill_time BOOLEAN NOT NULL DEFAULT TRUE,
      -- the hourly price by number of players: [{ "players": 1, "hour_paise": 10000 }, { "players": 2, "hour_paise": 15000 }]
      tiers JSONB NOT NULL DEFAULT '[]'::jsonb,
      -- the hourly price for each player past the biggest tier (NULL: no extra, the biggest tier's price)
      extra_player_hour_paise BIGINT CHECK (extra_player_hour_paise IS NULL OR extra_player_hour_paise >= 0),
      -- peak, weekend and happy-hour bands: [{ "name": "Evening", "days": [0,1,2,3,4,5,6], "from": "18:00", "to": "23:00", "multiplier_pct": 120 } or "tiers": [...]]
      bands JSONB NOT NULL DEFAULT '[]'::jsonb,
      -- billed in blocks of this many minutes (1 = by the minute). Time over a block is rounded up unless it is within the grace
      block_minutes SMALLINT NOT NULL DEFAULT 1 CHECK (block_minutes BETWEEN 1 AND 240),
      grace_minutes SMALLINT NOT NULL DEFAULT 0 CHECK (grace_minutes BETWEEN 0 AND 60),
      -- the least that is ever billed for a session that was started and used
      min_minutes SMALLINT NOT NULL DEFAULT 0 CHECK (min_minutes BETWEEN 0 AND 600),
      unit_label VARCHAR(20),
      unit_price_paise BIGINT NOT NULL DEFAULT 0 CHECK (unit_price_paise >= 0),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((kind IS NOT NULL)::int + (zone_id IS NOT NULL)::int + (station_id IS NOT NULL)::int <= 1)
    )`);
  await client.query(`CREATE INDEX idx_gaming_rates_business ON gaming_rates (business_id) WHERE is_active`);

  await client.query(`
    CREATE TABLE gaming_bundles (
      bundle_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      -- SESSION: a fixed block of time at a set price, started on a station. PACK: prepaid hours bought for later (part 2)
      kind VARCHAR(8) NOT NULL DEFAULT 'SESSION' CHECK (kind IN ('SESSION','PACK')),
      minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 6000),
      price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
      -- the number of players the price covers
      players SMALLINT NOT NULL DEFAULT 1 CHECK (players BETWEEN 1 AND 20),
      -- the station kinds it is good for, NULL = any
      kinds TEXT[],
      valid_days INTEGER CHECK (valid_days IS NULL OR valid_days BETWEEN 1 AND 3650),
      tax_rate NUMERIC(5,2),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  await client.query(`
    CREATE TABLE gaming_games (
      game_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gaming_game_name ON gaming_games (business_id, lower(name)) WHERE is_active`);

  await client.query(`
    CREATE TABLE gaming_sessions (
      session_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      station_id INTEGER NOT NULL REFERENCES gaming_stations(station_id) ON DELETE CASCADE,
      -- the station's tab. Food and drink ordered for the station are on it; so is the time line once the session stops
      order_id INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      player_name VARCHAR(60),
      -- OPEN: pay for what is used (planned_minutes is only an alert). FIXED: a bundle, time sold up front. PACK: paid from a prepaid hour pack
      mode VARCHAR(5) NOT NULL DEFAULT 'OPEN' CHECK (mode IN ('OPEN','FIXED','PACK')),
      bundle_id INTEGER REFERENCES gaming_bundles(bundle_id) ON DELETE SET NULL,
      -- the bundles' price and time added together (a FIXED session can be extended with another bundle)
      bundle_price_paise BIGINT NOT NULL DEFAULT 0,
      planned_minutes INTEGER CHECK (planned_minutes IS NULL OR planned_minutes > 0),
      pack_id INTEGER,
      pack_minutes INTEGER NOT NULL DEFAULT 0,
      -- frames or games counted on this session (pool and snooker)
      units INTEGER NOT NULL DEFAULT 0 CHECK (units >= 0),
      -- how many are playing now (the next stretch is priced for this many)
      players SMALLINT NOT NULL DEFAULT 1 CHECK (players BETWEEN 1 AND 20),
      status VARCHAR(9) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','PAUSED','ENDED','CANCELLED')),
      game_id INTEGER REFERENCES gaming_games(game_id) ON DELETE SET NULL,
      note VARCHAR(200),
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      -- the time and frame lines written on the tab when the session stopped, and what they came to
      time_charge_paise BIGINT,
      units_charge_paise BIGINT,
      time_item_id INTEGER REFERENCES order_items(order_item_id) ON DELETE SET NULL,
      units_item_id INTEGER REFERENCES order_items(order_item_id) ON DELETE SET NULL,
      -- each alert goes out once
      alerted_soon_at TIMESTAMPTZ,
      alerted_over_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      ended_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      void_reason VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  // a station has at most one live session: the guarantee that two staff cannot both start it
  await client.query(`CREATE UNIQUE INDEX uq_gaming_live_session ON gaming_sessions (station_id) WHERE status IN ('RUNNING','PAUSED')`);
  await client.query(`CREATE INDEX idx_gaming_sessions_business_time ON gaming_sessions (business_id, started_at DESC)`);
  await client.query(`CREATE INDEX idx_gaming_sessions_order ON gaming_sessions (order_id)`);

  await client.query(`
    CREATE TABLE gaming_session_segments (
      segment_id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES gaming_sessions(session_id) ON DELETE CASCADE,
      station_id INTEGER NOT NULL REFERENCES gaming_stations(station_id) ON DELETE CASCADE,
      players SMALLINT NOT NULL CHECK (players BETWEEN 1 AND 20),
      -- the rate this stretch is priced at, copied here so a later edit of the rate never changes a past or running session
      rate JSONB NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      CHECK (ended_at IS NULL OR ended_at >= started_at)
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gaming_open_segment ON gaming_session_segments (session_id) WHERE ended_at IS NULL`);
  await client.query(`CREATE INDEX idx_gaming_segments_session ON gaming_session_segments (session_id, started_at)`);

  await client.query(`
    CREATE TABLE gaming_session_events (
      event_id BIGSERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES gaming_sessions(session_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      type VARCHAR(20) NOT NULL,
      data JSONB,
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_gaming_events_session ON gaming_session_events (session_id, at)`);

  await client.query(`
    CREATE TABLE gaming_bookings (
      booking_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      station_id INTEGER NOT NULL REFERENCES gaming_stations(station_id) ON DELETE CASCADE,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      players SMALLINT NOT NULL DEFAULT 1 CHECK (players BETWEEN 1 AND 20),
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      guest_name VARCHAR(60),
      guest_phone VARCHAR(32),
      status VARCHAR(10) NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','SEATED','NO_SHOW','CANCELLED')),
      note VARCHAR(200),
      session_id INTEGER REFERENCES gaming_sessions(session_id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (ends_at > starts_at)
    )`);
  await client.query(`CREATE INDEX idx_gaming_bookings_station ON gaming_bookings (station_id, starts_at) WHERE status = 'BOOKED'`);
  await client.query(`CREATE INDEX idx_gaming_bookings_business ON gaming_bookings (business_id, starts_at DESC)`);
};
