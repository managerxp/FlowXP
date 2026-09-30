/*
 * India PIN code lookup — a real reference dataset (india-pincode: India
 * Post's own post office directory, ~165k offices / ~19,500 PIN codes across
 * all 36 states and UTs), not a hand-typed table. The package loads its data
 * from a local file synchronously on first use and caches it in memory —
 * no network call, so a lookup never depends on the pincode arriving before
 * some other server, and it works exactly the same in every environment.
 *
 * Every state/district name the dataset returns is run through the same
 * gst/states.js alias table already used for GST state codes ("NCT OF DELHI",
 * "Orissa", "Pondicherry" all resolve the same way there and here), so a
 * customer's PIN-filled state always matches the state a dropdown built from
 * lib/states.js would offer for the same place — one canonical name, not two
 * near-identical ones.
 */
import { createRequire } from 'node:module';
import { stateCode, stateName } from '../gst/states.js';

// india-pincode's ESM build references __dirname (a CommonJS-only global) to locate its bundled
// data file, so `import ... from 'india-pincode'` throws under Node's native ESM — a bug in the
// package's build, not ours. Its CJS build has no such problem, so load that one directly.
const { getIndiaPincode } = createRequire(import.meta.url)('india-pincode');

let pin = null;
const load = () => { pin ??= getIndiaPincode(); return pin; };

// Capitalises each word except a short connector list, so "dadra and nagar haveli and
// daman and diu" reads the way the state actually spells itself, matching lib/states.js
// (frontend) exactly rather than "Dadra And Nagar Haveli And Daman And Diu".
const LOWERCASE_WORDS = new Set(['and', 'of']);
const titleCase = (v) => String(v ?? '').toLowerCase().split(' ')
  .map((word, i) => (i > 0 && LOWERCASE_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
  .join(' ');

/**
 * @param {string} code a 6-digit Indian PIN code
 * @returns {{ pincode, city, district, state, country } | null} null when the
 *   code is not 6 digits or not in the dataset — never a guessed result.
 */
export const resolvePincode = (code) => {
  const cleaned = String(code ?? '').trim();
  if (!/^[1-9]\d{5}$/.test(cleaned)) return null;

  const result = load().getPincodeSummary(cleaned);
  if (!result.success) return null;

  const canonical = stateName(stateCode(result.data.state)) ?? result.data.state.toLowerCase();
  // The first delivery area is usually the locality the PIN is best known by (e.g. "Hyderabad" for 500001);
  // the district is the safer fallback when a PIN covers several small, unfamiliar-sounding areas.
  const area = result.data.areas[0]?.area;

  return {
    pincode: result.data.pincode,
    city: titleCase(area || result.data.district),
    district: titleCase(result.data.district),
    state: titleCase(canonical),
    country: 'India'
  };
};
