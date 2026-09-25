/*
 * Recipes (bill of materials). An ingredient is a product with
 * kind = 'INGREDIENT', so stock, purchases and the ledger already work for it.
 * quantity is per ONE portion of the dish, in the ingredient's own unit.
 * unit_cost_paise on invoice_items is the cost of goods at the moment of sale —
 * what profitability reports aggregate, immune to later price changes.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE recipe_items (
      recipe_item_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      dish_product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      ingredient_product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
      quantity NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
      wastage_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (wastage_pct >= 0 AND wastage_pct < 100),
      CHECK (dish_product_id <> ingredient_product_id),
      UNIQUE (dish_product_id, ingredient_product_id)
    )
  `);
  await client.query(`CREATE INDEX idx_recipe_items_business ON recipe_items (business_id)`);
  await client.query(`ALTER TABLE invoice_items ADD COLUMN unit_cost_paise BIGINT`);
};
