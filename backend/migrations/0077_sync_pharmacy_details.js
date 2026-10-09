/*
 * A pharmacy's phone keeps a copy of each medicine's details (strength, form, maker, salt, whether it needs a prescription and tracks batch and
 * expiry) so it can find a medicine and ask for the prescription with no internet. Those live in pharmacy_item_details, so a change there must
 * count as a change to the product in the sync log (see 0074 and 0075).
 */
export const up = async (client) => {
  await client.query(`DROP TRIGGER IF EXISTS trg_sync_log ON pharmacy_item_details`);
  await client.query(`CREATE TRIGGER trg_sync_log AFTER INSERT OR UPDATE OR DELETE ON pharmacy_item_details
                      FOR EACH ROW EXECUTE FUNCTION sync_log_change('product', 'product_id')`);
};
