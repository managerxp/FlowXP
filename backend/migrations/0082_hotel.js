/*
 * The hotel module (business type HOTEL): front office, housekeeping, folio and night audit.
 *
 * One outlet (branch) is one property. Everything below carries business_id and branch_id.
 *
 *   hotel_properties     per property: the business date (the hotel's "today", moved on by night audit), check-in / check-out time, and the
 *                        GST slab for room tariff (up to tax_threshold_paise a night is taxed at tax_low_pct, above it at tax_high_pct)
 *   room_types           Deluxe, Suite...: the rack rate, extra person rates and how many people it takes
 *   rooms                the physical rooms and their housekeeping state
 *   room_blocks          a room taken out of sale between two dates (maintenance, owner use)
 *   rate_plans           room only, with breakfast...: a meal plan and a rate for each room type
 *   rate_plan_rates      the rate of one plan for one room type
 *   rate_overrides       a different rate for a date range (season, event), for a room type and optionally one plan
 *   guests               the people who stay: contact, ID, nationality, GSTIN, VIP
 *   hotel_bookings         a booking (one or more rooms), its status and who it is for
 *   hotel_booking_rooms    each room on a booking: type, the room assigned at check-in, the nightly rate agreed, its own dates
 *   folio_charges        everything charged to a stay: the night's room charge (posted by night audit), restaurant, laundry, extras
 *   folio_payments       advances, payments at check-out and refunds
 *   hotel_night_audits   which business dates have been closed, by whom
 *   hotel_daily_stats    the figures of each closed day (kept as they were, so a later rate change does not rewrite history)
 */
