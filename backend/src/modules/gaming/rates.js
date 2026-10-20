/*
 * Rates (what time costs) and bundles (fixed-time offers and prepaid packs). The price rules themselves are in pricing.js; this is storage, the
 * cleaning of what a person typed, and picking the rate that applies to a station.
 *
 * A rate applies to one station, one zone, one kind, or everything. The most specific active rate wins: station, then zone, then kind, then the
 * rate that applies to everything. A station with none cannot start a session (the message says so, and says what to do).
 */
import { GamingError, STATION_KINDS, bool, int, money, oneOf, text, withRupees } from './common.js';
import { cleanBands, cleanTiers, snapshotOf } from './pricing.js';

const shape = (r) => withRupees({
  rate_id: r.rate_id, name: r.name, kind: r.kind, zone_id: r.zone_id, station_id: r.station_id, bill_time: r.bill_time, tiers: r.tiers, bands: r.bands,
  extra_player_hour_paise: r.extra_player_hour_paise == null ? null : Number(r.extra_player_hour_paise), block_minutes: r.block_minutes, grace_minutes: r.grace_minutes,
  min_minutes: r.min_minutes, unit_label: r.unit_label, unit_price_paise: Number(r.unit_price_paise), is_active: r.is_active
});

export const listRates = async (db, businessId) =>
  (await db.query(`SELECT * FROM gaming_rates WHERE business_id = $1 AND is_active ORDER BY COALESCE(station_id, 0) DESC, COALESCE(zone_id, 0) DESC, kind NULLS LAST, name`, [businessId])).rows.map(shape);

const scopeFields = async (db, businessId, b, cur = {}) => {
  const given = ['kind', 'zone_id', 'station_id'].filter((k) => b[k] !== undefined && b[k] !== null && b[k] !== '');
  if (given.length > 1) throw new GamingError(400, 'A rate applies to one thing: a kind, a zone or one station');
  const out = {};
  if (['kind', 'zone_id', 'station_id'].some((k) => b[k] !== undefined)) {
    out.kind = null; out.zone_id = null; out.station_id = null;
    if (b.kind) out.kind = oneOf(b.kind, 'Kind', STATION_KINDS, { required: true });
    if (b.zone_id) {
      const z = (await db.query(`SELECT 1 FROM gaming_zones WHERE zone_id = $1 AND business_id = $2 AND is_active`, [Number(b.zone_id), businessId])).rowCount;
      if (!z) throw new GamingError(400, 'That zone does not exist');
      out.zone_id = Number(b.zone_id);
    }
    if (b.station_id) {
      const s = (await db.query(`SELECT 1 FROM gaming_stations WHERE station_id = $1 AND business_id = $2 AND status <> 'ARCHIVED'`, [Number(b.station_id), businessId])).rowCount;
      if (!s) throw new GamingError(400, 'That station does not exist');
      out.station_id = Number(b.station_id);
    }
  }
  return out;
};

const fields = async (db, businessId, b, { creating }) => {
  const f = await scopeFields(db, businessId, b);
  if (creating || b.name !== undefined) f.name = text(b.name, 'Name', { max: 80, required: true });
  if (b.bill_time !== undefined) f.bill_time = bool(b.bill_time);
  const billTime = f.bill_time ?? (creating ? true : undefined);
  if (b.tiers !== undefined || creating) f.tiers = JSON.stringify(cleanTiers(b.tiers, { required: billTime !== false }));
  if (b.bands !== undefined) f.bands = JSON.stringify(cleanBands(b.bands));
  if (b.extra_player_hour !== undefined) f.extra_player_hour_paise = b.extra_player_hour === '' || b.extra_player_hour === null ? null : money(b.extra_player_hour, 'The extra player price', { min: 0 });
  if (b.block_minutes !== undefined) f.block_minutes = int(b.block_minutes, 'Block', { min: 1, max: 240, required: true });
  if (b.grace_minutes !== undefined) f.grace_minutes = int(b.grace_minutes, 'Grace', { min: 0, max: 60, required: true });
  if (b.min_minutes !== undefined) f.min_minutes = int(b.min_minutes, 'Minimum minutes', { min: 0, max: 600, required: true });
  if (b.unit_label !== undefined) f.unit_label = text(b.unit_label, 'Unit name', { max: 20 });
  if (b.unit_price !== undefined) f.unit_price_paise = money(b.unit_price || 0, 'The price per frame', { min: 0 });
  return f;
};

export const createRate = async (db, businessId, b) => {
  const f = await fields(db, businessId, b, { creating: true });
  if (f.bill_time === false && !(f.unit_price_paise > 0)) throw new GamingError(400, 'A table charged only per frame needs a price per frame');
  const keys = Object.keys(f);
  const id = (await db.query(`INSERT INTO gaming_rates (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING rate_id`, [businessId, ...keys.map((k) => f[k])])).rows[0].rate_id;
  return getRate(db, businessId, id);
};

export const getRate = async (db, businessId, id) => {
  const r = (await db.query(`SELECT * FROM gaming_rates WHERE rate_id = $1 AND business_id = $2`, [id, businessId])).rows[0];
  if (!r) throw new GamingError(404, 'Not found');
  return shape(r);
};

