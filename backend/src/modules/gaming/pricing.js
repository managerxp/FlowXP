/*
 * What a session costs. Pure functions: no database, no clock of their own (`now` is always passed in), so every rule can be tested with exact
 * times. Money is integer paise.
 *
 * A session is a list of SEGMENTS: the stretches that count. A pause ends one; a change of players or a transfer to another station starts the
 * next. Each segment carries its own copy of the rate it is priced at (see gaming_session_segments.rate), so editing a rate later never changes a
 * running or past session.
 *
 * THE RATE (a "plan"):
 *   bill_time               false = a table charged only per frame or game; the clock costs nothing
 *   tiers                   [{ players, hour_paise }]  the price per hour for that many players. More players than the biggest tier pay
 *                           the biggest tier plus `extra_player_hour_paise` for each one over (or just the biggest tier, if that is unset)
 *   bands                   [{ name, days:[0-6], from:'18:00', to:'23:00', multiplier_pct } or { ..., tiers }]
 *                           the first band that matches the local weekday and time replaces or scales the base tiers. A band is matched by
 *                           the weekday of the minute itself, so a 22:00 to 02:00 band on Saturday covers Saturday 22:00 to 23:59 and, on Sunday,
 *                           00:00 to 01:59 only if Sunday is also ticked
 *   block_minutes           bill in blocks (1 = by the minute); time over a block is rounded up to the next unless within grace_minutes
 *   grace_minutes           see above
 *   min_minutes             the least that is billed for a session that was started and used
 *   unit_label / unit_price_paise   a price per frame / game, added to the time
 *
 * HOW A CHARGE IS WORKED OUT (mode OPEN, the pay-as-you-go case):
 *   1. elapsed = the seconds inside the segments (a pause is not in any segment).
 *   2. billed minutes = elapsed rounded up to the block (with grace), and never below the minimum.
 *   3. the price of the elapsed seconds = each second at the rate in force at that moment (the band for its local weekday and time, the
 *      tier for the players then). The seconds added by rounding or the minimum are priced at the rate in force at the END.
 *   FIXED (a bundle): the bundle's price covers its minutes. Time over that (past a grace) is charged at the rate, by the minute.
 *      Stopping early refunds nothing: the bundle was sold as a block.
 *   PACK (prepaid hours): the pack covers up to the minutes it has left. What is left over is charged at the rate, pro rata.
 * Frames are added on top: units x unit price.
 *
 * LOCAL TIME. A band is a wall-clock idea, so every second is placed in the business's timezone. Intl does the zone arithmetic (a day with 23 or 25
 * hours is handled by the zone database, not by us). Seconds are priced in slices that never cross a wall-clock minute, so a band edge is exact.
 */

const DTF = new Map();
const formatterFor = (tz) => {
  let f = DTF.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' });
    DTF.set(tz, f);
  }
  return f;
};
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** { dow: 0-6 (0 = Sunday), minutes: minutes since local midnight } at an instant (ms since epoch). */
export const localAt = (ms, tz = 'Asia/Kolkata') => {
  const parts = formatterFor(tz).formatToParts(new Date(ms));
  let dow = 0; let h = 0; let m = 0;
  for (const p of parts) {
    if (p.type === 'weekday') dow = WEEKDAY[p.value];
    else if (p.type === 'hour') h = Number(p.value);
    else if (p.type === 'minute') m = Number(p.value);
  }
  return { dow, minutes: h * 60 + m };
};

const toMin = (clock) => { const [h, m] = String(clock).split(':').map(Number); return h * 60 + m; };

/** Is `minutes` inside from-to? A window past midnight wraps; the same time twice means all day. */
export const inWindow = (minutes, from, to) => {
  const a = toMin(from); const b = toMin(to);
  if (a === b) return true;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
};

const sortedTiers = (tiers) => [...(tiers || [])].sort((a, b) => a.players - b.players);

/** The price per hour, in paise, for `players` on these tiers. */
export const hourPrice = (tiers, players, extraPerHour = null) => {
  const t = sortedTiers(tiers);
  if (!t.length) return 0;
  const hit = t.find((x) => x.players >= players);
  if (hit) return Number(hit.hour_paise);
  const top = t[t.length - 1];
  return Number(top.hour_paise) + (extraPerHour == null ? 0 : (players - top.players) * Number(extraPerHour));
};

/** The price per hour for `players` at one local moment of this plan (after bands). */
export const hourRateAt = (plan, players, local) => {
  const band = (plan.bands || []).find((b) => (!b.days || b.days.includes(local.dow)) && inWindow(local.minutes, b.from ?? '00:00', b.to ?? '00:00'));
  if (band?.tiers?.length) return hourPrice(band.tiers, players, plan.extra_player_hour_paise);
  const base = hourPrice(plan.tiers, players, plan.extra_player_hour_paise);
  return band?.multiplier_pct ? base * Number(band.multiplier_pct) / 100 : base;
};

