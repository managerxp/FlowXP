/*
 * Selling parts: holds (reservations), trade price lists, customer classes and credit. Permissions and plan features are decided in the router.
 */
import pool from '../config/database.js';
import { audit, inTx, int, ok, wrapAll } from '../modules/autoparts/common.js';
import * as sales from '../modules/autoparts/sales.js';

const id = (req, label = 'Id') => int(req.params.id, label, { min: 1, required: true });
const uid = (req) => req.auth?.userId ?? req.tenant?.userId ?? null;

export default wrapAll({
  reservations: async (req, res) => {
    await inTx((db) => sales.expireOld(db, req.tenant));
    ok(res, await sales.listReservations(pool, req.tenant, { status: req.query.status || 'OPEN', customerId: req.query.customer_id }));
  },
  reserve: async (req, res) => {
    const r = await inTx((db) => sales.reserve(db, req.tenant, uid(req), req.body || {}));
    audit(req, 'autoparts.reserved', 'product', r.product_id, null, { qty: r.qty, customer_id: r.customer_id });
    ok(res, r, 201);
  },
  release: async (req, res) => {
    const r = await inTx((db) => sales.release(db, req.tenant, id(req)));
    audit(req, 'autoparts.reservation_released', 'reservation', r.reservation_id, null, null);
    ok(res, r);
  },
  priceLists: async (req, res) => ok(res, await sales.listPriceLists(pool, req.tenant.businessId)),
  priceListSave: async (req, res) => {
    const r = await inTx((db) => sales.savePriceList(db, req.tenant.businessId, req.params.id ? id(req) : null, req.body || {}));
    audit(req, 'autoparts.price_list_saved', 'price_list', r.price_list_id, null, { name: r.name, discount_pct: r.discount_pct });
    ok(res, r, req.params.id ? 200 : 201);
  },
  priceListItem: async (req, res) => {
    const r = await inTx((db) => sales.setListPrice(db, req.tenant.businessId, id(req), int(req.params.pid, 'Part', { min: 1, required: true }), req.body?.price));
    audit(req, 'autoparts.trade_price_set', 'price_list', id(req), null, { product_id: Number(req.params.pid), price: req.body?.price ?? null });
    ok(res, r);
  },
  profile: async (req, res) => ok(res, await sales.getProfile(pool, req.tenant.businessId, id(req))),
  profileSave: async (req, res) => {
    const r = await inTx((db) => sales.saveProfile(db, req.tenant.businessId, id(req), req.body || {}));
    audit(req, 'autoparts.customer_terms_saved', 'customer', id(req), null, { class: r.customer_class, limit: r.credit_limit_paise, policy: r.credit_policy });
    ok(res, r);
  },
  creditCheck: async (req, res) => {
    const amount = Math.round(Number(req.query.amount || 0) * 100);
    ok(res, await sales.checkCredit(pool, req.tenant.businessId, id(req), Number.isFinite(amount) && amount > 0 ? amount : 0));
  }
});
