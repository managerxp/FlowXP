/*
 * Timed sessions: start, pause, resume, players, frames, extend, transfer, stop, undo, and the live board.
 *
 * A session sits at a station, and the station's table holds its TAB (an `orders` row). Food and drink ordered for the station land on that tab
 * as they do for any table. When the session stops, its time (and frames) are written onto the same tab as lines of a SERVICE product, so the
 * tab bills once: time, food and drink on one GST invoice, through the ordinary bill path.
 *
 * Time is never a counter that ticks. A session is a list of segments with start and end instants; the elapsed time and the charge are worked out from
 * them whenever asked (pricing.js), so a restart, a reload or a second screen all agree. Every change to a station happens under one advisory lock
 * for that station, and a station can have only one live session (a unique index), so two staff cannot both start it, and a double tap cannot
 * stop it twice.
 *
 * Repeating a request is safe: pausing a paused session, stopping a stopped one, or starting at a station that is already running the same
 * session return the current state rather than an error or a second effect.
 */
import { getOrCreateOpenOrderForTable } from '../../controllers/orders.controller.js';
import { GamingError, ensureProduct, getSettings, int, oneOf, text, timezoneOf, withRupees } from './common.js';
import { bandAt, durationLabel, elapsedSeconds, hourRateAt, localAt, priceSession, remainingSeconds } from './pricing.js';
import { getBundle, snapshotFor } from './rates.js';
import { getStation } from './stations.js';
import { checkStart, giveBack, takeMinutes } from './passes.js';

export const LIVE = ['RUNNING', 'PAUSED'];
export const MODES = ['OPEN', 'FIXED', 'PACK'];

const lockStation = (db, stationId) => db.query(`SELECT pg_advisory_xact_lock(92, $1)`, [stationId]);

const logEvent = (db, session, type, data, userId, at) =>
  db.query(`INSERT INTO gaming_session_events (session_id, business_id, type, data, user_id, at) VALUES ($1,$2,$3,$4,$5,$6)`, [session.session_id, session.business_id, type, data ? JSON.stringify(data) : null, userId ?? null, at]);

export const segmentsOf = async (db, sessionId) =>
  (await db.query(`SELECT segment_id, station_id, players, rate, started_at, ended_at FROM gaming_session_segments WHERE session_id = $1 ORDER BY started_at, segment_id`, [sessionId])).rows;

const inScope = (tenant, row) => tenant.scopeBranchId == null || row.branch_id === tenant.scopeBranchId;

export const getSession = async (db, tenant, id, { lock = false } = {}) => {
  const row = (await db.query(`SELECT * FROM gaming_sessions WHERE session_id = $1 AND business_id = $2${lock ? ' FOR UPDATE' : ''}`, [id, tenant.businessId])).rows[0];
  if (!row || !inScope(tenant, row)) throw new GamingError(404, 'Not found');
  return row;
};

/* ── what a person sees: the numbers for one session at one instant ─────────────────────────────────────────── */

const viewOf = (session, segments, now, ctx) => {
  const t = now.getTime();
  const priced = priceSession(segments, session, t, { tz: ctx.tz, overrunGraceMinutes: ctx.overrunGrace });
  const remaining = remainingSeconds(segments, session, t);
  const last = segments[segments.length - 1];
  const local = localAt(t, ctx.tz);
  const live = LIVE.includes(session.status);
  const alert = !live || remaining == null ? null : remaining < 0 ? 'OVER' : remaining <= ctx.alertMinutes * 60 ? 'ENDING' : null;
  return withRupees({
    session_id: session.session_id, station_id: session.station_id, order_id: session.order_id, mode: session.mode, status: session.status, players: session.players,
    started_at: session.started_at, ended_at: session.ended_at, planned_minutes: session.planned_minutes, elapsed_seconds: priced.elapsed_seconds,
    remaining_seconds: remaining, alert, billed_minutes: priced.billed_minutes, units: priced.units,
    time_paise: session.status === 'ENDED' && session.time_charge_paise != null ? Number(session.time_charge_paise) : priced.time_paise,
    // not `units_paise`: withRupees would turn that into a `units` that overwrites the count of frames
    frames_paise: session.status === 'ENDED' && session.units_charge_paise != null ? Number(session.units_charge_paise) : priced.units_paise,
    charge_paise: session.status === 'ENDED' && session.time_charge_paise != null ? Number(session.time_charge_paise) + Number(session.units_charge_paise || 0) : priced.total_paise,
    hour_rate_paise: last && live ? Math.round(hourRateAt(last.rate, session.players, local)) : null,
    band: last && live ? bandAt(last.rate, local)?.name ?? null : null,
    unit_label: last?.rate?.unit_label ?? null, unit_price_paise: Number(last?.rate?.unit_price_paise || 0), bills_time: last?.rate?.bill_time !== false,
    customer_id: session.customer_id, customer_name: session.customer_name ?? null, player_name: session.player_name, game_id: session.game_id, game_name: session.game_name ?? null,
    bundle_id: session.bundle_id, bundle_name: session.bundle_name ?? null, pack_id: session.pack_id, pack_minutes: session.pack_minutes, covered_minutes: priced.covered_minutes ?? null, note: session.note, void_reason: session.void_reason
  });
};

