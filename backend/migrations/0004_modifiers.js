/*
 * Modifiers and variants. A variant (Half / Full) is a group with
 * is_variant = true and exactly one required choice; there is no separate
 * variants table. Order and invoice lines keep a JSONB snapshot of what was
 * chosen and what it cost then, so later menu edits never rewrite a bill.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE modifier_groups (
      group_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      is_variant BOOLEAN NOT NULL DEFAULT FALSE,
      min_select SMALLINT NOT NULL DEFAULT 0 CHECK (min_select >= 0),
      -- NULL = no upper limit (e.g. "any toppings").
      max_select SMALLINT CHECK (max_select IS NULL OR max_select >= 1),
      sort_order SMALLINT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (max_select IS NULL OR max_select >= min_select)
    )
  `);
  await client.query(`CREATE INDEX idx_modifier_groups_business ON modifier_groups (business_id)`);

  await client.query(`
    CREATE TABLE modifiers (
      modifier_id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES modifier_groups(group_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      -- Added to the dish's price; negative for a smaller portion.
      price_delta_paise BIGINT NOT NULL DEFAULT 0,
      -- Optional stock this choice consumes (extra cheese uses cheese).
      ingredient_product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
      ingredient_qty NUMERIC(14,4),
      sort_order SMALLINT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  await client.query(`CREATE INDEX idx_modifiers_group ON modifiers (group_id)`);

  await client.query(`
    CREATE TABLE product_modifier_groups (
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES modifier_groups(group_id) ON DELETE CASCADE,
      PRIMARY KEY (product_id, group_id)
    )
  `);

  await client.query(`ALTER TABLE order_items ADD COLUMN modifiers JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await client.query(`ALTER TABLE invoice_items ADD COLUMN modifiers JSONB NOT NULL DEFAULT '[]'::jsonb`);
};
