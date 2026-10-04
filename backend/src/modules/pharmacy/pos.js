/*
 * The pharmacy till: turns a cart of products into one invoice, with batch-aware FEFO stock deduction.
 *
 * Deliberately NOT built on modules/billing.js's createInvoiceInTransaction — that engine (shared by the
 * restaurant/retail POS and, through modules/salon/pos.js, the salon till) locks products and decrements
 * branch_stock directly; it has no concept of a batch at all. A pharmacy sale needs to know WHICH batch
 * each unit came from (FEFO, traceability, "which customer got batch X"), so this module adds that layer
 * using the same wholesale batch/lock engine the pharmacy GRN already posts through
 * (modules/pharmacy/stock.js) and reuses modules/billing.js's number series and payment-splitting helpers
 * rather than re-deriving them — see createGRN's own header note on reuse-not-fork for the GRN side.
 *
 * Quote-then-commit: run(dryRun=true) runs this exact function inside a transaction the caller rolls back,
 * so what the till shows before "Charge" is pressed is what charging will actually do — no second
 * implementation of the maths to drift (same pattern as modules/salon/pos.js).
 *
 * Cart lines: { product_id, quantity, batch_id?, unit_price?, discount? }
 *   batch_id is optional: omitted, the earliest-expiry ACTIVE batch is picked automatically (FEFO); given,
 *   that specific batch is used instead (an authorised override — see spec §15), still checked for
 *   status/expiry/quantity exactly as FEFO would check it.
 */
import { computeLineTax, isInterState, sumLines } from '../tax.js';
import { toPaise, toQuantity, toRupees } from '../../utils/money.js';
import { nextInvoiceNumber, paymentStatus, plannedPayments } from '../billing.js';
import { PharmacyError, getSettings, today } from './common.js';
import { allocateBatches, assertSellable, batchTracked, consumeBatches, lockProducts, q3, stockOut } from './stock.js';

const MAX_LINES = 60;

/** One batch's status/expiry row, locked, for an explicit (non-FEFO) pick. */
const lockBatch = async (client, { businessId, branchId, productId, batchId }) => {
  const row = (await client.query(
    `SELECT batch_id, qty_on_hand, status, expiry_date FROM wholesale_batches
     WHERE batch_id = $1 AND business_id = $2 AND branch_id = $3 AND product_id = $4 FOR UPDATE`,
    [batchId, businessId, branchId, productId])).rows[0];
  if (!row) throw new PharmacyError(400, 'That batch was not found for this product');
  return row;
};

