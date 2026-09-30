/*
 * Buying, completed: supplier price lists, back-orders (a delivery that arrives in parts), debit notes to
 * suppliers, and stock requests between outlets.
 *
 * Price list: what each supplier charges for a product. It fills the price on a new order, ranks suppliers for
 * a product, and flags a delivery billed above the list.
 * Back-orders: an order can be received in several deliveries. PARTIAL means "some has arrived, the rest is still
 * coming"; what is still owed is quantity minus received_quantity.
 * Debit notes: the formal document for goods sent back or a price overcharge. It reduces what we owe the supplier
 * (purchase_orders.debited_paise) and, for returns, takes the stock back out.
 * Stock requests: one outlet asks another for stock; the sending outlet fulfils it (fully or in parts) through the
 * ordinary stock transfer.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE supplier_prices (
      supplier_price_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
      min_qty NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0),
      lead_time_days SMALLINT CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 365),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (supplier_id, product_id)
    )
  `);
  await client.query(`CREATE INDEX idx_supplier_prices_product ON supplier_prices (business_id, product_id)`);

  await client.query(`ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check`);
  await client.query(`ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('DRAFT','ORDERED','PARTIAL','RECEIVED','CANCELLED'))`);
  await client.query(`ALTER TABLE purchase_orders ADD COLUMN debited_paise BIGINT NOT NULL DEFAULT 0`);
  await client.query(`DROP INDEX IF EXISTS idx_po_open`);
  await client.query(`CREATE INDEX idx_po_open ON purchase_orders (business_id, branch_id, status) WHERE status IN ('DRAFT','ORDERED','PARTIAL')`);

  await client.query(`ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check`);
  await client.query(`
    ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_transaction_type_check
      CHECK (transaction_type IN ('SALE','PURCHASE','ADJUSTMENT','RETURN','OPENING','WASTAGE','TRANSFER','PURCHASE_RETURN'))
  `);

  await client.query(`ALTER TABLE businesses ADD COLUMN debit_note_prefix VARCHAR(12) NOT NULL DEFAULT 'DN'`);
  await client.query(`ALTER TABLE businesses ADD COLUMN debit_note_next_number INTEGER NOT NULL DEFAULT 1`);
  await client.query(`
    CREATE TABLE debit_notes (
      dn_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL,
      po_id INTEGER NOT NULL REFERENCES purchase_orders(po_id),
      dn_number VARCHAR(32) NOT NULL,
      dn_date DATE NOT NULL DEFAULT CURRENT_DATE,
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('RETURN','PRICE')),
      reason VARCHAR(300) NOT NULL,
      subtotal_paise BIGINT NOT NULL DEFAULT 0,
      tax_paise BIGINT NOT NULL DEFAULT 0,
      total_paise BIGINT NOT NULL DEFAULT 0,
      applied_paise BIGINT NOT NULL DEFAULT 0,      -- taken off what we still owed on the order
      credit_paise BIGINT NOT NULL DEFAULT 0,       -- beyond that: the supplier owes us (already paid)
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_debit_notes_number ON debit_notes (business_id, dn_number)`);
  await client.query(`CREATE INDEX idx_debit_notes_po ON debit_notes (po_id)`);
  await client.query(`CREATE INDEX idx_debit_notes_supplier ON debit_notes (business_id, supplier_id, dn_date)`);
  await client.query(`
    CREATE TABLE debit_note_items (
      dn_item_id SERIAL PRIMARY KEY,
      dn_id INTEGER NOT NULL REFERENCES debit_notes(dn_id) ON DELETE CASCADE,
      po_item_id INTEGER NOT NULL REFERENCES purchase_order_items(item_id),
      product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
      description VARCHAR(200) NOT NULL,
      quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
      unit_cost_paise BIGINT NOT NULL,              -- the price per unit sent back, or the overcharge per unit
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      tax_amount_paise BIGINT NOT NULL DEFAULT 0,
      line_total_paise BIGINT NOT NULL
    )
  `);
  await client.query(`CREATE INDEX idx_dn_items_po_item ON debit_note_items (po_item_id)`);

  await client.query(`
    CREATE TABLE transfer_requests (
      request_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      from_branch_id INTEGER NOT NULL REFERENCES branches(branch_id),      -- the outlet asked to send
      to_branch_id INTEGER NOT NULL REFERENCES branches(branch_id),        -- the outlet that needs it
      status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PARTIAL','FULFILLED','REJECTED','CANCELLED','CLOSED')),
      notes VARCHAR(300),
      decision_note VARCHAR(300),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMPTZ,
      CHECK (from_branch_id <> to_branch_id)
    )
  `);
  await client.query(`CREATE INDEX idx_transfer_requests_from ON transfer_requests (business_id, from_branch_id, status)`);
  await client.query(`CREATE INDEX idx_transfer_requests_to ON transfer_requests (business_id, to_branch_id, status)`);
  await client.query(`
    CREATE TABLE transfer_request_items (
      item_id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES transfer_requests(request_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id),
      requested_qty NUMERIC(14,3) NOT NULL CHECK (requested_qty > 0),
      sent_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (sent_qty >= 0),
      UNIQUE (request_id, product_id)
    )
  `);
};
