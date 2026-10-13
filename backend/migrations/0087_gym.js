/*
 * The gym module (business type GYM), part 1: members, plans, memberships, credentials, access decisions and attendance.
 *
 *   gym_settings           per business: member numbering, default grace, duplicate-scan cooldown, check-out, self check-in controls, public address
 *   gym_branch_settings    per outlet: opening hours, holidays and the entrance QR token (a link to the check-in page; it grants nothing)
 *   gym_plans              what is sold: duration, price, GST, branches and times it is good for, grace, freeze and payment rules
 *   gym_members            a member = a `customers` row plus gym details (code, status, emergency contact, consent, a restricted health note)
 *   gym_memberships        one bought membership (a snapshot of the plan). Stored status is only ACTIVE / CANCELLED / TRANSFERRED: "not started",
 *                          "frozen", "expired", "in grace" and "unpaid" are worked out from dates, freezes and the invoice at the moment of use
 *   gym_freezes            a paused stretch of a membership (its end date moves out by the days frozen)
 *   gym_membership_events  the lifecycle history of a membership (sold, frozen, extended, cancelled, transferred ...)
 *   gym_credentials        a member's QR credentials. A printed card stores only the SHA-256 of its random token; a digital pass has no static token
 *   gym_access_events      every access decision, approved or denied, from any source (reception, self check-in, gate), with a reason code
 *   gym_attendance         the visits that came out of approved decisions (check-in, optional check-out)
 *
 * Forward only. To undo by hand (never on a live gym): drop the tables above in reverse order and restore business_users_role_check without
 * GYM_RECEPTIONIST and TRAINER. Nothing here changes an existing table except that role constraint.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE business_users DROP CONSTRAINT IF EXISTS business_users_role_check`);
  await client.query(`
    ALTER TABLE business_users ADD CONSTRAINT business_users_role_check CHECK (role IN (
      'OWNER','ADMIN','MANAGER','CASHIER','STAFF','WAITER','KITCHEN','INVENTORY_MANAGER','DELIVERY','RECEPTIONIST','STYLIST','ACCOUNTANT',
      'SALES_MANAGER','SALES_EXECUTIVE','WAREHOUSE_MANAGER','WAREHOUSE_STAFF','PURCHASE_MANAGER','DISTRIBUTOR_ADMIN','FIELD_SALES',
      'COLLECTION_EXECUTIVE','DELIVERY_MANAGER','PHARMACIST','SALES_STAFF','GRN_MANAGER','AUDITOR',
      'FRONT_DESK','HOUSEKEEPER','HOUSEKEEPING_SUPERVISOR','NIGHT_AUDITOR','BANQUET_MANAGER','HR_MANAGER',
      'GYM_RECEPTIONIST','TRAINER'))`);

  await client.query(`
    CREATE TABLE gym_settings (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      public_slug VARCHAR(40),
      member_prefix VARCHAR(8) NOT NULL DEFAULT 'GYM',
      next_member_no INTEGER NOT NULL DEFAULT 1,
      grace_days SMALLINT NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 60),
      cooldown_seconds INTEGER NOT NULL DEFAULT 120 CHECK (cooldown_seconds BETWEEN 0 AND 3600),
      visits_per_day SMALLINT NOT NULL DEFAULT 0 CHECK (visits_per_day BETWEEN 0 AND 20),
      checkout_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      reception_confirm BOOLEAN NOT NULL DEFAULT FALSE,
      self_checkin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      -- when on, a member must also type the code shown at the front desk today, which keeps a photo of the entrance poster from checking people in from home
      self_checkin_daily_code BOOLEAN NOT NULL DEFAULT FALSE,
      self_checkin_fresh_otp_minutes INTEGER CHECK (self_checkin_fresh_otp_minutes IS NULL OR self_checkin_fresh_otp_minutes BETWEEN 1 AND 1440),
      session_days SMALLINT NOT NULL DEFAULT 30 CHECK (session_days BETWEEN 1 AND 90),
      pass_ttl_seconds SMALLINT NOT NULL DEFAULT 60 CHECK (pass_ttl_seconds BETWEEN 15 AND 300),
      travel_minutes SMALLINT NOT NULL DEFAULT 30 CHECK (travel_minutes BETWEEN 0 AND 600),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gym_slug ON gym_settings (lower(public_slug)) WHERE public_slug IS NOT NULL`);

  await client.query(`
    CREATE TABLE gym_branch_settings (
      branch_id INTEGER PRIMARY KEY REFERENCES branches(branch_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      checkin_token VARCHAR(32) NOT NULL,
      -- NULL = open all day. Otherwise { "0": { "open": "06:00", "close": "22:00" }, ... } by weekday (0 = Sunday); a weekday with no entry is closed.
      hours JSONB,
      holidays JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gym_checkin_token ON gym_branch_settings (checkin_token)`);

  await client.query(`
    CREATE TABLE gym_plans (
      plan_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(300),
      kind VARCHAR(12) NOT NULL DEFAULT 'MEMBERSHIP' CHECK (kind IN ('MEMBERSHIP','PT_PACK','CLASS_PACK')),
      audience VARCHAR(12) NOT NULL DEFAULT 'STANDARD' CHECK (audience IN ('STANDARD','STUDENT','FAMILY','CORPORATE')),
      duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 3660),
      price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 18 CHECK (tax_rate BETWEEN 0 AND 100),
      hsn_sac VARCHAR(16),
      sessions INTEGER CHECK (sessions IS NULL OR sessions > 0),
      max_members SMALLINT NOT NULL DEFAULT 1 CHECK (max_members BETWEEN 1 AND 50),
      -- NULL = every outlet of the business
      allowed_branch_ids INTEGER[],
      -- NULL = any time the outlet is open. Otherwise { "days": [1,2,3,4,5], "from": "06:00", "to": "11:00" } (an off-peak plan).
      time_window JSONB,
      grace_days SMALLINT CHECK (grace_days IS NULL OR grace_days BETWEEN 0 AND 60),
      -- FULL_REQUIRED: paid in full. ANY_PAYMENT: something has been paid. PAY_LATER: open until pay_later_days after the start, then paid in full.
      payment_policy VARCHAR(14) NOT NULL DEFAULT 'FULL_REQUIRED' CHECK (payment_policy IN ('FULL_REQUIRED','ANY_PAYMENT','PAY_LATER')),
      pay_later_days SMALLINT NOT NULL DEFAULT 0 CHECK (pay_later_days BETWEEN 0 AND 90),
      freeze_allowed BOOLEAN NOT NULL DEFAULT TRUE,
      max_freeze_days INTEGER NOT NULL DEFAULT 30 CHECK (max_freeze_days BETWEEN 0 AND 365),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_gym_plans_business ON gym_plans (business_id, is_active)`);

  await client.query(`
    CREATE TABLE gym_members (
      member_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      member_code VARCHAR(20) NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED','ARCHIVED')),
      status_reason VARCHAR(200),
      joined_on DATE NOT NULL DEFAULT CURRENT_DATE,
      dob DATE,
      gender VARCHAR(10) CHECK (gender IS NULL OR gender IN ('FEMALE','MALE','OTHER')),
      emergency_name VARCHAR(120),
      emergency_phone VARCHAR(32),
      photo_url TEXT,
      company VARCHAR(120),
      -- the person who pays for a family or corporate group; NULL for an independent member
      head_member_id INTEGER REFERENCES gym_members(member_id) ON DELETE SET NULL,
      consent_marketing BOOLEAN NOT NULL DEFAULT FALSE,
      consent_data_at TIMESTAMPTZ,
      -- restricted: only people with the gym_trainer or gym_setup permission may read or write it
      health_notes TEXT,
      merged_into INTEGER REFERENCES gym_members(member_id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (business_id, member_code),
      UNIQUE (customer_id)
    )`);
  await client.query(`CREATE INDEX idx_gym_members_business ON gym_members (business_id, status)`);
  await client.query(`CREATE INDEX idx_gym_members_head ON gym_members (head_member_id) WHERE head_member_id IS NOT NULL`);

  await client.query(`
    CREATE TABLE gym_memberships (
      membership_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      plan_id INTEGER REFERENCES gym_plans(plan_id) ON DELETE SET NULL,
      plan_name VARCHAR(80) NOT NULL,
      kind VARCHAR(12) NOT NULL DEFAULT 'MEMBERSHIP',
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','TRANSFERRED')),
      price_paise BIGINT NOT NULL DEFAULT 0,
      -- what the access rules read: copied from the plan when it was sold, so editing a plan never changes what someone already bought
      allowed_branch_ids INTEGER[],
      time_window JSONB,
      grace_days SMALLINT,
      payment_policy VARCHAR(14) NOT NULL DEFAULT 'FULL_REQUIRED',
      pay_later_until DATE,
      freeze_allowed BOOLEAN NOT NULL DEFAULT TRUE,
      max_freeze_days INTEGER NOT NULL DEFAULT 30,
      -- more than 1: the head member's membership also covers that many people in all (themselves and their dependents)
      max_members SMALLINT NOT NULL DEFAULT 1,
      -- INVOICE: paid through invoice_id. COMPED: given free by the owner. TRANSFER: carried over from another member's membership.
      payment_basis VARCHAR(10) NOT NULL DEFAULT 'INVOICE' CHECK (payment_basis IN ('INVOICE','COMPED','TRANSFER')),
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      renewed_from INTEGER REFERENCES gym_memberships(membership_id) ON DELETE SET NULL,
      transferred_from INTEGER REFERENCES gym_memberships(membership_id) ON DELETE SET NULL,
      cancelled_at TIMESTAMPTZ,
      cancel_reason VARCHAR(200),
      reminder_sent_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (end_date >= start_date)
    )`);
  await client.query(`CREATE INDEX idx_gym_memberships_member ON gym_memberships (member_id, status, end_date)`);
  await client.query(`CREATE INDEX idx_gym_memberships_end ON gym_memberships (business_id, status, end_date)`);
  await client.query(`CREATE INDEX idx_gym_memberships_invoice ON gym_memberships (invoice_id) WHERE invoice_id IS NOT NULL`);

  await client.query(`
    CREATE TABLE gym_freezes (
      freeze_id SERIAL PRIMARY KEY,
      membership_id INTEGER NOT NULL REFERENCES gym_memberships(membership_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      from_date DATE NOT NULL,
      to_date DATE NOT NULL,
      reason VARCHAR(200),
      ended_early_on DATE,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (to_date >= from_date)
    )`);
  await client.query(`CREATE INDEX idx_gym_freezes_membership ON gym_freezes (membership_id)`);

  await client.query(`
    CREATE TABLE gym_membership_events (
      event_id BIGSERIAL PRIMARY KEY,
      membership_id INTEGER NOT NULL REFERENCES gym_memberships(membership_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      kind VARCHAR(16) NOT NULL,
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      actor_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_gym_membership_events ON gym_membership_events (membership_id, created_at)`);

  await client.query(`
    CREATE TABLE gym_credentials (
      credential_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      -- CARD: a printed static QR. DIGITAL: the member's phone pass (its short-lived tokens live in gym_pass_tokens).
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('CARD','DIGITAL')),
      -- SHA-256 of the random token; the token itself is shown once, when the card is made. NULL for DIGITAL.
      token_hash CHAR(64),
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','REPLACED')),
      expires_at TIMESTAMPTZ,
      issued_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TIMESTAMPTZ,
      revoked_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      revoke_reason VARCHAR(200),
      replaced_by INTEGER REFERENCES gym_credentials(credential_id) ON DELETE SET NULL,
      last_used_at TIMESTAMPTZ,
      last_used_branch INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      CHECK ((kind = 'CARD' AND token_hash IS NOT NULL) OR (kind = 'DIGITAL' AND token_hash IS NULL))
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gym_credential_hash ON gym_credentials (token_hash) WHERE token_hash IS NOT NULL`);
  // one live card and one digital pass per member
  await client.query(`CREATE UNIQUE INDEX uq_gym_credential_live ON gym_credentials (member_id, kind) WHERE status = 'ACTIVE'`);

  await client.query(`
    CREATE TABLE gym_access_events (
      event_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      member_id INTEGER REFERENCES gym_members(member_id) ON DELETE SET NULL,
      credential_id INTEGER REFERENCES gym_credentials(credential_id) ON DELETE SET NULL,
      membership_id INTEGER REFERENCES gym_memberships(membership_id) ON DELETE SET NULL,
      source VARCHAR(10) NOT NULL CHECK (source IN ('RECEPTION','SELF','DEVICE')),
      action VARCHAR(4) NOT NULL DEFAULT 'IN' CHECK (action IN ('IN','OUT')),
      decision VARCHAR(8) NOT NULL CHECK (decision IN ('APPROVED','DENIED')),
      reason_code VARCHAR(40) NOT NULL,
      -- never a token, an OTP or a payment detail: only what an auditor needs to follow the decision
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      device_id INTEGER,
      actor_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      idempotency_key VARCHAR(80),
      -- the server's clock decides. A device's own timestamp is kept beside it, never used for the decision.
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      device_time TIMESTAMPTZ,
      attendance_id INTEGER
    )`);
  await client.query(`CREATE INDEX idx_gym_events_business_time ON gym_access_events (business_id, occurred_at DESC)`);
  await client.query(`CREATE INDEX idx_gym_events_member ON gym_access_events (member_id, occurred_at DESC)`);
  await client.query(`CREATE UNIQUE INDEX uq_gym_event_idem ON gym_access_events (business_id, source, idempotency_key) WHERE idempotency_key IS NOT NULL`);

  await client.query(`
    CREATE TABLE gym_attendance (
      attendance_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      membership_id INTEGER REFERENCES gym_memberships(membership_id) ON DELETE SET NULL,
      check_in_at TIMESTAMPTZ NOT NULL,
      check_out_at TIMESTAMPTZ,
      -- the gym's own calendar day of the check-in (in the business timezone), so reports never depend on the server's zone
      local_date DATE NOT NULL,
      source VARCHAR(10) NOT NULL CHECK (source IN ('RECEPTION','SELF','DEVICE')),
      device_id INTEGER,
      -- PROVISIONAL: reported by a device that could not reach the server; CONFIRMED once the server has validated it
      status VARCHAR(12) NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','PROVISIONAL','VOIDED')),
      access_event_id BIGINT REFERENCES gym_access_events(event_id) ON DELETE SET NULL,
      void_reason VARCHAR(200),
      corrected_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_gym_attendance_day ON gym_attendance (business_id, branch_id, local_date)`);
  await client.query(`CREATE INDEX idx_gym_attendance_member ON gym_attendance (member_id, check_in_at DESC)`);
  // one attendance row per approved decision: a replayed decision can never record a second visit
  await client.query(`CREATE UNIQUE INDEX uq_gym_attendance_event ON gym_attendance (access_event_id) WHERE access_event_id IS NOT NULL`);
};
