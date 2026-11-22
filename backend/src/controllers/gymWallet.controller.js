/* A member's wallet for staff: balance and history, money in, paying a bill from it, and a refund. Permissions are decided in the router. */
import pool from '../config/database.js';
import { visibleTo } from '../modules/gym/members.js';
import * as wallet from '../modules/gym/wallet.js';
import { GymError, audit, inTx, ok, wrapAll } from '../modules/gym/common.js';

const memberId = async (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw new GymError(404, 'Not found');
  const params = [req.tenant.businessId, n];
  if (!(await pool.query(`SELECT 1 FROM gym_members gm WHERE gm.business_id = $1 AND gm.member_id = $2${visibleTo(req.tenant, params)}`, params)).rows.length) throw new GymError(404, 'Not found');
  return n;
};

const get = async (req, res) => ok(res, await wallet.ledger(pool, req.tenant, await memberId(req), { limit: req.query.limit }));

const deposit = async (req, res) => {
  const id = await memberId(req);
  const out = await inTx((db) => wallet.deposit(db, req.tenant, req.auth.userId, id, req.body || {}));
  audit(req, 'gym.wallet_deposit', 'gym_member', id, null, { amount: req.body?.amount, method: req.body?.method });
  ok(res, out, 201);
};

const payInvoice = async (req, res) => {
  const id = await memberId(req);
  const out = await inTx((db) => wallet.payInvoice(db, req.tenant, req.auth.userId, id, req.body || {}));
  audit(req, 'gym.wallet_spend', 'gym_member', id, null, { invoice_id: req.body?.invoice_id, paid_paise: out.paid_paise });
  ok(res, out, 201);
};

const refund = async (req, res) => {
  const id = await memberId(req);
  const out = await inTx((db) => wallet.refund(db, req.tenant, req.auth.userId, id, req.body || {}));
  audit(req, 'gym.wallet_refund', 'gym_member', id, null, { amount: req.body?.amount, reason: req.body?.reason });
  ok(res, out, 201);
};

export default wrapAll({ get, deposit, payInvoice, refund });
