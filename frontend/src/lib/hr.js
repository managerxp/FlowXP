/* Small helpers for the staff screens: date and time words, the ID choices on the forms. Dates are plain YYYY-MM-DD strings, never shifted by the browser's time zone. */
export { addDays, dateText, longDate, qs, useDebounced, useLoad, toNumber } from './salon.js';

export const ID_TYPES = ['Aadhaar', 'Passport', 'Driving licence', 'Voter ID', 'PAN', 'Other'];

export const timeText = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

export const shortDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
