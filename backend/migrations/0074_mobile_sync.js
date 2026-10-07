/*
 * What the mobile app (MOBILE.md, phase 0) needs from the database.
 *
 *   invoices.client_key   the Idempotency-Key a sale was sent with, kept on the invoice itself. idempotency_keys forgets after
 *                         48 hours; a phone offline for days can replay a sale later than that, and the same sale must still
 *                         come back as the same invoice, never a second one. Unique per business.
 *
 *   sync_log              "what changed, in order": one row per change to a thing a phone keeps a copy of (products, their
 *                         barcodes, outlet prices and stock, categories, customers). seq is the version a phone remembers.
 *                         A phone asks for everything after its seq and gets the CURRENT row for each thing that changed,
 *                         so several changes to one thing collapse into one. branch_id is set for per-outlet changes (an
 *                         outlet's price or stock) so another outlet's phone never sees them.
 *   sync_state            the highest seq already pruned; a phone older than that must download the catalogue again.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_key VARCHAR(128)`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_client_key ON invoices (business_id, client_key) WHERE client_key IS NOT NULL`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS sync_log (
      seq         BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL,
      branch_id   INTEGER,
      entity      VARCHAR(20) NOT NULL CHECK (entity IN ('product','category','customer')),
      entity_id   BIGINT NOT NULL,
      changed_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_sync_log_business_seq ON sync_log (business_id, seq)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_sync_log_changed_at ON sync_log (changed_at)`);
  await client.query(`CREATE TABLE IF NOT EXISTS sync_state (id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id), floor_seq BIGINT NOT NULL DEFAULT 0)`);
  await client.query(`INSERT INTO sync_state (id, floor_seq) VALUES (TRUE, 0) ON CONFLICT DO NOTHING`);

  // One trigger function for every table: TG_ARGV[0] = the entity name, TG_ARGV[1] = the column holding that entity's id.
  // Rows without a business_id of their own (outlet stock, outlet prices) find it through their branch.
  await client.query(`
    CREATE OR REPLACE FUNCTION sync_log_change() RETURNS trigger AS $$
    DECLARE r jsonb; biz INTEGER; br INTEGER;
    BEGIN
      IF TG_OP = 'DELETE' THEN r := to_jsonb(OLD); ELSE r := to_jsonb(NEW); END IF;
      br := NULLIF(r->>'branch_id', '')::int;
      biz := NULLIF(r->>'business_id', '')::int;
      IF biz IS NULL AND br IS NOT NULL THEN SELECT business_id INTO biz FROM branches WHERE branch_id = br; END IF;
      IF biz IS NOT NULL THEN
        INSERT INTO sync_log (business_id, branch_id, entity, entity_id) VALUES (biz, br, TG_ARGV[0], (r->>TG_ARGV[1])::bigint);
      END IF;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`);

  const watch = [
    ['products', 'product', 'product_id'],
    ['product_barcodes', 'product', 'product_id'],
    ['product_branch_settings', 'product', 'product_id'],
    ['branch_stock', 'product', 'product_id'],
    ['categories', 'category', 'category_id'],
    ['customers', 'customer', 'customer_id']
  ];
  for (const [table, entity, idColumn] of watch) {
    await client.query(`DROP TRIGGER IF EXISTS trg_sync_log ON ${table}`);
    await client.query(`CREATE TRIGGER trg_sync_log AFTER INSERT OR UPDATE OR DELETE ON ${table}
                        FOR EACH ROW EXECUTE FUNCTION sync_log_change('${entity}', '${idColumn}')`);
  }
};