export const updateRate = async (db, businessId, id, b) => {
  const cur = (await db.query(`SELECT * FROM gaming_rates WHERE rate_id = $1 AND business_id = $2 AND is_active FOR UPDATE`, [id, businessId])).rows[0];
  if (!cur) throw new GamingError(404, 'Not found');
  const f = await fields(db, businessId, b, { creating: false });
  const keys = Object.keys(f);
  if (keys.length) await db.query(`UPDATE gaming_rates SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE rate_id = $1`, [id, ...keys.map((k) => f[k])]);
  return getRate(db, businessId, id);
};

/** Switch a rate off. Sessions already running keep the copy they started with. */
export const archiveRate = async (db, businessId, id) => {
  const n = (await db.query(`UPDATE gaming_rates SET is_active = FALSE WHERE rate_id = $1 AND business_id = $2 AND is_active`, [id, businessId])).rowCount;
  if (!n) throw new GamingError(404, 'Not found');
};

/**
 * The rate in force for a station: its own, its zone's, its kind's, or the one for everything. Returns the stored row, or null.
 */
export const rateFor = async (db, businessId, station) =>
  (await db.query(
    `SELECT * FROM gaming_rates
     WHERE business_id = $1 AND is_active
       AND ((station_id = $2) OR (zone_id IS NOT NULL AND zone_id = $3) OR (kind = $4) OR (station_id IS NULL AND zone_id IS NULL AND kind IS NULL))
     ORDER BY (station_id IS NOT NULL) DESC, (zone_id IS NOT NULL) DESC, (kind IS NOT NULL) DESC, rate_id DESC LIMIT 1`,
    [businessId, station.station_id, station.zone_id, station.kind])).rows[0] ?? null;

/** The copy a segment stores, or a sentence saying what is missing. */
export const snapshotFor = async (db, businessId, station) => {
  const r = await rateFor(db, businessId, station);
  if (!r) throw new GamingError(409, `No rate is set for ${station.name}. Add one under Rates first`, { code: 'NO_RATE' });
  return snapshotOf(r);
};

/* ── bundles ───────────────────────────────────────────────────────────────────────────────────────────────── */

const bundleShape = (r) => withRupees({
  bundle_id: r.bundle_id, name: r.name, kind: r.kind, minutes: r.minutes, price_paise: Number(r.price_paise), players: r.players, kinds: r.kinds, valid_days: r.valid_days,
  tax_rate: r.tax_rate == null ? null : Number(r.tax_rate), is_active: r.is_active
});

export const listBundles = async (db, businessId, { kind = null } = {}) =>
  (await db.query(`SELECT * FROM gaming_bundles WHERE business_id = $1 AND is_active AND ($2::text IS NULL OR kind = $2) ORDER BY kind, minutes, price_paise`, [businessId, kind])).rows.map(bundleShape);

const bundleFields = (b, { creating }) => {
  const f = {};
  if (creating || b.name !== undefined) f.name = text(b.name, 'Name', { max: 80, required: true });
  if (creating || b.kind !== undefined) f.kind = oneOf(b.kind ?? 'SESSION', 'Kind', ['SESSION', 'PACK'], { required: true });
  if (creating || b.minutes !== undefined) f.minutes = b.hours !== undefined && b.minutes === undefined ? Math.round(Number(b.hours) * 60) : int(b.minutes, 'Minutes', { min: 1, max: 6000, required: true });
  if (creating || b.price !== undefined) f.price_paise = money(b.price, 'Price', { min: 0, required: true });
  if (b.players !== undefined) f.players = int(b.players, 'Players', { min: 1, max: 20, required: true });
  if (b.kinds !== undefined) {
    const kinds = b.kinds == null || !b.kinds.length ? null : [...new Set(b.kinds.map((k) => oneOf(k, 'Kind', STATION_KINDS, { required: true })))];
    f.kinds = kinds;
  }
  if (b.valid_days !== undefined) f.valid_days = b.valid_days === '' || b.valid_days == null ? null : int(b.valid_days, 'Valid for days', { min: 1, max: 3650 });
  if (b.tax_rate !== undefined) f.tax_rate = b.tax_rate === '' || b.tax_rate == null ? null : Number(b.tax_rate);
  return f;
};

export const createBundle = async (db, businessId, b) => {
  const f = bundleFields(b, { creating: true });
  const keys = Object.keys(f);
  const r = (await db.query(`INSERT INTO gaming_bundles (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`, [businessId, ...keys.map((k) => f[k])])).rows[0];
  return bundleShape(r);
};

export const updateBundle = async (db, businessId, id, b) => {
  const f = bundleFields(b, { creating: false });
  const keys = Object.keys(f);
  if (!keys.length) throw new GamingError(400, 'Nothing to change');
  const r = (await db.query(`UPDATE gaming_bundles SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE bundle_id = $1 AND business_id = $2 AND is_active RETURNING *`, [id, businessId, ...keys.map((k) => f[k])])).rows[0];
  if (!r) throw new GamingError(404, 'Not found');
  return bundleShape(r);
};

export const archiveBundle = async (db, businessId, id) => {
  const n = (await db.query(`UPDATE gaming_bundles SET is_active = FALSE WHERE bundle_id = $1 AND business_id = $2 AND is_active`, [id, businessId])).rowCount;
  if (!n) throw new GamingError(404, 'Not found');
};

export const getBundle = async (db, businessId, id, { kind = null } = {}) => {
  const r = (await db.query(`SELECT * FROM gaming_bundles WHERE bundle_id = $1 AND business_id = $2 AND is_active AND ($3::text IS NULL OR kind = $3)`, [id, businessId, kind])).rows[0];
  if (!r) throw new GamingError(404, 'That offer does not exist');
  return r;
};
