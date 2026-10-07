/*
 * Which option groups a product offers (Size, Milk...) travels with the product to the phone, so the app knows a drink needs choices.
 * Changing them must therefore count as a change to the product in the sync log (see 0074). That table has no business of its own, so
 * the trigger function now also finds the business through the product when the row has neither a business nor a branch.
 */
export const up = async (client) => {
  await client.query(`
    CREATE OR REPLACE FUNCTION sync_log_change() RETURNS trigger AS $$
    DECLARE r jsonb; biz INTEGER; br INTEGER;
    BEGIN
      IF TG_OP = 'DELETE' THEN r := to_jsonb(OLD); ELSE r := to_jsonb(NEW); END IF;
      br := NULLIF(r->>'branch_id', '')::int;
      biz := NULLIF(r->>'business_id', '')::int;
      IF biz IS NULL AND br IS NOT NULL THEN SELECT business_id INTO biz FROM branches WHERE branch_id = br; END IF;
      IF biz IS NULL AND TG_ARGV[0] = 'product' THEN SELECT business_id INTO biz FROM products WHERE product_id = (r->>TG_ARGV[1])::int; END IF;
      IF biz IS NOT NULL THEN
        INSERT INTO sync_log (business_id, branch_id, entity, entity_id) VALUES (biz, br, TG_ARGV[0], (r->>TG_ARGV[1])::bigint);
      END IF;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`);
  await client.query(`DROP TRIGGER IF EXISTS trg_sync_log ON product_modifier_groups`);
  await client.query(`CREATE TRIGGER trg_sync_log AFTER INSERT OR UPDATE OR DELETE ON product_modifier_groups
                      FOR EACH ROW EXECUTE FUNCTION sync_log_change('product', 'product_id')`);
};
