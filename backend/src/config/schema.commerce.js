/*
 * The commerce schema: everything a business actually trades with.
 *
 * Split from database.js because that file is the tenancy foundation
 * (users/businesses/branches/plans/audit) and this is everything built on top
 * of it. One growing file becomes a file nobody reads before editing; two
 * files with one job each stay readable past the point where a single file
 * would not.
 *
 * Money is stored as integer paise throughout — the same reasoning as the
 * plans table in database.js: floating point eventually bills someone
 * ₹1,199.9999999. Quantities are NUMERIC because a kilogram of rice is not an
 * integer.
 */

export const initializeCommerceSchema = async (client) => {
  /* Purchase orders get their own numbering sequence, the same idea as
     invoice_prefix / invoice_next_number on this table already. Added here
     rather than in database.js because it belongs to this schema's feature,
     not to the tenancy foundation. */
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS po_prefix VARCHAR(12) NOT NULL DEFAULT 'PO'`);
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS po_next_number INTEGER NOT NULL DEFAULT 1`);

  /* The business's own UPI ID, shown as a QR code on the customer QR-ordering
     confirmation screen (publicOrdering.controller.js) — not a payment
     gateway integration, the same thing as a UPI QR sticker on the counter,
     just shown digitally too. FlowXP never learns whether it was paid. */
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS upi_vpa VARCHAR(80)`);

  /* ======================================================================
     CATEGORIES — how a business groups its products
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS categories (
      category_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_categories_business ON categories (business_id)`);

  /* ======================================================================
     SUPPLIERS — created before products so products.supplier_id can point at it
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      supplier_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(160) NOT NULL,
      phone VARCHAR(32),
      email VARCHAR(160),
      address TEXT,
      gstin VARCHAR(20),
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_suppliers_business ON suppliers (business_id)`);

  /* ======================================================================
     PRODUCTS
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS products (
      product_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL,
      supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL,

      name VARCHAR(160) NOT NULL,
      sku VARCHAR(64),
      barcode VARCHAR(64),
      unit VARCHAR(24) NOT NULL DEFAULT 'pc',

      selling_price_paise BIGINT NOT NULL DEFAULT 0,
      purchase_price_paise BIGINT NOT NULL DEFAULT 0,
      -- Percentage, e.g. 18.00. Applied only when the business is GST-enabled
      -- — see invoices.controller.js for why an unregistered business must
      -- never have GST computed onto a bill.
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      hsn_sac VARCHAR(16),

      -- A service line ("Haircut", "Table service") has no stock to track.
      -- Turning this off is what lets a salon and a supermarket share one
      -- products table without the salon seeing stock counts that mean nothing.
      track_inventory BOOLEAN NOT NULL DEFAULT TRUE,
      current_stock NUMERIC(14,3) NOT NULL DEFAULT 0,
      min_stock NUMERIC(14,3) NOT NULL DEFAULT 0,

      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_products_business ON products (business_id)`);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_products_business_search
      ON products (business_id, name)
  `);
  /* A SKU or barcode is only unique within a business, and only when set —
     two products can both have no barcode, but not the same one. Partial
     unique indexes express exactly that; a plain UNIQUE column cannot. */
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_sku
      ON products (business_id, sku) WHERE sku IS NOT NULL AND sku <> ''
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_barcode
      ON products (business_id, barcode) WHERE barcode IS NOT NULL AND barcode <> ''
  `);

  /* A menu item's customer-facing photo and blurb — added for the QR
     ordering menu (public/CustomerMenu.jsx), which otherwise shows nothing
     but a name and a price. image_url points at this server's own
     /uploads/products/ static path (see the image-upload endpoint in
     products.routes.js) — local disk, not cloud object storage; fine for a
     single dev/staging server, but won't survive a redeploy on a host with
     an ephemeral filesystem. Move it to real object storage (already a
     known future item) before that matters. */
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT`);
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT`);

  /* ======================================================================
     CUSTOMERS
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS customers (
      customer_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(160) NOT NULL,
      phone VARCHAR(32),
      email VARCHAR(160),
      address TEXT,
      state VARCHAR(80),
      gstin VARCHAR(20),
      -- 0 = no limit enforced. Advisory only in V1: a UI warning, not a hard
      -- block on billing — a shop's biggest customer is often the one they
      -- extend the most credit to.
      credit_limit_paise BIGINT NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_customers_business ON customers (business_id)`);

  /* ======================================================================
     INVOICES — the record a sale produces
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      invoice_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,

      -- Business-scoped, not global — see nextInvoiceNumber() in
      -- invoices.controller.js for how two businesses each get their own
      -- INV-0001 without colliding.
      invoice_number VARCHAR(32) NOT NULL,
      invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,

      subtotal_paise BIGINT NOT NULL DEFAULT 0,
      discount_paise BIGINT NOT NULL DEFAULT 0,
      cgst_paise BIGINT NOT NULL DEFAULT 0,
      sgst_paise BIGINT NOT NULL DEFAULT 0,
      igst_paise BIGINT NOT NULL DEFAULT 0,
      tax_paise BIGINT NOT NULL DEFAULT 0,   -- cgst + sgst + igst, kept flat for fast report sums
      total_paise BIGINT NOT NULL DEFAULT 0,
      amount_paid_paise BIGINT NOT NULL DEFAULT 0,
      balance_due_paise BIGINT NOT NULL DEFAULT 0,

      payment_status VARCHAR(16) NOT NULL DEFAULT 'UNPAID'
        CHECK (payment_status IN ('UNPAID','PARTIAL','PAID')),
      status VARCHAR(16) NOT NULL DEFAULT 'ISSUED'
        CHECK (status IN ('ISSUED','CANCELLED')),

      notes TEXT,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_business_number
      ON invoices (business_id, invoice_number)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_invoices_business_date
      ON invoices (business_id, invoice_date DESC)
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      item_id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
      -- Copied at billing time, not read live off products. A product's name
      -- or price can change next month; the invoice must keep showing what
      -- was actually sold on the day it was sold.
      description VARCHAR(200) NOT NULL,
      quantity NUMERIC(14,3) NOT NULL,
      unit_price_paise BIGINT NOT NULL,
      discount_paise BIGINT NOT NULL DEFAULT 0,
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      tax_amount_paise BIGINT NOT NULL DEFAULT 0,
      line_total_paise BIGINT NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id)`);

  /* ======================================================================
     PAYMENTS — every rupee actually collected

     Against an invoice, or standalone (invoice_id NULL) for an advance a
     customer pays before anything is billed against it.
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS payments (
      payment_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,

      payment_method VARCHAR(16) NOT NULL
        CHECK (payment_method IN ('CASH','UPI','CARD','BANK_TRANSFER','CREDIT','OTHER')),
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      reference_number VARCHAR(80),
      payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT,

      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_business_date ON payments (business_id, payment_date DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id)`);

  /* ======================================================================
     INVENTORY TRANSACTIONS — the ledger every stock number is derived from

     products.current_stock is a maintained cache for fast reads; this table
     is the source of truth for how it got there. Never write to
     current_stock without a matching row here — see inventory.controller.js.
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      txn_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,

      transaction_type VARCHAR(16) NOT NULL
        CHECK (transaction_type IN ('SALE','PURCHASE','ADJUSTMENT','RETURN','OPENING')),
      -- Signed: positive adds to stock (purchase, upward adjustment, opening),
      -- negative removes it (sale, downward adjustment). One column instead of
      -- a separate direction flag, because every consumer just needs "the
      -- stock effect", not a direction to reinterpret.
      quantity NUMERIC(14,3) NOT NULL,

      reference_type VARCHAR(24),   -- 'invoice', 'purchase_order', 'manual'
      reference_id INTEGER,
      notes TEXT,

      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_inventory_txn_product ON inventory_transactions (product_id, created_at DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_inventory_txn_business ON inventory_transactions (business_id, created_at DESC)
  `);

  /* ======================================================================
     PURCHASES — stock and payables coming in from a supplier
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      po_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL,

      po_number VARCHAR(32) NOT NULL,
      po_date DATE NOT NULL DEFAULT CURRENT_DATE,

      subtotal_paise BIGINT NOT NULL DEFAULT 0,
      tax_paise BIGINT NOT NULL DEFAULT 0,
      total_paise BIGINT NOT NULL DEFAULT 0,
      amount_paid_paise BIGINT NOT NULL DEFAULT 0,
      balance_due_paise BIGINT NOT NULL DEFAULT 0,

      payment_status VARCHAR(16) NOT NULL DEFAULT 'UNPAID'
        CHECK (payment_status IN ('UNPAID','PARTIAL','PAID')),
      status VARCHAR(16) NOT NULL DEFAULT 'RECEIVED'
        CHECK (status IN ('RECEIVED','CANCELLED')),

      notes TEXT,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_po_business_number ON purchase_orders (business_id, po_number)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_po_business_date ON purchase_orders (business_id, po_date DESC)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      item_id SERIAL PRIMARY KEY,
      po_id INTEGER NOT NULL REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
      description VARCHAR(200) NOT NULL,
      quantity NUMERIC(14,3) NOT NULL,
      unit_cost_paise BIGINT NOT NULL,
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      tax_amount_paise BIGINT NOT NULL DEFAULT 0,
      line_total_paise BIGINT NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items (po_id)`);

  /* A supplier payment reuses the payments table (same shape: method, amount,
     reference, date) rather than a parallel supplier_payments table — the
     only difference is which side of the ledger it clears, which po_id says. */
  await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS po_id INTEGER REFERENCES purchase_orders(po_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL`);

  /* ======================================================================
     EXPENSES
     ====================================================================== */
  await client.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      expense_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      -- A free-text category rather than a lookup table: the brief's list
      -- (Rent, Salary, Utilities, Transport, Marketing, Maintenance, Other) is
      -- exactly the kind of thing an owner wants to type a new one of without
      -- an admin screen standing in the way.
      category VARCHAR(60) NOT NULL,
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      payment_method VARCHAR(16) NOT NULL DEFAULT 'CASH'
        CHECK (payment_method IN ('CASH','UPI','CARD','BANK_TRANSFER','OTHER')),
      expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
      description TEXT,
      attachment_url TEXT,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON expenses (business_id, expense_date DESC)`);
};
