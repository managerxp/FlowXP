/*
 * Gym members, their memberships and their credentials. Permissions are decided in the router (gym.routes.js); what a person may SEE of a member
 * (their outlet's members only, the restricted health note only for trainers and managers) is decided here and in modules/gym/members.js.
 */
import pool from '../config/database.js';
import { hasPermission } from '../middleware/auth.js';
import { EXT_BY_MIME, putFile, removeFile } from '../modules/storage.js';
import { looksLikeImage } from '../middleware/upload.js';
import { recordInvoiceCreated } from '../modules/billing.js';
import { recordAudit } from '../modules/events.js';
import * as members from '../modules/gym/members.js';
import * as memberships from '../modules/gym/memberships.js';
import * as credentials from '../modules/gym/credentials.js';
import { endMemberSessions } from '../modules/gym/portal.js';
import { sendWelcome, sendSubscribed } from '../modules/gym/automation.js';
import { GymError, audit, inTx, ok, page, wrapAll } from '../modules/gym/common.js';

const id = (req, name = 'id') => { const n = Number(req.params[name]); if (!Number.isInteger(n) || n <= 0) throw new GymError(404, 'Not found'); return n; };
const health = (req) => members.canSeeHealth(hasPermission, req.tenant);
const manager = (req) => hasPermission(req.tenant, 'gym_setup');

/** The member, or 404 if they are not this viewer's to see. Every by-id route starts here, so another outlet's member cannot be reached by guessing an id. */
const visible = async (req, memberId) => {
  const params = [req.tenant.businessId, memberId];
  const row = (await pool.query(`SELECT gm.member_id, gm.status FROM gym_members gm WHERE gm.business_id = $1 AND gm.member_id = $2${members.visibleTo(req.tenant, params)}`, params)).rows[0];
  if (!row) throw new GymError(404, 'Not found');
  return row;
};

const list = async (req, res) => {
  const r = await members.listMembers(pool, req.tenant, req.query);
  page(res, r.rows, r.total, { limit: r.limit, offset: r.offset });
};

const get = async (req, res) => {
  const m = await members.getMember(pool, req.tenant, id(req), { health: health(req) });
  if (!m) throw new GymError(404, 'Not found');
  ok(res, m);
};

const create = async (req, res) => {
  const made = await inTx((db) => members.registerMember(db, req.tenant, req.auth.userId, req.body, { allowHealth: health(req) }));
  audit(req, 'gym.member_registered', 'gym_member', made.member_id, null, { code: made.member_code });
  sendWelcome(req.tenant.businessId, made.member_id);   // after the commit, and never in the way of the registration
  ok(res, await members.getMember(pool, req.tenant, made.member_id, { health: health(req) }), 201);
};

const update = async (req, res) => {
  const memberId = id(req);
  await visible(req, memberId);
  const changed = await inTx((db) => members.updateMember(db, req.tenant, memberId, req.body, { allowHealth: health(req) }));
  audit(req, 'gym.member_updated', 'gym_member', memberId, null, changed);
  ok(res, await members.getMember(pool, req.tenant, memberId, { health: health(req) }));
};

const status = async (req, res) => {
  const memberId = id(req);
  await visible(req, memberId);
  const r = await inTx((db) => members.setStatus(db, req.tenant, req.auth.userId, memberId, req.body || {}));
  audit(req, 'gym.member_status', 'gym_member', memberId, null, { ...r, reason: req.body?.reason || null });
  ok(res, await members.getMember(pool, req.tenant, memberId, { health: health(req) }));
};

const merge = async (req, res) => {
  const [from, into] = [Number(req.body?.from_member_id), Number(req.body?.into_member_id)];
  if (!Number.isInteger(from) || !Number.isInteger(into)) throw new GymError(400, 'Choose the two members to merge');
  await visible(req, from); await visible(req, into);
  const r = await inTx((db) => members.mergeMembers(db, req.tenant, req.auth.userId, from, into));
  audit(req, 'gym.members_merged', 'gym_member', into, null, r);
  ok(res, r);
};

