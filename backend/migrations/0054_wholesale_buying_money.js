/*
 * Wholesale module, part 3: goods receipt, receipts from customers (with allocation to invoices), returns, ledger
 * adjustments, and the supplier-invoice details a purchase order needs.
 *
 * Purchase orders (and their payments and debit notes) already exist. A GRN is a receipt against one: what arrived,
 * what was damaged, what was accepted into stock, with batch / expiry / serial. A customer RECEIPT is one payment
 * that may settle several invoices: each allocation is an ordinary `payments` row on the invoice (so invoice
 * balances keep working everywhere), tied back to the receipt; whatever is not allocated stays as the customer's
 * advance and shows on their ledger.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check`);
  await client.query(`ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('DRAFT','ORDERED','CONFIRMED','PARTIAL','RECEIVED','CANCELLED'))`);
  await client.query(`
    ALTER TABLE purchase_orders
      ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER,
      ADD COLUMN IF NOT EXISTS supplier_invoice_no VARCHAR(40),
      ADD COLUMN IF NOT EXISTS supplier_invoice_date DATE,
      ADD COLUMN IF NOT EXISTS due_date DATE,
      ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ
  `);
  await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_id INTEGER`);

  await client.query(`
    CREATE TABLE wholesale_grns (
      grn_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      po_id INTEGER REFERENCES purchase_orders(po_id) ON DELETE SET NULL,
      supplier_id INTEGER REFERENCES suppliers(supplier_id),
      grn_number VARCHAR(32) NOT NULL,
      grn_date DATE NOT NULL,
      supplier_invoice_no VARCHAR(40),
      supplier_invoice_date DATE,
      notes VARCHAR(300),
      status VARCHAR(10) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
      total_cost_paise BIGINT NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX idx_ws_grn_number ON wholesale_grns (business_id, grn_number)`);
  await client.query(`CREATE INDEX idx_ws_grn_po ON wholesale_grns (po_id)`);
  await client.query(`CREATE INDEX idx_ws_grn_branch ON wholesale_grns (business_id, branch_id, grn_date DESC)`);
  await client.query(`
    CREATE TABLE wholesale_grn_items (
      grn_item_id SERIAL PRIMARY KEY,
      grn_id INTEGER NOT NULL REFERENCES wholesale_grns(grn_id) ON DELETE CASCADE,
      po_item_id INTEGER REFERENCES purchase_order_items(item_id) ON DELETE SET NULL,
      product_id INTEGER NOT NULL REFERENCES products(product_id),
      unit_name VARCHAR(24) NOT NULL,
      unit_factor NUMERIC(14,4) NOT NULL DEFAULT 1,
      ordered_base NUMERIC(14,3),
      received_base NUMERIC(14,3) NOT NULL CHECK (received_base >= 0),
      damaged_base NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (damaged_base >= 0),
      accepted_base NUMERIC(14,3) NOT NULL CHECK (accepted_base >= 0),
      cost_paise_per_base NUMERIC(14,4) NOT NULL DEFAULT 0,
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      batch_no VARCHAR(40),
      mfg_date DATE,
      expiry_date DATE,
      location_id INTEGER REFERENCES wholesale_locations(location_id) ON DELETE SET NULL,
      serials TEXT,
      notes VARCHAR(200),
      CHECK (damaged_base + accepted_base <= received_base + 0.0005)
    )
  `);
  await client.query(`CREATE INDEX idx_ws_grn_items ON wholesale_grn_items (grn_id)`);

  await client.query(`
    CREATE TABLE wholesale_receipts (
      receipt_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id),
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
      receipt_number VARCHAR(32) NOT NULL,
      receipt_date DATE NOT NULL,
      method VARCHAR(16) NOT NULL CHECK (method IN ('CASH','UPI','BANK_TRANSFER','CARD','CHEQUE','OTHER')),
      reference VARCHAR(80),
      cheque_date DATE,
      bank VARCHAR(80),
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      allocated_paise BIGINT NOT NULL DEFAULT 0 CHECK (allocated_paise >= 0),
      kind VARCHAR(8) NOT NULL DEFAULT 'RECEIPT' CHECK (kind IN ('RECEIPT','REFUND')),
      status VARCHAR(10) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','REVERSED')),
      reversed_at TIMESTAMPTZ,
      reversed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      reverse_reason VARCHAR(200),
      notes VARCHAR(300),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (allocated_paise <= amount_paise)
    )
  `);
  await client.query(`CREATE UNIQUE INDEX idx_ws_receipt_number ON wholesale_receipts (business_id, receipt_number)`);
  await client.query(`CREATE INDEX idx_ws_receipt_customer ON wholesale_receipts (business_id, customer_id, receipt_date DESC)`);
  await client.query(`
    CREATE TABLE wholesale_receipt_allocations (
      alloc_id SERIAL PRIMARY KEY,
      receipt_id INTEGER NOT NULL REFERENCES wholesale_receipts(receipt_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      invoice_id INTEGER NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
      payment_id INTEGER,
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_ws_alloc_receipt ON wholesale_receipt_allocations (receipt_id)`);
  await client.query(`CREATE INDEX idx_ws_alloc_invoice ON wholesale_receipt_allocations (invoice_id)`);

  await client.query(`
    CREATE TABLE wholesale_ledger_adjustments (
      adj_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      party_type VARCHAR(10) NOT NULL CHECK (party_type IN ('CUSTOMER','SUPPLIER')),
      party_id INTEGER NOT NULL,
      adj_date DATE NOT NULL,
      amount_paise BIGINT NOT NULL CHECK (amount_paise <> 0),
      reason VARCHAR(200) NOT NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_ws_adj_party ON wholesale_ledger_adjustments (business_id, party_type, party_id)`);

  await client.query(`
    CREATE TABLE wholesale_returns (
      return_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('SALE','PURCHASE')),
      return_number VARCHAR(32) NOT NULL,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      cn_id INTEGER,
      po_id INTEGER REFERENCES purchase_orders(po_id) ON DELETE SET NULL,
      dn_id INTEGER,
      customer_id INTEGER REFERENCES customers(customer_id),
      supplier_id INTEGER REFERENCES suppliers(supplier_id),
      reason VARCHAR(20) NOT NULL CHECK (reason IN ('DAMAGED','WRONG_PRODUCT','EXCESS_QUANTITY','EXPIRED','CUSTOMER_REJECTION','QUALITY','OTHER')),
      notes VARCHAR(300),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX idx_ws_return_number ON wholesale_returns (business_id, return_number)`);
  await client.query(`
    CREATE TABLE wholesale_return_items (
      return_item_id SERIAL PRIMARY KEY,
      return_id INTEGER NOT NULL REFERENCES wholesale_returns(return_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id),
      invoice_item_id INTEGER,
      quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
      unit_name VARCHAR(24),
      base_qty NUMERIC(14,3) NOT NULL CHECK (base_qty > 0),
      batch_id BIGINT REFERENCES wholesale_batches(batch_id),
      disposition VARCHAR(10) NOT NULL DEFAULT 'RESTOCK' CHECK (disposition IN ('RESTOCK','DAMAGED','EXPIRED','NONE')),
      reason VARCHAR(20)
    )
  `);
};

export const down = async (client) => {
  for (const t of ['wholesale_return_items', 'wholesale_returns', 'wholesale_ledger_adjustments', 'wholesale_receipt_allocations', 'wholesale_receipts',
    'wholesale_grn_items', 'wholesale_grns']) await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  await client.query(`ALTER TABLE payments DROP COLUMN IF EXISTS receipt_id`);
  await client.query(`ALTER TABLE purchase_orders DROP COLUMN IF EXISTS payment_terms_days, DROP COLUMN IF EXISTS supplier_invoice_no, DROP COLUMN IF EXISTS supplier_invoice_date,
    DROP COLUMN IF EXISTS due_date, DROP COLUMN IF EXISTS approved_by, DROP COLUMN IF EXISTS approved_at`);
  await client.query(`ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check`);
  await client.query(`ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('DRAFT','ORDERED','PARTIAL','RECEIVED','CANCELLED'))`);
};
