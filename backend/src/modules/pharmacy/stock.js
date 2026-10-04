/*
 * Pharmacy stock: reuses the wholesale batch/FEFO/locking engine unmodified (it carries no wholesale-only
 * semantics — see migrations/0061_pharmacy_foundation.js's header note) rather than forking a parallel one.
 * The only pharmacy-specific pieces are the product-behavior lookup (pharmacy_item_details instead of
 * wholesale_item_details) and the two "is this sellable" guards the spec asks for.
 */
import {
  addToBatch, allocateBatches, consumeBatches, expiredQty, lockProducts, logDamaged, returnToBatch, stockIn, stockOut
} from '../wholesale/stock.js';
import { PharmacyError, q3 } from './common.js';

export { addToBatch, allocateBatches, consumeBatches, expiredQty, lockProducts, logDamaged, returnToBatch, stockIn, stockOut, q3 };

/** Map(product_id -> { batch_tracking, expiry_tracking, serial_tracking, prescription_required }) */
export const batchTracked = async (db, businessId, productIds) => {
  if (!productIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT product_id, batch_tracking, expiry_tracking, serial_tracking, prescription_required, fefo_required
     FROM pharmacy_item_details WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, productIds]);
  return new Map(rows.map((r) => [r.product_id, r]));
};

/** Throws if a batch is not sellable right now (expired is checked separately by allocateBatches' own date filter). */
export const assertSellable = (batch) => {
  if (batch && batch.status && batch.status !== 'ACTIVE') {
    throw new PharmacyError(409, `This batch is ${batch.status.toLowerCase()} and cannot be sold.`);
  }
};

/** A serial under repair must not be sold — see pharmacy_service_requests (phase 10); until that exists every
    serial reaching here is a normal wholesale_serials row, so this only enforces the base IN_STOCK rule today. */
export const assertSerialSellable = (serial) => {
  if (!serial || serial.status !== 'IN_STOCK') {
    throw new PharmacyError(409, serial ? `Serial ${serial.serial_no} is ${serial.status.toLowerCase().replace('_', ' ')}, not in stock.` : 'That serial was not found.');
  }
};