const context = async (db, businessId) => {
  const settings = await getSettings(db, businessId);
  return { tz: await timezoneOf(db, businessId), alertMinutes: settings.alert_minutes, overrunGrace: 0 };
};

const SESSION_SELECT = `SELECT s.*, c.name AS customer_name, g.name AS game_name, b.name AS bundle_name
  FROM gaming_sessions s LEFT JOIN customers c ON c.customer_id = s.customer_id LEFT JOIN gaming_games g ON g.game_id = s.game_id LEFT JOIN gaming_bundles b ON b.bundle_id = s.bundle_id`;

export const sessionView = async (db, tenant, id, now = new Date()) => {
  const row = (await db.query(`${SESSION_SELECT} WHERE s.session_id = $1 AND s.business_id = $2`, [id, tenant.businessId])).rows[0];
  if (!row || !inScope(tenant, row)) throw new GamingError(404, 'Not found');
  return viewOf(row, await segmentsOf(db, id), now, await context(db, tenant.businessId));
};

/* ── the tab ───────────────────────────────────────────────────────────────────────────────────────────────── */

/** What is on a tab: the food and drink, the time lines, and the estimate to bill (with GST, as the table floor shows it). */
export const tabsOf = async (db, orderIds) => {
  if (!orderIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT o.order_id, o.order_number, o.status,
            COUNT(*) FILTER (WHERE oi.status <> 'CANCELLED' AND oi.invoice_id IS NULL AND p.kind <> 'SERVICE')::int AS fnb_lines,
            COALESCE(SUM(oi.quantity) FILTER (WHERE oi.status <> 'CANCELLED' AND oi.invoice_id IS NULL AND p.kind <> 'SERVICE'), 0) AS fnb_qty,
            COALESCE(SUM(ROUND(oi.quantity * oi.unit_price_paise * (1 + CASE WHEN b.gst_enabled THEN COALESCE(p.tax_rate, 0) / 100.0 ELSE 0 END))) FILTER (WHERE oi.status <> 'CANCELLED' AND oi.invoice_id IS NULL AND p.kind <> 'SERVICE'), 0) AS fnb_paise,
            COALESCE(SUM(ROUND(oi.quantity * oi.unit_price_paise * (1 + CASE WHEN b.gst_enabled THEN COALESCE(p.tax_rate, 0) / 100.0 ELSE 0 END))) FILTER (WHERE oi.status <> 'CANCELLED' AND oi.invoice_id IS NULL), 0) AS total_paise,
            COUNT(*) FILTER (WHERE oi.status = 'PENDING')::int AS not_sent,
            COUNT(*) FILTER (WHERE oi.status = 'PREPARING')::int AS cooking,
            COUNT(*) FILTER (WHERE oi.status = 'READY')::int AS ready
     FROM orders o JOIN businesses b ON b.business_id = o.business_id
     LEFT JOIN order_items oi ON oi.order_id = o.order_id LEFT JOIN products p ON p.product_id = oi.product_id
     WHERE o.order_id = ANY($1::int[]) GROUP BY o.order_id, o.order_number, o.status`, [orderIds]);
  return new Map(rows.map((r) => [r.order_id, {
    order_id: r.order_id, order_number: r.order_number, status: r.status, fnb_items: Number(r.fnb_qty), fnb_lines: r.fnb_lines,
    fnb_paise: Number(r.fnb_paise), total_paise: Number(r.total_paise), not_sent: r.not_sent, cooking: r.cooking, ready: r.ready
  }]));
};

/** An ended session whose time is still waiting to be billed on the station's open tab (the station shows "to bill"). */
const unbilledEnded = async (db, stationIds) => {
  if (!stationIds.length) return new Map();
  const { rows } = await db.query(
    `${SESSION_SELECT.replace('SELECT ', 'SELECT DISTINCT ON (s.station_id) ')} JOIN orders o ON o.order_id = s.order_id
     WHERE s.station_id = ANY($1::int[]) AND s.status = 'ENDED' AND o.status NOT IN ('BILLED','CANCELLED','MERGED')
       AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_item_id IN (s.time_item_id, s.units_item_id) AND oi.invoice_id IS NULL AND oi.status <> 'CANCELLED')
     ORDER BY s.station_id, s.ended_at DESC`, [stationIds]);
  return new Map(rows.map((r) => [r.station_id, r]));
};

/* ── the board ─────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Every station with what is happening on it. state: AVAILABLE, RUNNING, PAUSED, TO_BILL (a session ended and its time is on the tab, unpaid),
 * RESERVED (a booking is about to start), OUT_OF_SERVICE. `now` is returned so a screen can show a clock that follows the server's, not the device's.
 */
export const board = async (db, tenant, stations, now = new Date()) => {
  const ctx = await context(db, tenant.businessId);
  const ids = stations.map((s) => s.station_id);
  const live = ids.length ? (await db.query(`${SESSION_SELECT} WHERE s.station_id = ANY($1::int[]) AND s.status IN ('RUNNING','PAUSED')`, [ids])).rows : [];
  const ended = await unbilledEnded(db, ids);
  const segs = new Map();
  const shown = [...live, ...ended.values()];
  if (shown.length) {
    for (const r of (await db.query(`SELECT session_id, station_id, players, rate, started_at, ended_at FROM gaming_session_segments WHERE session_id = ANY($1::int[]) ORDER BY started_at, segment_id`, [shown.map((s) => s.session_id)])).rows) {
      if (!segs.has(r.session_id)) segs.set(r.session_id, []);
      segs.get(r.session_id).push(r);
    }
  }
  const openTabs = ids.length ? (await db.query(`SELECT t.table_id, o.order_id FROM gaming_stations s JOIN dining_tables t ON t.table_id = s.table_id JOIN orders o ON o.table_id = t.table_id AND o.status NOT IN ('BILLED','CANCELLED','MERGED') WHERE s.station_id = ANY($1::int[])`, [ids])).rows : [];
  const tabByTable = new Map(openTabs.map((r) => [r.table_id, r.order_id]));
  const tabs = await tabsOf(db, [...new Set([...tabByTable.values()])]);
  const liveBy = new Map(live.map((s) => [s.station_id, s]));
  const next = ids.length ? (await db.query(
    `SELECT DISTINCT ON (station_id) station_id, booking_id, starts_at, ends_at, guest_name FROM gaming_bookings
     WHERE station_id = ANY($1::int[]) AND status = 'BOOKED' AND ends_at > $2 AND starts_at < $2::timestamptz + interval '12 hours' ORDER BY station_id, starts_at`, [ids, now])).rows : [];
  const nextBy = new Map(next.map((r) => [r.station_id, r]));
  const holdMs = (await getSettings(db, tenant.businessId)).hold_minutes * 60000;

  return stations.map((st) => {
    const row = liveBy.get(st.station_id);
    const orderId = row?.order_id ?? tabByTable.get(st.table_id) ?? null;
    const tab = orderId ? tabs.get(orderId) ?? null : null;
    const upcoming = nextBy.get(st.station_id) ?? null;
    let state = 'AVAILABLE';
    let session = null;
    if (st.status === 'OUT_OF_SERVICE') state = 'OUT_OF_SERVICE';
    else if (row) { state = row.status; session = viewOf(row, segs.get(row.session_id) || [], now, ctx); }
    else if (ended.has(st.station_id)) { state = 'TO_BILL'; session = viewOf(ended.get(st.station_id), segs.get(ended.get(st.station_id).session_id) || [], now, ctx); }
    else if (upcoming && new Date(upcoming.starts_at).getTime() - now.getTime() <= holdMs) state = 'RESERVED';
    return { ...st, state, session, tab, order_id: orderId, next_booking: upcoming };
  });
};

/* ── start ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const customerOf = async (db, businessId, id) => {
  if (id == null || id === '') return null;
  const c = (await db.query(`SELECT customer_id, name FROM customers WHERE customer_id = $1 AND business_id = $2`, [Number(id), businessId])).rows[0];
  if (!c) throw new GamingError(400, 'That customer does not exist');
  return c;
};

const gameOf = async (db, businessId, id) => {
  if (id == null || id === '') return null;
  const g = (await db.query(`SELECT game_id FROM gaming_games WHERE game_id = $1 AND business_id = $2 AND is_active`, [Number(id), businessId])).rows[0];
  if (!g) throw new GamingError(400, 'That game is not on your list');
  return g.game_id;
};

/** Things other parts of the module check before a station may be started (a booking holding it, for one). Each may throw. */
export const startGuards = [];

export const startSession = async (db, tenant, userId, b, { now = new Date() } = {}) => {
  const stationId = int(b.station_id, 'Station', { min: 1, required: true });
  await lockStation(db, stationId);
  const station = await getStation(db, tenant, stationId, { lock: true });
  if (station.status === 'ARCHIVED') throw new GamingError(404, 'Not found');
  if (station.status === 'OUT_OF_SERVICE') throw new GamingError(409, `${station.name} is out of service${station.status_note ? `: ${station.status_note}` : ''}`, { code: 'OUT_OF_SERVICE' });

  const live = (await db.query(`SELECT session_id FROM gaming_sessions WHERE station_id = $1 AND status IN ('RUNNING','PAUSED')`, [stationId])).rows[0];
  if (live) throw new GamingError(409, `${station.name} already has a session running`, { code: 'STATION_BUSY', data: { session_id: live.session_id } });

  const mode = oneOf(b.mode ?? 'OPEN', 'Mode', MODES, { required: true });
  const players = b.players === undefined || b.players === null || b.players === '' ? 1 : int(b.players, 'Players', { min: 1, max: 20, required: true });
  if (players > station.max_players) throw new GamingError(400, `${station.name} takes up to ${station.max_players} players`);
  const customer = await customerOf(db, tenant.businessId, b.customer_id);
  const gameId = await gameOf(db, tenant.businessId, b.game_id);
  const playerName = text(b.player_name, 'Name', { max: 60 });
  const note = text(b.note, 'Note', { max: 200 });

  let bundle = null; let planned = null; let bundlePrice = 0; let packId = null; let packMinutes = 0;
  if (mode === 'PACK') {
    if (!b.pack_id) throw new GamingError(400, 'Choose the pack to play against');
    packId = Number(b.pack_id);
    const pack = await checkStart(db, tenant, packId, { customerId: customer?.customer_id ?? null, kind: station.kind });
    packMinutes = pack.minutes_left; planned = pack.minutes_left;   // the board warns as the pack runs low
  } else if (mode === 'FIXED') {
    if (!b.bundle_id) throw new GamingError(400, 'Choose the offer this session is sold as');
    bundle = await getBundle(db, tenant.businessId, Number(b.bundle_id), { kind: 'SESSION' });
    if (bundle.kinds && !bundle.kinds.includes(station.kind)) throw new GamingError(400, `${bundle.name} is not for ${station.name}`);
    planned = bundle.minutes; bundlePrice = Number(bundle.price_paise);
    if (players > bundle.players && b.allow_extra_players !== true) throw new GamingError(400, `${bundle.name} covers ${bundle.players} player${bundle.players === 1 ? '' : 's'}`);
  } else if (b.planned_minutes !== undefined && b.planned_minutes !== null && b.planned_minutes !== '') {
    planned = int(b.planned_minutes, 'Planned minutes', { min: 1, max: 1440 });
  }

  for (const guard of startGuards) await guard(db, tenant, station, { now, override: b.override === true, customerId: customer?.customer_id ?? null, bookingId: b.booking_id ? Number(b.booking_id) : null });

  const rate = await snapshotFor(db, tenant.businessId, station);

  // the station's tab: an open one is adopted (a drink ordered before the game was started), unless it is a finished session's unpaid tab
  const tab = await getOrCreateOpenOrderForTable(db, { businessId: tenant.businessId, branchId: station.branch_id, tableId: station.table_id, customerId: customer?.customer_id ?? null, createdBy: userId });
  const stale = (await db.query(
    `SELECT 1 FROM gaming_sessions s WHERE s.order_id = $1 AND s.status = 'ENDED'
       AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_item_id IN (s.time_item_id, s.units_item_id) AND oi.invoice_id IS NULL AND oi.status <> 'CANCELLED')`, [tab.order_id])).rowCount;
  if (stale) throw new GamingError(409, `The last session on ${station.name} has not been paid. Bill or cancel its tab (${tab.order_number}) first`, { code: 'TO_BILL', data: { order_id: tab.order_id } });
  if (customer && !tab.customer_id) await db.query(`UPDATE orders SET customer_id = $2 WHERE order_id = $1`, [tab.order_id, customer.customer_id]);

  const session = (await db.query(
    `INSERT INTO gaming_sessions (business_id, branch_id, station_id, order_id, customer_id, player_name, mode, bundle_id, bundle_price_paise, planned_minutes, pack_id, pack_minutes, players, game_id, note, started_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [tenant.businessId, station.branch_id, stationId, tab.order_id, customer?.customer_id ?? null, playerName, mode, bundle?.bundle_id ?? null, bundlePrice, planned, packId, packMinutes, players, gameId, note, now, userId])).rows[0];
  await db.query(`INSERT INTO gaming_session_segments (session_id, station_id, players, rate, started_at) VALUES ($1,$2,$3,$4,$5)`, [session.session_id, stationId, players, JSON.stringify(rate), now]);
  await logEvent(db, session, 'START', { mode, players, bundle_id: bundle?.bundle_id ?? null, pack_id: packId, planned_minutes: planned, rate: rate.name }, userId, now);
  return sessionView(db, tenant, session.session_id, now);
};

