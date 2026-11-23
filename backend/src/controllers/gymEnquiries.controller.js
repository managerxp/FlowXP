/* Enquiries and follow-ups. Permissions are decided in the router. */
import pool from '../config/database.js';
import * as enq from '../modules/gym/enquiries.js';
import { audit, inTx, localParts, ok, wrapAll } from '../modules/gym/common.js';

const today = async (req) => (await localParts(pool, req.tenant.businessId)).date;
const id = (req) => Number(req.params.id);

const list = async (req, res) => ok(res, await enq.list(pool, req.tenant, { today: await today(req), view: req.query.view, search: req.query.q }));
const create = async (req, res) => {
  const out = await inTx(async (db) => enq.create(db, req.tenant, req.auth.userId, req.body || {}, await today(req)));
  audit(req, 'gym.enquiry_added', 'gym_enquiry', out.enquiry_id, null, null);
  ok(res, out, 201);
};
const note = async (req, res) => ok(res, await inTx(async (db) => enq.addNote(db, req.tenant, req.auth.userId, id(req), req.body || {}, await today(req))));
const lost = async (req, res) => ok(res, await inTx((db) => enq.markLost(db, req.tenant, req.auth.userId, id(req), req.body || {})));
const join = async (req, res) => {
  const out = await inTx((db) => enq.makeMember(db, req.tenant, req.auth.userId, id(req), req.body || {}));
  audit(req, 'gym.enquiry_joined', 'gym_enquiry', id(req), null, { member_id: out.member_id });
  ok(res, out, 201);
};
const notes = async (req, res) => ok(res, await enq.notes(pool, req.tenant, id(req)));

export default wrapAll({ list, create, note, lost, join, notes });