/** Which band (if any) is in force at this local moment: used to show "Peak" on the tile. */
export const bandAt = (plan, local) => (plan.bands || []).find((b) => (!b.days || b.days.includes(local.dow)) && inWindow(local.minutes, b.from ?? '00:00', b.to ?? '00:00')) || null;

const segEnd = (s, now) => (s.ended_at ? new Date(s.ended_at).getTime() : now);
const segStart = (s) => new Date(s.started_at).getTime();

/** Seconds that count: the sum of the segments up to `now`. */
export const elapsedSeconds = (segments, now) =>
  Math.max(0, Math.round(segments.reduce((sum, s) => sum + Math.max(0, segEnd(s, now) - segStart(s)), 0) / 1000));

/** Minutes billed for `elapsed` seconds under a plan's block, grace and minimum. Zero elapsed is zero billed (nothing was used). */
export const billedMinutes = (elapsed, plan) => {
  if (elapsed <= 0) return 0;
  const block = Math.max(1, Number(plan.block_minutes) || 1);
  const grace = Math.max(0, Number(plan.grace_minutes) || 0);
  let minutes;
  if (block === 1) {
    minutes = Math.ceil(elapsed / 60 - 1e-9);
    // with a grace on by-the-minute billing, a few seconds into a new minute are not billed
    if (grace > 0) minutes = Math.max(0, Math.ceil((elapsed - grace * 60) / 60 - 1e-9));
  } else {
    const raw = elapsed / 60;
    const whole = Math.floor(raw / block + 1e-9) * block;
    const over = raw - whole;
    if (over <= 1e-9) minutes = whole;
    else if (whole > 0 && over <= grace + 1e-9) minutes = whole;       // the grace is for overshooting a block already paid for, not for the first one
    else minutes = whole + block;
  }
  return Math.max(minutes, Number(plan.min_minutes) || 0);
};

/**
 * The price, in paise (a float; the caller rounds once), of the seconds inside the segments, each priced at the rate in force at that moment.
 * Slices never cross a wall-clock minute, so a band edge is exact.
 */
const priceSeconds = (segments, now, tz, capSeconds = Infinity) => {
  let paise = 0;
  let left = capSeconds * 1000;
  for (const s of segments) {
    if (left <= 0) break;
    if (s.rate?.bill_time === false) continue;
    const start = segStart(s); const end = Math.min(segEnd(s, now), start + left);
    left -= end - start;
    let t = start;
    while (t < end) {
      const next = Math.min(end, (Math.floor(t / 60000) + 1) * 60000);
      const rate = hourRateAt(s.rate, s.players, localAt(t, tz));
      paise += rate * (next - t) / 3600000;
      t = next;
    }
  }
  return paise;
};

/**
 * The charge for a session as it stands at `now`.
 *
 *   segments  [{ started_at, ended_at|null, players, rate }]   in order
 *   session   { mode, bundle_price_paise, planned_minutes, pack_minutes, units }
 *   opts      { tz, overrunGraceMinutes }
 *
 * Returns { elapsed_seconds, billed_minutes, time_paise, units, units_paise, total_paise, over_seconds }.
 */
export const priceSession = (segments, session, now, { tz = 'Asia/Kolkata', overrunGraceMinutes = 0 } = {}) => {
  const live = segments.filter((s) => segEnd(s, now) > segStart(s));
  const last = segments[segments.length - 1];
  const plan = last?.rate || {};
  const elapsed = elapsedSeconds(segments, now);
  const units = Number(session.units) || 0;
  const unitsPaise = units * (Number(plan.unit_price_paise) || 0);
  const out = { elapsed_seconds: elapsed, billed_minutes: 0, time_paise: 0, units, units_paise: unitsPaise, over_seconds: 0 };

  if (!last || elapsed <= 0 || plan.bill_time === false) {
    if (session.mode === 'FIXED' && elapsed > 0) out.time_paise = Number(session.bundle_price_paise) || 0;
    return { ...out, total_paise: out.time_paise + unitsPaise };
  }

  // the price of one second at the end: what rounding and the minimum are charged at
  const endLocal = localAt(Math.max(...live.map((s) => segEnd(s, now))), tz);
  const endPerMinute = hourRateAt(plan, last.players, endLocal) / 60;

  if (session.mode === 'FIXED') {
    const planned = (Number(session.planned_minutes) || 0) * 60;
    const over = Math.max(0, elapsed - planned - overrunGraceMinutes * 60);
    out.over_seconds = over;
    // the overrun is the LAST `over` seconds of the session, by the minute at the rate then in force
    out.billed_minutes = Math.ceil(over / 60 - 1e-9);
    out.time_paise = (Number(session.bundle_price_paise) || 0) + Math.round(out.billed_minutes * endPerMinute);
    return { ...out, total_paise: out.time_paise + unitsPaise };
  }

  const billed = billedMinutes(elapsed, plan);
  const extraSeconds = Math.max(0, billed * 60 - elapsed);
  // time forgiven by a grace is the last of the session, so it is not priced; time added by rounding or the minimum is
  let time = priceSeconds(live, now, tz, Math.min(elapsed, billed * 60)) + extraSeconds * endPerMinute / 60;
  out.billed_minutes = billed;
  if (session.mode === 'PACK') {
    const covered = Math.min(Number(session.pack_minutes) || 0, billed);
    time = billed > 0 ? time * (billed - covered) / billed : 0;
    out.covered_minutes = covered;
  }
  out.time_paise = Math.round(time);
  return { ...out, total_paise: out.time_paise + unitsPaise };
};

