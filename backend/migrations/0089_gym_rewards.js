/*
 * The gym module, part 3: rewards, referrals and reminders.
 *
 *   gym_reward_rules          per gym: what earns points (visits, paid renewals, referrals, milestones, birthdays), caps, expiry, what a point is worth
 *   gym_rewards               the catalogue: free days, a discount, a gift, each for a number of points
 *   gym_points_ledger         every change to a member's points. The balance is the sum of the ledger and nothing else. An earn row is a "lot": it has
 *                             `remaining` and an expiry date, so spending uses the oldest points first and expiry takes only what is unspent.
 *                             (source_type, source_ref) is unique per member: the same event can never pay twice, however often it is replayed.
 *   gym_reward_redemptions    a member spending points on a catalogue item, and whether it has been handed over
 *   gym_automations          which reminders a gym has switched on, and their settings
 *   gym_message_log           one row per reminder sent (unique per automation and record), so a retry or a second worker never sends it twice
 *
 * The general loyalty program (visit card, points and tiers on the till) is separate and keeps working; gym rewards are keyed to membership events, which the
 * till's points do not know about, and need replay-proof awards and expiry that the till's ledger does not have.
 *
 * Forward only. To undo by hand: drop these tables and the two added gym_members columns.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE gym_members ADD COLUMN referred_by INTEGER REFERENCES gym_members(member_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE gym_members ADD COLUMN rewards_excluded BOOLEAN NOT NULL DEFAULT FALSE`);

  await client.query(`
    CREATE TABLE gym_reward_rules (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      visit_points INTEGER NOT NULL DEFAULT 1 CHECK (visit_points BETWEEN 0 AND 1000),
      renewal_flat_points INTEGER NOT NULL DEFAULT 0 CHECK (renewal_flat_points BETWEEN 0 AND 100000),
      renewal_points_per_100 NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (renewal_points_per_100 BETWEEN 0 AND 1000),
      referral_points INTEGER NOT NULL DEFAULT 0 CHECK (referral_points BETWEEN 0 AND 100000),
      referee_points INTEGER NOT NULL DEFAULT 0 CHECK (referee_points BETWEEN 0 AND 100000),
      birthday_points INTEGER NOT NULL DEFAULT 0 CHECK (birthday_points BETWEEN 0 AND 100000),
      -- [{ "visits": 10, "points": 50 }, ...]: paid once, when the member's visit count reaches it
      milestones JSONB NOT NULL DEFAULT '[]'::jsonb,
      expiry_days INTEGER CHECK (expiry_days IS NULL OR expiry_days BETWEEN 1 AND 3650),
      max_points_per_day INTEGER CHECK (max_points_per_day IS NULL OR max_points_per_day > 0),
      min_redeem_points INTEGER NOT NULL DEFAULT 0 CHECK (min_redeem_points >= 0),
      -- what one point is worth, for the "what we owe in points" figure only
      point_value_paise INTEGER NOT NULL DEFAULT 100 CHECK (point_value_paise >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  await client.query(`
    CREATE TABLE gym_rewards (
      reward_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(300),
      points_cost INTEGER NOT NULL CHECK (points_cost > 0),
      -- FREE_DAYS is applied to the member's running membership at once; the others are handed over by the desk
      kind VARCHAR(10) NOT NULL DEFAULT 'ITEM' CHECK (kind IN ('FREE_DAYS','DISCOUNT','ITEM')),
      value NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
      stock INTEGER CHECK (stock IS NULL OR stock >= 0),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_gym_rewards_business ON gym_rewards (business_id, is_active)`);

  await client.query(`
    CREATE TABLE gym_points_ledger (
      entry_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('EARN','REDEEM','EXPIRE','REVERSAL','ADJUST')),
      points INTEGER NOT NULL CHECK (points <> 0),
      -- EARN rows only: how many of these points are still unspent and unexpired
      remaining INTEGER CHECK (remaining IS NULL OR remaining >= 0),
      expires_on DATE,
      reason VARCHAR(20) NOT NULL,
      source_type VARCHAR(20) NOT NULL,
      source_ref VARCHAR(80),
      note VARCHAR(200),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((kind = 'EARN' AND remaining IS NOT NULL) OR kind <> 'EARN')
    )`);
  await client.query(`CREATE INDEX idx_gym_points_member ON gym_points_ledger (member_id, entry_id)`);
  await client.query(`CREATE INDEX idx_gym_points_lots ON gym_points_ledger (member_id, expires_on) WHERE kind = 'EARN' AND remaining > 0`);
  await client.query(`CREATE UNIQUE INDEX uq_gym_points_source ON gym_points_ledger (business_id, member_id, source_type, source_ref) WHERE source_ref IS NOT NULL`);

  await client.query(`
    CREATE TABLE gym_reward_redemptions (
      redemption_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      reward_id INTEGER REFERENCES gym_rewards(reward_id) ON DELETE SET NULL,
      reward_name VARCHAR(80) NOT NULL,
      reward_kind VARCHAR(10) NOT NULL,
      reward_value NUMERIC(10,2) NOT NULL DEFAULT 0,
      points INTEGER NOT NULL CHECK (points > 0),
      status VARCHAR(10) NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','FULFILLED','CANCELLED')),
      ledger_entry_id BIGINT REFERENCES gym_points_ledger(entry_id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fulfilled_at TIMESTAMPTZ,
      note VARCHAR(200)
    )`);
  await client.query(`CREATE INDEX idx_gym_redemptions_member ON gym_reward_redemptions (member_id, created_at DESC)`);

  await client.query(`
    CREATE TABLE gym_automations (
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      automation_key VARCHAR(30) NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (business_id, automation_key)
    )`);

  await client.query(`
    CREATE TABLE gym_message_log (
      log_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      automation_key VARCHAR(30) NOT NULL,
      ref VARCHAR(80) NOT NULL,
      member_id INTEGER REFERENCES gym_members(member_id) ON DELETE CASCADE,
      sent_on DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (business_id, automation_key, ref)
    )`);
};