/* ── changes while it runs ─────────────────────────────────────────────────────────────────────────────────── */

const liveSession = async (db, tenant, id) => {
  const peek = await getSession(db, tenant, id);
  await lockStation(db, peek.station_id);
  return getSession(db, tenant, id, { lock: true });
};

const closeOpenSegment = (db, sessionId, at) => db.query(`UPDATE gaming_session_segments SET ended_at = $2 WHERE session_id = $1 AND ended_at IS NULL`, [sessionId, at]);

const openSegment = async (db, session, at, { players = session.players, rate = null } = {}) => {
  let snapshot = rate;
  if (!snapshot) {
    const last = (await db.query(`SELECT station_id, rate FROM gaming_session_segments WHERE session_id = $1 ORDER BY started_at DESC, segment_id DESC LIMIT 1`, [session.session_id])).rows[0];
    snapshot = last && last.station_id === session.station_id ? last.rate : await snapshotFor(db, session.business_id, { station_id: session.station_id, ...(await stationRow(db, session.station_id)) });
  }
  await db.query(`INSERT INTO gaming_session_segments (session_id, station_id, players, rate, started_at) VALUES ($1,$2,$3,$4,$5)`, [session.session_id, session.station_id, players, JSON.stringify(snapshot), at]);
};

const stationRow = async (db, id) => (await db.query(`SELECT station_id, zone_id, kind, name FROM gaming_stations WHERE station_id = $1`, [id])).rows[0];

