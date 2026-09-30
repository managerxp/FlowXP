/*
 * Stock lives per outlet (branch_stock); products.current_stock is the business
 * total, kept in step here so every existing reader of it stays correct.
 * Every stock change goes through moveStock — never UPDATE either column
 * directly, or the two drift apart (a test asserts they never do).
 *
 * The caller holds a row lock on the product (SELECT ... FOR UPDATE), which is
 * what makes read-check-then-move safe.
 */

/** Add `delta` (negative to remove) to an outlet's stock and to the business total. */
export const moveStock = async (client, { businessId, branchId, productId, delta }) => {
  await client.query(
    `INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,$3)
     ON CONFLICT (branch_id, product_id) DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity`,
    [branchId, productId, delta]
  );
  await client.query(
    `UPDATE products SET current_stock = current_stock + $1, updated_at = CURRENT_TIMESTAMP
     WHERE product_id = $2 AND business_id = $3`,
    [delta, productId, businessId]
  );
};

/** Stock at one outlet for the given products: Map(product_id -> quantity). Missing rows are 0. */
export const stockAt = async (db, branchId, productIds) => {
  const map = new Map(productIds.map((id) => [Number(id), 0]));
  if (!productIds.length) return map;
  const { rows } = await db.query(
    `SELECT product_id, quantity FROM branch_stock WHERE branch_id = $1 AND product_id = ANY($2::int[])`,
    [branchId, productIds]
  );
  for (const r of rows) map.set(r.product_id, Number(r.quantity));
  return map;
};
