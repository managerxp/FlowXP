/*
 * Warehouse: locations (racks, bins), stock in bins, put-away and bin moves. Permissions and plan features are decided in the router.
 */
import pool from '../config/database.js';
import { audit, inTx, int, ok, wrapAll } from '../modules/autoparts/common.js';
import * as loc from '../modules/autoparts/locations.js';
import * as bins from '../modules/autoparts/bins.js';

const id = (req, label = 'Id') => int(req.params.id, label, { min: 1, required: true });
const uid = (req) => req.auth?.userId ?? req.tenant?.userId ?? null;
const keyOf = (req) => req.body?.source_key || req.headers?.['idempotency-key'] || null;

export default wrapAll({
  tree: async (req, res) => ok(res, await loc.tree(pool, req.tenant, { branchId: req.query.branch_id, includeInactive: req.query.inactive === '1' })),
  location: async (req, res) => ok(res, await loc.detail(pool, req.tenant, id(req))),
  scan: async (req, res) => {
    const l = await loc.findByScan(pool, req.tenant, req.query.code);
    ok(res, l ? await loc.detail(pool, req.tenant, l.location_id) : null);
  },
  create: async (req, res) => {
    const r = await inTx((db) => loc.createLocation(db, req.tenant, uid(req), req.body || {}));
    audit(req, 'autoparts.location_created', 'location', r.location_id, null, { code: r.code });
    ok(res, r, 201);
  },
  createMany: async (req, res) => {
    const r = await inTx((db) => loc.createMany(db, req.tenant, uid(req), req.body || {}));
    audit(req, 'autoparts.locations_created', 'location', null, null, { count: r.length, first: r[0]?.code });
    ok(res, r, 201);
  },
  update: async (req, res) => {
    const r = await inTx((db) => loc.updateLocation(db, req.tenant, id(req), req.body || {}));
    audit(req, 'autoparts.location_updated', 'location', r.location_id, null, req.body || {});
    ok(res, r);
  },
  settings: async (req, res) => ok(res, await loc.getSettings(pool, req.tenant.businessId)),
  saveSettings: async (req, res) => {
    const r = await inTx((db) => loc.saveSettings(db, req.tenant.businessId, req.body || {}));
    audit(req, 'autoparts.settings_saved', 'business', req.tenant.businessId, null, req.body || {});
    ok(res, r);
  },
  partLocations: async (req, res) => ok(res, await bins.partLocations(pool, req.tenant, id(req), { branchId: req.query.branch_id })),
  pick: async (req, res) => ok(res, await bins.pickPlan(pool, req.tenant, id(req), req.query.qty, { branchId: req.query.branch_id })),
  putAway: async (req, res) => {
    const r = await inTx((db) => bins.putAway(db, req.tenant, uid(req), { ...(req.body || {}), source_key: keyOf(req) }));
    if (!r.replayed) audit(req, 'autoparts.put_away', 'product', Number(req.body.product_id), null, { location: r.location_code, qty: r.qty });
    ok(res, r, r.replayed ? 200 : 201);
  },
  move: async (req, res) => {
    const r = await inTx((db) => bins.moveBetween(db, req.tenant, uid(req), { ...(req.body || {}), source_key: keyOf(req) }));
    if (!r.replayed) audit(req, 'autoparts.bin_move', 'product', Number(req.body.product_id), null, { from: r.from, to: r.to, qty: r.qty });
    ok(res, r, r.replayed ? 200 : 201);
  },
  primary: async (req, res) => ok(res, await inTx((db) => bins.setPrimary(db, req.tenant, id(req), req.body?.location_id))),
  unassigned: async (req, res) => ok(res, await bins.unassigned(pool, req.tenant, { branchId: req.query.branch_id })),
  tasks: async (req, res) => ok(res, await bins.openTasks(pool, req.tenant)),
  reconcile: async (req, res) => ok(res, await bins.reconcile(pool, req.tenant, { branchId: req.query.branch_id }))
});
