/*
 * The parts catalogue and vehicle fitment. Permissions and plan features are decided in the router (autoparts.routes.js).
 */
import { loadDefaults } from '../modules/autoparts/indiaVehicles.js';
import pool from '../config/database.js';
import * as productsApi from './products.controller.js';
import { PartsError, audit, inTx, int, ok, page, paging, wrapAll } from '../modules/autoparts/common.js';
import * as parts from '../modules/autoparts/parts.js';
import * as vehicles from '../modules/autoparts/vehicles.js';

const id = (req, label = 'Id') => int(req.params.id, label, { min: 1, required: true });
const uid = (req) => req.auth?.userId ?? req.tenant?.userId ?? null;

/** Run the existing product-create handler and hand back what it answered, so a part is made by exactly the code every shop uses. */
const makeProduct = (req) => new Promise((resolve, reject) => {
  const res = {
    code: 200, status(c) { this.code = c; return this; },
    json(b) { if (this.code >= 400) reject(new PartsError(this.code, b.message || 'Could not save the part', { code: b.code, data: b.data })); else resolve(b.data); return this; }
  };
  productsApi.create({ ...req, body: { ...(req.body || {}), kind: 'DISH', _via: 'autoparts' } }, res).catch(reject);
});

export default wrapAll({
  list: async (req, res) => {
    const p = paging(req.query, { max: 200, fallback: 30 });
    const { rows, total } = await parts.listParts(pool, req.tenant, req.query, p);
    page(res, rows, total, p);
  },
  lookup: async (req, res) => ok(res, await parts.lookup(pool, req.tenant, req.query.q, { limit: Number(req.query.limit) || 12 })),
  get: async (req, res) => ok(res, { ...(await parts.getPart(pool, req.tenant, id(req))), fitment: await vehicles.fitmentOf(pool, req.tenant.businessId, id(req)) }),
  create: async (req, res) => {
    const b = req.body || {};
    // the profile is checked first, so a bad one never leaves a half-made part behind
    await parts.cleanProfile(pool, req.tenant.businessId, b, { mrpPaise: b.mrp === undefined || b.mrp === '' || b.mrp === null ? null : Math.round(Number(b.mrp) * 100) });
    const product = await makeProduct(req);
    const part = await inTx((db) => parts.saveProfile(db, req.tenant.businessId, product.product_id, uid(req), b));
    audit(req, 'autoparts.part_created', 'product', product.product_id, null, { name: product.name, sku: product.sku });
    ok(res, { ...part, fitment: [] }, 201);
  },
  saveProfile: async (req, res) => {
    const part = await inTx((db) => parts.saveProfile(db, req.tenant.businessId, id(req), uid(req), req.body || {}));
    audit(req, 'autoparts.part_profile_saved', 'product', id(req), null, req.body || {});
    ok(res, part);
  },
  numberAdd: async (req, res) => {
    const n = await inTx((db) => parts.addNumber(db, req.tenant.businessId, id(req), uid(req), req.body || {}));
    audit(req, 'autoparts.part_number_added', 'product', id(req), null, { number: n.number, kind: n.kind });
    ok(res, n, 201);
  },
  numberRemove: async (req, res) => {
    await inTx((db) => parts.removeNumber(db, req.tenant.businessId, id(req), int(req.params.pn, 'Number', { min: 1, required: true })));
    ok(res, { removed: true });
  },
  duplicates: async (req, res) => ok(res, await parts.duplicates(pool, req.tenant.businessId)),

  vehicles: async (req, res) => ok(res, await vehicles.tree(pool, req.tenant.businessId, { includeInactive: req.query.all === 'true' })),
  loadDefaultVehicles: async (req, res) => ok(res, await inTx((db) => loadDefaults(db, req.tenant.businessId, req.body?.types)), 201),
  makeCreate: async (req, res) => ok(res, await inTx((db) => vehicles.createMake(db, req.tenant.businessId, req.body || {})), 201),
  makeUpdate: async (req, res) => ok(res, await inTx((db) => vehicles.updateMake(db, req.tenant.businessId, id(req), req.body || {}))),
  modelCreate: async (req, res) => ok(res, await inTx((db) => vehicles.createModel(db, req.tenant.businessId, req.body || {})), 201),
  modelUpdate: async (req, res) => ok(res, await inTx((db) => vehicles.updateModel(db, req.tenant.businessId, id(req), req.body || {}))),
  variantCreate: async (req, res) => ok(res, await inTx((db) => vehicles.createVariant(db, req.tenant.businessId, req.body || {})), 201),
  variantUpdate: async (req, res) => ok(res, await inTx((db) => vehicles.updateVariant(db, req.tenant.businessId, id(req), req.body || {}))),
  vehiclesImport: async (req, res) => {
    const commit = req.body?.commit === true;
    const out = await inTx((db) => vehicles.importVehicles(db, req.tenant.businessId, req.body?.rows, { commit }));
    if (commit && out.ok) audit(req, 'autoparts.vehicles_imported', 'vehicle_catalogue', null, null, { variants: out.variants, models: out.models, makes: out.makes });
    ok(res, out);
  },

  fitAdd: async (req, res) => {
    const f = await inTx((db) => vehicles.addFit(db, req.tenant.businessId, id(req), uid(req), req.body || {}));
    audit(req, 'autoparts.fitment_added', 'product', id(req), null, { model_id: f.model_id, status: f.status });
    ok(res, f, 201);
  },
  fitSet: async (req, res) => {
    const f = await inTx((db) => vehicles.setFit(db, req.tenant.businessId, id(req), uid(req), req.body || {}));
    audit(req, 'autoparts.fitment_changed', 'part_fitment', f.fit_id, null, { status: f.status });
    ok(res, f);
  },
  fitRemove: async (req, res) => {
    await inTx((db) => vehicles.removeFit(db, req.tenant.businessId, id(req)));
    audit(req, 'autoparts.fitment_removed', 'part_fitment', req.params.id, null, null);
    ok(res, { removed: true });
  },
  fitCopy: async (req, res) => ok(res, await inTx((db) => vehicles.copyFit(db, req.tenant.businessId, id(req), req.body?.to, uid(req)))),
  fitCheck: async (req, res) => ok(res, await vehicles.fitFor(pool, req.tenant.businessId, id(req), req.query)),
  byVehicle: async (req, res) => {
    const p = paging(req.query, { max: 200, fallback: 50 });
    const { rows, total, excluded_not_fit: excluded } = await vehicles.partsForVehicle(pool, req.tenant, req.query, p);
    res.json({ success: true, data: rows, meta: { total, limit: p.limit, offset: p.offset, excluded_not_fit: excluded } });
  },
  alternates: async (req, res) => ok(res, await vehicles.alternates(pool, req.tenant, id(req), req.query))
});
