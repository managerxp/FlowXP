/*
 * Gate devices. Two sets of handlers:
 *   the device's own (signed requests, no staff session): access, acknowledgement, heartbeat, offline events;
 *   the manager's: register a device, rotate its secret, switch it off, and see what did not add up.
 * What a device may ask and how it proves itself is in modules/gym/devices.js and GYM_DEVICES.md.
 */
import pool from '../config/database.js';
import * as devices from '../modules/gym/devices.js';
import { GymError, audit, inTx, ok, wrapAll } from '../modules/gym/common.js';
import { branchFilter } from '../utils/scope.js';

/* ── the device ─────────────────────────────────────────────────────────────────────────────── */

/** Signed-request check. Every failure is the same 401, so a caller learns nothing about which part was wrong. */
export const deviceAuth = async (req, res, next) => {
  try {
    const device = await devices.authenticate({ method: req.method, path: req.originalUrl.split('?')[0], headers: req.headers, rawBody: req.rawBody });
    if (!device) return res.status(401).json({ success: false, message: 'Not authorised' });
    req.device = device;
    next();
  } catch (error) { next(error); }
};

const fromDevice = (fn) => async (req, res) => {
  try {
    const out = await fn(req.device, req.body || {});
    if (out.unavailable) return res.status(503).json({ success: false, message: 'Please try again in a moment', code: 'SERVICE_UNAVAILABLE', data: out });
    res.json({ success: true, data: out });
  } catch (error) {
    if (error?.name === 'GymError') return res.status(error.status).json({ success: false, message: error.message });
    console.error('[gym] device request failed:', error.message);
    res.status(503).json({ success: false, message: 'Please try again in a moment', code: 'SERVICE_UNAVAILABLE' });
  }
};

export const access = fromDevice((d, b) => devices.processAccess(d, b));
export const ack = fromDevice((d, b) => devices.processAck(d, b));
export const heartbeat = fromDevice((d, b) => devices.heartbeat(d, b));
export const batch = fromDevice((d, b) => devices.processBatch(d, b));

/* ── the manager ────────────────────────────────────────────────────────────────────────────── */

const id = (req) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new GymError(404, 'Not found'); return n; };

const list = async (req, res) => ok(res, { devices: await devices.listDevices(pool, req.tenant.businessId, req.tenant.scopeBranchId), adapters: Object.entries(devices.ADAPTERS).map(([key, a]) => ({ key, label: a.label })), kinds: devices.KINDS });

const register = async (req, res) => {
  const b = req.body || {};
  const branchId = Number(b.branch_id ?? req.tenant.branchId);
  const out = await inTx((db) => devices.registerDevice(db, { businessId: req.tenant.businessId, branchId, name: b.name, kind: String(b.kind || '').toUpperCase(), adapter: String(b.adapter || 'GENERIC_HTTP').toUpperCase(), offlinePolicy: String(b.offline_policy || 'NONE').toUpperCase(), userId: req.auth.userId }));
  audit(req, 'gym.device_registered', 'gym_device', out.device.device_id, null, { name: out.device.name, kind: out.device.kind });
  res.set('Cache-Control', 'no-store');
  ok(res, out, 201);
};

const owns = async (req) => {
  const params = [req.tenant.businessId, id(req)];
  const d = (await pool.query(`SELECT device_id FROM gym_devices WHERE business_id = $1 AND device_id = $2${branchFilter(req.tenant, 'branch_id', params)}`, params)).rows[0];
  if (!d) throw new GymError(404, 'Not found');
  return d.device_id;
};

const update = async (req, res) => {
  const deviceId = await owns(req);
  const out = await devices.updateDevice(pool, { businessId: req.tenant.businessId, deviceId, name: req.body?.name, offlinePolicy: req.body?.offline_policy && String(req.body.offline_policy).toUpperCase() });
  audit(req, 'gym.device_updated', 'gym_device', deviceId);
  ok(res, out);
};

const rotate = async (req, res) => {
  const deviceId = await owns(req);
  const out = await inTx((db) => devices.rotateSecret(db, { businessId: req.tenant.businessId, deviceId, immediate: req.body?.immediate === true }));
  audit(req, 'gym.device_secret_rotated', 'gym_device', deviceId, null, { immediate: req.body?.immediate === true });
  res.set('Cache-Control', 'no-store');
  ok(res, out);
};

const status = (value) => async (req, res) => {
  const deviceId = await owns(req);
  const out = await devices.setDeviceStatus(pool, { businessId: req.tenant.businessId, deviceId, status: value });
  audit(req, value === 'ACTIVE' ? 'gym.device_enabled' : 'gym.device_disabled', 'gym_device', deviceId);
  ok(res, out);
};

const problems = async (req, res) => {
  await devices.reconcile(pool, { businessId: req.tenant.businessId });
  ok(res, await devices.discrepancies(pool, req.tenant.businessId, { branchId: req.tenant.scopeBranchId, days: Math.min(90, Number(req.query.days) || 14) }));
};

export default wrapAll({ list, register, update, rotate, disable: status('DISABLED'), enable: status('ACTIVE'), problems });
