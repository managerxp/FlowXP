/* Deleting a business for good (super admin only). Every table that belongs to a business refers to it with ON DELETE CASCADE, so removing the
   businesses row removes the shop's whole history: bills, orders, stock, staff records, settings, notes. Then the people who belonged to this shop alone
   are removed too (so they can sign up again with the same email and get a fresh free trial, set by the platform); anyone who also works in another shop,
   and every super admin, stays. Uploaded pictures are cleaned up afterwards, best effort. One transaction: all of it, or none of it. */
import { removeFile } from './storage.js';

export const deleteBusinessForever = async (client, businessId, { deleteUsers = true } = {}) => {
  const biz = (await client.query(`SELECT business_id, name, owner_user_id, receipt_settings->>'logo_url' AS logo_url FROM businesses WHERE business_id = $1 FOR UPDATE`, [businessId])).rows[0];
  if (!biz) return null;
  const products = (await client.query(`SELECT image_url FROM products WHERE business_id = $1 AND image_url IS NOT NULL`, [businessId])).rows.map((r) => r.image_url);

  /* people tied to this shop alone: members with no seat in any other business, who own no other business, and are not super admins */
  const alone = deleteUsers ? (await client.query(
    `SELECT u.user_id, u.email FROM users u
     WHERE u.is_super_admin = FALSE
       AND (u.user_id IN (SELECT user_id FROM business_users WHERE business_id = $1) OR u.user_id = $2)
       AND NOT EXISTS (SELECT 1 FROM business_users o WHERE o.user_id = u.user_id AND o.business_id <> $1)
       AND NOT EXISTS (SELECT 1 FROM businesses b WHERE b.owner_user_id = u.user_id AND b.business_id <> $1)`, [businessId, biz.owner_user_id])).rows : [];

  await client.query(`DELETE FROM businesses WHERE business_id = $1`, [businessId]);
  if (alone.length) await client.query(`DELETE FROM users WHERE user_id = ANY($1::int[])`, [alone.map((u) => u.user_id)]);
  return { name: biz.name, users_deleted: alone.length, files: [biz.logo_url, ...products].filter(Boolean) };
};

/** After the commit: remove the shop's uploaded pictures (only ever inside that shop's own folder). */
export const removeBusinessFiles = (businessId, files) => Promise.all(files.map((f) => removeFile(f, businessId)));
