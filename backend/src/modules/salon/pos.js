/*
 * The salon till: turns a cart of services, products, packages, memberships and gift cards into ONE invoice.
 *
 * It does not reimplement billing. Everything a bill needs — GST, round-off, coupons, loyalty points, stock
 * locking, the invoice number, payments — is the shared engine (modules/billing.js, createInvoiceInTransaction).
 * This module prepares what that engine is given and records what it cannot know:
 *
 *   before   resolve prices, price each service from the client's package or membership when they are using one,
 *            work out the membership discount and offers (server-side, never trusting the till), check gift
 *            card payments, and pick the points-earning rule for each kind of line
 *   after    note who performed each line, spend package visits and free membership services, redeem gift cards,
 *            issue the packages / memberships / gift cards that were bought, accrue staff commission, and mark
 *            the appointment completed
 *
 * Everything happens in the caller's transaction, so any failure (a package with no visits left, a gift card
 * short of the amount) rolls the whole sale back. `dryRun` callers roll it back on purpose to show a quote.
 *
 * Cart lines ({ type, ... }):
 *   SERVICE     { service_id, staff_id, quantity?, use?: { kind: 'PACKAGE', cp_id } | { kind: 'MEMBERSHIP' },
 *                 unit_price?, discount?, consumption_actual?: [{ ingredient_id, quantity }] }
 *   PRODUCT     { product_id, quantity, staff_id?, unit_price?, discount? }
 *   PACKAGE     { package_id, staff_id? }          MEMBERSHIP { plan_id, staff_id? }
 *   GIFT_CARD   { amount, expires_on?, recipient_customer_id? }
 */
import { createInvoiceInTransaction } from '../billing.js';
import { hasPermission } from '../../middleware/auth.js';
import { hasPlanFeature } from '../planFeatures.js';
import { businessToday } from '../../utils/dates.js';
import { toRupees } from '../../utils/money.js';
import { SalonError, int, isoDate, money } from './common.js';
import { getSettings } from './settings.js';
import { accrueCommissions } from './commission.js';
import {
  activeMembership, freeServiceBalance, issueGiftCard, lockUsableCard, redeemGiftCard, sellMembership, sellPackage, usePackage
} from './entitlements.js';
import { clientContext, computeOffer, whyNot } from './offers.js';
import { earnedPoints, loadRules } from './loyalty.js';

const MAX_LINES = 60;
const MAX_OFFERS = 3;
const POINTS_TYPE = { SERVICE: 'SERVICE', PRODUCT: 'PRODUCT', PACKAGE: 'PACKAGE', MEMBERSHIP: 'MEMBERSHIP', GIFT_CARD: 'GIFT_CARD' };

const grossOf = (l) => Math.round(l.quantity * l.unitPaise);

/* The till's own list price for an item at this outlet: the outlet's override, else the catalogue price. */
const loadCatalog = async (client, tenant, productIds) => {
  const map = new Map();
  if (!productIds.length) return map;
  const { rows } = await client.query(
    `SELECT p.product_id, p.name, p.kind, p.status, p.tax_rate, p.track_inventory, COALESCE(pbs.price_paise, p.selling_price_paise) AS price_paise, pbs.is_available,
            COALESCE(d.points_earnable, TRUE) AS points_earnable, COALESCE(d.points_redeemable, TRUE) AS points_redeemable
     FROM products p LEFT JOIN salon_item_details d ON d.product_id = p.product_id
     LEFT JOIN product_branch_settings pbs ON pbs.product_id = p.product_id AND pbs.branch_id = $3
     WHERE p.business_id = $1 AND p.product_id = ANY($2::int[])`, [tenant.businessId, productIds, tenant.branchId]);
  for (const r of rows) map.set(r.product_id, { ...r, price_paise: Number(r.price_paise) });
  return map;
};

/* Packages, memberships and gift cards are separate plan features: a line that needs one the plan lacks is refused. */
const needFeature = (tenant, feature, what) => {
  if (!hasPlanFeature(tenant, feature)) {
    const e = new SalonError(402, `${what} is not available on your plan. Contact FlowXP support if you think this is wrong.`);
    e.code = 'FEATURE_NOT_IN_PLAN';
    throw e;
  }
};