export const pauseSession = async (db, tenant, userId, id, { now = new Date() } = {}) => {
  const s = await liveSession(db, tenant, id);
  if (s.status === 'PAUSED') return sessionView(db, tenant, id, now);
  if (s.status !== 'RUNNING') throw new GamingError(409, 'This session has ended');
  await closeOpenSegment(db, id, now);
  await db.query(`UPDATE gaming_sessions SET status = 'PAUSED' WHERE session_id = $1`, [id]);
  await logEvent(db, s, 'PAUSE', null, userId, now);
  return sessionView(db, tenant, id, now);
};

export const resumeSession = async (db, tenant, userId, id, { now = new Date() } = {}) => {
  const s = await liveSession(db, tenant, id);
  if (s.status === 'RUNNING') return sessionView(db, tenant, id, now);
  if (s.status !== 'PAUSED') throw new GamingError(409, 'This session has ended');
  await openSegment(db, s, now);
  await db.query(`UPDATE gaming_sessions SET status = 'RUNNING' WHERE session_id = $1`, [id]);
  await logEvent(db, s, 'RESUME', null, userId, now);
  return sessionView(db, tenant, id, now);
};

/** Change how many are playing: the stretch so far is priced for the old count, the next for the new. */
export const setPlayers = async (db, tenant, userId, id, b, { now = new Date() } = {}) => {
  const s = await liveSession(db, tenant, id);
  if (!LIVE.includes(s.status)) throw new GamingError(409, 'This session has ended');
  const players = int(b.players, 'Players', { min: 1, max: 20, required: true });
  const station = await getStation(db, tenant, s.station_id);
  if (players > station.max_players) throw new GamingError(400, `${station.name} takes up to ${station.max_players} players`);
  if (players === s.players) return sessionView(db, tenant, id, now);
  if (s.status === 'RUNNING') {
    const last = (await db.query(`SELECT rate FROM gaming_session_segments WHERE session_id = $1 AND ended_at IS NULL`, [id])).rows[0];
    await closeOpenSegment(db, id, now);
    await openSegment(db, s, now, { players, rate: last.rate });
  }
  await db.query(`UPDATE gaming_sessions SET players = $2 WHERE session_id = $1`, [id, players]);
  await logEvent(db, s, 'PLAYERS', { from: s.players, to: players }, userId, now);
  return sessionView(db, tenant, id, now);
};

