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
import { takeBatchesForSale } from './retailStock.js';
import { isRetail } from './retailSettings.js';
import { activePromotions, priceLines } from './promotions.js';
import { businessNow } from '../utils/dates.js';
import { getProgram, isLive, progressFor, recordEvent as recordLoyalty } from './loyalty.js';
import { CouponError, validateCoupon } from './coupons.js';
import { consumptionPerUnit, loadRecipes } from './recipes.js';
import { comboBlocker, comboConsumption, loadCombos } from './combos.js';
import { afterBill } from './messaging/index.js';
import { PointsError, addEntry, earnFor, getPoints, redemption, standing, tierFor } from './points.js';

export class BillingError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
  }
}

/** A card-slip / UTR / cheque reference: trimmed, blank means none, and longer than the column (80) is refused rather than a 500. */
export const paymentReference = (value) => {
  const text = String(value ?? '').trim();
  if (text.length > 80) throw new BillingError(400, 'The payment reference is too long (80 characters at most)');
  return text || null;
};

export const paymentStatus = (totalPaise, paidPaise) => {
  if (paidPaise <= 0) return 'UNPAID';
  return paidPaise >= totalPaise ? 'PAID' : 'PARTIAL';
};

/*
 * The next number for this business, claimed atomically. `FOR UPDATE` locks
 * the business row for the rest of the transaction, so two invoices billed in
 * the same instant cannot both read "next number 47".
 */