/**
 * Build the cart: validate every line and price it. Returns an array of entries the rest of the pipeline reads:
 * { type, quantity, unitPaise, discountPaise, taxRate, staffId, free, use, productId, refId, list, earnable, redeemable, description, raw }
 */
const buildCart = async (client, tenant, userId, input, ctx) => {
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw new SalonError(400, 'Add at least one item');
  if (items.length > MAX_LINES) throw new SalonError(400, `A bill can have at most ${MAX_LINES} lines`);

  const serviceIds = []; const productIds = []; const packageIds = []; const planIds = []; const staffIds = [];
  for (const i of items) {
    const type = String(i.type || '').toUpperCase();
    if (type === 'SERVICE') serviceIds.push(Number(i.service_id));
    else if (type === 'PRODUCT') productIds.push(Number(i.product_id));
    else if (type === 'PACKAGE') packageIds.push(Number(i.package_id));
    else if (type === 'MEMBERSHIP') planIds.push(Number(i.plan_id));
    else if (type !== 'GIFT_CARD') throw new SalonError(400, `Unknown line type: ${i.type}`);
    if (i.staff_id != null && i.staff_id !== '') staffIds.push(Number(i.staff_id));
  }
  const catalog = await loadCatalog(client, tenant, [...serviceIds, ...productIds]);
  const packages = packageIds.length ? new Map((await client.query(
    `SELECT package_id, name, price_paise, tax_rate, validity_days FROM salon_packages WHERE business_id = $1 AND is_active AND package_id = ANY($2::int[])`, [tenant.businessId, packageIds])).rows.map((r) => [r.package_id, { ...r, price_paise: Number(r.price_paise), tax_rate: Number(r.tax_rate) }])) : new Map();
  const packageItems = packageIds.length ? (await client.query(`SELECT package_id, service_id, quantity FROM salon_package_items WHERE package_id = ANY($1::int[])`, [packageIds])).rows : [];
  const plans = planIds.length ? new Map((await client.query(
    `SELECT plan_id, name, price_paise, tax_rate, duration_days, benefits FROM salon_membership_plans WHERE business_id = $1 AND is_active AND plan_id = ANY($2::int[])`, [tenant.businessId, planIds])).rows.map((r) => [r.plan_id, { ...r, price_paise: Number(r.price_paise), tax_rate: Number(r.tax_rate) }])) : new Map();
  if (staffIds.length) {
    const found = Number((await client.query(`SELECT COUNT(*) AS n FROM salon_staff WHERE business_id = $1 AND status = 'ACTIVE' AND staff_id = ANY($2::int[])`, [tenant.businessId, [...new Set(staffIds)]])).rows[0].n);
    if (found !== new Set(staffIds).size) throw new SalonError(400, 'Choose team members from your own active team');
  }

  const membership = ctx.customerId ? await activeMembership(client, tenant.businessId, ctx.customerId, ctx.today, { lock: true }) : null;
  const freeLeft = membership ? await freeServiceBalance(client, membership) : new Map();
  const discountPct = Number(membership?.benefits?.discount_pct || 0);
  const discountOn = new Set(membership?.benefits?.discount_applies_to || ['SERVICE']);
  const mayOverridePrice = hasPermission(tenant, 'products');
  const cart = [];
  const soldPlans = new Set();

  for (const raw of items) {
    const type = String(raw.type).toUpperCase();
    const staffId = raw.staff_id != null && raw.staff_id !== '' ? Number(raw.staff_id) : null;
    const entry = { type, quantity: 1, unitPaise: 0, discountPaise: 0, taxRate: 0, staffId, free: false, use: null, productId: null, refId: null, listPaise: 0, earnable: true, redeemable: true, description: null, raw: {} };

    if (type === 'PACKAGE' || (raw.use && String(raw.use.kind).toUpperCase() === 'PACKAGE')) needFeature(tenant, 'salon_packages', 'Packages');
    if (type === 'MEMBERSHIP' || (raw.use && String(raw.use.kind).toUpperCase() === 'MEMBERSHIP')) needFeature(tenant, 'salon_memberships', 'Memberships');
    if (type === 'GIFT_CARD') needFeature(tenant, 'salon_gift_cards', 'Gift cards');

    if (type === 'SERVICE' || type === 'PRODUCT') {
      const id = Number(type === 'SERVICE' ? raw.service_id : raw.product_id);
      const p = catalog.get(id);
      if (!p || p.status !== 'ACTIVE') throw new SalonError(400, `${type === 'SERVICE' ? 'Service' : 'Product'} ${id || ''} is not available`);
      if (type === 'SERVICE' && p.kind !== 'SERVICE') throw new SalonError(400, `${p.name} is not a service`);
      if (type === 'PRODUCT' && p.kind !== 'DISH') throw new SalonError(400, `${p.name} is not a retail product`);
      if (p.is_available === false) throw new SalonError(409, `${p.name} is not offered at this outlet`);
      const quantity = Number(raw.quantity ?? 1);
      if (!Number.isFinite(quantity) || quantity <= 0 || (type === 'SERVICE' && (!Number.isInteger(quantity) || quantity > 99))) throw new SalonError(400, `${p.name}: enter a valid quantity`);
      if (type === 'SERVICE' && !staffId) throw new SalonError(400, `Choose who is doing ${p.name}`);
      Object.assign(entry, { quantity, productId: p.product_id, taxRate: Number(p.tax_rate), listPaise: p.price_paise, unitPaise: p.price_paise, earnable: p.points_earnable, redeemable: p.points_redeemable, description: p.name });
      if (raw.unit_price != null && raw.unit_price !== '') {
        if (!mayOverridePrice) throw new SalonError(403, 'You do not have access to change a price');
        entry.unitPaise = money(raw.unit_price, `${p.name} price`, { required: true });
        entry.overridden = true;
      }
      const use = raw.use && typeof raw.use === 'object' ? raw.use : null;
      if (type === 'SERVICE' && use) {
        if (quantity !== 1) throw new SalonError(400, `${p.name}: a package or membership visit is one at a time`);
        if (!ctx.customerId) throw new SalonError(400, 'Choose a client to use their package or membership');
        if (String(use.kind).toUpperCase() === 'PACKAGE') {
          entry.use = { kind: 'PACKAGE', cpId: int(use.cp_id, 'Package', { min: 1, required: true }) };
        } else if (String(use.kind).toUpperCase() === 'MEMBERSHIP') {
          if (!membership) throw new SalonError(409, 'This client has no active membership');
          const left = freeLeft.get(p.product_id) || 0;
          if (left < 1) throw new SalonError(409, `${p.name} is not included in (or has been used up on) their membership`);
          freeLeft.set(p.product_id, left - 1);
          entry.use = { kind: 'MEMBERSHIP', membershipId: membership.membership_id };
        } else throw new SalonError(400, 'A service can be taken from a package or a membership');
        entry.free = true; entry.unitPaise = 0; entry.description = `${p.name} (${entry.use.kind === 'PACKAGE' ? 'package' : 'membership'})`;
      }
      if (raw.consumption_actual != null) {
        if (type !== 'SERVICE') throw new SalonError(400, 'Consumables apply to services');
        entry.raw.consumption_actual = raw.consumption_actual;
      }
      // a manual discount on the line, in rupees
      if (raw.discount != null && raw.discount !== '' && !entry.free) entry.discountPaise = money(raw.discount, 'Discount', { min: 0 });
      // membership discount (only on lines paying a price), on what is left after any discount given by hand
      if (!entry.free && discountPct > 0 && discountOn.has(type)) {
        entry.memberDiscountPaise = Math.round(Math.max(0, grossOf(entry) - entry.discountPaise) * discountPct / 100);
        entry.discountPaise += entry.memberDiscountPaise;
      }
    } else if (type === 'PACKAGE') {
      const pkg = packages.get(Number(raw.package_id));
      if (!pkg) throw new SalonError(400, 'That package is not available');
      if (!ctx.customerId) throw new SalonError(400, 'Choose the client who is buying the package');
      const parts = packageItems.filter((x) => x.package_id === pkg.package_id);
      if (!parts.length) throw new SalonError(409, `${pkg.name} has no services in it yet`);
      Object.assign(entry, { refId: pkg.package_id, unitPaise: pkg.price_paise, listPaise: pkg.price_paise, taxRate: pkg.tax_rate, description: `Package: ${pkg.name}`, pkg, parts, redeemable: false });
    } else if (type === 'MEMBERSHIP') {
      const plan = plans.get(Number(raw.plan_id));
      if (!plan) throw new SalonError(400, 'That membership plan is not available');
      if (!ctx.customerId) throw new SalonError(400, 'Choose the client who is joining');
      if (soldPlans.has(plan.plan_id)) throw new SalonError(400, `${plan.name} is on the bill twice`);
      soldPlans.add(plan.plan_id);
      Object.assign(entry, { refId: plan.plan_id, unitPaise: plan.price_paise, listPaise: plan.price_paise, taxRate: plan.tax_rate, description: `Membership: ${plan.name}`, plan, redeemable: false });
    } else {
      const amount = money(raw.amount, 'Gift card amount', { min: 100, required: true });
      const recipient = raw.recipient_customer_id ? int(raw.recipient_customer_id, 'Recipient', { min: 1 }) : ctx.customerId;
      Object.assign(entry, { unitPaise: amount, listPaise: amount, taxRate: 0, description: `Gift card ₹${toRupees(amount).toLocaleString('en-IN')}`, expiresOn: isoDate(raw.expires_on, 'Expiry'), recipient, earnable: false, redeemable: false });
    }
    cart.push(entry);
  }
  return { cart, membership };
};

