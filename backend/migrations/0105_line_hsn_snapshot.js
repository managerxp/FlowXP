/*
 * The HSN/SAC code a bill line was sold under, kept on the line. It used to be read live off the product, so changing a product's HSN
 * later rewrote every old tax invoice and GST return that had sold it. A trigger fills it from the product when a line is inserted
 * (every way of making a bill goes through the same insert), credit-note lines take it from the bill line they return, and lines that
 * already exist are filled from their product's current code (the best that can be known for them). Forward only.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS hsn_sac VARCHAR(16)`);
  await client.query(`ALTER TABLE credit_note_items ADD COLUMN IF NOT EXISTS hsn_sac VARCHAR(16)`);
  await client.query(`
    CREATE OR REPLACE FUNCTION fill_invoice_item_hsn() RETURNS trigger AS $$
    BEGIN
      IF NEW.hsn_sac IS NULL AND NEW.product_id IS NOT NULL THEN
        SELECT hsn_sac INTO NEW.hsn_sac FROM products WHERE product_id = NEW.product_id;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await client.query(`DROP TRIGGER IF EXISTS trg_invoice_item_hsn ON invoice_items`);
  await client.query(`CREATE TRIGGER trg_invoice_item_hsn BEFORE INSERT ON invoice_items FOR EACH ROW EXECUTE FUNCTION fill_invoice_item_hsn()`);
  await client.query(`
    CREATE OR REPLACE FUNCTION fill_credit_note_item_hsn() RETURNS trigger AS $$
    BEGIN
      IF NEW.hsn_sac IS NULL AND NEW.invoice_item_id IS NOT NULL THEN
        SELECT hsn_sac INTO NEW.hsn_sac FROM invoice_items WHERE item_id = NEW.invoice_item_id;
      END IF;
      IF NEW.hsn_sac IS NULL AND NEW.product_id IS NOT NULL THEN
        SELECT hsn_sac INTO NEW.hsn_sac FROM products WHERE product_id = NEW.product_id;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await client.query(`DROP TRIGGER IF EXISTS trg_credit_note_item_hsn ON credit_note_items`);
  await client.query(`CREATE TRIGGER trg_credit_note_item_hsn BEFORE INSERT ON credit_note_items FOR EACH ROW EXECUTE FUNCTION fill_credit_note_item_hsn()`);
  await client.query(`UPDATE invoice_items ii SET hsn_sac = p.hsn_sac FROM products p WHERE ii.product_id = p.product_id AND ii.hsn_sac IS NULL AND p.hsn_sac IS NOT NULL`);
  await client.query(`UPDATE credit_note_items ci SET hsn_sac = COALESCE(ii.hsn_sac, p.hsn_sac) FROM products p, invoice_items ii WHERE ci.hsn_sac IS NULL AND ii.item_id = ci.invoice_item_id AND p.product_id = ci.product_id`);
};
