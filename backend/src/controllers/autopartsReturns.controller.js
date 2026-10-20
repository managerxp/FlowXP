/*
 * Returns log and supplier claims. (Customer returns themselves are credit notes: POST /api/invoices/:id/credit-notes with return_reason and disposition.)
 */
import pool from '../config/database.js';
import { audit, inTx, int, ok, wrapAll } from '../modules/autoparts/common.js';
import * as returns from '../modules/autoparts/returns.js';

const uid = (req) => req.auth?.userId ?? req.tenant?.userId ?? null;

export default wrapAll({
  log: async (req, res) => ok(res, await returns.returnsLog(pool, req.tenant, { from: req.query.from, to: req.query.to })),
  claims: async (req, res) => ok(res, await returns.listClaims(pool, req.tenant, { status: req.query.status || 'OPEN' })),
  claimCreate: async (req, res) => {
    const r = await inTx((db) => returns.createClaim(db, req.tenant, uid(req), req.body || {}));
    audit(req, 'autoparts.claim_opened', 'claim', r.claim_id, null, { product_id: r.product_id, qty: r.qty, reason: r.reason });
    ok(res, r, 201);
  },
  claimResolve: async (req, res) => {
    const r = await inTx((db) => returns.resolveClaim(db, req.tenant, int(req.params.id, 'Claim', { min: 1, required: true }), req.body || {}));
    audit(req, 'autoparts.claim_resolved', 'claim', r.claim_id, null, { status: r.status });
    ok(res, r);
  }
});