/** Offers: explicit (chosen at the till or typed as a code) must apply or the sale is refused; automatic ones apply quietly. */
const applyOffers = async (client, tenant, input, cart, ctx) => {
  const view = cart.map((c) => ({ type: c.type, productId: c.productId, grossPaise: grossOf(c), discountPaise: c.discountPaise, free: c.free }));
  const billPaise = view.reduce((s, l) => s + Math.max(0, l.grossPaise - l.discountPaise), 0);
  const wantedIds = [...new Set((Array.isArray(input.offer_ids) ? input.offer_ids : []).map(Number))];
  const code = input.offer_code ? String(input.offer_code).trim().toUpperCase() : null;
  if (wantedIds.length + (code ? 1 : 0) > MAX_OFFERS) throw new SalonError(400, `Up to ${MAX_OFFERS} offers on one bill`);
  const { rows } = await client.query(
    `SELECT * FROM salon_offers WHERE business_id = $1 AND (offer_id = ANY($2::int[]) OR ($3::text IS NOT NULL AND upper(code) = $3) OR ($4::boolean AND auto_apply AND is_active)) ORDER BY offer_id`,
    [tenant.businessId, wantedIds, code, input.skip_auto_offers !== true]);
  const explicit = new Set([...wantedIds, ...rows.filter((r) => code && r.code && r.code.toUpperCase() === code).map((r) => r.offer_id)]);
  for (const id of wantedIds) if (!rows.some((r) => r.offer_id === id)) throw new SalonError(400, 'That offer does not exist');
  if (code && !rows.some((r) => r.code && r.code.toUpperCase() === code)) throw new SalonError(400, 'That offer code is not valid');

  const applied = [];
  for (const offer of rows) {
    if (applied.length >= MAX_OFFERS) break;
    const why = await whyNot(client, offer, ctx, { businessId: tenant.businessId, branchId: tenant.branchId, today: ctx.today, billPaise });
    if (why) { if (explicit.has(offer.offer_id)) throw new SalonError(409, `${offer.name}: ${why}`); continue; }
    const { amountPaise, perLine } = computeOffer(offer, view);
    if (amountPaise <= 0) { if (explicit.has(offer.offer_id)) throw new SalonError(409, `${offer.name} does not apply to anything on this bill`); continue; }
    for (const [i, d] of perLine) { view[i].discountPaise += d; cart[i].discountPaise += d; }
    applied.push({ offer_id: offer.offer_id, name: offer.name, amountPaise });
  }
  return applied;
};

