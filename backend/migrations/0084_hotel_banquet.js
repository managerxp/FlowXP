/*
 * Banquet and events for a hotel: halls, menu packages, events with one or more functions (a wedding is a mehendi, a sangeet and a reception), the event's charges and
 * payments.
 *
 *   banquet_halls      the halls, with capacity and a rent for one function
 *   banquet_packages   a menu package with its price a plate
 *   banquet_events     one event for one organiser: enquiry, tentative (holds the hall until a date), confirmed, completed or cancelled
 *   banquet_functions  each function of an event: hall, date, times, guests, package, set-up. A hall cannot hold two functions that overlap.
 *   banquet_charges    what the organiser is charged: hall rent and food (worked out from the function, `auto`) and anything else added by hand
 *   banquet_payments   advances, payments and refunds
 * The organiser is a row in `guests`, the same people the front office knows. When an event is completed it becomes one GST invoice, like a hotel stay.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE business_users DROP CONSTRAINT IF EXISTS business_users_role_check`);
  await client.query(`
    ALTER TABLE business_users ADD CONSTRAINT business_users_role_check CHECK (role IN (
      'OWNER','ADMIN','MANAGER','CASHIER','STAFF','WAITER','KITCHEN','INVENTORY_MANAGER','DELIVERY','RECEPTIONIST','STYLIST','ACCOUNTANT',
      'SALES_MANAGER','SALES_EXECUTIVE','WAREHOUSE_MANAGER','WAREHOUSE_STAFF','PURCHASE_MANAGER','DISTRIBUTOR_ADMIN','FIELD_SALES',
      'COLLECTION_EXECUTIVE','DELIVERY_MANAGER','PHARMACIST','SALES_STAFF','GRN_MANAGER','AUDITOR',
      'FRONT_DESK','HOUSEKEEPER','HOUSEKEEPING_SUPERVISOR','NIGHT_AUDITOR','BANQUET_MANAGER','HR_MANAGER'))`);

  await client.query(`ALTER TABLE hotel_properties ADD COLUMN IF NOT EXISTS event_prefix VARCHAR(8) NOT NULL DEFAULT 'BQ'`);
  await client.query(`ALTER TABLE hotel_properties ADD COLUMN IF NOT EXISTS next_event_no INTEGER NOT NULL DEFAULT 1`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS banquet_halls (
      hall_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      capacity_seated INTEGER NOT NULL DEFAULT 0 CHECK (capacity_seated >= 0),
      capacity_floating INTEGER NOT NULL DEFAULT 0 CHECK (capacity_floating >= 0),
      rent_paise BIGINT NOT NULL DEFAULT 0 CHECK (rent_paise >= 0),
      amenities TEXT[] NOT NULL DEFAULT '{}',
      sort_order SMALLINT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (branch_id, name)
    )`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS banquet_packages (
      package_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      diet VARCHAR(10) NOT NULL DEFAULT 'VEG' CHECK (diet IN ('VEG','NON_VEG','JAIN','MIXED')),
      per_plate_paise BIGINT NOT NULL DEFAULT 0 CHECK (per_plate_paise >= 0),
      min_guests INTEGER NOT NULL DEFAULT 0 CHECK (min_guests >= 0),
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
      menu TEXT,
      sort_order SMALLINT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (branch_id, name)
    )`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS banquet_events (
      event_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      event_no VARCHAR(24) NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'ENQUIRY' CHECK (status IN ('ENQUIRY','TENTATIVE','CONFIRMED','COMPLETED','CANCELLED')),
      event_type VARCHAR(16) NOT NULL DEFAULT 'OTHER' CHECK (event_type IN ('WEDDING','RECEPTION','ENGAGEMENT','BIRTHDAY','CORPORATE','CONFERENCE','PARTY','OTHER')),
      title VARCHAR(160) NOT NULL,
      guest_id INTEGER NOT NULL REFERENCES guests(guest_id),
      company VARCHAR(120),
      hold_until DATE,
      source VARCHAR(24) NOT NULL DEFAULT 'PHONE',
      notes TEXT,
      instructions TEXT,
      cancel_reason TEXT,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_on DATE,
      confirmed_on DATE,
      completed_on DATE,
      cancelled_on DATE,
      UNIQUE (branch_id, event_no)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_banquet_events_branch_status ON banquet_events (branch_id, status)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS banquet_functions (
      function_id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES banquet_events(event_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      hall_id INTEGER NOT NULL REFERENCES banquet_halls(hall_id),
      name VARCHAR(80) NOT NULL,
      event_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      expected_guests INTEGER NOT NULL DEFAULT 0 CHECK (expected_guests >= 0),
      guaranteed_guests INTEGER CHECK (guaranteed_guests IS NULL OR guaranteed_guests >= 0),
      package_id INTEGER REFERENCES banquet_packages(package_id) ON DELETE SET NULL,
      per_plate_paise BIGINT NOT NULL DEFAULT 0 CHECK (per_plate_paise >= 0),
      rent_paise BIGINT NOT NULL DEFAULT 0 CHECK (rent_paise >= 0),
      setup_style VARCHAR(16) NOT NULL DEFAULT 'BANQUET_ROUNDS' CHECK (setup_style IN ('THEATRE','BANQUET_ROUNDS','CLASSROOM','U_SHAPE','COCKTAIL','BOARDROOM','OTHER')),
      menu TEXT,
      setup_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (end_time > start_time)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_banquet_functions_event ON banquet_functions (event_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_banquet_functions_hall_date ON banquet_functions (hall_id, event_date)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS banquet_charges (
      charge_id BIGSERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES banquet_events(event_id) ON DELETE CASCADE,
      function_id INTEGER REFERENCES banquet_functions(function_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      category VARCHAR(8) NOT NULL DEFAULT 'OTHER' CHECK (category IN ('HALL','FOOD','DECOR','AV','ROOMS','OTHER')),
      description VARCHAR(200) NOT NULL,
      quantity NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
      unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise >= 0),
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
      amount_paise BIGINT NOT NULL,
      tax_paise BIGINT NOT NULL DEFAULT 0,
      auto BOOLEAN NOT NULL DEFAULT FALSE,
      voided_at TIMESTAMPTZ,
      void_reason TEXT,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_banquet_charges_event ON banquet_charges (event_id) WHERE voided_at IS NULL`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS banquet_payments (
      bp_id BIGSERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES banquet_events(event_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('ADVANCE','PAYMENT','REFUND')),
      method VARCHAR(14) NOT NULL CHECK (method IN ('CASH','UPI','CARD','BANK_TRANSFER','CHEQUE','OTHER','CREDIT')),
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      reference VARCHAR(80),
      pay_date DATE NOT NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_banquet_payments_event ON banquet_payments (event_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_banquet_payments_branch_date ON banquet_payments (branch_id, pay_date)`);
};