/** Stock at this branch for non-batch-tracked products, locked for the duration of the sale. */
const lockBranchStock = async (client, branchId, productId) => {
  await client.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,0) ON CONFLICT DO NOTHING`, [branchId, productId]);
  return (await client.query(`SELECT quantity, reserved_qty FROM branch_stock WHERE branch_id = $1 AND product_id = $2 FOR UPDATE`, [branchId, productId])).rows[0];
};

export const createPharmacySale = async (client, tenant, userId, input, { dryRun = false } = {}) => {
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw new PharmacyError(400, 'Add at least one item');
  if (items.length > MAX_LINES) throw new PharmacyError(400, `A bill can have at most ${MAX_LINES} lines`);

  const settings = await getSettings(client, tenant.businessId);
  const business = (await client.query(`SELECT gst_enabled, state FROM businesses WHERE business_id = $1`, [tenant.businessId])).rows[0];
  let customer = null;
  if (input.customerId) {
    const row = (await client.query(`SELECT customer_id, name, state FROM customers WHERE customer_id = $1 AND business_id = $2`, [input.customerId, tenant.businessId])).rows[0];
    if (!row) throw new PharmacyError(400, 'Customer not found');
    customer = row;
  }
  const outlet = (await client.query(`SELECT state FROM branches WHERE branch_id = $1 AND business_id = $2`, [tenant.branchId, tenant.businessId])).rows[0];
  const interState = isInterState(outlet?.state || business.state, customer?.state);
  const date = input.invoiceDate ? String(input.invoiceDate).slice(0, 10) : await today(client, tenant.businessId);

  // lock every product row FIRST, in one call sorted by id — the chain that makes two cashiers selling the
  // last unit of the same product never both succeed (see modules/pharmacy/stock.js's header note)
  const ids = [...new Set(items.map((i) => Number(i.product_id)))];
  const products = await lockProducts(client, tenant.businessId, ids);
  const tracked = await batchTracked(client, tenant.businessId, ids);

  const lines = [];
  for (const raw of items) {
    const quantity = toQuantity(raw.quantity);
    if (!(quantity > 0)) throw new PharmacyError(400, 'Each line needs a quantity above zero');
    const product = products.get(Number(raw.product_id));
    if (!product) throw new PharmacyError(400, `Product ${raw.product_id} not found`);
    if (product.status !== 'ACTIVE') throw new PharmacyError(400, `${product.name} is archived`);
    const tr = tracked.get(product.product_id) || {};
    const unitPricePaise = raw.unit_price != null ? toPaise(raw.unit_price) : Number(product.selling_price_paise);
    const taxRate = Number(product.tax_rate);
    const discountPaise = raw.discount != null ? toPaise(raw.discount) : 0;

    let pickedBatches = [];
    if (product.track_inventory && (tr.batch_tracking || tr.expiry_tracking)) {
      if (raw.batch_id != null) {
        const batch = await lockBatch(client, { businessId: tenant.businessId, branchId: tenant.branchId, productId: product.product_id, batchId: Number(raw.batch_id) });
        assertSellable(batch);
        if (batch.expiry_date && batch.expiry_date < date) throw new PharmacyError(409, `That batch of ${product.name} has expired`);
        if (Number(batch.qty_on_hand) < quantity - 1e-9) throw new PharmacyError(409, `Only ${batch.qty_on_hand} of that batch is left`);
        pickedBatches = [{ batch_id: batch.batch_id, qty: quantity }];
      } else {
        const { allocations, unbatched } = await allocateBatches(client, { branchId: tenant.branchId, productId: product.product_id, qty: quantity, fefo: settings.fefo, today: date });
        if (unbatched > 1e-9 && settings.negative_stock === 'BLOCK') throw new PharmacyError(409, `Not enough stock for ${product.name} (short by ${unbatched})`);
        pickedBatches = allocations;
      }
    } else if (product.track_inventory && !input.allowNegativeStock) {
      const row = await lockBranchStock(client, tenant.branchId, product.product_id);
      const available = q3(Number(row.quantity) - Number(row.reserved_qty));
      if (available < quantity - 1e-9 && settings.negative_stock === 'BLOCK') throw new PharmacyError(409, `Not enough stock for ${product.name} (${available} left here)`);
    }

    const tax = computeLineTax({ quantity, unitPricePaise, discountPaise, taxRatePercent: business.gst_enabled ? taxRate : 0, gstEnabled: business.gst_enabled, interState });
    lines.push({ product, quantity, unitPricePaise, discountPaise, taxRate, tax, batches: pickedBatches });
  }

  const invoiceDiscountPaise = input.discount != null ? toPaise(input.discount) : 0;
  const totals = sumLines(lines.map((l) => l.tax));
  totals.discount_paise = lines.reduce((s, l) => s + l.discountPaise, 0) + invoiceDiscountPaise;
  totals.total_paise = Math.max(0, totals.total_paise - invoiceDiscountPaise);

  const plan = plannedPayments(input, totals.total_paise);
  const paidPaise = plan.reduce((s, p) => s + p.amountPaise, 0);

  if (dryRun) {
    return {
      invoice: {
        subtotal: toRupees(totals.subtotal_paise), discount: toRupees(totals.discount_paise), tax: toRupees(totals.tax_paise),
        cgst: toRupees(totals.cgst_paise), sgst: toRupees(totals.sgst_paise), igst: toRupees(totals.igst_paise),
        total: toRupees(totals.total_paise), amount_paid: toRupees(paidPaise), balance_due: toRupees(Math.max(0, totals.total_paise - paidPaise))
      },
      lines: lines.map((l) => ({
        product_id: l.product.product_id, name: l.product.name, quantity: l.quantity, unit_price: toRupees(l.unitPricePaise),
        discount: toRupees(l.discountPaise), tax: toRupees(l.tax.tax_paise), line_total: toRupees(l.tax.line_total_paise),
        batches: l.batches.map((b) => ({ batch_id: b.batch_id, qty: b.qty }))
      }))
    };
  }

  const invoiceNumber = await nextInvoiceNumber(client, tenant.businessId, tenant.branchId);
  const invoice = (await client.query(
    `INSERT INTO invoices (business_id, branch_id, customer_id, invoice_number, invoice_date, subtotal_paise, discount_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise, amount_paid_paise, balance_due_paise, payment_status, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ISSUED',$16,$17) RETURNING *`,
    [tenant.businessId, tenant.branchId, customer?.customer_id ?? null, invoiceNumber, date, totals.subtotal_paise, totals.discount_paise, totals.cgst_paise, totals.sgst_paise, totals.igst_paise, totals.tax_paise, totals.total_paise, paidPaise, Math.max(0, totals.total_paise - paidPaise), paymentStatus(totals.total_paise, paidPaise), input.notes || null, userId])).rows[0];

  for (const l of lines) {
    await client.query(
      `INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price_paise, discount_paise, tax_rate, tax_amount_paise, line_total_paise, batch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [invoice.invoice_id, l.product.product_id, l.product.name, l.quantity, l.unitPricePaise, l.discountPaise, l.taxRate, l.tax.tax_paise, l.tax.line_total_paise, l.batches[0]?.batch_id ?? null]);
    if (l.product.track_inventory) {
      await stockOut(client, { businessId: tenant.businessId, branchId: tenant.branchId, productId: l.product.product_id, qty: l.quantity, type: 'SALE', refType: 'invoice', refId: invoice.invoice_id, notes: invoiceNumber, userId });
      if (l.batches.length) await consumeBatches(client, { businessId: tenant.businessId, allocations: l.batches, refType: 'invoice', refId: invoice.invoice_id });
    }
  }
  for (const p of plan) {
    await client.query(`INSERT INTO payments (business_id, branch_id, invoice_id, customer_id, payment_method, amount_paise, reference_number, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenant.businessId, tenant.branchId, invoice.invoice_id, customer?.customer_id ?? null, p.method, p.amountPaise, p.reference, userId]);
  }
  return {
    invoice: {
      invoice_id: invoice.invoice_id, invoice_number: invoiceNumber, invoice_date: date,
      subtotal: toRupees(totals.subtotal_paise), discount: toRupees(totals.discount_paise), tax: toRupees(totals.tax_paise),
      cgst: toRupees(totals.cgst_paise), sgst: toRupees(totals.sgst_paise), igst: toRupees(totals.igst_paise),
      total: toRupees(totals.total_paise), amount_paid: toRupees(paidPaise), balance_due: toRupees(Math.max(0, totals.total_paise - paidPaise)),
      payment_status: invoice.payment_status
    },
    lines: lines.map((l) => ({
      product_id: l.product.product_id, name: l.product.name, quantity: l.quantity, unit_price: toRupees(l.unitPricePaise),
      discount: toRupees(l.discountPaise), tax: toRupees(l.tax.tax_paise), line_total: toRupees(l.tax.line_total_paise),
      batches: l.batches.map((b) => ({ batch_id: b.batch_id, qty: b.qty }))
    }))
  };
};
