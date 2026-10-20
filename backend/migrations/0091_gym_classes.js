/*
 * The gym module, part 5: trainers, classes, personal-training and class packs, workout plans, goals and measurements.
 *
 *   gym_trainers              a trainer (optionally linked to their staff login). A trainer with only the trainer role sees just the members assigned to them
 *   gym_class_types           Yoga, Spin, Zumba: a name, a usual length and a usual capacity
 *   gym_class_sessions        one class at one time: a trainer, a room, a capacity
 *   gym_class_bookings        a member in a class: booked, on the waitlist, cancelled, attended, no-show. One live booking per member per class
 *   gym_packs                 a pack of personal-training or class sessions that a member bought (a snapshot of the plan, billed like a membership)
 *   gym_pack_usage            each session taken from a pack: reserved at booking, kept when used or when cancelled too late, given back when cancelled in time
 *   gym_pt_sessions           a one-to-one session with a trainer
 *   gym_exercises             the exercise library
 *   gym_workout_plans / _items  a plan for a member (or a template to copy), with its exercises
 *   gym_goals / gym_measurements  what a member is working towards and their body measurements over time (private: trainers, managers and the member)
 *
 * Forward only. To undo by hand: drop these tables (in reverse order) and the added gym_settings / gym_members columns.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE gym_settings ADD COLUMN class_cancel_hours SMALLINT NOT NULL DEFAULT 4 CHECK (class_cancel_hours BETWEEN 0 AND 168)`);
  await client.query(`ALTER TABLE gym_settings ADD COLUMN pt_cancel_hours SMALLINT NOT NULL DEFAULT 12 CHECK (pt_cancel_hours BETWEEN 0 AND 168)`);
  await client.query(`ALTER TABLE gym_settings ADD COLUMN class_booking_days SMALLINT NOT NULL DEFAULT 14 CHECK (class_booking_days BETWEEN 1 AND 90)`);
  await client.query(`ALTER TABLE gym_settings ADD COLUMN class_waitlist BOOLEAN NOT NULL DEFAULT TRUE`);

  await client.query(`
    CREATE TABLE gym_trainers (
      trainer_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(32),
      bio VARCHAR(500),
      specialties VARCHAR(200),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gym_trainer_user ON gym_trainers (business_id, user_id) WHERE user_id IS NOT NULL`);
  await client.query(`ALTER TABLE gym_members ADD COLUMN assigned_trainer_id INTEGER REFERENCES gym_trainers(trainer_id) ON DELETE SET NULL`);
  await client.query(`CREATE INDEX idx_gym_members_trainer ON gym_members (assigned_trainer_id) WHERE assigned_trainer_id IS NOT NULL`);

  await client.query(`
    CREATE TABLE gym_class_types (
      class_type_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(300),
      duration_min SMALLINT NOT NULL DEFAULT 60 CHECK (duration_min BETWEEN 10 AND 480),
      default_capacity SMALLINT NOT NULL DEFAULT 20 CHECK (default_capacity BETWEEN 1 AND 500),
      -- a class that is not part of the membership and takes a session from a class pack
      requires_pack BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )`);

  await client.query(`
    CREATE TABLE gym_class_sessions (
      session_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      class_type_id INTEGER NOT NULL REFERENCES gym_class_types(class_type_id) ON DELETE CASCADE,
      trainer_id INTEGER REFERENCES gym_trainers(trainer_id) ON DELETE SET NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      capacity SMALLINT NOT NULL CHECK (capacity BETWEEN 1 AND 500),
      room VARCHAR(60),
      status VARCHAR(10) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','CANCELLED','COMPLETED')),
      cancel_reason VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (ends_at > starts_at)
    )`);
  await client.query(`CREATE INDEX idx_gym_sessions_day ON gym_class_sessions (business_id, branch_id, starts_at)`);
  await client.query(`CREATE INDEX idx_gym_sessions_trainer ON gym_class_sessions (trainer_id, starts_at) WHERE status = 'SCHEDULED'`);

  await client.query(`
    CREATE TABLE gym_packs (
      pack_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES gym_plans(plan_id) ON DELETE SET NULL,
      plan_name VARCHAR(80) NOT NULL,
      kind VARCHAR(12) NOT NULL CHECK (kind IN ('PT_PACK','CLASS_PACK')),
      sessions_total INTEGER NOT NULL CHECK (sessions_total > 0),
      start_date DATE NOT NULL,
      expires_on DATE NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
      price_paise BIGINT NOT NULL DEFAULT 0,
      payment_policy VARCHAR(14) NOT NULL DEFAULT 'FULL_REQUIRED',
      payment_basis VARCHAR(10) NOT NULL DEFAULT 'INVOICE' CHECK (payment_basis IN ('INVOICE','COMPED')),
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (expires_on >= start_date)
    )`);
  await client.query(`CREATE INDEX idx_gym_packs_member ON gym_packs (member_id, status, expires_on)`);

  await client.query(`
    CREATE TABLE gym_pt_sessions (
      pt_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      trainer_id INTEGER NOT NULL REFERENCES gym_trainers(trainer_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      pack_id INTEGER REFERENCES gym_packs(pack_id) ON DELETE SET NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','COMPLETED','CANCELLED','NO_SHOW')),
      notes VARCHAR(500),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (ends_at > starts_at)
    )`);
  await client.query(`CREATE INDEX idx_gym_pt_trainer ON gym_pt_sessions (trainer_id, starts_at) WHERE status = 'SCHEDULED'`);
  await client.query(`CREATE INDEX idx_gym_pt_member ON gym_pt_sessions (member_id, starts_at)`);

  await client.query(`
    CREATE TABLE gym_class_bookings (
      booking_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      session_id INTEGER NOT NULL REFERENCES gym_class_sessions(session_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      status VARCHAR(10) NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','WAITLISTED','CANCELLED','ATTENDED','NO_SHOW')),
      pack_id INTEGER REFERENCES gym_packs(pack_id) ON DELETE SET NULL,
      source VARCHAR(10) NOT NULL DEFAULT 'STAFF' CHECK (source IN ('STAFF','MEMBER')),
      late_cancel BOOLEAN NOT NULL DEFAULT FALSE,
      booked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cancelled_at TIMESTAMPTZ,
      attended_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL
    )`);
  // one live booking per member per class, enforced by the database, so two taps cannot book a seat twice
  await client.query(`CREATE UNIQUE INDEX uq_gym_booking_live ON gym_class_bookings (session_id, member_id) WHERE status <> 'CANCELLED'`);
  await client.query(`CREATE INDEX idx_gym_bookings_member ON gym_class_bookings (member_id, status)`);

  await client.query(`
    CREATE TABLE gym_pack_usage (
      usage_id SERIAL PRIMARY KEY,
      pack_id INTEGER NOT NULL REFERENCES gym_packs(pack_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      ref_type VARCHAR(8) NOT NULL CHECK (ref_type IN ('PT','CLASS')),
      ref_id INTEGER NOT NULL,
      status VARCHAR(9) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','CONSUMED','RELEASED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gym_pack_usage_ref ON gym_pack_usage (ref_type, ref_id) WHERE status <> 'RELEASED'`);
  await client.query(`CREATE INDEX idx_gym_pack_usage_pack ON gym_pack_usage (pack_id, status)`);

  await client.query(`
    CREATE TABLE gym_exercises (
      exercise_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      muscle_group VARCHAR(40),
      equipment VARCHAR(60),
      instructions VARCHAR(1000),
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gym_exercise_name ON gym_exercises (business_id, lower(name))`);

  await client.query(`
    CREATE TABLE gym_workout_plans (
      workout_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      member_id INTEGER REFERENCES gym_members(member_id) ON DELETE CASCADE,
      trainer_id INTEGER REFERENCES gym_trainers(trainer_id) ON DELETE SET NULL,
      name VARCHAR(100) NOT NULL,
      goal VARCHAR(200),
      notes VARCHAR(1000),
      is_template BOOLEAN NOT NULL DEFAULT FALSE,
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((is_template AND member_id IS NULL) OR (NOT is_template AND member_id IS NOT NULL))
    )`);
  await client.query(`CREATE INDEX idx_gym_workouts_member ON gym_workout_plans (member_id, status)`);

  await client.query(`
    CREATE TABLE gym_workout_items (
      item_id SERIAL PRIMARY KEY,
      workout_id INTEGER NOT NULL REFERENCES gym_workout_plans(workout_id) ON DELETE CASCADE,
      day_no SMALLINT NOT NULL DEFAULT 1 CHECK (day_no BETWEEN 1 AND 14),
      position SMALLINT NOT NULL DEFAULT 0,
      exercise_id INTEGER REFERENCES gym_exercises(exercise_id) ON DELETE SET NULL,
      exercise_name VARCHAR(100) NOT NULL,
      sets SMALLINT CHECK (sets IS NULL OR sets BETWEEN 1 AND 50),
      reps VARCHAR(20),
      rest_seconds SMALLINT CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 1800),
      weight_kg NUMERIC(6,2) CHECK (weight_kg IS NULL OR weight_kg >= 0),
      notes VARCHAR(200)
    )`);
  await client.query(`CREATE INDEX idx_gym_workout_items ON gym_workout_items (workout_id, day_no, position)`);

  await client.query(`
    CREATE TABLE gym_goals (
      goal_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      description VARCHAR(200) NOT NULL,
      metric VARCHAR(20) CHECK (metric IS NULL OR metric IN ('WEIGHT_KG','BODY_FAT_PCT','WAIST_CM','OTHER')),
      target_value NUMERIC(8,2),
      target_date DATE,
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ACHIEVED','DROPPED')),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  await client.query(`
    CREATE TABLE gym_measurements (
      measurement_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      measured_on DATE NOT NULL,
      weight_kg NUMERIC(6,2) CHECK (weight_kg IS NULL OR weight_kg BETWEEN 10 AND 500),
      height_cm NUMERIC(5,1) CHECK (height_cm IS NULL OR height_cm BETWEEN 50 AND 260),
      body_fat_pct NUMERIC(4,1) CHECK (body_fat_pct IS NULL OR body_fat_pct BETWEEN 2 AND 80),
      waist_cm NUMERIC(5,1) CHECK (waist_cm IS NULL OR waist_cm BETWEEN 30 AND 250),
      chest_cm NUMERIC(5,1) CHECK (chest_cm IS NULL OR chest_cm BETWEEN 30 AND 250),
      hips_cm NUMERIC(5,1) CHECK (hips_cm IS NULL OR hips_cm BETWEEN 30 AND 250),
      notes VARCHAR(300),
      recorded_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_gym_measurements_member ON gym_measurements (member_id, measured_on DESC)`);
};