/** Count frames or games (pool, snooker): `delta` is +1 or -1, or `units` sets the total. */
export const setUnits = async (db, tenant, userId, id, b, { now = new Date() } = {}) => {
  const s = await liveSession(db, tenant, id);
  if (!LIVE.includes(s.status)) throw new GamingError(409, 'This session has ended');
  const units = b.units !== undefined ? int(b.units, 'Frames', { min: 0, max: 500, required: true }) : s.units + int(b.delta ?? 1, 'Change', { min: -50, max: 50, required: true });
  if (units < 0) throw new GamingError(400, 'There are no frames to take off');
  if (units > 500) throw new GamingError(400, 'That is too many frames');
  await db.query(`UPDATE gaming_sessions SET units = $2 WHERE session_id = $1`, [id, units]);
  await logEvent(db, s, 'UNITS', { from: s.units, to: units }, userId, now);
  return sessionView(db, tenant, id, now);
};

/** Add time. An OPEN session's planned time (its alarm) moves out; a FIXED one needs another offer, which adds its time and its price. */
export const extendSession = async (db, tenant, userId, id, b, { now = new Date() } = {}) => {
  const s = await liveSession(db, tenant, id);
  if (!LIVE.includes(s.status)) throw new GamingError(409, 'This session has ended');
  if (s.mode === 'PACK') throw new GamingError(400, 'A pack session cannot be extended. Start a new session against another pack, or pay the rest by the time');
  if (s.mode === 'FIXED') {
    if (!b.bundle_id) throw new GamingError(400, 'Choose the offer to add');
    const bundle = await getBundle(db, tenant.businessId, Number(b.bundle_id), { kind: 'SESSION' });
    await db.query(`UPDATE gaming_sessions SET planned_minutes = planned_minutes + $2, bundle_price_paise = bundle_price_paise + $3, alerted_soon_at = NULL, alerted_over_at = NULL WHERE session_id = $1`, [id, bundle.minutes, bundle.price_paise]);
    await logEvent(db, s, 'EXTEND', { bundle_id: bundle.bundle_id, minutes: bundle.minutes, price_paise: Number(bundle.price_paise) }, userId, now);
  } else {
    const minutes = int(b.minutes, 'Minutes', { min: 1, max: 1440, required: true });
    const elapsed = Math.ceil(elapsedSeconds(await segmentsOf(db, id), now.getTime()) / 60);
    const base = s.planned_minutes && s.planned_minutes > elapsed ? s.planned_minutes : elapsed;
    await db.query(`UPDATE gaming_sessions SET planned_minutes = $2, alerted_soon_at = NULL, alerted_over_at = NULL WHERE session_id = $1`, [id, base + minutes]);
    await logEvent(db, s, 'EXTEND', { minutes }, userId, now);
  }
  return sessionView(db, tenant, id, now);
};

