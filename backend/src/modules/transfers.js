/*
 * Moving stock from one outlet to another: the one place it happens, used by a direct transfer
 * (inventory.controller) and by fulfilling a stock request (transferRequests.controller).
 *
 * Two ledger rows (out of the source, into the destination) so each outlet's history explains its own
 * stock; the business total does not change.
 */
import { moveStock, stockAt } from './stock.js';

export class TransferError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Run inside an open transaction. Returns the transfer_id; throws TransferError with the HTTP status to use. */
export const transferStock = async (client, { businessId, from, to, productId, quantity, notes = null, userId = null }) => {
  const outlets = (await client.query(`SELECT branch_id FROM branches WHERE business_id = $1 AND status = 'ACTIVE' AND branch_id = ANY($2::int[])`, [businessId, [from, to]])).rows;
  if (outlets.length !== 2) throw new TransferError(404, 'Not found');
  const product = (await client.query(`SELECT product_id, name, track_inventory FROM products WHERE product_id = $1 AND business_id = $2 FOR UPDATE`, [productId, businessId])).rows[0];
  if (!product) throw new TransferError(404, 'Not found');
  if (!product.track_inventory) throw new TransferError(400, `${product.name} does not track stock`);

  const have = (await stockAt(client, from, [product.product_id])).get(product.product_id);
  if (have < quantity) throw new TransferError(409, `Only ${have} of ${product.name} at the sending outlet`);

  const t = (await client.query(
    `INSERT INTO stock_transfers (business_id, from_branch_id, to_branch_id, product_id, quantity, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING transfer_id`,
    [businessId, from, to, product.product_id, quantity, notes, userId]
  )).rows[0];
  for (const [branchId, delta] of [[from, -quantity], [to, quantity]]) {
    await moveStock(client, { businessId, branchId, productId: product.product_id, delta });
    await client.query(
      `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, notes, created_by)
       VALUES ($1,$2,$3,'TRANSFER',$4,'stock_transfer',$5,$6,$7)`,
      [businessId, branchId, product.product_id, delta, t.transfer_id, notes, userId]
    );
  }
  return { transferId: t.transfer_id, productId: product.product_id, name: product.name };
};
