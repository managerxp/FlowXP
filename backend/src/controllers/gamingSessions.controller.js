/*
 * Gaming sessions and the live board. Permissions are decided in the router (gaming.routes.js). Every change runs in one transaction under the
 * station's lock (see modules/gaming/sessions.js), and repeating a request is safe.
 */
import pool from '../config/database.js';
import { audit, inTx, int, ok, page, paging, wrapAll } from '../modules/gaming/common.js';
import { listStations } from '../modules/gaming/stations.js';
import * as sessions from '../modules/gaming/sessions.js';
import { GamingError, getSettings } from '../modules/gaming/common.js';
import { hasPlanFeature } from '../modules/planFeatures.js';

const id = (req) => int(req.params.id, 'Session', { min: 1, required: true });
const now = () => new Date();
const uid = (req) => req.auth?.userId ?? req.tenant?.userId ?? null;

export default wrapAll({
  board: async (req, res) => {
    const at = now();
    const stations = await listStations(pool, req.tenant);
    const zones = new Map();
    for (const s of await sessions.board(pool, req.tenant, stations, at)) {
      const key = s.zone_id ?? 0;
      if (!zones.has(key)) zones.set(key, { zone_id: s.zone_id, name: s.zone_name ?? 'Other', stations: [] });
      zones.get(key).stations.push(s);
    }
    const settings = await getSettings(pool, req.tenant.businessId);
    ok(res, { now: at.toISOString(), alert_minutes: settings.alert_minutes, zones: [...zones.values()] });
  },

  start: async (req, res) => {
    if (String(req.body?.mode || '').toUpperCase() === 'PACK' && !hasPlanFeature(req.tenant, 'gaming_wallet')) throw new GamingError(402, 'Hour packs are not part of your plan');
    const s = await inTx((db) => sessions.startSession(db, req.tenant, uid(req), req.body || {}, { now: now() }));
    audit(req, 'gaming.session_started', 'gaming_session', s.session_id, null, { station_id: s.station_id, mode: s.mode, players: s.players });
    ok(res, s, 201);
  },
  get: async (req, res) => ok(res, await sessions.sessionView(pool, req.tenant, id(req), now())),
  events: async (req, res) => ok(res, await sessions.eventsOf(pool, req.tenant, id(req))),
  list: async (req, res) => {
    const p = paging(req.query, { max: 100, fallback: 25 });
    const { rows, total } = await sessions.listSessions(pool, req.tenant, req.query, p);
    page(res, rows, total, p);
  },

  pause: async (req, res) => ok(res, await inTx((db) => sessions.pauseSession(db, req.tenant, uid(req), id(req), { now: now() }))),
  resume: async (req, res) => ok(res, await inTx((db) => sessions.resumeSession(db, req.tenant, uid(req), id(req), { now: now() }))),
  players: async (req, res) => ok(res, await inTx((db) => sessions.setPlayers(db, req.tenant, uid(req), id(req), req.body || {}, { now: now() }))),
  units: async (req, res) => ok(res, await inTx((db) => sessions.setUnits(db, req.tenant, uid(req), id(req), req.body || {}, { now: now() }))),
  extend: async (req, res) => ok(res, await inTx((db) => sessions.extendSession(db, req.tenant, uid(req), id(req), req.body || {}, { now: now() }))),
  edit: async (req, res) => ok(res, await inTx((db) => sessions.editSession(db, req.tenant, uid(req), id(req), req.body || {}, { now: now() }))),
  transfer: async (req, res) => {
    const s = await inTx((db) => sessions.transferSession(db, req.tenant, uid(req), id(req), req.body || {}, { now: now() }));
    audit(req, 'gaming.session_transferred', 'gaming_session', s.session_id, null, { to_station_id: s.station_id });
    ok(res, s);
  },
  stop: async (req, res) => {
    const s = await inTx((db) => sessions.stopSession(db, req.tenant, uid(req), id(req), req.body || {}, { now: now() }));
    if (!s.repeated) audit(req, req.body?.void === true ? 'gaming.session_voided' : 'gaming.session_stopped', 'gaming_session', s.session_id, null, { charge: s.charge, reason: s.void_reason });
    ok(res, s);
  },
  reopen: async (req, res) => {
    const s = await inTx((db) => sessions.reopenSession(db, req.tenant, uid(req), id(req), { now: now() }));
    audit(req, 'gaming.session_reopened', 'gaming_session', s.session_id, null, null);
    ok(res, s);
  }
});
