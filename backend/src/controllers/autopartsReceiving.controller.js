/*
 * Receiving: GRN (through the wholesale receipt), put-away tasks, cancel. Permissions and plan features are decided in the router.
 */
import pool from '../config/database.js';
import purchasing from './wholesalePurchasing.controller.js';
import { PartsError, audit, inTx, int, ok, text, wrapAll } from '../modules/autoparts/common.js';
import * as grn from '../modules/autoparts/grn.js';

const uid = (req) => req.auth?.userId ?? req.tenant?.userId ?? null;

/** Run a wholesale handler and capture what it answered instead of sending it. */
const capture = (handler, req) => new Promise((resolve, reject) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; } };
  Promise.resolve(handler(req, res)).catch(reject);
});

export default wrapAll({
  list: async (req, res) => {
    const out = await capture(purchasing.listGRNs, req);
    res.status(out.code).json(out.body);
  },
  get: async (req, res) => {
    const out = await capture(purchasing.getGRN, req);
    if (out.code !== 200) return res.status(out.code).json(out.body);
    const extra = await grn.enrich(pool, out.body.data.grn_id);
    const items = (out.body.data.items || []).map((i) => ({ ...i, ...(extra.get(i.grn_item_id) || {}) }));
    ok(res, { ...out.body.data, items });
  },
  create: async (req, res) => {
    const prepared = await inTx((db) => grn.prepare(db, req.tenant, req.body || {}));
    const out = await capture(purchasing.createGRN, { ...req, body: prepared.body });
    if (out.code !== 201) return res.status(out.code).json(out.body);
    const id = out.body.data.grn_id;
    const settled = await inTx((db) => grn.settle(db, req.tenant, uid(req), id, prepared.bins));
    audit(req, 'autoparts.grn_posted', 'grn', id, null, { tasks: settled.tasks.length });
    const extra = await grn.enrich(pool, id);
    const items = (out.body.data.items || []).map((i) => ({ ...i, ...(extra.get(i.grn_item_id) || {}) }));
    ok(res, { ...out.body.data, items, putaway_tasks: settled.tasks, warnings: settled.warnings }, 201);
  },
  cancel: async (req, res) => {
    const reason = text(req.body?.reason, 'Reason', { max: 200, required: true });
    const r = await inTx((db) => grn.cancel(db, req.tenant, uid(req), int(req.params.id, 'Receipt', { min: 1, required: true }), reason));
    audit(req, 'autoparts.grn_cancelled', 'grn', r.grn_id, null, { reason });
    ok(res, r);
  }
});

void PartsError;