const photo = async (req, res) => {
  const memberId = id(req);
  await visible(req, memberId);
  if (!req.file) throw new GymError(400, 'Choose an image to upload');
  if (!looksLikeImage(req.file.buffer, req.file.mimetype)) throw new GymError(400, 'That file is not a valid JPEG, PNG or WebP image');
  const old = (await pool.query(`SELECT photo_url FROM gym_members WHERE member_id = $1 AND business_id = $2`, [memberId, req.tenant.businessId])).rows[0];
  let url;
  try { url = await putFile({ key: `gym/${req.tenant.businessId}/${memberId}-${Date.now()}${EXT_BY_MIME[req.file.mimetype]}`, buffer: req.file.buffer, contentType: req.file.mimetype }); }
  catch (error) { console.error('[gym] photo upload failed:', error.message); throw new GymError(502, 'Could not save the photo. Try again in a moment.'); }
  await pool.query(`UPDATE gym_members SET photo_url = $3 WHERE member_id = $1 AND business_id = $2`, [memberId, req.tenant.businessId, url]);
  if (old?.photo_url) removeFile(old.photo_url, req.tenant.businessId);
  audit(req, 'gym.member_photo', 'gym_member', memberId);
  ok(res, { photo_url: url });
};

const duplicates = async (req, res) => ok(res, await members.findByPhone(pool, req.tenant.businessId, req.query.phone, {}));

const importCheck = async (req, res) => {
  const dryRun = req.body?.dry_run !== false;
  const r = await inTx((db) => members.importRows(db, req.tenant, req.auth.userId, req.body?.rows, { dryRun }));
  if (!dryRun && r.imported) audit(req, 'gym.members_imported', 'gym_member', null, null, { imported: r.imported });
  ok(res, r);
};

const exportCsv = async (req, res) => {
  const csv = await members.exportCsv(pool, req.tenant);
  audit(req, 'gym.members_exported', 'gym_member', null);
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="members.csv"').send(csv);
};

/* ── memberships ────────────────────────────────────────────────────────────────────────────── */

const opts = (req) => ({ allowDiscount: manager(req), allowComplimentary: manager(req) });

const sell = async (req, res) => {
  const memberId = id(req);
  await visible(req, memberId);
  const sold = await inTx((db) => memberships.sellMembership(db, req.tenant, req.auth.userId, memberId, req.body || {}, opts(req)));
  if (sold.invoice) recordInvoiceCreated(req, sold.invoice);
  audit(req, 'gym.membership_sold', 'gym_membership', sold.membership_id, null, { member_id: memberId, start: sold.start_date, end: sold.end_date, invoice_id: sold.invoice?.invoice_id ?? null });
  ok(res, sold, 201);
  sendSubscribed(req.tenant, sold.membership_id);
};

/** A membership by id, but only if its member is visible to this viewer. */
const ownMembership = async (req) => {
  const membershipId = id(req);
  const m = (await pool.query(`SELECT member_id FROM gym_memberships WHERE membership_id = $1 AND business_id = $2`, [membershipId, req.tenant.businessId])).rows[0];
  if (!m) throw new GymError(404, 'Not found');
  await visible(req, m.member_id);
  return { membershipId, memberId: m.member_id };
};

const renew = async (req, res) => {
  const { membershipId, memberId } = await ownMembership(req);
  const sold = await inTx((db) => memberships.sellMembership(db, req.tenant, req.auth.userId, memberId, { ...req.body, renewed_from: membershipId }, opts(req)));
  if (sold.invoice) recordInvoiceCreated(req, sold.invoice);
  audit(req, 'gym.membership_renewed', 'gym_membership', sold.membership_id, null, { renewed_from: membershipId, invoice_id: sold.invoice?.invoice_id ?? null });
  ok(res, sold, 201);
  sendSubscribed(req.tenant, sold.membership_id);
};

const changePlan = async (req, res) => {
  const { membershipId } = await ownMembership(req);
  const sold = await inTx((db) => memberships.changePlan(db, req.tenant, req.auth.userId, membershipId, req.body || {}, opts(req)));
  if (sold.invoice) recordInvoiceCreated(req, sold.invoice);
  audit(req, 'gym.membership_plan_changed', 'gym_membership', membershipId, null, { new_membership_id: sold.membership_id, credit: sold.credit_paise / 100 });
  ok(res, sold, 201);
  sendSubscribed(req.tenant, sold.membership_id);
};

