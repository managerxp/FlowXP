/* Where a visit happened: the small decisions, kept apart from the phone's location service so they can be tested. */

/** A place the phone worked out recently is good enough for a visit; an old one is not. */
export const freshEnough = (takenAt: number, now: number, maxAgeMs = 120000): boolean => now - takenAt >= 0 && now - takenAt <= maxAgeMs;

/** Six decimals is about a tenth of a metre: more than a visit needs, and no more than the server keeps. */
export const rounded = (n: number): number => Math.round(n * 1e6) / 1e6;

export const place = (lat: number, lng: number): { lat: number; lng: number } | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: rounded(lat), lng: rounded(lng) } : null;

/** Whether this business records where visits happen: kept as '1' or '0' on the phone; unknown means no, so nothing is asked of the phone until the business has said yes. */
export const settingOn = (kept: string | null): boolean => kept === '1';

/** Give up after this long rather than keep a rep waiting at a shop door. */
export const withinMs = <T>(work: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => { const timer = setTimeout(() => resolve(null), ms); work.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(null); }); });
