/*
 * Multi-outlet: a business (the organisation) can run several outlets.
 *
 * Outlets are the existing `branches` rows. Until now nothing really used
 * them: tables and stock were business-wide, branch_id was often NULL, and
 * signup pinned owners to "Main". This migration makes branch_id meaningful:
 *   - every record that belongs to an outlet gets one (NULL backfilled to the primary outlet)
 *   - stock is kept per outlet (branch_stock); products.current_stock stays as the business total
 *   - tables belong to an outlet
 *   - price / availability can differ per outlet without duplicating the menu
 *   - owners and admins see every outlet (membership.branch_id NULL); other roles stay pinned
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE branches ADD COLUMN code VARCHAR(12)`);
  await client.query(`ALTER TABLE branches ADD COLUMN city VARCHAR(80)`);
  await client.query(`ALTER TABLE branches ADD COLUMN state VARCHAR(60)`);
  await client.query(`ALTER TABLE branches ADD COLUMN gstin VARCHAR(20)`);
  await client.query(`CREATE UNIQUE INDEX uq_branches_name ON branches (business_id, lower(name)) WHERE status = 'ACTIVE'`);

  // Legacy rows without an outlet belong to the primary one.
  const primary = `(SELECT b.branch_id FROM branches b WHERE b.business_id = t.business_id AND b.is_primary ORDER BY b.branch_id LIMIT 1)`;
  for (const table of ['invoices', 'payments', 'orders', 'expenses', 'purchase_orders', 'inventory_transactions']) {
    await client.query(`UPDATE ${table} t SET branch_id = ${primary} WHERE t.branch_id IS NULL`);
  }
  await client.query(`CREATE INDEX idx_invoices_branch_date ON invoices (business_id, branch_id, invoice_date)`);
  await client.query(`CREATE INDEX idx_orders_branch ON orders (business_id, branch_id, status)`);
  await client.query(`CREATE INDEX idx_inventory_txn_branch ON inventory_transactions (business_id, branch_id, created_at DESC)`);

  await client.query(`ALTER TABLE dining_tables ADD COLUMN branch_id INTEGER REFERENCES branches(branch_id)`);
  await client.query(`UPDATE dining_tables t SET branch_id = ${primary}`);
  await client.query(`ALTER TABLE dining_tables ALTER COLUMN branch_id SET NOT NULL`);
  await client.query(`CREATE INDEX idx_dining_tables_branch ON dining_tables (business_id, branch_id)`);

  await client.query(`
    CREATE TABLE branch_stock (
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
      PRIMARY KEY (branch_id, product_id)
    )
  `);
  await client.query(`CREATE INDEX idx_branch_stock_product ON branch_stock (product_id)`);
  await client.query(`
    INSERT INTO branch_stock (branch_id, product_id, quantity)
    SELECT ${primary.replace(/t\.business_id/g, 'p.business_id')}, p.product_id, p.current_stock
    FROM products p WHERE p.track_inventory
  `);

  await client.query(`
    CREATE TABLE product_branch_settings (
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      price_paise BIGINT CHECK (price_paise IS NULL OR price_paise >= 0),
      is_available BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (product_id, branch_id)
    )
  `);

  await client.query(`
    CREATE TABLE stock_transfers (
      transfer_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      from_branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      to_branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
      notes VARCHAR(200),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (from_branch_id <> to_branch_id)
    )
  `);
  await client.query(`CREATE INDEX idx_stock_transfers_business ON stock_transfers (business_id, created_at DESC)`);

  await client.query(`ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check`);
  await client.query(`
    ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_transaction_type_check
      CHECK (transaction_type IN ('SALE','PURCHASE','ADJUSTMENT','RETURN','OPENING','WASTAGE','TRANSFER'))
  `);

  // Owners and admins run the whole group; signup had pinned them to Main.
  await client.query(`UPDATE business_users SET branch_id = NULL WHERE role IN ('OWNER','ADMIN')`);

  // Outlet allowance per plan (enforced when creating an outlet).
  await client.query(`
    UPDATE plans SET limits = limits || jsonb_build_object('outlets',
      CASE plan_code WHEN 'TRIAL' THEN 3 WHEN 'STARTER' THEN 1 WHEN 'GROWTH' THEN 1 WHEN 'BUSINESS' THEN 5 ELSE NULL END)
  `);
};