export const nextInvoiceNumber = async (client, businessId, branchId) => {
  // an outlet with its own series numbers from its own counter. NO KEY UPDATE: a plain FOR UPDATE would clash with the
  // foreign-key checks other inserts make on this branch row (the audit log, an order) and could deadlock with them.
  const own = branchId ? (await client.query(`SELECT invoice_prefix, invoice_next_number FROM branches WHERE branch_id = $1 AND business_id = $2 FOR NO KEY UPDATE`, [branchId, businessId])).rows[0] : null;
  if (own?.invoice_prefix) {
    await client.query(`UPDATE branches SET invoice_next_number = invoice_next_number + 1 WHERE branch_id = $1`, [branchId]);
    return `${own.invoice_prefix}-${String(own.invoice_next_number).padStart(4, '0')}`;
  }
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
  points_discount: toRupees(row.points_discount_paise || 0),
  points_earned: row.points_earned || 0,
  points_redeemed: row.points_redeemed || 0,
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
 *   payment: { amount, method, reference_number }       one payment ('FULL' = the whole bill)
 *   payments: [{ amount, method, reference_number }]     or several (split); one of them may be
 *             'REST' (whatever the others leave), and together they may not exceed the bill
 */
const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CREDIT', 'OTHER', 'WALLET', 'GIFT_CARD', 'CHEQUE'];
const MAX_SPLIT = 6;

/*
 * The payments taken with a bill, as rows to insert. A single `payment` keeps
 * its old meaning (any amount, 'FULL' for the whole bill). A `payments` list is
 * a split: every part needs a positive amount except at most one 'REST', which
 * takes whatever the others leave, and the parts may not add up to more than
 * the bill. 'REST' exists because only the server knows the exact final total
 * (tax rounding, round-off, loyalty rewards), so the till cannot fill the last
 * part in to the paisa.
 */
export const plannedPayments = (input, totalPaise) => {
  if (Array.isArray(input.payments)) {
    const list = input.payments.filter((p) => p && (p.amount != null && p.amount !== ''));
    if (list.length > MAX_SPLIT) throw new BillingError(400, `A bill can be split into at most ${MAX_SPLIT} payments`);
    if (list.filter((p) => p.amount === 'REST' || p.amount === 'FULL').length > 1) throw new BillingError(400, 'Only one part of a split payment can be "the rest"');
    const rows = list.map((p) => {
      const method = String(p.method || 'CASH').toUpperCase();
      if (!PAYMENT_METHODS.includes(method)) throw new BillingError(400, `Unknown payment method: ${p.method}`);
      if (p.amount === 'REST' || p.amount === 'FULL') return { method, rest: true, reference: paymentReference(p.reference_number) };
      const amountPaise = toPaise(p.amount);
      if (amountPaise <= 0) throw new BillingError(400, 'Each part of a split payment needs an amount above zero');
      return { method, amountPaise, reference: paymentReference(p.reference_number) };
    });
    const fixed = rows.reduce((s, r) => s + (r.rest ? 0 : r.amountPaise), 0);
    if (fixed > totalPaise) throw new BillingError(400, `The payments add up to ₹${toRupees(fixed)}, more than the bill of ₹${toRupees(totalPaise)}`);
    return rows
      .map((r) => (r.rest ? { ...r, amountPaise: totalPaise - fixed } : r))
      .filter((r) => r.amountPaise > 0);
  }
  if (input.payment?.amount != null) {
    // 'FULL' = collect exactly what the bill comes to (the caller cannot know it before tax is worked out).
    // More than the bill (cash handed over) records the bill; the difference is change, not a payment.
    const asked = input.payment.amount === 'FULL' ? totalPaise : toPaise(input.payment.amount);
    if (asked < 0) throw new BillingError(400, 'Payment amount cannot be negative');
    const amountPaise = Math.min(asked, totalPaise);
    return amountPaise > 0 ? [{ method: input.payment.method || 'CASH', amountPaise, reference: paymentReference(input.payment.reference_number) }] : [];
  }
  return [];
};

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
  const pts = customer ? await getPoints(client, tenant.businessId) : null;
  if (customer && (isLive(program) || pts)) await client.query(`SELECT 1 FROM customers WHERE customer_id = $1 FOR UPDATE`, [customer.customer_id]);
  const pointsState = pts ? await standing(client, tenant.businessId, customer.customer_id, pts) : null;
  let loyalty = null;
  if (customer && isLive(program)) {
    loyalty = { program, progress: await progressFor(client, tenant.businessId, customer.customer_id, program, today), applied: null };
  }

  // GST place of supply follows the outlet's state when it has one (outlets can be in different states).
  const outlet = (await client.query(`SELECT state FROM branches WHERE branch_id = $1 AND business_id = $2`, [tenant.branchId, tenant.businessId])).rows[0];
  const interState = isInterState(outlet?.state || business.state, customer?.state);

  const productIds = [...new Set(items.filter((i) => i.product_id).map((i) => Number(i.product_id)))];
  const products = new Map();
  if (productIds.length) {
    const { rows } = await client.query(
      `SELECT product_id, name, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, current_stock, status, category_id
       FROM products WHERE business_id = $1 AND product_id = ANY($2::int[]) ORDER BY product_id FOR UPDATE`,
      [tenant.businessId, productIds]
    );
    for (const p of rows) products.set(p.product_id, p);
  }
  // What each dish/item has at THIS outlet (the products row only holds the business total).
  const outletStock = await stockAt(client, tenant.branchId, productIds);
  const outletSettings = await outletSettingsFor(client, tenant.branchId, productIds);

  // Combos sell as one line but use up their components (stock and recipes).
  const combos = await loadCombos(client, tenant.businessId, productIds);
  const componentIds = [...new Set([...combos.values()].flat().map((c) => c.component_id))];
  const recipes = await loadRecipes(client, tenant.businessId, [...new Set([...productIds, ...componentIds])], tenant.branchId);

  const lines = [];
  const overrideIds = new Set();   // ingredients a line named by hand (consumption_actual) — must all exist
  for (const raw of items) {
    const quantity = toQuantity(raw.quantity);
    let description, unitPricePaise, taxRate, product = null, modifiers = [], consumption = [], stockFactor = 1;

    if (raw.product_id) {
      product = products.get(Number(raw.product_id));
      if (!product) throw new BillingError(400, `Product ${raw.product_id} not found`);
      if (product.status !== 'ACTIVE') throw new BillingError(400, `${product.name} is archived`);
      const here = outletSettings.get(product.product_id);
      if (here && here.is_available === false) throw new BillingError(409, `${product.name} is not available at this outlet`);
      // a line sold in a larger unit (a carton of 24 boxes) moves `unit_factor` times as much stock as its quantity
      const factor = raw.unit_factor != null ? Number(raw.unit_factor) : 1;
      if (!Number.isFinite(factor) || factor <= 0) throw new BillingError(400, 'The unit conversion must be above zero');
      stockFactor = factor;
      if (product.track_inventory && !input.allowNegativeStock && outletStock.get(product.product_id) < quantity * factor - 1e-9) {
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
      /* The amount actually used can differ from the recipe (hair colour: 50 ml by default, 60 ml today). The till sends
         the TOTAL used for this line, per ingredient; anything it lists replaces the recipe's figure, and an ingredient
         that is not in the recipe can be added. Ids are checked against the business below, where ingredients are loaded. */
      if (Array.isArray(raw.consumption_actual)) {
        const byId = new Map(consumption.map((c) => [c.ingredient_id, c.qty_per_unit]));
        for (const a of raw.consumption_actual) {
          const id = Number(a.ingredient_id); const used = Number(a.quantity);
          if (!Number.isInteger(id) || !Number.isFinite(used) || used < 0) throw new BillingError(400, 'Each consumable needs a quantity of zero or more');
          byId.set(id, used / quantity);
          overrideIds.add(id);
        }
        consumption = [...byId].map(([ingredient_id, qty_per_unit]) => ({ ingredient_id, qty_per_unit }));
      }
      const parts = combos.get(product.product_id);
      if (parts) {
        const blocked = await comboBlocker(client, tenant.branchId, product.name, parts, quantity);
        if (blocked) throw new BillingError(409, blocked);
        const merged = new Map(consumption.map((c) => [c.ingredient_id, c.qty_per_unit]));
        for (const c of comboConsumption(parts, recipes)) merged.set(c.ingredient_id, (merged.get(c.ingredient_id) || 0) + c.qty_per_unit);
        consumption = [...merged].map(([ingredient_id, qty_per_unit]) => ({ ingredient_id, qty_per_unit }));
      }
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
      gstEnabled: business.gst_enabled, interState, inclusive: input.taxInclusive === true
    });

    lines.push({
      product_id: product?.product_id || null, categoryId: product?.category_id ?? null, description, quantity, unitPricePaise,
      discountPaise, taxRate, trackInventory: Boolean(product?.track_inventory), modifiers, consumption,
      unitName: raw.unit_name ? String(raw.unit_name).slice(0, 24) : null, stockFactor,
      fallbackCostPaise: product ? Math.round(Number(product.purchase_price_paise) * stockFactor) : 0, ...tax
    });
  }

  /* Offers: when the till asks for them (a retail till does), every product line is priced by the offers that are on today.
     The saving is a line discount taken BEFORE tax, so GST follows what was actually charged. */
  if (input.applyPromotions === true) {
    const promos = await activePromotions(client, tenant.businessId, await businessNow(tenant.businessId, client));
    if (promos.length) {
      const cut = priceLines(promos, lines.map((l, index) => ({ index, product_id: l.product_id, category_id: l.categoryId, quantity: l.quantity, unitPricePaise: l.unitPricePaise, discountPaise: l.discountPaise })), { hasCustomer: Boolean(customer) });
      for (const [index, r] of cut) {
        const line = lines[index];
        line.discountPaise += r.discountPaise;
        line.promo = { id: r.promo_id, discountPaise: r.discountPaise };
        Object.assign(line, computeLineTax({
          quantity: line.quantity, unitPricePaise: line.unitPricePaise, discountPaise: line.discountPaise, taxRatePercent: line.taxRate,
          gstEnabled: business.gst_enabled, interState, inclusive: input.taxInclusive === true
        }));
      }
    }
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
  for (const id of overrideIds) if (!ingredients.has(id)) throw new BillingError(400, 'One of the consumables is not in your stock list');
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
  let pointsDiscountPaise = 0; let pointsRedeemed = 0;
  if (input.redeemPoints) {
    if (!customer) throw new BillingError(400, 'Choose a customer to use their points');
    if (!pts) throw new BillingError(400, 'Loyalty points are not switched on');
    try {
      pointsRedeemed = Number(input.redeemPoints);
      pointsDiscountPaise = redemption(pts, pointsState, pointsRedeemed, Math.max(0, totals.total_paise - invoiceDiscountPaise));
    } catch (error) {
      if (error instanceof PointsError) throw new BillingError(error.status, error.message);
      throw error;
    }
    invoiceDiscountPaise += pointsDiscountPaise;
  }
  let finalTotalPaise = Math.max(0, totals.total_paise - invoiceDiscountPaise);
  // Cash round-off: the bill is rounded to the nearest rupee; the difference is kept on the invoice (never taxed).
  let roundOffPaise = 0;
  if (business.round_off_enabled && finalTotalPaise > 0) {
    roundOffPaise = Math.round(finalTotalPaise / 100) * 100 - finalTotalPaise;
    finalTotalPaise += roundOffPaise;
  }

  /* A caller with its own earning rules (the salon: a different rate for services, products, packages) supplies them;
     everyone else earns the program's single rate on the bill. */
  const pointsEarned = pts
    ? (typeof input.earnPoints === 'function' ? Math.max(0, Math.floor(input.earnPoints({ lines, finalTotalPaise, state: pointsState, cfg: pts }))) : earnFor(pts, pointsState, finalTotalPaise))
    : 0;

  /* An exchange: the credit from a return (a credit note) is spent on this bill as a payment, never as a discount, because the
     return already took that revenue off the old sale. What the credit does not cover is paid the usual way. */
  let creditTaken = null;
  if (input.exchangeCreditNoteId) {
    const cn = (await client.query(
      `SELECT cn_id, cn_number, total_paise, settled_balance_paise, refunded_paise, credit_used_paise FROM credit_notes WHERE cn_id = $1 AND business_id = $2 FOR UPDATE`,
      [input.exchangeCreditNoteId, tenant.businessId])).rows[0];
    if (!cn) throw new BillingError(400, 'That credit note was not found');
    const available = Number(cn.total_paise) - Number(cn.settled_balance_paise) - Number(cn.refunded_paise) - Number(cn.credit_used_paise);
    if (available <= 0) throw new BillingError(400, `${cn.cn_number} has no credit left to use`);
    creditTaken = { cn, amountPaise: Math.min(available, finalTotalPaise) };
  }
  const takenPayments = [
    ...(creditTaken && creditTaken.amountPaise > 0 ? [{ method: 'OTHER', amountPaise: creditTaken.amountPaise, reference: paymentReference(`Exchange ${creditTaken.cn.cn_number}`) }] : []),
    ...plannedPayments(input, finalTotalPaise - (creditTaken?.amountPaise || 0))
  ];
  const paidPaise = takenPayments.reduce((s, p) => s + p.amountPaise, 0);
  const balancePaise = finalTotalPaise - paidPaise;

  const invoiceNumber = await nextInvoiceNumber(client, tenant.businessId, tenant.branchId);

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
         (invoice_id, product_id, description, quantity, unit_price_paise, discount_paise, tax_rate, tax_amount_paise, line_total_paise, modifiers, unit_cost_paise, unit_name, unit_factor, promo_id, promo_discount_paise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [invoice.invoice_id, line.product_id, line.description, line.quantity, line.unitPricePaise,
       line.discountPaise, line.taxRate, line.tax_paise, line.line_total_paise, JSON.stringify(line.modifiers), line.unitCostPaise, line.unitName, line.stockFactor,
       line.promo?.id ?? null, line.promo?.discountPaise ?? 0]
    );

    // stockHandledElsewhere: the goods are not in this outlet's stock (a distributor's van holds them), so selling them here must not take them out of it
    if (line.trackInventory && !input.stockHandledElsewhere) {
      const stockQty = Math.round(line.quantity * line.stockFactor * 1000) / 1000;
      await moveStock(client, { businessId: tenant.businessId, branchId: tenant.branchId, productId: line.product_id, delta: -stockQty });
      await client.query(
        `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, created_by)
         VALUES ($1,$2,$3,'SALE',$4,'invoice',$5,$6)`,
        [tenant.businessId, tenant.branchId, line.product_id, -stockQty, invoice.invoice_id, userId]
      );
    }
  }

  // a retail product that tracks expiry is sold from its soonest-expiring batch
  if (isRetail(tenant) && !input.stockHandledElsewhere) {
    await takeBatchesForSale(client, { businessId: tenant.businessId, branchId: tenant.branchId, invoiceId: invoice.invoice_id,
      lines: lines.filter((l) => l.trackInventory && l.product_id).map((l) => ({ productId: l.product_id, qty: Math.round(l.quantity * l.stockFactor * 1000) / 1000 })) });
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

  if (pts) {
    if (pointsRedeemed > 0) {
      await addEntry(client, { businessId: tenant.businessId, customerId: customer.customer_id, invoiceId: invoice.invoice_id, kind: 'REDEEM', points: -pointsRedeemed, amountPaise: pointsDiscountPaise, createdBy: userId });
    }
    if (pointsEarned > 0) {
      await addEntry(client, { businessId: tenant.businessId, customerId: customer.customer_id, invoiceId: invoice.invoice_id, kind: 'EARN', points: pointsEarned, amountPaise: finalTotalPaise, createdBy: userId });
    }
    await client.query('UPDATE invoices SET points_discount_paise = $2, points_earned = $3, points_redeemed = $4 WHERE invoice_id = $1',
      [invoice.invoice_id, pointsDiscountPaise, pointsEarned, pointsRedeemed]);
    invoice.points_discount_paise = pointsDiscountPaise; invoice.points_earned = pointsEarned; invoice.points_redeemed = pointsRedeemed;
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

  if (creditTaken && creditTaken.amountPaise > 0) {
    await client.query(`UPDATE credit_notes SET credit_used_paise = credit_used_paise + $2 WHERE cn_id = $1`, [creditTaken.cn.cn_id, creditTaken.amountPaise]);
  }

  for (const p of takenPayments) {
    await client.query(
      `INSERT INTO payments (business_id, branch_id, invoice_id, customer_id, payment_method, amount_paise, reference_number, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tenant.businessId, tenant.branchId, invoice.invoice_id, customer?.customer_id || null, p.method, p.amountPaise, p.reference, null, userId]
    );
  }

  return {
    ...asInvoice({ ...invoice, customer_name: customer?.name || null }), currency: business.currency,
    loyalty_points: pts ? {
      earned: pointsEarned, redeemed: pointsRedeemed, balance: pointsState.balance - pointsRedeemed + pointsEarned,
      tier: (tierFor(pts.tiers, pointsState.lifetime + pointsEarned).current || {}).name ?? null
    } : null,
    loyalty_reward: loyalty?.applied ? { item: loyalty.applied.item, amount: toRupees(loyalty.applied.amountPaise) } : null,
    payments_taken: takenPayments.map((p) => ({ method: p.method, amount: toRupees(p.amountPaise) }))
  };
};

/** Fire the audit/analytics side-effects a successful bill produces. Called
    after COMMIT — never inside the transaction, since these never roll back. */
export const recordInvoiceCreated = (req, invoice) => {
  recordAudit(req, { action: 'invoice.created', resource_type: 'invoice', resource_id: invoice.invoice_id, metadata: { total: invoice.total } });
  recordEvent('invoice_created', { userId: req.auth.userId, businessId: req.tenant.businessId, properties: { total: invoice.total } });
  afterBill(req.tenant.businessId, invoice.invoice_id);   // the customer's copy and loyalty nudge, when messaging is on
};
