/* The supplement desk for staff: find products, ring up a sale, and see what is running low or out of date. Permissions are decided in the router. */
import pool from '../config/database.js';
import * as shop from '../modules/gym/shop.js';
import { BillingError } from '../modules/billing.js';
import { GymError, audit, inTx, ok, wrapAll } from '../modules/gym/common.js';

const products = async (req, res) => ok(res, await shop.products(pool, req.tenant, { q: req.query.q, limit: req.query.limit }));

const sell = async (req, res) => {
  let out;
  try { out = await inTx((db) => shop.sell(db, req.tenant, req.auth.userId, req.body || {})); }
  catch (e) { if (e instanceof BillingError) throw new GymError(e.status || 400, e.message); throw e; }
  audit(req, 'gym.shop_sale', 'invoice', out.invoice_id, null, { total: out.total, wallet_paid: out.wallet_paid, member_id: req.body?.member_id ?? null });
  ok(res, out, 201);
};

const alerts = async (req, res) => ok(res, await shop.stockAlerts(pool, req.tenant, { days: req.query.days }));

export default wrapAll({ products, sell, alerts });