/* Gift card payments: lock the cards now so the amounts can be checked against balances before the bill is made. */
const planGiftCards = async (client, tenant, input, ctx) => {
  const out = [];
  if (!Array.isArray(input.payments)) return out;
  const seen = new Set();
  for (const p of input.payments) {
    if (String(p.method || '').toUpperCase() !== 'GIFT_CARD') continue;
    const amountPaise = p.amount === 'REST' || p.amount === 'FULL' ? null : money(p.amount, 'Gift card amount', { min: 1, required: true });
    if (amountPaise == null) throw new SalonError(400, 'Enter how much to take from the gift card');
    const card = await lockUsableCard(client, tenant.businessId, p.code, ctx.today);
    if (seen.has(card.card_id)) throw new SalonError(400, 'That gift card is on the bill twice');
    seen.add(card.card_id);
    if (amountPaise > Number(card.balance_paise)) throw new SalonError(409, `That gift card only has ₹${toRupees(card.balance_paise)} left`);
    out.push({ card, amountPaise });
  }
  return out;
};

/** Split `input.payments` into what the billing engine is given; gift card rows carry the card's code as the reference. */
const enginePayments = (input, giftCards, settings) => {
  if (!Array.isArray(input.payments)) return undefined;
  let gift = 0;
  return input.payments.map((p) => {
    const method = String(p.method || 'CASH').toUpperCase();
    if (method === 'GIFT_CARD') { const g = giftCards[gift++]; return { method, amount: g.amountPaise / 100, reference_number: g.card.code }; }
    if (!settings.payment_methods.includes(method) && !['CREDIT', 'OTHER'].includes(method)) throw new SalonError(400, `${method.replace('_', ' ')} is not switched on for this salon`);
    return { method, amount: p.amount, reference_number: p.reference_number || null };
  });
};

