/*
 * The prepaid wallet and hour packs. Permissions and the plan feature are decided in the router (gaming.routes.js).
 * Top-ups and pack sales move money, so they take an Idempotency-Key; a top-up also carries a request_id of its own so a repeat can never add twice.
 */
import pool from '../config/database.js';
import { audit, getSettings, inTx, int, ok, paging, wrapAll } from '../modules/gaming/common.js';
import * as wallet from '../modules/gaming/wallet.js';
import * as passes from '../modules/gaming/passes.js';
import { getPlayer } from '../modules/gaming/players.js';

const id = (req) => int(req.params.id, 'Player', { min: 1, required: true });
const uid = (req) => req.auth?.userId ?? req.tenant?.userId ?? null;

export default wrapAll({
  wallet: async (req, res) => {
    const customerId = id(req);
    await getPlayer(pool, req.tenant, customerId);
    const p = paging(req.query, { max: 100, fallback: 25 });
    const { rows, total, balance_paise: balance } = await wallet.ledger(pool, req.tenant, customerId, p);
    res.json({ success: true, data: rows, meta: { total, limit: p.limit, offset: p.offset, balance_paise: balance, balance: balance / 100 } });
  },
  topup: async (req, res) => {
    const customerId = id(req);
    const settings = await getSettings(pool, req.tenant.businessId);
    const out = await inTx((db) => wallet.topUp(db, req.tenant, uid(req), customerId, req.body || {}, { settings }));
    if (!out.repeated) audit(req, 'gaming.wallet_topup', 'customer', customerId, null, { topup: out.topup_paise / 100, bonus: out.bonus_paise / 100 });
    ok(res, { ...out, balance: out.balance_paise / 100, topup: (out.topup_paise ?? 0) / 100, bonus: (out.bonus_paise ?? 0) / 100 }, out.repeated ? 200 : 201);
  },
  adjust: async (req, res) => {
    const customerId = id(req);
    const out = await inTx((db) => wallet.adjust(db, req.tenant, uid(req), customerId, req.body || {}));
    audit(req, 'gaming.wallet_adjusted', 'customer', customerId, null, { amount: req.body?.amount, reason: req.body?.reason });
    ok(res, { ...out, balance: out.balance_paise / 100 });
  },
  liability: async (req, res) => ok(res, await wallet.liability(pool, req.tenant.businessId)),

  passes: async (req, res) => ok(res, await passes.listPasses(pool, req.tenant, id(req))),
  passSell: async (req, res) => {
    const out = await inTx((db) => passes.sellPass(db, req.tenant, uid(req), id(req), req.body || {}));
    audit(req, 'gaming.pack_sold', 'gaming_pass', out.pass.pass_id, null, { name: out.pass.name, invoice_id: out.invoice.invoice_id });
    ok(res, out, 201);
  },
  passCancel: async (req, res) => {
    const p = await inTx((db) => passes.cancelPass(db, req.tenant, int(req.params.id, 'Pack', { min: 1, required: true })));
    audit(req, 'gaming.pack_cancelled', 'gaming_pass', p.pass_id, null, null);
    ok(res, p);
  }
});

