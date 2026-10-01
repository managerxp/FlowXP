/*
 * Pharmacy module, part 1: the foundation.
 *
 * New roles (RBAC matrix lives in middleware/auth.js ROLE_PERMISSIONS), per-business settings, and the product
 * master extension (pharmacy_item_details — same shape as wholesale_item_details: one row per product, carrying
 * the behavior flags that make a product's batch/expiry/serial/prescription handling configurable rather than
 * hardcoded, per the brief).
 *
 * Also two additive changes to tables the wholesale module already owns, reused here rather than forked:
 *   - wholesale_batches gets a `status` column (ACTIVE/QUARANTINED/RECALLED/BLOCKED). Wholesale never sets
 *     anything but ACTIVE, so this is a no-op for it; allocateBatches() gets one added predicate so a
 *     quarantined/recalled/blocked batch is never FEFO-picked for ANY vertical — a correctness fix, not a
 *     pharmacy-only fork (see modules/wholesale/stock.js).
 *   - wholesale_counters/wholesale_batches/wholesale_serials/branch_stock/products/inventory_transactions/
 *     purchase_orders are otherwise reused completely unchanged — see modules/pharmacy/common.js and
 *     modules/pharmacy/grn.js for how the pharmacy module calls into them.
 */
export const up = async (client) => {
  /* ======================================================================
     ROLES — widen the CHECK constraint (same pattern as 0048/0052/0057)
     ====================================================================== */
  await client.query(`ALTER TABLE business_users DROP CONSTRAINT IF EXISTS business_users_role_check`);
  await client.query(`
    ALTER TABLE business_users ADD CONSTRAINT business_users_role_check
      CHECK (role IN ('OWNER','ADMIN','MANAGER','CASHIER','STAFF','WAITER','KITCHEN','INVENTORY_MANAGER','DELIVERY',
                      'RECEPTIONIST','STYLIST','ACCOUNTANT',
                      'SALES_MANAGER','SALES_EXECUTIVE','WAREHOUSE_MANAGER','WAREHOUSE_STAFF','PURCHASE_MANAGER',
                      'DISTRIBUTOR_ADMIN','FIELD_SALES','COLLECTION_EXECUTIVE','DELIVERY_MANAGER',
                      'PHARMACIST','SALES_STAFF','GRN_MANAGER','AUDITOR'))
  `);

  /* ======================================================================
     SETTINGS — one row per pharmacy business
     ====================================================================== */
  await client.query(`
    CREATE TABLE pharmacy_settings (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      fefo BOOLEAN NOT NULL DEFAULT TRUE,
      negative_stock VARCHAR(8) NOT NULL DEFAULT 'BLOCK' CHECK (negative_stock IN ('BLOCK','ALLOW')),
      -- org-configurable expiry dashboard buckets, in days
      expiry_alert_days JSONB NOT NULL DEFAULT '[30,60,90,180]'::jsonb,
      warranty_alert_days JSONB NOT NULL DEFAULT '[30,60]'::jsonb,
      low_stock_alert BOOLEAN NOT NULL DEFAULT TRUE,
      adjustment_approval_over_qty NUMERIC(14,3),
      invoice_prefix VARCHAR(8) NOT NULL DEFAULT 'INV',
      grn_prefix VARCHAR(8) NOT NULL DEFAULT 'GRN',
      rx_prefix VARCHAR(8) NOT NULL DEFAULT 'RX',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /* ======================================================================
     PRODUCT MASTER EXTENSION — one unified `products` table (spec §6), the
     per-product behavior configured here rather than a type-specific table
     ====================================================================== */
  await client.query(`
    CREATE TABLE pharmacy_item_details (
      product_id INTEGER PRIMARY KEY REFERENCES products(product_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      product_type VARCHAR(16) NOT NULL DEFAULT 'OTHER' CHECK (product_type IN
        ('MEDICINE','DEVICE','CONSUMABLE','SURGICAL','WELLNESS','PERSONAL_CARE','BABY_CARE','ORTHOPEDIC','DIAGNOSTIC','OTHER')),
      manufacturer VARCHAR(120),
      mrp_paise BIGINT CHECK (mrp_paise IS NULL OR mrp_paise >= 0),
      -- configurable per product, not hardcoded by category (spec §6/7/8)
      batch_tracking BOOLEAN NOT NULL DEFAULT FALSE,
      expiry_tracking BOOLEAN NOT NULL DEFAULT FALSE,
      serial_tracking BOOLEAN NOT NULL DEFAULT FALSE,
      prescription_required BOOLEAN NOT NULL DEFAULT FALSE,
      fefo_required BOOLEAN NOT NULL DEFAULT FALSE,
      warranty_applicable BOOLEAN NOT NULL DEFAULT FALSE,
      warranty_months INTEGER CHECK (warranty_months IS NULL OR warranty_months > 0),
      service_trackable BOOLEAN NOT NULL DEFAULT FALSE,
      -- India drug schedule (H/H1/X...), nullable — never hardcoded into logic elsewhere, just shown/warned on
      schedule_class VARCHAR(8),
      salt_composition VARCHAR(300),
      strength VARCHAR(40),
      dosage_form VARCHAR(40),
      -- HSN/SAC lives on products.hsn_sac (already exists, used by GST reports) — not duplicated here
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_ph_item_business_type ON pharmacy_item_details (business_id, product_type)`);

  /* ======================================================================
     BATCH STATUS — additive column on the table wholesale already built;
     see modules/wholesale/stock.js allocateBatches() for the one-predicate
     change that makes this apply FEFO-wide, not pharmacy-only.
     ====================================================================== */
  await client.query(`
    ALTER TABLE wholesale_batches ADD COLUMN status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE'
      CHECK (status IN ('ACTIVE','QUARANTINED','RECALLED','BLOCKED'))
  `);
  await client.query(`CREATE INDEX idx_ws_batch_status ON wholesale_batches (business_id, status) WHERE status <> 'ACTIVE'`);

  /* Which batch an invoice line was sold from — the POS's FEFO/override pick, so "which customer got batch X"
     (spec §13/61) is answerable straight off the invoice. Nullable: every non-pharmacy sale leaves it NULL. */
  await client.query(`ALTER TABLE invoice_items ADD COLUMN batch_id BIGINT REFERENCES wholesale_batches(batch_id)`);
  await client.query(`CREATE INDEX idx_invoice_items_batch ON invoice_items (batch_id) WHERE batch_id IS NOT NULL`);
};
