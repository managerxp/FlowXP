/*
 * A business that has booked goods receipts could not be deleted: wholesale_grn_items pointed at products, and wholesale_grns at branches and suppliers, with no cascade, so
 * removing the business (which removes its products and outlets) was refused. Receipts belong to the business, so they go with it. Forward only.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE wholesale_grn_items DROP CONSTRAINT IF EXISTS wholesale_grn_items_product_id_fkey`);
  await client.query(`ALTER TABLE wholesale_grn_items ADD CONSTRAINT wholesale_grn_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE`);
  await client.query(`ALTER TABLE wholesale_grns DROP CONSTRAINT IF EXISTS wholesale_grns_branch_id_fkey`);
  await client.query(`ALTER TABLE wholesale_grns ADD CONSTRAINT wholesale_grns_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE`);
  await client.query(`ALTER TABLE wholesale_grns DROP CONSTRAINT IF EXISTS wholesale_grns_supplier_id_fkey`);
  await client.query(`ALTER TABLE wholesale_grns ADD CONSTRAINT wholesale_grns_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE CASCADE`);
};