export const up = async (client) => {
  // roles: the front desk, housekeeping and night audit people, and the managers of banquet and staff (used by later phases)
  await client.query(`ALTER TABLE business_users DROP CONSTRAINT IF EXISTS business_users_role_check`);
  await client.query(`
    ALTER TABLE business_users ADD CONSTRAINT business_users_role_check CHECK (role IN (
      'OWNER','ADMIN','MANAGER','CASHIER','STAFF','WAITER','KITCHEN','INVENTORY_MANAGER','DELIVERY','RECEPTIONIST','STYLIST','ACCOUNTANT',
      'SALES_MANAGER','SALES_EXECUTIVE','WAREHOUSE_MANAGER','WAREHOUSE_STAFF','PURCHASE_MANAGER','DISTRIBUTOR_ADMIN','FIELD_SALES',
      'COLLECTION_EXECUTIVE','DELIVERY_MANAGER','PHARMACIST','SALES_STAFF','GRN_MANAGER','AUDITOR',
      'FRONT_DESK','HOUSEKEEPER','HOUSEKEEPING_SUPERVISOR','NIGHT_AUDITOR','BANQUET_MANAGER','HR_MANAGER'))`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS hotel_properties (
      branch_id INTEGER PRIMARY KEY REFERENCES branches(branch_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      business_date DATE NOT NULL,
      check_in_time TIME NOT NULL DEFAULT '12:00',
      check_out_time TIME NOT NULL DEFAULT '11:00',
      tax_threshold_paise BIGINT NOT NULL DEFAULT 750000 CHECK (tax_threshold_paise >= 0),
      tax_low_pct NUMERIC(5,2) NOT NULL DEFAULT 5 CHECK (tax_low_pct BETWEEN 0 AND 100),
      tax_high_pct NUMERIC(5,2) NOT NULL DEFAULT 18 CHECK (tax_high_pct BETWEEN 0 AND 100),
      allow_overbooking BOOLEAN NOT NULL DEFAULT FALSE,
      res_prefix VARCHAR(8) NOT NULL DEFAULT 'RES',
      next_res_no INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS room_types (
      room_type_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      code VARCHAR(12) NOT NULL,
      description TEXT,
      base_rate_paise BIGINT NOT NULL DEFAULT 0 CHECK (base_rate_paise >= 0),
      extra_adult_paise BIGINT NOT NULL DEFAULT 0 CHECK (extra_adult_paise >= 0),
      extra_child_paise BIGINT NOT NULL DEFAULT 0 CHECK (extra_child_paise >= 0),
      base_adults SMALLINT NOT NULL DEFAULT 2 CHECK (base_adults >= 1),
      max_adults SMALLINT NOT NULL DEFAULT 2 CHECK (max_adults >= 1),
      max_children SMALLINT NOT NULL DEFAULT 1 CHECK (max_children >= 0),
      amenities TEXT[] NOT NULL DEFAULT '{}',
      sort_order SMALLINT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (branch_id, code)
    )`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      room_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      room_type_id INTEGER NOT NULL REFERENCES room_types(room_type_id),
      room_no VARCHAR(16) NOT NULL,
      floor VARCHAR(16),
      hk_status VARCHAR(14) NOT NULL DEFAULT 'CLEAN' CHECK (hk_status IN ('CLEAN','DIRTY','INSPECTED','OUT_OF_ORDER')),
      hk_note TEXT,
      hk_updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (branch_id, room_no)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms (room_type_id)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS room_blocks (
      block_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      room_id INTEGER NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
      from_date DATE NOT NULL,
      to_date DATE NOT NULL,
      reason VARCHAR(200),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (to_date > from_date)
    )`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS rate_plans (
      rate_plan_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      code VARCHAR(12) NOT NULL,
      meal_plan VARCHAR(3) NOT NULL DEFAULT 'EP' CHECK (meal_plan IN ('EP','CP','MAP','AP')),
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (branch_id, code)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS rate_plan_rates (
      rate_plan_id INTEGER NOT NULL REFERENCES rate_plans(rate_plan_id) ON DELETE CASCADE,
      room_type_id INTEGER NOT NULL REFERENCES room_types(room_type_id) ON DELETE CASCADE,
      rate_paise BIGINT NOT NULL CHECK (rate_paise >= 0),
      PRIMARY KEY (rate_plan_id, room_type_id)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS rate_overrides (
      override_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      room_type_id INTEGER NOT NULL REFERENCES room_types(room_type_id) ON DELETE CASCADE,
      rate_plan_id INTEGER REFERENCES rate_plans(rate_plan_id) ON DELETE CASCADE,
      name VARCHAR(80),
      from_date DATE NOT NULL,
      to_date DATE NOT NULL,
      days_of_week SMALLINT[],
      rate_paise BIGINT NOT NULL CHECK (rate_paise >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (to_date >= from_date)
    )`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS guests (
      guest_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(20),
      email VARCHAR(255),
      company VARCHAR(120),
      gstin VARCHAR(20),
      id_type VARCHAR(24),
      id_number VARCHAR(40),
      nationality VARCHAR(60),
      address TEXT,
      city VARCHAR(80),
      state VARCHAR(80),
      country VARCHAR(60),
      dob DATE,
      is_vip BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_guests_business_phone ON guests (business_id, phone)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_guests_business_name ON guests (business_id, lower(name))`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS hotel_bookings (
      booking_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      res_no VARCHAR(24) NOT NULL,
      guest_id INTEGER NOT NULL REFERENCES guests(guest_id),
      status VARCHAR(12) NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT','CANCELLED','NO_SHOW')),
      arrival DATE NOT NULL,
      departure DATE NOT NULL,
      source VARCHAR(24) NOT NULL DEFAULT 'WALK_IN',
      source_ref VARCHAR(60),
      rate_plan_id INTEGER REFERENCES rate_plans(rate_plan_id) ON DELETE SET NULL,
      company VARCHAR(120),
      notes TEXT,
      cancel_reason TEXT,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checked_in_at TIMESTAMPTZ,
      checked_out_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      CHECK (departure > arrival),
      UNIQUE (branch_id, res_no)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_bookings_branch_dates ON hotel_bookings (branch_id, arrival, departure)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_bookings_branch_status ON hotel_bookings (branch_id, status)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_bookings_guest ON hotel_bookings (guest_id)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS hotel_booking_rooms (
      rr_id SERIAL PRIMARY KEY,
      booking_id INTEGER NOT NULL REFERENCES hotel_bookings(booking_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      room_type_id INTEGER NOT NULL REFERENCES room_types(room_type_id),
      room_id INTEGER REFERENCES rooms(room_id),
      arrival DATE NOT NULL,
      departure DATE NOT NULL,
      adults SMALLINT NOT NULL DEFAULT 1 CHECK (adults >= 1),
      children SMALLINT NOT NULL DEFAULT 0 CHECK (children >= 0),
      rate_paise BIGINT NOT NULL CHECK (rate_paise >= 0),
      status VARCHAR(12) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','IN_HOUSE','DEPARTED','CANCELLED')),
      guest_name VARCHAR(120),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (departure > arrival)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hbr_reservation ON hotel_booking_rooms (booking_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hbr_branch_dates ON hotel_booking_rooms (branch_id, arrival, departure) WHERE status IN ('RESERVED','IN_HOUSE')`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hbr_room ON hotel_booking_rooms (room_id) WHERE room_id IS NOT NULL`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS folio_charges (
      charge_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      booking_id INTEGER NOT NULL REFERENCES hotel_bookings(booking_id) ON DELETE CASCADE,
      rr_id INTEGER REFERENCES hotel_booking_rooms(rr_id) ON DELETE SET NULL,
      charge_date DATE NOT NULL,
      department VARCHAR(12) NOT NULL CHECK (department IN ('ROOM','FNB','LAUNDRY','SPA','BANQUET','TRANSPORT','MISC')),
      description VARCHAR(200) NOT NULL,
      quantity NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
      unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise >= 0),
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      amount_paise BIGINT NOT NULL,
      tax_paise BIGINT NOT NULL DEFAULT 0,
      source VARCHAR(12) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('NIGHT_AUDIT','MANUAL','POS')),
      ref_type VARCHAR(20),
      ref_id BIGINT,
      voided_at TIMESTAMPTZ,
      void_reason TEXT,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_folio_charges_reservation ON folio_charges (booking_id) WHERE voided_at IS NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_folio_charges_branch_date ON folio_charges (branch_id, charge_date) WHERE voided_at IS NULL`);
  // one room-night is posted once per room, however many times night audit is retried
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_folio_room_night ON folio_charges (rr_id, charge_date) WHERE source = 'NIGHT_AUDIT' AND voided_at IS NULL`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS folio_payments (
      fp_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      booking_id INTEGER NOT NULL REFERENCES hotel_bookings(booking_id) ON DELETE CASCADE,
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('ADVANCE','PAYMENT','REFUND')),
      method VARCHAR(14) NOT NULL CHECK (method IN ('CASH','UPI','CARD','BANK_TRANSFER','CHEQUE','OTHER','CREDIT')),
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      reference VARCHAR(80),
      pay_date DATE NOT NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_folio_payments_reservation ON folio_payments (booking_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_folio_payments_branch_date ON folio_payments (branch_id, pay_date)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS hotel_night_audits (
      audit_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      audit_date DATE NOT NULL,
      run_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      run_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      UNIQUE (branch_id, audit_date)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS hotel_daily_stats (
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      stat_date DATE NOT NULL,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      rooms_available INTEGER NOT NULL DEFAULT 0,
      rooms_sold INTEGER NOT NULL DEFAULT 0,
      rooms_out_of_order INTEGER NOT NULL DEFAULT 0,
      room_revenue_paise BIGINT NOT NULL DEFAULT 0,
      fnb_revenue_paise BIGINT NOT NULL DEFAULT 0,
      other_revenue_paise BIGINT NOT NULL DEFAULT 0,
      tax_paise BIGINT NOT NULL DEFAULT 0,
      arrivals INTEGER NOT NULL DEFAULT 0,
      departures INTEGER NOT NULL DEFAULT 0,
      in_house_guests INTEGER NOT NULL DEFAULT 0,
      walk_ins INTEGER NOT NULL DEFAULT 0,
      no_shows INTEGER NOT NULL DEFAULT 0,
      cancellations INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (branch_id, stat_date)
    )`);
};