/** Seconds left on a timed session (FIXED: the bundle's minutes; OPEN with a planned time: that alarm), or null when it is not timed. */
export const remainingSeconds = (segments, session, now) => {
  const planned = Number(session.planned_minutes) || 0;
  if (!planned) return null;
  return planned * 60 - elapsedSeconds(segments, now);
};

/* ── cleaning a rate a person typed ────────────────────────────────────────────────────────────────────────────────────────────────────── */

export class RateError extends Error {
  constructor(message) { super(message); this.name = 'RateError'; this.status = 400; }
}

const asInt = (v, label, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new RateError(`${label} must be a whole number from ${min} to ${max}`);
  return n;
};
const asPaise = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new RateError(`${label} must be an amount between 0 and 1,00,000`);
  return Math.round(n * 100);
};
const cleanClock = (v, label) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? ''))) throw new RateError(`${label} is a time like 18:00`);
  return String(v);
};

/** Tiers typed in rupees ([{ players, hour }]) to the stored shape in paise ([{ players, hour_paise }]), sorted and without repeats. */
export const cleanTiers = (tiers, { required = false } = {}) => {
  if (tiers == null || (Array.isArray(tiers) && !tiers.length)) {
    if (required) throw new RateError('Add at least one price: for example 1 player, Rs 100 an hour');
    return [];
  }
  if (!Array.isArray(tiers) || tiers.length > 12) throw new RateError('Prices by number of players: up to 12 rows');
  const seen = new Set();
  const out = tiers.map((t) => {
    const players = asInt(t.players, 'Players', 1, 20);
    if (seen.has(players)) throw new RateError(`${players} players is listed twice`);
    seen.add(players);
    return { players, hour_paise: t.hour_paise != null ? asInt(t.hour_paise, 'Price', 0, 1000000000) : asPaise(t.hour, 'The hourly price') };
  });
  return sortedTiers(out);
};

export const cleanBands = (bands) => {
  if (bands == null) return [];
  if (!Array.isArray(bands) || bands.length > 8) throw new RateError('Peak times: up to 8');
  return bands.map((b, i) => {
    const days = b.days == null ? [0, 1, 2, 3, 4, 5, 6] : [...new Set((Array.isArray(b.days) ? b.days : []).map(Number))].sort();
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new RateError('Peak times: choose the days (0 = Sunday to 6 = Saturday)');
    const out = { name: String(b.name || `Band ${i + 1}`).slice(0, 40), days, from: cleanClock(b.from ?? '00:00', 'From'), to: cleanClock(b.to ?? '00:00', 'To') };
    if (b.tiers && b.tiers.length) out.tiers = cleanTiers(b.tiers);
    else {
      const pct = Number(b.multiplier_pct);
      if (!Number.isFinite(pct) || pct < 10 || pct > 1000) throw new RateError('A peak time needs prices, or a percentage of the normal price between 10 and 1000');
      out.multiplier_pct = pct;
    }
    return out;
  });
};

/** The rate as the session stores it: only the fields pricing reads. Used to take the snapshot into a segment. */
export const snapshotOf = (rate) => ({
  rate_id: rate.rate_id ?? null,
  name: rate.name,
  bill_time: rate.bill_time !== false,
  tiers: rate.tiers || [],
  extra_player_hour_paise: rate.extra_player_hour_paise == null ? null : Number(rate.extra_player_hour_paise),
  bands: rate.bands || [],
  block_minutes: Number(rate.block_minutes) || 1,
  grace_minutes: Number(rate.grace_minutes) || 0,
  min_minutes: Number(rate.min_minutes) || 0,
  unit_label: rate.unit_label || null,
  unit_price_paise: Number(rate.unit_price_paise) || 0
});

/** A readable duration: 1h 05m, 42m, 0m. */
export const durationLabel = (seconds) => {
  const m = Math.floor(Math.max(0, seconds) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};
