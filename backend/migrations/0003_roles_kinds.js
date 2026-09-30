/*
 * Restaurant floor roles, and a product "kind" so ingredients and packaging can
 * live in the same table (and therefore the same stock ledger) as dishes.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE business_users DROP CONSTRAINT IF EXISTS business_users_role_check`);
  await client.query(`
    ALTER TABLE business_users ADD CONSTRAINT business_users_role_check
      CHECK (role IN ('OWNER','ADMIN','MANAGER','CASHIER','STAFF','WAITER','KITCHEN','INVENTORY_MANAGER'))
  `);
  await client.query(`
    ALTER TABLE products ADD COLUMN kind VARCHAR(12) NOT NULL DEFAULT 'DISH'
      CHECK (kind IN ('DISH','INGREDIENT','PACKAGING'))
  `);
  await client.query(`CREATE INDEX idx_products_business_kind ON products (business_id, kind)`);
};
