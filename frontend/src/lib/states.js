/*
 * Country and first-level-subdivision data for address forms — sourced from
 * country-region-data (MIT, no API key, no network call, bundled JSON), not a
 * hand-typed list. It covers all ~249 countries with their real regions:
 * states for India and the US, provinces for Canada, counties for the UK, and
 * so on — each with its own ISO 3166-2-style short code. India's 36 entries
 * are the exact same 36 states/UTs backend/src/modules/gst/states.js's
 * STATE_CODES already keys on, so a name picked here always resolves to a
 * GST state code later; modules/geo/pincode.js round-trips through the same
 * table so a PIN-filled state matches one of these options exactly.
 *
 * A country's first-level division is not always called "State" — this file
 * also carries the right word for the ones FlowXP is likely to see, so a form
 * can ask "Province" for Canada rather than "State" for everyone.
 */
import countryRegionData from 'country-region-data/data.json';

/** [{ countryName, countryShortCode, regions: [{ name, shortCode }] }, …] for every country. */
export const COUNTRY_REGION_DATA = countryRegionData;

export const COUNTRIES = countryRegionData.map((c) => c.countryName).sort((a, b) => a.localeCompare(b));

/** The regions (states/provinces/counties/…) for one country by name, or []
    when that country has none worth asking about (e.g. a city-state). */
export const regionsFor = (countryName) => COUNTRY_REGION_DATA.find((c) => c.countryName === countryName)?.regions ?? [];

/* What to call a country's first administrative level. Default 'State' covers India, the US and
   most of the rest fairly naturally; only the countries where that reads oddly get their own word. */
const SUBDIVISION_LABEL = {
  'United Kingdom': 'County', Canada: 'Province', Ireland: 'County', Japan: 'Prefecture', 'South Korea': 'Province',
  France: 'Region', Germany: 'State', Italy: 'Region', Spain: 'Province', China: 'Province', Netherlands: 'Province'
};
export const subdivisionLabel = (countryName) => SUBDIVISION_LABEL[countryName] || 'State';
