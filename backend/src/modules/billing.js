/*
 * The transactional core of turning a list of items into an invoice.
 *
 * Extracted out of invoices.controller.js so Orders (a running KOT tab) can
 * convert itself into an invoice through the exact same tax, stock-locking
 * and payment logic a direct POS sale uses — not a second copy of it. Two
 * copies of "how GST and stock decrement work" is exactly the kind of code
 * that quietly drifts apart the first time one of them gets a bug fix the
 * other doesn't.
 *
 * This function does not open or close the transaction — the caller does,
 * because a caller (orders.controller.js's bill()) may need to do more inside
 * the same transaction, such as marking the order BILLED and freeing its
 * table. It also does not touch req/res: failures are thrown as BillingError
 * with the HTTP status already attached, so either caller can translate them
 * the same way.
 */
import { recordAudit, recordEvent } from './events.js';
import { computeLineTax, isInterState, sumLines } from './tax.js';
import { toPaise, toQuantity, toRupees } from '../utils/money.js';
import { ModifierError, modifierLabel, outletSettingsFor, resolveModifiers } from './menu.js';
import { moveStock, stockAt } from './stock.js';
import { getProgram, isLive, progressFor, recordEvent as recordLoyalty } from './loyalty.js';
import { CouponError, validateCoupon } from './coupons.js';
import { consumptionPerUnit, loadRecipes } from './recipes.js';

export class BillingError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
  }
}

export const paymentStatus = (totalPaise, paidPaise) => {
  if (paidPaise <= 0) return 'UNPAID';
  return paidPaise >= totalPaise ? 'PAID' : 'PARTIAL';
};

/*
 * The next number for this business, claimed atomically. `FOR UPDATE` locks
 * the business row for the rest of the transaction, so two invoices billed in
 * the same instant cannot both read "next number 47".
 */
const nextInvoiceNumber = async (client, businessId) => {
  const { rows } = await client.query(
    `SELECT invoice_prefix, invoice_next_number FROM businesses WHERE business_id = $1 FOR UPDATE`,
    [businessId]
  );
  const { invoice_prefix: prefix, invoice_next_number: n } = rows[0];
  await client.query(`UPDATE businesses SET invoice_next_number = invoice_next_number + 1 WHERE business_id = $1`, [businessId]);
  return `${prefix}-${String(n).padStart(4, '0')}`;
};

export const asInvoice = (row) => ({
  invoice_id: row.invoice_id,
  invoice_number: row.invoice_number,
  invoice_date: row.invoice_date,
  customer_id: row.customer_id,
  customer_name: row.customer_name,
  subtotal: toRupees(row.subtotal_paise),
  discount: toRupees(row.discount_paise),
  cgst: toRupees(row.cgst_paise),
  sgst: toRupees(row.sgst_paise),
  igst: toRupees(row.igst_paise),
  tax: toRupees(row.tax_paise),
  total: toRupees(row.total_paise),
  amount_paid: toRupees(row.amount_paid_paise),
  balance_due: toRupees(row.balance_due_paise),
  refunded: toRupees(row.refunded_paise || 0),
  coupon_code: row.coupon_code || null,
  coupon_discount: toRupees(row.coupon_discount_paise || 0),
  loyalty_discount: toRupees(row.loyalty_discount_paise || 0),
  round_off: toRupees(row.round_off_paise || 0),
  credited: toRupees(row.credited_paise || 0),
  payment_status: row.payment_status,
  status: row.status,
  notes: row.notes
});

/**
 * Build and insert an invoice (+ items, + stock movement, + payment) inside
 * the caller's already-open transaction. Throws BillingError on anything the
 * caller must roll back for (missing customer, archived product, overselling,
 * a malformed custom line) — the caller is expected to ROLLBACK on catch.
 *
 * @param client       an open pg client, mid-transaction
 * @param tenant       { businessId, branchId }
 * @param userId       who is billing this
 * @param input        { customerId, items, discount, notes, payment, invoiceDate }
 *   items: [{ product_id?, description?, unit_price?, quantity, discount?, tax_rate? }]
 *   payment: { amount, method, reference_number }
 */