const freeze = async (req, res) => {
  const { membershipId } = await ownMembership(req);
  const r = await inTx((db) => memberships.freeze(db, req.tenant, req.auth.userId, membershipId, req.body || {}));
  audit(req, 'gym.membership_frozen', 'gym_membership', membershipId, null, r);
  ok(res, r);
};
const unfreeze = async (req, res) => {
  const { membershipId } = await ownMembership(req);
  const r = await inTx((db) => memberships.unfreeze(db, req.tenant, req.auth.userId, membershipId));
  audit(req, 'gym.membership_unfrozen', 'gym_membership', membershipId, null, r);
  ok(res, r);
};
const extend = async (req, res) => {
  const { membershipId } = await ownMembership(req);
  const r = await inTx((db) => memberships.extend(db, req.tenant, req.auth.userId, membershipId, req.body || {}));
  audit(req, 'gym.membership_extended', 'gym_membership', membershipId, null, { ...r, days: req.body?.days });
  ok(res, r);
};
const cancel = async (req, res) => {
  const { membershipId } = await ownMembership(req);
  const r = await inTx((db) => memberships.cancel(db, req.tenant, req.auth.userId, membershipId, req.body || {}));
  audit(req, 'gym.membership_cancelled', 'gym_membership', membershipId, null, { reason: req.body?.reason || null });
  ok(res, r);
};
const transfer = async (req, res) => {
  const { membershipId } = await ownMembership(req);
  const target = Number(req.body?.to_member_id);
  if (Number.isInteger(target)) await visible(req, target);
  const r = await inTx((db) => memberships.transfer(db, req.tenant, req.auth.userId, membershipId, req.body || {}));
  audit(req, 'gym.membership_transferred', 'gym_membership', membershipId, null, { to_member_id: target, new_membership_id: r.membership_id });
  ok(res, r);
};
const history = async (req, res) => {
  const { membershipId } = await ownMembership(req);
  ok(res, await memberships.events(pool, req.tenant.businessId, membershipId));
};

/* ── credentials ────────────────────────────────────────────────────────────────────────────── */

/** Make (or replace) a printed card. The QR text comes back once and is not stored: print it now. */
const issueCard = async (req, res) => {
  const memberId = id(req);
  await visible(req, memberId);
  const made = await inTx((db) => credentials.issueCard(db, { businessId: req.tenant.businessId, memberId, userId: req.auth.userId, reason: req.body?.reason }));
  recordAudit(req, { action: made.replaced ? 'gym.card_replaced' : 'gym.card_issued', resource_type: 'gym_credential', resource_id: made.credential.credential_id, metadata: { member_id: memberId, reason: req.body?.reason || null } });
  res.set('Cache-Control', 'no-store');
  ok(res, made, 201);
};

const revokeCredential = async (req, res) => {
  const credentialId = id(req);
  const c = (await pool.query(`SELECT member_id FROM gym_credentials WHERE credential_id = $1 AND business_id = $2`, [credentialId, req.tenant.businessId])).rows[0];
  if (!c) throw new GymError(404, 'Not found');
  await visible(req, c.member_id);
  const r = await inTx((db) => credentials.revoke(db, { businessId: req.tenant.businessId, credentialId, userId: req.auth.userId, reason: req.body?.reason }));
  audit(req, 'gym.credential_revoked', 'gym_credential', credentialId, null, { member_id: c.member_id, reason: req.body?.reason || null });
  ok(res, r);
};

/** A lost phone or a stolen card: every credential stops and every signed-in browser is signed out. The member signs in again with a new code. */
const revokeAccess = async (req, res) => {
  const memberId = id(req);
  await visible(req, memberId);
  const n = await inTx(async (db) => { const c = await credentials.revokeAll(db, { businessId: req.tenant.businessId, memberId, userId: req.auth.userId, reason: req.body?.reason || 'Access revoked' }); await endMemberSessions(db, req.tenant.businessId, memberId); return c; });
  audit(req, 'gym.access_revoked', 'gym_member', memberId, null, { credentials: n, reason: req.body?.reason || null });
  ok(res, { revoked: n });
};

export default wrapAll({ revokeAccess, list, get, create, update, status, merge, photo, duplicates, importCheck, exportCsv, sell, renew, changePlan, freeze, unfreeze, extend, cancel, transfer, history, issueCard, revokeCredential });
