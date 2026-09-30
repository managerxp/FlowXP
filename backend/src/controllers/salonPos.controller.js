/*
 * The salon till's API: what the screen loads (catalogue, retail product search, a client's entitlements),
 * a live quote, and the sale itself. The sale is modules/salon/pos.js; this file is the HTTP around it.
 *
 * A quote runs the real pipeline inside a transaction and rolls it back, so what the cashier sees (offers,
 * membership discount, GST, points, stock problems) is exactly what the sale will do — there is no second
 * implementation of the maths to drift.
 */
import pool from '../config/database.js';
import { recordInvoiceCreated } from '../modules/billing.js';
import { businessToday } from '../utils/dates.js';
import { toRupees } from '../utils/money.js';
import { getPoints } from '../modules/points.js';
import { pointsCard } from './points.controller.js';
import { createSalonInvoice } from '../modules/salon/pos.js';
import { activeMembership, freeServiceBalance } from '../modules/salon/entitlements.js';
import { clientContext, whyNot } from '../modules/salon/offers.js';
import { getSettings } from '../modules/salon/settings.js';
import { SalonError, audit, int, like, ok, paging, wrapAll } from '../modules/salon/common.js';

/* GET /api/salon/pos/catalog — everything the till needs to start, in one request */
const catalog = async (req, res) => {
  const businessId = req.tenant.businessId; const branchId = req.tenant.branchId;
  const settings = await getSettings(pool, businessId);
  const services = (await pool.query(
    `SELECT p.product_id, p.name, p.category_id, COALESCE(pbs.price_paise, p.selling_price_paise) AS price_paise, p.tax_rate,
            COALESCE(d.duration_min, 30) AS duration_min, COALESCE(d.gender, 'ANY') AS gender, p.description
     FROM products p LEFT JOIN salon_item_details d ON d.product_id = p.product_id
     LEFT JOIN product_branch_settings pbs ON pbs.product_id = p.product_id AND pbs.branch_id = $2
     WHERE p.business_id = $1 AND p.kind = 'SERVICE' AND p.status = 'ACTIVE' AND COALESCE(pbs.is_available, TRUE)
     ORDER BY p.name`, [businessId, branchId])).rows;
  const ids = services.map((s) => s.product_id);
  const recipeRows = ids.length ? (await pool.query(
    `SELECT r.dish_product_id, r.ingredient_product_id AS ingredient_id, i.name, i.unit, r.quantity, r.wastage_pct, r.is_variable, r.branch_id
     FROM recipe_items r JOIN products i ON i.product_id = r.ingredient_product_id
     WHERE r.business_id = $1 AND r.dish_product_id = ANY($2::int[]) AND (r.branch_id IS NULL OR r.branch_id = $3) ORDER BY r.recipe_item_id`, [businessId, ids, branchId])).rows : [];
  const own = new Set(recipeRows.filter((r) => r.branch_id != null).map((r) => r.dish_product_id));
  const consumables = new Map();
  for (const r of recipeRows) {
    if (own.has(r.dish_product_id) !== (r.branch_id != null)) continue;   // the outlet's own recipe replaces the default whole
    if (!consumables.has(r.dish_product_id)) consumables.set(r.dish_product_id, []);
    consumables.get(r.dish_product_id).push({ ingredient_id: r.ingredient_id, name: r.name, unit: r.unit, quantity: Number(r.quantity) * (1 + Number(r.wastage_pct) / 100), is_variable: r.is_variable });
  }
  const categories = (await pool.query(`SELECT category_id, name FROM categories WHERE business_id = $1 AND item_scope IN ('SERVICE','ANY') ORDER BY lower(name)`, [businessId])).rows;
  const staff = (await pool.query(
    `SELECT s.staff_id, s.name, s.staff_role, COALESCE((SELECT json_agg(x.product_id) FROM salon_staff_services x WHERE x.staff_id = s.staff_id), '[]'::json) AS service_ids
     FROM salon_staff s WHERE s.business_id = $1 AND s.branch_id = $2 AND s.status = 'ACTIVE' AND s.is_bookable ORDER BY s.name`, [businessId, branchId])).rows;
  const packages = (await pool.query(
    `SELECT p.package_id, p.name, p.price_paise, p.validity_days, p.tax_rate,
            (SELECT json_agg(json_build_object('service_id', i.service_id, 'name', s.name, 'quantity', i.quantity) ORDER BY s.name) FROM salon_package_items i JOIN products s ON s.product_id = i.service_id WHERE i.package_id = p.package_id) AS items
     FROM salon_packages p WHERE p.business_id = $1 AND p.is_active ORDER BY p.name`, [businessId])).rows;
  const plans = (await pool.query(`SELECT plan_id, name, description, price_paise, duration_days, tax_rate, benefits FROM salon_membership_plans WHERE business_id = $1 AND is_active ORDER BY sort_order, price_paise`, [businessId])).rows;
  const business = (await pool.query(`SELECT gst_enabled, round_off_enabled FROM businesses WHERE business_id = $1`, [businessId])).rows[0];
  const cfg = await getPoints(pool, businessId);

  ok(res, {
    categories,
    services: services.map((s) => ({ service_id: s.product_id, name: s.name, category_id: s.category_id, price: toRupees(s.price_paise), tax_rate: Number(s.tax_rate), duration_min: s.duration_min, gender: s.gender, consumables: consumables.get(s.product_id) || [] })),
    staff: staff.map((s) => ({ ...s })),
    packages: packages.map((p) => ({ package_id: p.package_id, name: p.name, price: toRupees(p.price_paise), validity_days: p.validity_days, tax_rate: Number(p.tax_rate), items: p.items || [] })),
    membership_plans: plans.map((p) => ({ plan_id: p.plan_id, name: p.name, description: p.description, price: toRupees(p.price_paise), duration_days: p.duration_days, tax_rate: Number(p.tax_rate), benefits: p.benefits })),
    payment_methods: [...settings.payment_methods, 'GIFT_CARD'],
    tax: { inclusive: settings.tax_inclusive, gst_enabled: business.gst_enabled, round_off: business.round_off_enabled },
    loyalty: cfg ? { enabled: true, point_value: toRupees(cfg.program.point_value_paise), min_redeem_points: cfg.program.min_redeem_points, max_redeem_pct: cfg.program.max_redeem_pct } : { enabled: false }
  });
};

