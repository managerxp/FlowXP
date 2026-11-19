/*
 * Loyalty engine, phase 1: programmes, memberships, and the ledger gaining what it needs to be safe.
 *
 * Programmes: a business can run several, each with its own earning and redeeming rules held as columns (nothing is hardcoded in code).
 * Memberships: one per customer per programme, with a membership number for the till and a secret token for the customer's own link and QR code.
 * The ledger stays points_ledger (the one that already holds points): it gains the programme, membership and branch it belongs to, an idempotency key
 * so a retried request can never credit or deduct twice, and the entry a reversal undoes. A row's amounts and owner can never be changed once written:
 * a mistake is put right with a reversal row, never by editing history. (voided_at, used by older bill cancellation, is still allowed.)
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE loyalty_programmes (
      programme_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(300),
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('POINTS','VISITS','STAMPS','SPEND','CASHBACK','TIER_MEMBERSHIP','FIXED_DISCOUNT','CUSTOM')),
      logo_url VARCHAR(500),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      starts_on DATE,
      ends_on DATE,
      -- earning: earn_points for every per_amount_paise spent (per_amount_paise = 0: earn_points for every qualifying bill, as a stamp or visit does)
      earn_points INTEGER NOT NULL DEFAULT 1 CHECK (earn_points > 0),
      per_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (per_amount_paise >= 0),
      min_txn_paise BIGINT NOT NULL DEFAULT 0 CHECK (min_txn_paise >= 0),
      -- redeeming: redeem_points are worth redeem_value_paise; at least min_redeem_points at a time, at most max_redeem_per_txn on one bill
      redeem_points INTEGER NOT NULL DEFAULT 1 CHECK (redeem_points > 0),
      redeem_value_paise BIGINT NOT NULL DEFAULT 0 CHECK (redeem_value_paise >= 0),
      min_redeem_points INTEGER NOT NULL DEFAULT 1 CHECK (min_redeem_points > 0),
      max_redeem_per_txn INTEGER CHECK (max_redeem_per_txn IS NULL OR max_redeem_per_txn > 0),
      reward_limit_per_member INTEGER CHECK (reward_limit_per_member IS NULL OR reward_limit_per_member > 0),
      expiry_days INTEGER CHECK (expiry_days IS NULL OR expiry_days > 0),
      membership_days INTEGER CHECK (membership_days IS NULL OR membership_days > 0),   -- how long a membership lasts before it must be renewed
      branch_ids INTEGER[],                                                             -- null = every outlet
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
    )
  `);
  await client.query(`CREATE INDEX idx_loyalty_programmes_business ON loyalty_programmes (business_id, is_active)`);

  await client.query(`
    CREATE TABLE loyalty_memberships (
      membership_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      programme_id INTEGER NOT NULL REFERENCES loyalty_programmes(programme_id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      membership_no VARCHAR(16) NOT NULL,
      token VARCHAR(48) NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMPTZ,
      consent_marketing BOOLEAN NOT NULL DEFAULT FALSE,
      consent_at TIMESTAMPTZ,
      created_by INTEGER,
      UNIQUE (programme_id, customer_id),
      UNIQUE (business_id, membership_no),
      UNIQUE (token)
    )
  `);
  await client.query(`CREATE INDEX idx_loyalty_memberships_customer ON loyalty_memberships (business_id, customer_id)`);

  await client.query(`ALTER TABLE points_ledger ADD COLUMN programme_id INTEGER REFERENCES loyalty_programmes(programme_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE points_ledger ADD COLUMN membership_id INTEGER REFERENCES loyalty_memberships(membership_id) ON DELETE CASCADE`);
  await client.query(`ALTER TABLE points_ledger ADD COLUMN branch_id INTEGER`);
  await client.query(`ALTER TABLE points_ledger ADD COLUMN idempotency_key VARCHAR(100)`);
  await client.query(`ALTER TABLE points_ledger ADD COLUMN reverses_entry_id INTEGER REFERENCES points_ledger(entry_id) ON DELETE SET NULL`);
  await client.query(`CREATE UNIQUE INDEX uq_points_ledger_key ON points_ledger (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);
  await client.query(`CREATE INDEX idx_points_ledger_membership ON points_ledger (membership_id, entry_id) WHERE membership_id IS NOT NULL`);
  await client.query(`CREATE INDEX idx_points_ledger_reverses ON points_ledger (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL`);

  // History is never edited. Only voided_at (older bill cancellation) may change on a row.
  await client.query(`
    CREATE FUNCTION points_ledger_immutable() RETURNS trigger AS $$
    BEGIN
      IF NEW.business_id IS DISTINCT FROM OLD.business_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.kind IS DISTINCT FROM OLD.kind
         OR NEW.points IS DISTINCT FROM OLD.points OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
         OR NEW.membership_id IS DISTINCT FROM OLD.membership_id OR NEW.programme_id IS DISTINCT FROM OLD.programme_id
         OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.reverses_entry_id IS DISTINCT FROM OLD.reverses_entry_id THEN
        RAISE EXCEPTION 'A points ledger row cannot be changed: add a reversal instead';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql
  `);
  await client.query(`CREATE TRIGGER points_ledger_no_edit BEFORE UPDATE ON points_ledger FOR EACH ROW EXECUTE FUNCTION points_ledger_immutable()`);
};
