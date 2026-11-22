/* Dues control for staff: who owes, a member's credit limit and payment promise. Permissions are decided in the router. */
import pool from '../config/database.js';
import { visibleTo } from '../modules/gym/members.js';
import * as dues from '../modules/gym/dues.js';
import { GymError, audit, inTx, localParts, ok, wrapAll } from '../modules/gym/common.js';

const memberId = async (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw new GymError(404, 'Not found');
  const params = [req.tenant.businessId, n];
  if (!(await pool.query(`SELECT 1 FROM gym_members gm WHERE gm.business_id = $1 AND gm.member_id = $2${visibleTo(req.tenant, params)}`, params)).rows.length) throw new GymError(404, 'Not found');
  return n;
};

const list = async (req, res) => {
  const { date: today } = await localParts(pool, req.tenant.businessId);
  ok(res, await dues.duesList(pool, req.tenant, { today, overdueDays: req.query.overdue_days, search: req.query.q }));
};

const setLimit = async (req, res) => {
  const id = await memberId(req);
  const out = await inTx((db) => dues.setCreditLimit(db, req.tenant, id, req.body || {}));
  audit(req, 'gym.credit_limit_set', 'gym_member', id, null, { credit_limit_paise: out.credit_limit_paise });
  ok(res, out);
};

const setPromise = async (req, res) => {
  const id = await memberId(req);
  const { date: today } = await localParts(pool, req.tenant.businessId);
  const out = await inTx((db) => dues.setPromise(db, req.tenant, id, req.body || {}, today));
  audit(req, 'gym.payment_promise_set', 'gym_member', id, null, out);
  ok(res, out);
};

export default wrapAll({ list, setLimit, setPromise });