/* GET /api/salon/pos/products?q=&limit= — retail products with this outlet's stock; a barcode match comes first */
const products = async (req, res) => {
  const pg = paging(req.query, { max: 50, fallback: 24 });
  const q = String(req.query.q || '').trim().slice(0, 64);
  const values = [req.tenant.businessId, req.tenant.branchId];
  let where = `p.business_id = $1 AND p.kind = 'DISH' AND p.status = 'ACTIVE' AND COALESCE(pbs.is_available, TRUE)`;
  let order = 'p.name';
  if (q) {
    values.push(q); const exact = values.length;
    values.push(like(q)); const fuzzy = values.length;
    where += ` AND (p.barcode = $${exact} OR p.sku = $${exact} OR p.name ILIKE $${fuzzy})`;
    order = `(p.barcode = $${exact} OR p.sku = $${exact}) DESC, p.name`;
  }
  values.push(pg.limit);
  const { rows } = await pool.query(
    `SELECT p.product_id, p.name, p.sku, p.barcode, p.unit, COALESCE(pbs.price_paise, p.selling_price_paise) AS price_paise, p.tax_rate, p.track_inventory,
            COALESCE(bs.quantity, 0) AS stock, d.brand
     FROM products p LEFT JOIN product_branch_settings pbs ON pbs.product_id = p.product_id AND pbs.branch_id = $2
     LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $2 LEFT JOIN salon_item_details d ON d.product_id = p.product_id
     WHERE ${where} ORDER BY ${order} LIMIT $${values.length}`, values);
  ok(res, rows.map((r) => ({ product_id: r.product_id, name: r.name, sku: r.sku, barcode: r.barcode, unit: r.unit, brand: r.brand, price: toRupees(r.price_paise), tax_rate: Number(r.tax_rate), stock: r.track_inventory ? Number(r.stock) : null })));
};

/* GET /api/salon/pos/entitlements?customer_id= — what this client can spend, for the till */
const entitlements = async (req, res) => {
  const customerId = int(req.query.customer_id, 'Client', { min: 1, required: true });
  const businessId = req.tenant.businessId;
  const today = await businessToday(businessId);
  const own = (await pool.query(`SELECT name, phone FROM customers WHERE customer_id = $1 AND business_id = $2`, [customerId, businessId])).rows[0];
  if (!own) throw new SalonError(404, 'Not found');

  const membership = await activeMembership(pool, businessId, customerId, today);
  let membershipOut = null;
  if (membership) {
    const left = await freeServiceBalance(pool, membership);
    const names = left.size ? new Map((await pool.query(`SELECT product_id, name FROM products WHERE product_id = ANY($1::int[])`, [[...left.keys()]])).rows.map((r) => [r.product_id, r.name])) : new Map();
    membershipOut = {
      membership_id: membership.membership_id, plan_name: membership.plan_name, expiry_date: membership.expiry_date,
      discount_pct: Number(membership.benefits?.discount_pct || 0), discount_applies_to: membership.benefits?.discount_applies_to || ['SERVICE'],
      points_multiplier: Number(membership.benefits?.points_multiplier || 1), priority_booking: Boolean(membership.benefits?.priority_booking),
      free_services: [...left].map(([service_id, remaining]) => ({ service_id, name: names.get(service_id), remaining }))
    };
  }
  const packages = (await pool.query(
    `SELECT cp.cp_id, cp.name, cp.expiry_date,
            (SELECT json_agg(json_build_object('service_id', i.service_id, 'name', s.name, 'remaining', i.qty_total - i.qty_used) ORDER BY s.name) FROM salon_customer_package_items i JOIN products s ON s.product_id = i.service_id WHERE i.cp_id = cp.cp_id AND i.qty_used < i.qty_total) AS items
     FROM salon_customer_packages cp WHERE cp.business_id = $1 AND cp.customer_id = $2 AND cp.status = 'ACTIVE' AND cp.expiry_date >= $3::date ORDER BY cp.expiry_date`, [businessId, customerId, today])).rows
    .filter((p) => p.items?.length);
  const cards = (await pool.query(
    `SELECT card_id, code, balance_paise, expires_on FROM salon_gift_cards WHERE business_id = $1 AND customer_id = $2 AND status = 'ACTIVE' AND balance_paise > 0 AND (expires_on IS NULL OR expires_on >= $3::date)`, [businessId, customerId, today])).rows;
  const points = await pointsCard(pool, businessId, customerId);

  // offers the client could use today, with the reason for any they cannot (the server re-checks at billing)
  const ctx = { ...(await clientContext(pool, businessId, customerId, today)), today };
  const offers = [];
  for (const o of (await pool.query(`SELECT * FROM salon_offers WHERE business_id = $1 AND is_active ORDER BY offer_id`, [businessId])).rows) {
    const why = await whyNot(pool, o, ctx, { businessId, branchId: req.tenant.branchId, today, billPaise: Number.MAX_SAFE_INTEGER });
    offers.push({ offer_id: o.offer_id, name: o.name, description: o.description, code: o.code, discount_type: o.discount_type, value: Number(o.value), applies_to: o.applies_to, auto_apply: o.auto_apply, eligible: !why, reason: why });
  }
  ok(res, {
    customer: { customer_id: customerId, ...own }, membership: membershipOut, packages, points,
    gift_cards: cards.map((c) => ({ card_id: c.card_id, code: c.code, balance: toRupees(c.balance_paise), expires_on: c.expires_on })),
    offers: offers.filter((o) => o.eligible || !o.code)
  });
};