/** Change the note, the game, or who it is for. */
export const editSession = async (db, tenant, userId, id, b, { now = new Date() } = {}) => {
  const s = await liveSession(db, tenant, id);
  const next = {};
  if (b.note !== undefined) next.note = text(b.note, 'Note', { max: 200 });
  if (b.player_name !== undefined) next.player_name = text(b.player_name, 'Name', { max: 60 });
  if (b.game_id !== undefined) next.game_id = await gameOf(db, tenant.businessId, b.game_id);
  if (b.customer_id !== undefined) {
    const c = await customerOf(db, tenant.businessId, b.customer_id);
    next.customer_id = c?.customer_id ?? null;
    if (c) await db.query(`UPDATE orders SET customer_id = $2 WHERE order_id = $1 AND customer_id IS NULL`, [s.order_id, c.customer_id]);
  }
  const keys = Object.keys(next);
  if (keys.length) {
    await db.query(`UPDATE gaming_sessions SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE session_id = $1`, [id, ...keys.map((k) => next[k])]);
    await logEvent(db, s, 'EDIT', next, userId, now);
  }
  return sessionView(db, tenant, id, now);
};

/** Move the session, and its tab, to another station. The time so far is priced at the old station's rate, the rest at the new one's. */
export const transferSession = async (db, tenant, userId, id, b, { now = new Date() } = {}) => {
  const toId = int(b.station_id, 'Station', { min: 1, required: true });
  const peek = await getSession(db, tenant, id);
  if (toId === peek.station_id) return sessionView(db, tenant, id, now);
  // both stations, in id order, so two transfers across the same pair cannot deadlock
  for (const sid of [peek.station_id, toId].sort((a, c) => a - c)) await lockStation(db, sid);
  const s = await getSession(db, tenant, id, { lock: true });
  if (!LIVE.includes(s.status)) throw new GamingError(409, 'This session has ended');
  if (s.station_id !== peek.station_id) throw new GamingError(409, 'This session was just moved. Look again');
  const to = await getStation(db, tenant, toId, { lock: true });
  if (to.status !== 'ACTIVE') throw new GamingError(409, `${to.name} is not available`);
  if (to.branch_id !== s.branch_id) throw new GamingError(400, 'A session cannot move to another outlet');
  if ((await db.query(`SELECT 1 FROM gaming_sessions WHERE station_id = $1 AND status IN ('RUNNING','PAUSED')`, [toId])).rowCount) throw new GamingError(409, `${to.name} already has a session running`, { code: 'STATION_BUSY' });
  if ((await db.query(`SELECT 1 FROM orders WHERE table_id = $1 AND status NOT IN ('BILLED','CANCELLED','MERGED')`, [to.table_id])).rowCount) throw new GamingError(409, `${to.name} has an open tab. Bill or cancel it first`, { code: 'TO_BILL' });
  if (s.players > to.max_players) throw new GamingError(400, `${to.name} takes up to ${to.max_players} players`);
  const rate = await snapshotFor(db, tenant.businessId, to);

  const was = s.status === 'RUNNING';
  if (was) await closeOpenSegment(db, id, now);
  await db.query(`UPDATE gaming_sessions SET station_id = $2 WHERE session_id = $1`, [id, toId]);
  await db.query(`UPDATE orders SET table_id = $2, updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [s.order_id, to.table_id]);
  if (was) await openSegment(db, { ...s, station_id: toId }, now, { rate });
  await logEvent(db, s, 'TRANSFER', { from: s.station_id, to: toId }, userId, now);
  return sessionView(db, tenant, id, now);
};

/* ── stop ──────────────────────────────────────────────────────────────────────────────────────────────────── */

const writeLine = async (db, orderId, productId, description, quantity, unitPaise) =>
  (await db.query(
    `INSERT INTO order_items (order_id, product_id, description, quantity, unit_price_paise, status, modifiers) VALUES ($1,$2,$3,$4,$5,'SERVED','[]'::jsonb) RETURNING order_item_id`,
    [orderId, productId, description.slice(0, 200), quantity, unitPaise])).rows[0].order_item_id;

/** A tab with nothing left on it is closed, so the table is free and nothing is left open for no reason. */
const closeIfEmpty = async (db, orderId) => {
  const left = Number((await db.query(`SELECT COUNT(*) AS n FROM order_items WHERE order_id = $1 AND status <> 'CANCELLED' AND invoice_id IS NULL`, [orderId])).rows[0].n);
  if (left) return false;
  await db.query(`UPDATE orders SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1 AND status NOT IN ('BILLED','CANCELLED')`, [orderId]);
  return true;
};

/**
 * Stop the session and put its time on the tab. With `void: true` (and a reason) the session never happened: no charge, nothing on the tab.
 * Stopping a session that already ended returns it as it is, so a double tap does nothing twice.
 */
export const stopSession = async (db, tenant, userId, id, b = {}, { now = new Date() } = {}) => {
  const s = await liveSession(db, tenant, id);
  if (!LIVE.includes(s.status)) return { ...(await sessionView(db, tenant, id, now)), repeated: true };
  const station = await getStation(db, tenant, s.station_id);
  const ctx = await context(db, tenant.businessId);

  if (b.void === true) {
    const reason = text(b.reason, 'The reason', { max: 200, required: true });
    await closeOpenSegment(db, id, now);
    await db.query(`UPDATE gaming_sessions SET status = 'CANCELLED', ended_at = $2, ended_by = $3, void_reason = $4, time_charge_paise = 0, units_charge_paise = 0 WHERE session_id = $1`, [id, now, userId, reason]);
    await logEvent(db, s, 'VOID', { reason }, userId, now);
    const closed = await closeIfEmpty(db, s.order_id);
    return { ...(await sessionView(db, tenant, id, now)), tab_closed: closed };
  }

  await closeOpenSegment(db, id, now);
  const segments = await segmentsOf(db, id);
  let priced = priceSession(segments, s, now.getTime(), { tz: ctx.tz, overrunGraceMinutes: ctx.overrunGrace });
  if (s.mode === 'PACK' && s.pack_id) {
    // the pack covers what it has left NOW (read under its lock); if another bill took some meanwhile, the rest is charged by the time
    const covered = await takeMinutes(db, tenant, s.pack_id, id, priced.covered_minutes ?? 0);
    if (covered !== (priced.covered_minutes ?? 0)) priced = priceSession(segments, { ...s, pack_minutes: covered }, now.getTime(), { tz: ctx.tz, overrunGraceMinutes: ctx.overrunGrace });
  }
  const rate = segments[segments.length - 1]?.rate || {};
  const productId = priced.time_paise > 0 || priced.units_paise > 0 ? await ensureProduct(db, tenant.businessId, 'time') : null;
  let timeItem = null; let unitsItem = null;
  if (priced.time_paise > 0) {
    const how = s.mode === 'FIXED' ? ` · ${s.planned_minutes} min offer${priced.over_seconds > 0 ? ` + ${Math.ceil(priced.over_seconds / 60)} min over` : ''}` : s.mode === 'PACK' ? ` · ${priced.covered_minutes || 0} min from the pack` : '';
    timeItem = await writeLine(db, s.order_id, productId, `${station.name} · ${durationLabel(priced.elapsed_seconds)}${s.players > 1 ? ` · ${s.players} players` : ''}${how}`, 1, priced.time_paise);
  }
  if (priced.units_paise > 0) {
    unitsItem = await writeLine(db, s.order_id, productId, `${station.name} · ${rate.unit_label || 'frame'}s`, priced.units, Number(rate.unit_price_paise));
  }
  await db.query(
    `UPDATE gaming_sessions SET status = 'ENDED', ended_at = $2, ended_by = $3, time_charge_paise = $4, units_charge_paise = $5, time_item_id = $6, units_item_id = $7 WHERE session_id = $1`,
    [id, now, userId, priced.time_paise, priced.units_paise, timeItem, unitsItem]);
  await logEvent(db, s, 'STOP', { elapsed_seconds: priced.elapsed_seconds, time_paise: priced.time_paise, units_paise: priced.units_paise }, userId, now);
  const closed = await closeIfEmpty(db, s.order_id);
  return { ...(await sessionView(db, tenant, id, now)), tab_closed: closed };
};

/**
 * Take back a stop: the time lines come off the tab and the session runs again (the minutes between the stop and now are not counted).
 * Only while nothing on the tab has been billed, and only if no newer session has started on the station.
 */
export const reopenSession = async (db, tenant, userId, id, { now = new Date() } = {}) => {
  const s = await liveSession(db, tenant, id);
  if (s.status !== 'ENDED') throw new GamingError(409, 'Only a stopped session can be taken back');
  if ((await db.query(`SELECT 1 FROM gaming_sessions WHERE station_id = $1 AND status IN ('RUNNING','PAUSED')`, [s.station_id])).rowCount) throw new GamingError(409, 'Another session is running on this station now');
  const tab = (await db.query(`SELECT status FROM orders WHERE order_id = $1 FOR UPDATE`, [s.order_id])).rows[0];
  if (!tab || ['BILLED', 'CANCELLED', 'MERGED'].includes(tab.status)) throw new GamingError(409, 'The tab was already billed or closed, so the session cannot be reopened');
  const lines = [s.time_item_id, s.units_item_id].filter(Boolean);
  if (lines.length && (await db.query(`SELECT 1 FROM order_items WHERE order_item_id = ANY($1::int[]) AND invoice_id IS NOT NULL`, [lines])).rowCount) throw new GamingError(409, 'The time was already billed, so the session cannot be reopened');
  if (lines.length) await db.query(`UPDATE order_items SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP WHERE order_item_id = ANY($1::int[])`, [lines]);
  await giveBack(db, id);
  await db.query(`UPDATE gaming_sessions SET status = 'RUNNING', ended_at = NULL, ended_by = NULL, time_charge_paise = NULL, units_charge_paise = NULL, time_item_id = NULL, units_item_id = NULL, alerted_soon_at = NULL, alerted_over_at = NULL WHERE session_id = $1`, [id]);
  await openSegment(db, s, now);
  await logEvent(db, s, 'REOPEN', null, userId, now);
  return sessionView(db, tenant, id, now);
};

export const eventsOf = async (db, tenant, id) => {
  await getSession(db, tenant, id);
  return (await db.query(
    `SELECT e.event_id, e.type, e.data, e.at, u.name AS by FROM gaming_session_events e LEFT JOIN users u ON u.user_id = e.user_id WHERE e.session_id = $1 ORDER BY e.at, e.event_id`, [id])).rows;
};

/** Past and present sessions, newest first, for the history screen. */
export const listSessions = async (db, tenant, q, { limit, offset }) => {
  const params = [tenant.businessId];
  let where = 's.business_id = $1';
  if (tenant.scopeBranchId != null) { params.push(tenant.scopeBranchId); where += ` AND s.branch_id = $${params.length}`; }
  if (q.station_id) { params.push(Number(q.station_id)); where += ` AND s.station_id = $${params.length}`; }
  if (q.customer_id) { params.push(Number(q.customer_id)); where += ` AND s.customer_id = $${params.length}`; }
  if (q.status) { params.push(String(q.status).toUpperCase()); where += ` AND s.status = $${params.length}`; }
  if (q.from) { params.push(q.from); where += ` AND s.started_at >= $${params.length}::date`; }
  if (q.to) { params.push(q.to); where += ` AND s.started_at < ($${params.length}::date + 1)`; }
  const total = Number((await db.query(`SELECT COUNT(*) AS n FROM gaming_sessions s WHERE ${where}`, params)).rows[0].n);
  params.push(limit, offset);
  const rows = (await db.query(
    `SELECT s.session_id, s.station_id, st.name AS station_name, st.kind, s.mode, s.status, s.players, s.units, s.started_at, s.ended_at, s.planned_minutes,
            s.time_charge_paise, s.units_charge_paise, s.void_reason, c.name AS customer_name, s.player_name, g.name AS game_name, s.order_id,
            (SELECT i.invoice_number FROM order_items oi JOIN invoices i ON i.invoice_id = oi.invoice_id WHERE oi.order_item_id = COALESCE(s.time_item_id, s.units_item_id)) AS invoice_number,
            (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(sg.ended_at, now()) - sg.started_at))), 0)::int FROM gaming_session_segments sg WHERE sg.session_id = s.session_id) AS elapsed_seconds
     FROM gaming_sessions s JOIN gaming_stations st ON st.station_id = s.station_id LEFT JOIN customers c ON c.customer_id = s.customer_id LEFT JOIN gaming_games g ON g.game_id = s.game_id
     WHERE ${where} ORDER BY s.started_at DESC, s.session_id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
  return { rows: withRupees(rows.map((r) => ({ ...r, charge_paise: Number(r.time_charge_paise || 0) + Number(r.units_charge_paise || 0), time_charge_paise: undefined, units_charge_paise: undefined }))), total };
};
