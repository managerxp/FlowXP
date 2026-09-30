/*
 * Per-outlet invoice numbers, kitchen stations and recipes.
 *
 * Invoice series: an outlet may have its own prefix and counter (MGR-0001, IND-0001). Without one it uses the
 * business's series as before. Prefixes are unique inside a business, so a number never repeats.
 *
 * Kitchen stations: a station belongs to one outlet, or (branch_id NULL) to all of them. The same name can exist at
 * several outlets, and a dish routed to "Grill" is cooked at whichever outlet's "Grill" the order belongs to.
 *
 * Recipes: a dish has a default recipe (branch_id NULL). An outlet can override it completely; an outlet with no
 * override uses the default.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE branches ADD COLUMN invoice_prefix VARCHAR(12)`);
  await client.query(`ALTER TABLE branches ADD COLUMN invoice_next_number INTEGER NOT NULL DEFAULT 1 CHECK (invoice_next_number >= 1)`);
  await client.query(`CREATE UNIQUE INDEX uq_branches_invoice_prefix ON branches (business_id, upper(invoice_prefix)) WHERE invoice_prefix IS NOT NULL`);

  await client.query(`ALTER TABLE kitchen_stations ADD COLUMN branch_id INTEGER REFERENCES branches(branch_id)`);
  await client.query(`DROP INDEX uq_kitchen_station_name`);
  await client.query(`CREATE UNIQUE INDEX uq_kitchen_station_name ON kitchen_stations (business_id, COALESCE(branch_id, 0), lower(name)) WHERE is_active`);

  await client.query(`ALTER TABLE recipe_items ADD COLUMN branch_id INTEGER REFERENCES branches(branch_id) ON DELETE CASCADE`);
  await client.query(`ALTER TABLE recipe_items DROP CONSTRAINT recipe_items_dish_product_id_ingredient_product_id_key`);
  await client.query(`CREATE UNIQUE INDEX uq_recipe_items_scope ON recipe_items (dish_product_id, ingredient_product_id, COALESCE(branch_id, 0))`);
  await client.query(`CREATE INDEX idx_recipe_items_dish_branch ON recipe_items (dish_product_id, branch_id)`);
};