/**
 * Create the invoice for a cart. See the header for the flow. Returns { invoice, lines, offers, issued, ... }.
 * Caller owns the transaction (BEGIN / COMMIT / ROLLBACK) and runs recordInvoiceCreated after commit.
 */
export const createSalonInvoice = async (client, tenant, userId, input, { dryRun = false } = {}) => {
  const settings = await getSettings(client, tenant.businessId);
  const today = await businessToday(tenant.businessId, client);
  let customerId = null;
  if (input.customer_id != null && input.customer_id !== '') {
    customerId = int(input.customer_id, 'Client', { min: 1, required: true });
    const c = (await client.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [customerId, tenant.businessId])).rows[0];
    if (!c) throw new SalonError(400, 'Client not found');
  }
  const ctx = { ...(await clientContext(client, tenant.businessId, customerId, today)), today };

  const { cart, membership } = await buildCart(client, tenant, userId, input, ctx);
  const offers = await applyOffers(client, tenant, input, cart, ctx);
  const giftCards = await planGiftCards(client, tenant, input, ctx);
  if (giftCards.length) needFeature(tenant, 'salon_gift_cards', 'Gift cards');

  // Points: a stricter check than the engine's, because only services and products can be paid for with points.
  if (input.redeem_points) {
    const eligible = cart.filter((c) => c.redeemable && !c.free).reduce((s, c) => s + Math.max(0, grossOf(c) - c.discountPaise), 0);
    if (eligible <= 0) throw new SalonError(400, 'Points cannot be used on the items in this bill');
    const program = (await client.query(`SELECT point_value_paise, max_redeem_pct FROM points_programs WHERE business_id = $1 AND is_enabled`, [tenant.businessId])).rows[0];
    if (program && Number(input.redeem_points) * Number(program.point_value_paise) > Math.floor((eligible * program.max_redeem_pct) / 100)) {
      throw new SalonError(400, `Points can pay for at most ${program.max_redeem_pct}% of the services and products on this bill (₹${toRupees(Math.floor((eligible * program.max_redeem_pct) / 100))})`);
    }
  }

  const rules = await loadRules(client, tenant.businessId);
  const memberMultiplier = Number(membership?.benefits?.points_multiplier || 1);
  const coreItems = cart.map((c) => {
    const base = { quantity: c.quantity, discount: c.discountPaise / 100 };
    if (c.productId) return { ...base, product_id: c.productId, unit_price: c.unitPaise / 100, ...c.raw };
    return { ...base, description: c.description, unit_price: c.unitPaise / 100, tax_rate: c.taxRate };
  });

  const invoice = await createInvoiceInTransaction(client, tenant, userId, {
    customerId, items: coreItems, discount: input.discount, notes: input.notes || null, couponCode: input.coupon_code || null,
    redeemPoints: input.redeem_points || null, payments: enginePayments(input, giftCards, settings),
    taxInclusive: settings.tax_inclusive,
    earnPoints: ({ lines, finalTotalPaise, state, cfg }) => earnedPoints({
      lines: lines.map((l, i) => ({ line_total_paise: l.line_total_paise, type: POINTS_TYPE[cart[i].type], earnable: cart[i].earnable })),
      finalTotalPaise, state, cfg, rules, memberMultiplier
    })
  });

  const rows = (await client.query(
    `SELECT item_id, description, quantity, unit_price_paise, discount_paise, tax_amount_paise, line_total_paise FROM invoice_items WHERE invoice_id = $1 ORDER BY item_id`, [invoice.invoice_id])).rows;
  if (rows.length !== cart.length) throw new Error('Invoice lines do not match the cart');

  const commissionLines = [];
  const issued = { packages: [], memberships: [], gift_cards: [] };
  for (const [i, c] of cart.entries()) {
    const row = rows[i];
    const lineType = c.use ? (c.use.kind === 'PACKAGE' ? 'PACKAGE_USE' : 'MEMBERSHIP_USE') : c.type;
    await client.query(
      `INSERT INTO salon_invoice_lines (item_id, invoice_id, business_id, branch_id, line_type, staff_id, ref_id, list_price_paise, appointment_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.item_id, invoice.invoice_id, tenant.businessId, tenant.branchId, lineType, c.staffId, c.refId ?? c.use?.cpId ?? c.use?.membershipId ?? null, c.listPaise * (c.type === 'SERVICE' || c.type === 'PRODUCT' ? c.quantity : 1), input.appointment_id || null]);

    if (c.use?.kind === 'PACKAGE') await usePackage(client, { businessId: tenant.businessId, customerId, cpId: c.use.cpId, serviceId: c.productId, invoiceId: invoice.invoice_id, today });
    if (c.use?.kind === 'MEMBERSHIP') await client.query(`INSERT INTO salon_membership_usage (membership_id, business_id, invoice_id, kind, service_id, quantity) VALUES ($1,$2,$3,'FREE_SERVICE',$4,1)`, [c.use.membershipId, tenant.businessId, invoice.invoice_id, c.productId]);

    // what was sold remembers the line that sold it, so a cancellation or credit note can take back exactly that one
    const tie = (id) => client.query(`UPDATE salon_invoice_lines SET ref_id = $2 WHERE item_id = $1`, [row.item_id, id]);
    if (c.type === 'PACKAGE') {
      const made = await sellPackage(client, { businessId: tenant.businessId, branchId: tenant.branchId, customerId, pkg: c.pkg, items: c.parts, invoiceId: invoice.invoice_id, today, userId });
      issued.packages.push(made); await tie(made.cp_id);
    }
    if (c.type === 'MEMBERSHIP') {
      const made = await sellMembership(client, { businessId: tenant.businessId, branchId: tenant.branchId, customerId, plan: c.plan, invoiceId: invoice.invoice_id, today, userId });
      issued.memberships.push(made); await tie(made.membership_id);
    }
    if (c.type === 'GIFT_CARD') {
      if (!dryRun && Number(invoice.balance_due) > 0) throw new SalonError(400, 'Gift cards must be paid in full before they are issued');
      const card = await issueGiftCard(client, { businessId: tenant.businessId, branchId: tenant.branchId, amountPaise: c.unitPaise, customerId: c.recipient ?? null, expiresOn: c.expiresOn, invoiceId: invoice.invoice_id, userId });
      issued.gift_cards.push({ ...card, amount: toRupees(c.unitPaise) }); await tie(card.card_id);
    }

    // commission: what the person did or sold, on the line's own value
    if (c.staffId) {
      const free = Boolean(c.use);
      if (!free || settings.commission_on_package_use) {
        const net = Number(row.line_total_paise) - Number(row.tax_amount_paise);
        const basePaise = free ? c.listPaise : settings.commission_base === 'GROSS' ? Math.round(Number(row.quantity) * Number(row.unit_price_paise)) : net;
        commissionLines.push({ item_id: row.item_id, line_type: lineType, staff_id: c.staffId, quantity: Number(row.quantity), base_paise: Math.max(0, basePaise), product_id: c.productId });
      }
    }
  }

  for (const g of giftCards) await redeemGiftCard(client, { card: g.card, amountPaise: g.amountPaise, invoiceId: invoice.invoice_id, userId });
  for (const o of offers) await client.query(`INSERT INTO salon_offer_redemptions (offer_id, business_id, invoice_id, customer_id, amount_paise) VALUES ($1,$2,$3,$4,$5)`, [o.offer_id, tenant.businessId, invoice.invoice_id, customerId, o.amountPaise]);
  if (membership) {
    const memberDiscount = cart.reduce((s, c) => s + (c.memberDiscountPaise || 0), 0);
    if (memberDiscount > 0) await client.query(`INSERT INTO salon_membership_usage (membership_id, business_id, invoice_id, kind, discount_paise) VALUES ($1,$2,$3,'DISCOUNT',$4)`, [membership.membership_id, tenant.businessId, invoice.invoice_id, memberDiscount]);
  }

  const commissions = await accrueCommissions(client, { businessId: tenant.businessId, branchId: tenant.branchId, invoiceId: invoice.invoice_id, earnedOn: invoice.invoice_date ? String(invoice.invoice_date).slice(0, 10) : today, lines: commissionLines });

  if (input.appointment_id) {
    const a = (await client.query(
      `UPDATE salon_appointments SET status = 'COMPLETED', invoice_id = $3, updated_at = CURRENT_TIMESTAMP
       WHERE appointment_id = $1 AND business_id = $2 AND branch_id = $4 AND status IN ('BOOKED','CONFIRMED','CHECKED_IN','IN_SERVICE') RETURNING appointment_id`,
      [int(input.appointment_id, 'Appointment', { min: 1, required: true }), tenant.businessId, invoice.invoice_id, tenant.branchId])).rows[0];
    if (!a) throw new SalonError(409, 'That appointment is not open at this outlet');
  }

  return {
    invoice, offers: offers.map((o) => ({ offer_id: o.offer_id, name: o.name, amount: toRupees(o.amountPaise) })), issued, commissions: commissions.length,
    membership_discount_pct: Number(membership?.benefits?.discount_pct || 0) || null,
    lines: rows.map((r, i) => ({
      item_id: r.item_id, type: cart[i].type, use: cart[i].use?.kind ?? null, description: r.description, staff_id: cart[i].staffId, quantity: Number(r.quantity),
      unit_price: toRupees(r.unit_price_paise), discount: toRupees(r.discount_paise), tax: toRupees(r.tax_amount_paise), total: toRupees(r.line_total_paise)
    })),
    gift_card_payments: giftCards.map((g) => ({ code: g.card.code, amount: toRupees(g.amountPaise), balance_after: toRupees(g.card.balance_paise) }))
  };
};

