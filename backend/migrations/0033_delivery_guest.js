/*
 * A delivery-platform order arrives with the diner's own name/phone (Zomato,
 * Swiggy etc.), but that person is rarely one of the business's own saved
 * customers — ingestOrder() was parsing this and then throwing it away. Kept
 * on the order itself, separate from customer_id, so accepting/rejecting one
 * can show who it is without inventing a customer record for every stranger.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name VARCHAR(120)`);
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(20)`);
};
