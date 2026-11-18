/*
 * "Price includes GST" per product (owner, 2026-11-18): for goods sold at the MRP printed on the pack, the bill takes GST out of the price
 * instead of adding it on top, so the customer pays exactly the price. Off for every existing product, so no price already in use changes;
 * new products in shop-type businesses start with it on (products.controller.js).
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_includes_tax BOOLEAN NOT NULL DEFAULT FALSE`);
};