export const createInvoiceInTransaction = async (client, tenant, userId, input) => {
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw new BillingError(400, 'Add at least one item');

  const business = (await client.query(
    `SELECT gst_enabled, state, currency, timezone, round_off_enabled FROM businesses WHERE business_id = $1`,
    [tenant.businessId]
  )).rows[0];

  let customer = null;
  if (input.customerId) {
    const { rows } = await client.query(
      `SELECT customer_id, name, state FROM customers WHERE customer_id = $1 AND business_id = $2`,
      [input.customerId, tenant.businessId]
    );
    if (!rows.length) throw new BillingError(400, 'Customer not found');
    customer = rows[0];
  }
  // The business's own calendar day: what a loyalty visit and a coupon's validity window are measured in.
  const today = input.invoiceDate ? String(input.invoiceDate).slice(0, 10)
    : (await client.query(`SELECT ((CURRENT_TIMESTAMP AT TIME ZONE $1)::date)::text AS d`, [business.timezone || 'Asia/Kolkata'])).rows[0].d;

  /* Loyalty: a known customer on a live program. Locking the customer serialises two tills billing
     the same person at once, so a reward can't be given twice. */
  const program = customer ? await getProgram(client, tenant.businessId) : null;
  let loyalty = null;
  if (customer && isLive(program)) {
    await client.query(`SELECT 1 FROM customers WHERE customer_id = $1 FOR UPDATE`, [customer.customer_id]);
    loyalty = { program, progress: await progressFor(client, tenant.businessId, customer.customer_id, program, today), applied: null };
  }

  // GST place of supply follows the outlet's state when it has one (outlets can be in different states).
  const outlet = (await client.query(`SELECT state FROM branches WHERE branch_id = $1 AND business_id = $2`, [tenant.branchId, tenant.businessId])).rows[0];
  const interState = isInterState(outlet?.state || business.state, customer?.state);

  const productIds = [...new Set(items.filter((i) => i.product_id).map((i) => Number(i.product_id)))];
  const products = new Map();
  if (productIds.length) {
    const { rows } = await client.query(
      `SELECT product_id, name, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, current_stock, status
       FROM products WHERE business_id = $1 AND product_id = ANY($2::int[]) ORDER BY product_id FOR UPDATE`,
      [tenant.businessId, productIds]
    );
    for (const p of rows) products.set(p.product_id, p);
  }
  // What each dish/item has at THIS outlet (the products row only holds the business total).
  const outletStock = await stockAt(client, tenant.branchId, productIds);
  const outletSettings = await outletSettingsFor(client, tenant.branchId, productIds);

  const recipes = await loadRecipes(client, tenant.businessId, productIds);

  const lines = [];
  for (const raw of items) {
    const quantity = toQuantity(raw.quantity);
    let description, unitPricePaise, taxRate, product = null, modifiers = [], consumption = [];

    if (raw.product_id) {
      product = products.get(Number(raw.product_id));
      if (!product) throw new BillingError(400, `Product ${raw.product_id} not found`);
      if (product.status !== 'ACTIVE') throw new BillingError(400, `${product.name} is archived`);
      const here = outletSettings.get(product.product_id);
      if (here && here.is_available === false) throw new BillingError(409, `${product.name} is not available at this outlet`);
      if (product.track_inventory && outletStock.get(product.product_id) < quantity) {
        throw new BillingError(409, `Not enough stock for ${product.name} (${outletStock.get(product.product_id)} left here)`);
      }
      description = raw.description || product.name;
      unitPricePaise = raw.unit_price != null ? toPaise(raw.unit_price) : (here?.price_paise ?? product.selling_price_paise);
      taxRate = Number(product.tax_rate);

      /* From an order, modifiers arrive already snapshotted and priced into
         unit_price; from the POS they arrive as ids that still need checking. */
      if (Array.isArray(raw.modifiers)) {
        modifiers = raw.modifiers;
      } else {
        try {
          const picked = await resolveModifiers(client, tenant.businessId, product.product_id, raw.modifier_ids);
          modifiers = picked.snapshot;
          unitPricePaise = Number(unitPricePaise) + picked.deltaPaise;
        } catch (error) {
          if (error instanceof ModifierError) throw new BillingError(400, error.message);
          throw error;
        }
      }
      if (modifiers.length) description = `${description} (${modifierLabel(modifiers)})`;
      consumption = consumptionPerUnit(recipes.get(product.product_id), modifiers);
    } else {
      if (!raw.description || raw.unit_price == null) {
        throw new BillingError(400, 'A custom line needs a description and a price');
      }
      description = String(raw.description).trim();
      unitPricePaise = toPaise(raw.unit_price);
      taxRate = Number(raw.tax_rate) || 0;
    }

    let discountPaise = raw.discount != null ? toPaise(raw.discount) : 0;
    // The reward item is free (up to the reward quantity) on the visit that earns it — once per bill.
    if (loyalty?.progress.reward_ready && !loyalty.applied && product && product.product_id === program.reward_product_id) {
      const freeQty = Math.min(quantity, program.reward_quantity);
      const gross = Math.round(quantity * unitPricePaise);
      const free = Math.min(Math.round(freeQty * unitPricePaise), Math.max(0, gross - discountPaise));
      if (free > 0) { discountPaise += free; loyalty.applied = { amountPaise: free, item: product.name }; }
    }
    const tax = computeLineTax({
      quantity, unitPricePaise, discountPaise, taxRatePercent: taxRate,
      gstEnabled: business.gst_enabled, interState
    });

    lines.push({
      product_id: product?.product_id || null, description, quantity, unitPricePaise,
      discountPaise, taxRate, trackInventory: Boolean(product?.track_inventory), modifiers, consumption,
      fallbackCostPaise: product ? Number(product.purchase_price_paise) : 0, ...tax
    });
  }

  /* Ingredient stock this sale uses, locked in id order so two tills billing
     dishes that share an ingredient can never deadlock each other. */
  const ingredientIds = [...new Set(lines.flatMap((l) => l.consumption.map((c) => c.ingredient_id)))].sort((a, b) => a - b);
  const ingredients = new Map();
  if (ingredientIds.length) {
    const { rows } = await client.query(
      `SELECT product_id, purchase_price_paise, track_inventory FROM products
       WHERE business_id = $1 AND product_id = ANY($2::int[]) ORDER BY product_id FOR UPDATE`,
      [tenant.businessId, ingredientIds]
    );
    for (const r of rows) ingredients.set(r.product_id, r);
  }
  for (const line of lines) {
    line.unitCostPaise = line.consumption.length
      ? Math.round(line.consumption.reduce((sum, c) => sum + c.qty_per_unit * Number(ingredients.get(c.ingredient_id)?.purchase_price_paise || 0), 0))
      : line.fallbackCostPaise;
  }

  const totals = sumLines(lines);
  let invoiceDiscountPaise = input.discount != null ? Math.max(0, toPaise(input.discount)) : 0;

  // A coupon comes off what is left after any discount given by hand.
  let coupon = null;
  if (input.couponCode) {
    try {
      coupon = await validateCoupon(client, {
        businessId: tenant.businessId, code: input.couponCode, customerId: customer?.customer_id ?? null,
        totalPaise: Math.max(0, totals.total_paise - invoiceDiscountPaise), today, lock: true
      });
    } catch (error) {
      if (error instanceof CouponError) throw new BillingError(400, error.message);
      throw error;
    }
    invoiceDiscountPaise += coupon.discountPaise;
  }
  let finalTotalPaise = Math.max(0, totals.total_paise - invoiceDiscountPaise);
  // Cash round-off: the bill is rounded to the nearest rupee; the difference is kept on the invoice (never taxed).
  let roundOffPaise = 0;
  if (business.round_off_enabled && finalTotalPaise > 0) {
    roundOffPaise = Math.round(finalTotalPaise / 100) * 100 - finalTotalPaise;
    finalTotalPaise += roundOffPaise;
  }

  let paidPaise = 0;
  if (input.payment?.amount != null) {
    // 'FULL' = collect exactly what the bill comes to (the caller cannot know it before tax is worked out).
    paidPaise = input.payment.amount === 'FULL' ? finalTotalPaise : toPaise(input.payment.amount);
    if (paidPaise < 0) throw new BillingError(400, 'Payment amount cannot be negative');
  }
  const balancePaise = finalTotalPaise - paidPaise;

  const invoiceNumber = await nextInvoiceNumber(client, tenant.businessId);

  const invoice = (await client.query(
    `INSERT INTO invoices
       (business_id, branch_id, customer_id, invoice_number, invoice_date,
        subtotal_paise, discount_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise,
        amount_paid_paise, balance_due_paise, payment_status, notes, created_by, order_id,
        coupon_code, coupon_discount_paise, loyalty_discount_paise, round_off_paise)
     VALUES ($1,$2,$3,$4,COALESCE($5::date,(CURRENT_TIMESTAMP AT TIME ZONE $18)::date),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$19,$20,$21,$22,$23)
     RETURNING *`,
    [
      tenant.businessId, tenant.branchId, customer?.customer_id || null, invoiceNumber, input.invoiceDate || null,
      totals.subtotal_paise, invoiceDiscountPaise, totals.cgst_paise, totals.sgst_paise, totals.igst_paise, totals.tax_paise, finalTotalPaise,
      paidPaise, Math.max(0, balancePaise), paymentStatus(finalTotalPaise, paidPaise), input.notes || null, userId,
      business.timezone || 'Asia/Kolkata', input.orderId || null,
      coupon ? coupon.coupon.code : null, coupon ? coupon.discountPaise : 0, loyalty?.applied ? loyalty.applied.amountPaise : 0, roundOffPaise
    ]
  )).rows[0];

  for (const line of lines) {
    await client.query(
      `INSERT INTO invoice_items
         (invoice_id, product_id, description, quantity, unit_price_paise, discount_paise, tax_rate, tax_amount_paise, line_total_paise, modifiers, unit_cost_paise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [invoice.invoice_id, line.product_id, line.description, line.quantity, line.unitPricePaise,
       line.discountPaise, line.taxRate, line.tax_paise, line.line_total_paise, JSON.stringify(line.modifiers), line.unitCostPaise]
    );

    if (line.trackInventory) {
      await moveStock(client, { businessId: tenant.businessId, branchId: tenant.branchId, productId: line.product_id, delta: -line.quantity });
      await client.query(
        `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, created_by)
         VALUES ($1,$2,$3,'SALE',$4,'invoice',$5,$6)`,
        [tenant.businessId, tenant.branchId, line.product_id, -line.quantity, invoice.invoice_id, userId]
      );
    }
  }

  /* Ingredient consumption: one ledger row per ingredient for the whole
     invoice. Ingredients may go negative (a kitchen keeps selling on an
     imperfect count); the negative shows in Inventory to be corrected. */
  const used = new Map();
  for (const line of lines) {
    for (const c of line.consumption) used.set(c.ingredient_id, (used.get(c.ingredient_id) || 0) + c.qty_per_unit * line.quantity);
  }
  for (const id of ingredientIds) {
    if (!ingredients.get(id)?.track_inventory) continue;
    const qty = Math.round(used.get(id) * 1000) / 1000;
    if (!qty) continue;
    await moveStock(client, { businessId: tenant.businessId, branchId: tenant.branchId, productId: id, delta: -qty });
    await client.query(
      `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, created_by)
       VALUES ($1,$2,$3,'SALE',$4,'invoice',$5,$6)`,
      [tenant.businessId, tenant.branchId, id, -qty, invoice.invoice_id, userId]
    );
  }

  if (coupon) {
    await client.query(
      `INSERT INTO coupon_redemptions (coupon_id, business_id, invoice_id, customer_id, amount_paise) VALUES ($1,$2,$3,$4,$5)`,
      [coupon.coupon.coupon_id, tenant.businessId, invoice.invoice_id, customer?.customer_id ?? null, coupon.discountPaise]
    );
  }

  /* The visit card: a reward visit redeems; any other bill at or above the minimum earns a stamp. */
  if (loyalty) {
    if (loyalty.applied) {
      await recordLoyalty(client, { businessId: tenant.businessId, customerId: customer.customer_id, invoiceId: invoice.invoice_id, date: today, redeemed: true, amountPaise: loyalty.applied.amountPaise });
    } else if (finalTotalPaise >= Number(program.min_bill_paise)) {
      await recordLoyalty(client, { businessId: tenant.businessId, customerId: customer.customer_id, invoiceId: invoice.invoice_id, date: today, redeemed: false });
    }
  }

  if (paidPaise > 0) {
    await client.query(
      `INSERT INTO payments (business_id, branch_id, invoice_id, customer_id, payment_method, amount_paise, reference_number, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        tenant.businessId, tenant.branchId, invoice.invoice_id, customer?.customer_id || null,
        input.payment?.method || 'CASH', paidPaise, input.payment?.reference_number || null, null, userId
      ]
    );
  }

  return {
    ...asInvoice({ ...invoice, customer_name: customer?.name || null }), currency: business.currency,
    loyalty_reward: loyalty?.applied ? { item: loyalty.applied.item, amount: toRupees(loyalty.applied.amountPaise) } : null
  };
};

/** Fire the audit/analytics side-effects a successful bill produces. Called
    after COMMIT — never inside the transaction, since these never roll back. */
export const recordInvoiceCreated = (req, invoice) => {
  recordAudit(req, { action: 'invoice.created', resource_type: 'invoice', resource_id: invoice.invoice_id, metadata: { total: invoice.total } });
  recordEvent('invoice_created', { userId: req.auth.userId, businessId: req.tenant.businessId, properties: { total: invoice.total } });
};
