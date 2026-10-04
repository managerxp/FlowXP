/*
 * Time arithmetic for the appointment book, kept free of the database so it can be reasoned about (and tested)
 * on its own.
 *
 * A salon's day is the salon's own: "10:00" means 10:00 in the business's timezone, whatever the server or the
 * browser thinks. Everything is stored as timestamptz; these helpers translate to and from local clock time.
 */

const PARTS = new Map();
const formatter = (tz) => {
  if (!PARTS.has(tz)) {
    PARTS.set(tz, new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short'
    }));
  }
  return PARTS.get(tz);
};
const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** { date: 'YYYY-MM-DD', minutes: minutes since local midnight, isoDay: 1..7 } for an instant, in `tz`. */
export const localParts = (instant, tz = 'Asia/Kolkata') => {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), isoDay: WEEKDAY[p.weekday] };
};

/** The UTC instant at which local `date` + `minutes` occurs in `tz` (handles zones with no DST and with it). */
export const fromLocal = (date, minutes, tz = 'Asia/Kolkata') => {
  // start from the same wall-clock read as UTC, then correct by the zone's offset at that moment (twice, for DST edges)
  let guess = new Date(`${date}T00:00:00Z`).getTime() + minutes * 60000;
  for (let i = 0; i < 2; i++) {
    const seen = localParts(guess, tz);
    const wanted = Date.parse(`${date}T00:00:00Z`) / 60000 + minutes;
    const got = Date.parse(`${seen.date}T00:00:00Z`) / 60000 + seen.minutes;
    guess += (wanted - got) * 60000;
  }
  return new Date(guess);
};

export const toMinutes = (hhmm) => { const [h, m] = String(hhmm).split(':'); return Number(h) * 60 + Number(m); };
export const toClock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * The window a person works on an ISO weekday: their own hours when set (a null day is a day off), otherwise
 * the outlet's hours on an outlet working day. Returns { start, end } in minutes, or null when not working.
 */
export const workWindow = (staffHours, outlet, isoDay) => {
  if (staffHours && Object.prototype.hasOwnProperty.call(staffHours, String(isoDay))) {
    const w = staffHours[String(isoDay)];
    return w ? { start: toMinutes(w.start), end: toMinutes(w.end) } : null;
  }
  if (!outlet.working_days.includes(isoDay)) return null;
  return { start: toMinutes(outlet.open_time), end: toMinutes(outlet.close_time) };
};

/** Do [aStart, aEnd) and [bStart, bEnd) overlap? Touching ends do not. */
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

/**
 * Start times (minutes) at which `duration` minutes fit inside `window` around the `busy` intervals
 * ([start, end) in minutes), stepping by `step`. `buffer` is the gap kept after every busy interval.
 * `notBefore` drops slots earlier than that (for "today").
 */
export const freeSlots = ({ window, busy, duration, step, buffer = 0, notBefore = 0 }) => {
  if (!window) return [];
  const out = [];
  const first = Math.max(window.start, Math.ceil(notBefore / step) * step);
  for (let t = Math.ceil(first / step) * step; t + duration <= window.end; t += step) {
    if (!busy.some(([s, e]) => overlaps(t, t + duration, s, e + buffer) || overlaps(t, t + duration, s - 0, e))) out.push(t);
  }
  return out;
};
