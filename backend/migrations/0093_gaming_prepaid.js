/*
 * The gaming lounge module, part 2: players, the prepaid wallet, hour packs and tournaments.
 *
 *   gaming_players              a player = a `customers` row plus gaming details (gamer tag, a minor and the guardian, notes). Most visitors are
 *                               walk-ins and need no player at all; a wallet or a pack needs one
 *   gaming_wallet_ledger        every movement of a player's prepaid balance, signed. The balance is the sum, never a stored number. A top-up and
 *                               its bonus, each spend against a bill, a refund, an adjustment. (business, source_type, source_ref) is unique, so
 *                               a repeated top-up or a bill posted twice can never move the balance twice
 *   gaming_passes               prepaid hours bought for later (an hour pack): minutes, an expiry and the kinds of station it is good for
 *   gaming_pass_usage           the minutes a session took from a pack. Minutes left = minutes bought minus usage that has not been voided
 *   gaming_tournaments          an event: the game, the day, the entry fee and the prize pool
 *   gaming_tournament_entries   who entered, whether they paid, how they placed and what they won
 *
 * Forward only. To undo by hand (never on a live lounge): drop the tables above in reverse order.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE gaming_players (
      player_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      gamer_tag VARCHAR(40),
      is_minor BOOLEAN NOT NULL DEFAULT FALSE,
      guardian_name VARCHAR(60),
      guardian_phone VARCHAR(32),
      notes VARCHAR(300),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (business_id, customer_id)
    )`);

  await client.query(`
    CREATE TABLE gaming_wallet_ledger (
      entry_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('TOPUP','BONUS','SPEND','REFUND','ADJUST')),
      -- signed: a top-up, bonus and refund add; a spend takes away; an adjustment is either
      amount_paise BIGINT NOT NULL CHECK (amount_paise <> 0),
      source_type VARCHAR(16),
      source_ref VARCHAR(80),
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      payment_id INTEGER REFERENCES payments(payment_id) ON DELETE SET NULL,
      note VARCHAR(200),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gaming_wallet_source ON gaming_wallet_ledger (business_id, source_type, source_ref) WHERE source_ref IS NOT NULL`);
  await client.query(`CREATE INDEX idx_gaming_wallet_customer ON gaming_wallet_ledger (business_id, customer_id, created_at DESC)`);

  await client.query(`
    CREATE TABLE gaming_passes (
      pass_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      bundle_id INTEGER REFERENCES gaming_bundles(bundle_id) ON DELETE SET NULL,
      name VARCHAR(80) NOT NULL,
      minutes_total INTEGER NOT NULL CHECK (minutes_total > 0),
      kinds TEXT[],
      expires_on DATE,
      status VARCHAR(9) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_gaming_passes_customer ON gaming_passes (business_id, customer_id)`);
  await client.query(`
    CREATE TABLE gaming_pass_usage (
      usage_id SERIAL PRIMARY KEY,
      pass_id INTEGER NOT NULL REFERENCES gaming_passes(pass_id) ON DELETE CASCADE,
      session_id INTEGER NOT NULL REFERENCES gaming_sessions(session_id) ON DELETE CASCADE,
      minutes INTEGER NOT NULL CHECK (minutes > 0),
      voided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gaming_pass_usage_session ON gaming_pass_usage (session_id, pass_id) WHERE voided_at IS NULL`);
  await client.query(`ALTER TABLE gaming_sessions ADD CONSTRAINT gaming_sessions_pack_fk FOREIGN KEY (pack_id) REFERENCES gaming_passes(pass_id) ON DELETE SET NULL`);

  await client.query(`
    CREATE TABLE gaming_tournaments (
      tournament_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      game_name VARCHAR(80),
      starts_at TIMESTAMPTZ NOT NULL,
      entry_fee_paise BIGINT NOT NULL DEFAULT 0 CHECK (entry_fee_paise >= 0),
      prize_pool_paise BIGINT NOT NULL DEFAULT 0 CHECK (prize_pool_paise >= 0),
      max_players SMALLINT CHECK (max_players IS NULL OR max_players BETWEEN 2 AND 500),
      status VARCHAR(9) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('PLANNED','OPEN','RUNNING','DONE','CANCELLED')),
      notes VARCHAR(300),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_gaming_tournaments_business ON gaming_tournaments (business_id, starts_at DESC)`);
  await client.query(`
    CREATE TABLE gaming_tournament_entries (
      entry_id SERIAL PRIMARY KEY,
      tournament_id INTEGER NOT NULL REFERENCES gaming_tournaments(tournament_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      player_name VARCHAR(60) NOT NULL,
      phone VARCHAR(32),
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'REGISTERED' CHECK (status IN ('REGISTERED','CHECKED_IN','WITHDRAWN')),
      placement SMALLINT CHECK (placement IS NULL OR placement BETWEEN 1 AND 500),
      prize_paise BIGINT NOT NULL DEFAULT 0 CHECK (prize_paise >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_gaming_entry_customer ON gaming_tournament_entries (tournament_id, customer_id) WHERE customer_id IS NOT NULL AND status <> 'WITHDRAWN'`);
};
