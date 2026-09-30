/*
 * Orders, KOT and dining tables — the staging layer in front of billing.
 *
 * The brief's flow for a restaurant/café/gaming counter is: a table or
 * counter opens a running tab, items get added to it as they're ordered (in
 * more than one round, typically), the kitchen needs a physical or on-screen
 * ticket for what to cook, and only at the end does the tab become an
 * invoice. That staging step is what `orders`/`order_items` are — everything
 * about GST, stock and payment still happens exactly once, in
 * modules/billing.js, when an order is billed.
 *
 * A Kitchen Order Ticket (KOT) is not its own workflow: it's a snapshot of
 * "the items added to this order since the last ticket", grouped so the
 * kitchen sees what's new without re-cooking what already went out. Sending
 * a KOT does not touch stock or money — only billing does that.
 */

import crypto from 'node:crypto';

export const initializeOrdersSchema = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS order_prefix VARCHAR(12) NOT NULL DEFAULT 'ORD'`);
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS order_next_number INTEGER NOT NULL DEFAULT 1`);
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS kot_next_number INTEGER NOT NULL DEFAULT 1`);

  /* ======================================================================
     DINING TABLES — dine-in only; a takeaway or delivery order has none
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS dining_tables (
      table_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(60) NOT NULL,
      zone VARCHAR(60),
      seats SMALLINT,
      -- OCCUPIED is derived from "does this table have an open order", not
      -- stored redundantly, EXCEPT that a table can be RESERVED or under
      -- CLEANING with no order attached — states an order can't express.
      status VARCHAR(16) NOT NULL DEFAULT 'FREE'
        CHECK (status IN ('FREE','RESERVED','CLEANING','CLOSED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_dining_tables_business ON dining_tables (business_id)`);

  /* The unguessable path segment for a table's customer-facing QR ordering
     link (see controllers/publicOrdering.controller.js) — same idea as
     delivery_integrations.webhook_token below: not a login, just the thing
     that says which table an unauthenticated request is for. Added after the
     table already existed in earlier deployments, so existing rows need a
     one-off backfill — each needs its OWN random value, which a single
     UPDATE can't produce, hence the per-row loop. */
  await client.query(`ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS qr_token VARCHAR(64)`);
  const untokenised = (await client.query(`SELECT table_id FROM dining_tables WHERE qr_token IS NULL`)).rows;
  for (const { table_id } of untokenised) {
    await client.query(`UPDATE dining_tables SET qr_token = $1 WHERE table_id = $2`, [crypto.randomBytes(20).toString('hex'), table_id]);
  }
  await client.query(`ALTER TABLE dining_tables ALTER COLUMN qr_token SET NOT NULL`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_dining_tables_qr_token ON dining_tables (qr_token)`);

  /* ======================================================================
     ORDERS — the running tab
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS orders (
      order_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      order_number VARCHAR(32) NOT NULL,

      order_type VARCHAR(16) NOT NULL DEFAULT 'DINE_IN'
        CHECK (order_type IN ('DINE_IN','TAKEAWAY','DELIVERY')),
      table_id INTEGER REFERENCES dining_tables(table_id) ON DELETE SET NULL,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,

      -- Set only for order_type = DELIVERY. platform is which of the
      -- configured delivery_integrations this arrived through; external_*
      -- are the platform's own identifiers, kept so a support conversation
      -- ("Zomato order #4521 never showed up") can be traced back.
      platform VARCHAR(16) CHECK (platform IN ('ZOMATO','SWIGGY','ONDC','MAGICPIN')),
      external_order_id VARCHAR(120),
      external_order_number VARCHAR(60),

      status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','PREPARING','READY','SERVED','BILLED','CANCELLED')),

      notes TEXT,
      -- Set once the order is billed. The order row is kept after billing —
      -- deleting it would break the KOT/order trail an audit or a delivery
      -- platform dispute needs to point back to.
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,

      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_business_number ON orders (business_id, order_number)
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_business_status ON orders (business_id, status)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_table ON orders (table_id) WHERE status NOT IN ('BILLED','CANCELLED')`);
  /* Two open dine-in tabs on the same table at once is a data-entry accident
     waiting to overbill someone — the partial index only counts orders that
     are still running, so a billed or cancelled order never blocks reuse of
     the table. */
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_open_table
      ON orders (table_id) WHERE table_id IS NOT NULL AND status NOT IN ('BILLED','CANCELLED')
  `);

  /* ======================================================================
     KOT TICKETS — a snapshot of "what's new since the last ticket"
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS kot_tickets (
      kot_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
      kot_number VARCHAR(32) NOT NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_kot_order ON kot_tickets (order_id)`);

  /* ======================================================================
     ORDER ITEMS
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      order_item_id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
      description VARCHAR(200) NOT NULL,
      quantity NUMERIC(14,3) NOT NULL,
      unit_price_paise BIGINT NOT NULL,
      -- e.g. "no onions", "extra spicy" — printed on the KOT, never billed on.
      kitchen_notes VARCHAR(200),

      -- NULL until a "send to kitchen" groups this item into a ticket.
      kot_id INTEGER REFERENCES kot_tickets(kot_id) ON DELETE SET NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','PREPARING','READY','SERVED','CANCELLED')),

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id)`);

  /* ======================================================================
     DELIVERY INTEGRATIONS — one row per business per platform it has
     connected. Credentials are a JSONB blob because each platform's shape
     differs (Zomato/Swiggy: partner API key + outlet ID; ONDC: signing
     keys) and none of it is queried on, only round-tripped to the adapter.
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS delivery_integrations (
      integration_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      platform VARCHAR(16) NOT NULL CHECK (platform IN ('ZOMATO','SWIGGY','ONDC','MAGICPIN')),
      is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      -- Unguessable per-business-per-platform path segment for the inbound
      -- webhook URL — see modules/delivery/registry.js. Not a secret proving
      -- authenticity on its own (a real integration also checks the
      -- adapter's verifySignature()); it is what tells us WHICH business a
      -- platform's order belongs to, since a webhook carries no session.
      webhook_token VARCHAR(64) NOT NULL,
      credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_business_platform
      ON delivery_integrations (business_id, platform)
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_webhook_token ON delivery_integrations (webhook_token)
  `);

  /* Every inbound webhook call, successful or not — the record a support
     conversation about a missing delivery order starts from. */
  await client.query(`
    CREATE TABLE IF NOT EXISTS delivery_webhook_log (
      log_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(business_id) ON DELETE CASCADE,
      platform VARCHAR(16) NOT NULL,
      order_id INTEGER REFERENCES orders(order_id) ON DELETE SET NULL,
      status VARCHAR(16) NOT NULL CHECK (status IN ('RECEIVED','REJECTED','ERROR')),
      detail TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_delivery_log_business ON delivery_webhook_log (business_id, created_at DESC)`);
};
