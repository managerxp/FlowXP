/*
 * Gaming set-up: settings, zones, stations, rates, bundles and the games list. Permissions are decided in the router (gaming.routes.js).
 */
import pool from '../config/database.js';
import { GamingError, audit, diff, getSettings, inTx, int, num, ok, wrapAll } from '../modules/gaming/common.js';
import * as rates from '../modules/gaming/rates.js';
import * as stations from '../modules/gaming/stations.js';
import { cleanBonusRules } from '../modules/gaming/wallet.js';

const settingsShape = (s) => ({ alert_minutes: s.alert_minutes, hold_minutes: s.hold_minutes, noshow_minutes: s.noshow_minutes, gst_rate: Number(s.gst_rate), topup_bonus: s.topup_bonus || [] });

const settings = async (req, res) => ok(res, settingsShape(await getSettings(pool, req.tenant.businessId)));

const updateSettings = async (req, res) => {
  const b = req.body || {};
  const cur = await getSettings(pool, req.tenant.businessId);
  const next = {};
  if (b.alert_minutes !== undefined) next.alert_minutes = int(b.alert_minutes, 'Warn when this many minutes are left', { min: 1, max: 60, required: true });
  if (b.hold_minutes !== undefined) next.hold_minutes = int(b.hold_minutes, 'Hold a booked station for', { min: 0, max: 240, required: true });
  if (b.noshow_minutes !== undefined) next.noshow_minutes = int(b.noshow_minutes, 'No-show after', { min: 0, max: 240, required: true });
  if (b.gst_rate !== undefined) next.gst_rate = num(b.gst_rate, 'GST rate', { min: 0, max: 40, required: true });
  if (b.topup_bonus !== undefined) next.topup_bonus = JSON.stringify(cleanBonusRules(b.topup_bonus));
  const keys = Object.keys(next);
  if (keys.length) {
    await inTx(async (db) => {
      await db.query(`UPDATE gaming_settings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE business_id = $1`, [req.tenant.businessId, ...keys.map((k) => next[k])]);
      // the lines the module writes onto a tab take the rate from the product
      if (next.gst_rate !== undefined) await db.query(`UPDATE products SET tax_rate = $2 WHERE business_id = $1 AND product_id IN (SELECT time_product_id FROM gaming_settings WHERE business_id = $1 UNION SELECT tournament_product_id FROM gaming_settings WHERE business_id = $1)`, [req.tenant.businessId, next.gst_rate]);
    });
  }
  const after = await getSettings(pool, req.tenant.businessId);
  audit(req, 'gaming.settings_updated', 'gaming_settings', req.tenant.businessId, null, diff(settingsShape(cur), settingsShape(after)));
  ok(res, settingsShape(after));
};

const id = (req) => int(req.params.id, 'Id', { min: 1, required: true });

export default wrapAll({
  settings, updateSettings,

  zones: async (req, res) => ok(res, await stations.listZones(pool, req.tenant)),
  zoneCreate: async (req, res) => ok(res, await inTx((db) => stations.createZone(db, req.tenant, req.body || {})), 201),
  zoneUpdate: async (req, res) => ok(res, await inTx((db) => stations.updateZone(db, req.tenant, id(req), req.body || {}))),
  zoneDelete: async (req, res) => { await inTx((db) => stations.deleteZone(db, req.tenant, id(req))); ok(res, { deleted: true }); },

  stations: async (req, res) => ok(res, await stations.listStations(pool, req.tenant, { includeArchived: req.query.archived === 'true' })),
  stationCreate: async (req, res) => {
    const s = await inTx((db) => stations.createStation(db, req.tenant, req.body || {}));
    audit(req, 'gaming.station_created', 'gaming_station', s.station_id, null, { name: s.name, kind: s.kind });
    ok(res, s, 201);
  },
  stationUpdate: async (req, res) => {
    const s = await inTx((db) => stations.updateStation(db, req.tenant, id(req), req.body || {}));
    audit(req, 'gaming.station_updated', 'gaming_station', s.station_id, null, req.body || {});
    ok(res, s);
  },
  stationStatus: async (req, res) => {
    const s = await inTx((db) => stations.setStationStatus(db, req.tenant, id(req), req.body || {}));
    audit(req, 'gaming.station_status', 'gaming_station', s.station_id, null, { status: s.status, note: s.status_note });
    ok(res, s);
  },
  stationArchive: async (req, res) => {
    const s = await inTx((db) => stations.archiveStation(db, req.tenant, id(req)));
    audit(req, 'gaming.station_archived', 'gaming_station', s.station_id, null, { name: s.name });
    ok(res, s);
  },

  rates: async (req, res) => ok(res, await rates.listRates(pool, req.tenant.businessId)),
  rateCreate: async (req, res) => {
    const r = await inTx((db) => rates.createRate(db, req.tenant.businessId, req.body || {}));
    audit(req, 'gaming.rate_created', 'gaming_rate', r.rate_id, null, { name: r.name });
    ok(res, r, 201);
  },
  rateUpdate: async (req, res) => {
    const r = await inTx((db) => rates.updateRate(db, req.tenant.businessId, id(req), req.body || {}));
    audit(req, 'gaming.rate_updated', 'gaming_rate', r.rate_id, null, { name: r.name });
    ok(res, r);
  },
  rateDelete: async (req, res) => {
    await inTx((db) => rates.archiveRate(db, req.tenant.businessId, id(req)));
    audit(req, 'gaming.rate_archived', 'gaming_rate', req.params.id, null, null);
    ok(res, { deleted: true });
  },

  bundles: async (req, res) => ok(res, await rates.listBundles(pool, req.tenant.businessId, { kind: req.query.kind ? String(req.query.kind).toUpperCase() : null })),
  bundleCreate: async (req, res) => ok(res, await inTx((db) => rates.createBundle(db, req.tenant.businessId, req.body || {})), 201),
  bundleUpdate: async (req, res) => ok(res, await inTx((db) => rates.updateBundle(db, req.tenant.businessId, id(req), req.body || {}))),
  bundleDelete: async (req, res) => { await inTx((db) => rates.archiveBundle(db, req.tenant.businessId, id(req))); ok(res, { deleted: true }); },

  games: async (req, res) => ok(res, await stations.listGames(pool, req.tenant.businessId)),
  gameCreate: async (req, res) => ok(res, await inTx((db) => stations.createGame(db, req.tenant.businessId, req.body || {})), 201),
  gameDelete: async (req, res) => { await inTx((db) => stations.deleteGame(db, req.tenant.businessId, id(req))); ok(res, { deleted: true }); }
});

export { GamingError };