const summarise = (out) => ({
  subtotal: out.invoice.subtotal, discount: out.invoice.discount, tax: out.invoice.tax, cgst: out.invoice.cgst, sgst: out.invoice.sgst, igst: out.invoice.igst,
  round_off: out.invoice.round_off, total: out.invoice.total, points_earned: out.invoice.points_earned, points_redeemed: out.invoice.points_redeemed,
  points_discount: out.invoice.points_discount, coupon_discount: out.invoice.coupon_discount,
  lines: out.lines, offers: out.offers, membership_discount_pct: out.membership_discount_pct, loyalty_points: out.invoice.loyalty_points ?? null
});

const run = async (req, res, dryRun) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await createSalonInvoice(client, req.tenant, req.auth.userId, req.body || {}, { dryRun });
    if (dryRun) {
      await client.query('ROLLBACK');
      return ok(res, summarise(out));
    }
    await client.query('COMMIT');
    recordInvoiceCreated(req, out.invoice);
    audit(req, 'salon.sale_completed', 'invoice', out.invoice.invoice_id, null, null, {
      total: out.invoice.total, lines: out.lines.length, offers: out.offers.map((o) => o.name),
      sold: { packages: out.issued.packages.length, memberships: out.issued.memberships.length, gift_cards: out.issued.gift_cards.length },
      gift_card_payments: out.gift_card_payments.length
    });
    if (out.issued.packages.length) audit(req, 'salon.package_sold', 'invoice', out.invoice.invoice_id, null, null, { count: out.issued.packages.length });
    if (out.issued.memberships.length) audit(req, 'salon.membership_sold', 'invoice', out.invoice.invoice_id, null, null, { count: out.issued.memberships.length });
    ok(res, { ...out, summary: summarise(out) }, 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* POST /api/salon/pos/quote — the bill as it would be, nothing saved */
const quote = (req, res) => run(req, res, true);
/* POST /api/salon/pos/invoices — take the sale (send an Idempotency-Key so a retry cannot bill twice) */
const create = (req, res) => run(req, res, false);

/* GET /api/salon/invoices/:id/lines — who did what on a bill, for receipts and the invoice screen */
const invoiceLines = async (req, res) => {
  const inv = (await pool.query(`SELECT invoice_id FROM invoices WHERE invoice_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!inv) throw new SalonError(404, 'Not found');
  const { rows } = await pool.query(
    `SELECT sl.item_id, sl.line_type, sl.staff_id, s.name AS staff_name, sl.ref_id, sl.list_price_paise, sl.appointment_id
     FROM salon_invoice_lines sl LEFT JOIN salon_staff s ON s.staff_id = sl.staff_id WHERE sl.invoice_id = $1 ORDER BY sl.item_id`, [inv.invoice_id]);
  const cards = (await pool.query(`SELECT code, initial_paise, expires_on FROM salon_gift_cards WHERE invoice_id = $1 AND business_id = $2`, [inv.invoice_id, req.tenant.businessId])).rows;
  ok(res, { lines: rows.map((r) => ({ ...r, list_price: toRupees(r.list_price_paise) })), gift_cards: cards.map((c) => ({ code: c.code, amount: toRupees(c.initial_paise), expires_on: c.expires_on })) });
};

export default wrapAll({ catalog, products, entitlements, quote, create, invoiceLines });
