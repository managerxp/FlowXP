/*
 * refunds.invoice_id and recipe_items.ingredient_product_id were RESTRICT, which
 * Postgres checks row-by-row, so deleting a whole business (whose invoices,
 * refunds, products and recipes all cascade) could trip over its own children
 * depending on delete order. NO ACTION is checked at the end of the statement
 * instead: deleting a business works, while deleting a used ingredient or a
 * refunded invoice on its own is still refused.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE refunds DROP CONSTRAINT refunds_invoice_id_fkey`);
  await client.query(`ALTER TABLE refunds ADD CONSTRAINT refunds_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(invoice_id)`);
  await client.query(`ALTER TABLE recipe_items DROP CONSTRAINT recipe_items_ingredient_product_id_fkey`);
  await client.query(`ALTER TABLE recipe_items ADD CONSTRAINT recipe_items_ingredient_product_id_fkey FOREIGN KEY (ingredient_product_id) REFERENCES products(product_id)`);
};
