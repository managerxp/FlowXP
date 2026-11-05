/*
 * The clothing catalogue: styles and their size/colour variants. Permissions and plan features are decided in the router (clothing.routes.js).
 */
import pool from '../config/database.js';
import { audit, inTx, int, ok, page, paging, wrapAll } from '../modules/clothing/common.js';
import * as styles from '../modules/clothing/styles.js';

const id = (req, label = 'Id') => int(req.params.id, label, { min: 1, required: true });
const uid = (req) => req.auth?.userId ?? req.tenant?.userId ?? null;
const ctx = (req) => ({ tenant: req.tenant, userId: uid(req) });

export default wrapAll({
  meta: async (req, res) => ok(res, await styles.meta(pool, req.tenant.businessId)),
  setup: async (req, res) => {
    const made = await styles.ensureCategories(pool, req.tenant.businessId);
    ok(res, { categories_made: made });
  },
  sizeSets: async (req, res) => ok(res, await styles.sizeSets(pool, req.tenant.businessId)),
  saveSizeSet: async (req, res) => ok(res, await styles.saveSizeSet(pool, req.tenant.businessId, req.body || {}), 201),

  list: async (req, res) => {
    const p = paging(req.query, { max: 200, fallback: 30 });
    const { rows, total } = await styles.listStyles(pool, req.tenant, req.query, p);
    page(res, rows, total, p);
  },
  get: async (req, res) => ok(res, await styles.getStyle(pool, req.tenant, id(req))),
  create: async (req, res) => {
    const made = await inTx((client) => styles.createStyle(client, ctx(req), req.body || {}));
    audit(req, 'clothing.style_created', 'clothing_style', made.style_id, null, { style_code: made.style_code, variants: made.variants.length });
    ok(res, { ...made, style: await styles.getStyle(pool, req.tenant, made.style_id) }, 201);
  },
  update: async (req, res) => {
    const out = await inTx((client) => styles.updateStyle(client, ctx(req), id(req), req.body || {}));
    audit(req, 'clothing.style_updated', 'clothing_style', id(req), null, { fields: Object.keys(req.body || {}) });
    ok(res, out);
  },
  addVariants: async (req, res) => {
    const made = await inTx((client) => styles.addVariants(client, ctx(req), id(req), req.body || {}));
    audit(req, 'clothing.variants_added', 'clothing_style', id(req), null, { added: made.variants.length });
    ok(res, { ...made, style: await styles.getStyle(pool, req.tenant, id(req)) }, 201);
  },
  updateVariant: async (req, res) => {
    const out = await inTx((client) => styles.updateVariant(client, ctx(req), id(req), req.body || {}));
    audit(req, 'clothing.variant_updated', 'product', id(req), null, { fields: Object.keys(req.body || {}) });
    ok(res, out);
  },
  outlets: async (req, res) => ok(res, await styles.styleOutlets(pool, req.tenant, id(req))),
  transfer: async (req, res) => {
    const out = await inTx((client) => styles.transferGrid(client, ctx(req), id(req), req.body || {}));
    audit(req, 'clothing.style_transferred', 'clothing_style', id(req), null, { from: req.body?.from_branch_id, to: req.body?.to_branch_id, ...out });
    ok(res, out, 201);
  },
  analytics: async (req, res) => ok(res, await styles.analytics(pool, req.tenant, req.query)),
  customerPreferences: async (req, res) => ok(res, await styles.customerPreferences(pool, req.tenant, id(req))),
  supplierStyles: async (req, res) => ok(res, await styles.supplierStyles(pool, req.tenant, id(req))),
  importRows: async (req, res) => {
    const out = await inTx((client) => styles.importRows(client, ctx(req), req.body?.rows, { check: req.body?.check === true }));
    if (out.ok && out.saved) audit(req, 'clothing.imported', 'clothing_style', null, null, { styles: out.styles, variants: out.variants });
    res.status(out.ok ? 200 : 400).json({ success: out.ok, data: out, ...(out.ok ? {} : { message: 'Some rows need fixing' }) });
  }
});
