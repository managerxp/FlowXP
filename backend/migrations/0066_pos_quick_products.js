/*
 * Quick products: the handful of things a supermarket sells without a barcode or in a hurry (loose items, bread, eggs).
 * The owner marks them once; the till shows them as one-tap buttons. A flag on the product, not a second catalogue.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_quick BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_products_quick ON products (business_id) WHERE is_quick AND status = 'ACTIVE'`);
};
