/*
 * Salon module, part 1: the foundation.
 *
 * FlowXP already has tenants, outlets, customers, products, stock, invoices, payments, loyalty points,
 * recipes (bill of materials), suppliers, purchase orders and expenses. A salon reuses all of them. This
 * migration only adds what a salon needs that has no generic home:
 *
 *   - widening checks the salon needs (roles, product kind, payment methods, points ledger kind)
 *   - salon settings (business-wide, with per-outlet overrides)
 *   - salon_item_details: the salon-specific half of a service or a retail product (duration, gender,
 *     commission and loyalty flags) — the item itself stays a `products` row, so stock, tax, barcodes
 *     and invoices all keep working unchanged
 *   - salon staff (people who perform services; most have no FlowXP login), their per-service commission
 *     and attendance
 *   - customer profile extras and private notes
 *   - appointments and the services booked on them
 *   - salon_invoice_lines: what kind of line an invoice line was and who performed it
 *
 * Every table carries business_id (tenant) and, where the row belongs to one outlet, branch_id.
 * Money is integer paise, like everywhere else.
 */
export const up = async (client) => {
  /* ── widen existing checks ───────────────────────────────────────────── */
  await client.query(`ALTER TABLE business_users DROP CONSTRAINT IF EXISTS business_users_role_check`);
  await client.query(`
    ALTER TABLE business_users ADD CONSTRAINT business_users_role_check
      CHECK (role IN ('OWNER','ADMIN','MANAGER','CASHIER','STAFF','WAITER','KITCHEN','INVENTORY_MANAGER','DELIVERY',
                      'RECEPTIONIST','STYLIST','ACCOUNTANT'))
  `);

  // A service is a product with no stock of its own (consumables are tracked through its recipe).
  await client.query(`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_kind_check`);
  await client.query(`ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK (kind IN ('DISH','INGREDIENT','PACKAGING','SERVICE'))`);

  // WALLET (an external wallet such as Paytm) and GIFT_CARD (a FlowXP gift card redeemed at the till).
  await client.query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_method_check`);
  await client.query(`
    ALTER TABLE payments ADD CONSTRAINT payments_payment_method_check
      CHECK (payment_method IN ('CASH','UPI','CARD','BANK_TRANSFER','CREDIT','OTHER','WALLET','GIFT_CARD'))
  `);

  await client.query(`ALTER TABLE points_ledger DROP CONSTRAINT IF EXISTS points_ledger_kind_check`);
  await client.query(`ALTER TABLE points_ledger ADD CONSTRAINT points_ledger_kind_check CHECK (kind IN ('EARN','REDEEM','ADJUST','REVERSAL','EXPIRE'))`);
  // Points expire this many days after they were earned (NULL = never).
  await client.query(`ALTER TABLE points_programs ADD COLUMN IF NOT EXISTS expiry_days INTEGER CHECK (expiry_days IS NULL OR expiry_days BETWEEN 30 AND 3650)`);

  // Categories can be scoped, so the salon's service categories do not appear among retail ones.
  await client.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS item_scope VARCHAR(12) NOT NULL DEFAULT 'ANY' CHECK (item_scope IN ('ANY','SERVICE','PRODUCT','CONSUMABLE'))`);
  // A consumable whose real use varies per visit (hair colour): the till asks for the actual amount.
  await client.query(`ALTER TABLE recipe_items ADD COLUMN IF NOT EXISTS is_variable BOOLEAN NOT NULL DEFAULT FALSE`);

  /* ── settings ────────────────────────────────────────────────────────── */
  await client.query(`
    CREATE TABLE salon_settings (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      pan VARCHAR(10),
      registration_type VARCHAR(40),
      registration_no VARCHAR(60),
      -- ISO weekdays, 1 = Monday .. 7 = Sunday
      working_days JSONB NOT NULL DEFAULT '[1,2,3,4,5,6]'::jsonb,
      open_time TIME NOT NULL DEFAULT '10:00',
      close_time TIME NOT NULL DEFAULT '20:00',
      slot_minutes SMALLINT NOT NULL DEFAULT 15 CHECK (slot_minutes IN (5,10,15,20,30,60)),
      -- booking rules
      min_advance_minutes INTEGER NOT NULL DEFAULT 0 CHECK (min_advance_minutes >= 0),
      max_advance_days INTEGER NOT NULL DEFAULT 90 CHECK (max_advance_days BETWEEN 1 AND 730),
      buffer_minutes SMALLINT NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 120),
      cancellation_policy JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { min_notice_hours, fee_pct, text }
      no_show_policy JSONB NOT NULL DEFAULT '{}'::jsonb,        -- { fee_pct, text }
      -- tax: how prices are quoted, and the rates new items start with (never applied silently)
      tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
      default_service_tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (default_service_tax_rate BETWEEN 0 AND 100),
      default_product_tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (default_product_tax_rate BETWEEN 0 AND 100),
      default_service_sac VARCHAR(16),
      -- commission
      commission_on_package_use BOOLEAN NOT NULL DEFAULT TRUE,
      commission_base VARCHAR(8) NOT NULL DEFAULT 'NET' CHECK (commission_base IN ('NET','GROSS')),
      -- inventory
      expiry_alert_days INTEGER NOT NULL DEFAULT 30 CHECK (expiry_alert_days BETWEEN 1 AND 365),
      consumption_alert_factor NUMERIC(4,1) NOT NULL DEFAULT 2 CHECK (consumption_alert_factor >= 1.2),
      -- customer segments (amounts in paise)
      segment_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
      -- which payment methods the till offers
      payment_methods JSONB NOT NULL DEFAULT '["CASH","UPI","CARD","BANK_TRANSFER","WALLET"]'::jsonb,
      extra JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Per-outlet overrides. NULL = use the business setting. `ownership` prepares franchise-style groups.
  await client.query(`
    CREATE TABLE salon_branch_settings (
      branch_id INTEGER PRIMARY KEY REFERENCES branches(branch_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      working_days JSONB,
      open_time TIME,
      close_time TIME,
      slot_minutes SMALLINT CHECK (slot_minutes IS NULL OR slot_minutes IN (5,10,15,20,30,60)),
      ownership VARCHAR(10) NOT NULL DEFAULT 'OWNED' CHECK (ownership IN ('OWNED','FRANCHISE')),
      franchisee_name VARCHAR(120),
      extra JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_salon_branch_settings_business ON salon_branch_settings (business_id)`);

  /* ── services and retail items ───────────────────────────────────────── */
  await client.query(`
    CREATE TABLE salon_item_details (
      product_id INTEGER PRIMARY KEY REFERENCES products(product_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      item_type VARCHAR(8) NOT NULL CHECK (item_type IN ('SERVICE','PRODUCT')),
      duration_min SMALLINT CHECK (duration_min IS NULL OR duration_min BETWEEN 5 AND 720),
      gender VARCHAR(8) NOT NULL DEFAULT 'ANY' CHECK (gender IN ('ANY','WOMEN','MEN','KIDS')),
      points_earnable BOOLEAN NOT NULL DEFAULT TRUE,
      points_redeemable BOOLEAN NOT NULL DEFAULT TRUE,
      -- commission for this item, overriding the staff member's default; NULL = use the staff default
      commission_type VARCHAR(8) CHECK (commission_type IS NULL OR commission_type IN ('PERCENT','FIXED')),
      commission_value NUMERIC(10,2) CHECK (commission_value IS NULL OR commission_value >= 0),
      max_stock NUMERIC(14,3) CHECK (max_stock IS NULL OR max_stock >= 0),
      -- the product's own brand (L'Oreal, Wella ...): free text, unrelated to the restaurant "virtual brands" feature
      brand VARCHAR(80),
      -- when a service can be booked online / needs a specific skill
      requires_skill VARCHAR(40),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_salon_item_details_business ON salon_item_details (business_id, item_type)`);

  /* ── staff ───────────────────────────────────────────────────────────── */
  await client.query(`
    CREATE TABLE salon_staff (
      staff_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      -- the FlowXP login of this person, when they have one (a stylist sees their own appointments)
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(32),
      email VARCHAR(160),
      staff_role VARCHAR(16) NOT NULL DEFAULT 'HAIR_STYLIST'
        CHECK (staff_role IN ('HAIR_STYLIST','BARBER','BEAUTICIAN','MAKEUP_ARTIST','THERAPIST','RECEPTIONIST','MANAGER','OTHER')),
      skills JSONB NOT NULL DEFAULT '[]'::jsonb,
      -- defaults; a row in salon_staff_services or salon_item_details overrides them for one service
      commission_type VARCHAR(8) NOT NULL DEFAULT 'PERCENT' CHECK (commission_type IN ('PERCENT','FIXED')),
      commission_value NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (commission_value >= 0),
      product_commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (product_commission_pct BETWEEN 0 AND 100),
      -- { "1": { "start": "10:00", "end": "19:00" }, ... } by ISO weekday; NULL = the outlet's hours
      working_hours JSONB,
      is_bookable BOOLEAN NOT NULL DEFAULT TRUE,
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      joined_on DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_salon_staff_branch ON salon_staff (business_id, branch_id, status)`);
  await client.query(`CREATE UNIQUE INDEX uq_salon_staff_user ON salon_staff (business_id, user_id) WHERE user_id IS NOT NULL`);

  // Which services a person performs (none listed = all), with an optional commission for that service.
  await client.query(`
    CREATE TABLE salon_staff_services (
      staff_id INTEGER NOT NULL REFERENCES salon_staff(staff_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      commission_type VARCHAR(8) CHECK (commission_type IS NULL OR commission_type IN ('PERCENT','FIXED')),
      commission_value NUMERIC(10,2) CHECK (commission_value IS NULL OR commission_value >= 0),
      PRIMARY KEY (staff_id, product_id)
    )
  `);
  await client.query(`CREATE INDEX idx_salon_staff_services_product ON salon_staff_services (product_id)`);

  await client.query(`
    CREATE TABLE salon_attendance (
      attendance_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      staff_id INTEGER NOT NULL REFERENCES salon_staff(staff_id) ON DELETE CASCADE,
      work_date DATE NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'PRESENT' CHECK (status IN ('PRESENT','ABSENT','LEAVE','HALF_DAY')),
      check_in TIMESTAMPTZ,
      check_out TIMESTAMPTZ,
      note VARCHAR(200),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      UNIQUE (staff_id, work_date)
    )
  `);
  await client.query(`CREATE INDEX idx_salon_attendance_day ON salon_attendance (business_id, branch_id, work_date)`);

  /* ── customers: what a salon knows about a client ────────────────────── */
  await client.query(`
    CREATE TABLE salon_customer_profiles (
      customer_id INTEGER PRIMARY KEY REFERENCES customers(customer_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      dob DATE,
      anniversary DATE,
      gender VARCHAR(8) CHECK (gender IS NULL OR gender IN ('FEMALE','MALE','OTHER')),
      preferences TEXT,
      allergies TEXT,
      favorite_staff_id INTEGER REFERENCES salon_staff(staff_id) ON DELETE SET NULL,
      home_branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_salon_profiles_business ON salon_customer_profiles (business_id)`);
  await client.query(`CREATE INDEX idx_salon_profiles_dob ON salon_customer_profiles (business_id, (EXTRACT(MONTH FROM dob)), (EXTRACT(DAY FROM dob))) WHERE dob IS NOT NULL`);

  // Private staff notes: who wrote them and when, never edited in place.
  await client.query(`
    CREATE TABLE salon_customer_notes (
      note_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      author_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      body VARCHAR(2000) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_salon_notes_customer ON salon_customer_notes (customer_id, created_at DESC)`);

  /* ── appointments ────────────────────────────────────────────────────── */
  await client.query(`
    CREATE TABLE salon_appointments (
      appointment_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      guest_name VARCHAR(120),
      guest_phone VARCHAR(20),
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      status VARCHAR(12) NOT NULL DEFAULT 'BOOKED'
        CHECK (status IN ('BOOKED','CONFIRMED','CHECKED_IN','IN_SERVICE','COMPLETED','CANCELLED','NO_SHOW')),
      source VARCHAR(10) NOT NULL DEFAULT 'PHONE' CHECK (source IN ('PHONE','WALK_IN','ONLINE','APP')),
      notes VARCHAR(500),
      cancel_reason VARCHAR(200),
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      reminder_sent_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (end_at > start_at)
    )
  `);
  await client.query(`CREATE INDEX idx_salon_appt_branch_time ON salon_appointments (business_id, branch_id, start_at)`);
  await client.query(`CREATE INDEX idx_salon_appt_customer ON salon_appointments (customer_id, start_at DESC)`);

  await client.query(`
    CREATE TABLE salon_appointment_services (
      line_id SERIAL PRIMARY KEY,
      appointment_id INTEGER NOT NULL REFERENCES salon_appointments(appointment_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      service_id INTEGER NOT NULL REFERENCES products(product_id),
      staff_id INTEGER NOT NULL REFERENCES salon_staff(staff_id),
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      price_paise BIGINT NOT NULL DEFAULT 0,
      CHECK (end_at > start_at)
    )
  `);
  await client.query(`CREATE INDEX idx_salon_appt_lines_staff ON salon_appointment_services (staff_id, start_at)`);
  await client.query(`CREATE INDEX idx_salon_appt_lines_appt ON salon_appointment_services (appointment_id)`);

  /* ── invoice lines: what each line was, and who did it ───────────────── */
  await client.query(`
    CREATE TABLE salon_invoice_lines (
      item_id INTEGER PRIMARY KEY REFERENCES invoice_items(item_id) ON DELETE CASCADE,
      invoice_id INTEGER NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id),
      line_type VARCHAR(16) NOT NULL
        CHECK (line_type IN ('SERVICE','PRODUCT','PACKAGE','MEMBERSHIP','GIFT_CARD','PACKAGE_USE','MEMBERSHIP_USE')),
      staff_id INTEGER REFERENCES salon_staff(staff_id) ON DELETE SET NULL,
      ref_id INTEGER,                        -- package / membership plan / gift card the line sold or used
      list_price_paise BIGINT NOT NULL DEFAULT 0,
      appointment_id INTEGER REFERENCES salon_appointments(appointment_id) ON DELETE SET NULL
    )
  `);
  await client.query(`CREATE INDEX idx_salon_invoice_lines_invoice ON salon_invoice_lines (invoice_id)`);
  await client.query(`CREATE INDEX idx_salon_invoice_lines_staff ON salon_invoice_lines (business_id, staff_id)`);
  await client.query(`CREATE INDEX idx_salon_invoice_lines_type ON salon_invoice_lines (business_id, line_type)`);
};

export const down = async (client) => {
  for (const t of ['salon_invoice_lines', 'salon_appointment_services', 'salon_appointments', 'salon_customer_notes',
    'salon_customer_profiles', 'salon_attendance', 'salon_staff_services', 'salon_staff', 'salon_item_details',
    'salon_branch_settings', 'salon_settings']) {
    await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  }
  await client.query(`ALTER TABLE recipe_items DROP COLUMN IF EXISTS is_variable`);
  await client.query(`ALTER TABLE categories DROP COLUMN IF EXISTS item_scope`);
  await client.query(`ALTER TABLE points_programs DROP COLUMN IF EXISTS expiry_days`);
  // The widened role / kind / payment-method / points-kind checks are left in place: narrowing them would
  // fail as soon as a salon row exists, and widened checks are harmless to every other business type.
};
