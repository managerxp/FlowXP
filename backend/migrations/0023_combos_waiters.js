/*
 * Combos, and who serves which table.
 *
 * A combo is an ordinary menu item (its own price, tax rate and station) that is
 * made of other items. Selling one takes its components' stock and recipes down,
 * so cost and stock stay honest; it never nests inside another combo.
 *
 * Waiters: a table can have a regular waiter (its section); an order records who
 * served it (the table's waiter unless someone else is picked), which is what
 * the per-waiter sales report groups by.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE products ADD COLUMN is_combo BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`
    CREATE TABLE combo_items (
      combo_item_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      combo_product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      component_product_id INTEGER NOT NULL REFERENCES products(product_id),
      quantity NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
      UNIQUE (combo_product_id, component_product_id)
    )
  `);
  await client.query(`CREATE INDEX idx_combo_items_component ON combo_items (component_product_id)`);

  await client.query(`ALTER TABLE dining_tables ADD COLUMN waiter_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE orders ADD COLUMN waiter_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL`);
  await client.query(`CREATE INDEX idx_orders_waiter ON orders (business_id, waiter_user_id) WHERE waiter_user_id IS NOT NULL`);
};
