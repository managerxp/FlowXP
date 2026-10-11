/* Shared by the hotel screens: words for statuses, the choices on the forms, and small date helpers. The hotel's own date (its "business date") comes from the
   server; the dates here are plain YYYY-MM-DD strings, never shifted by the browser's time zone. */
import { addDays } from './salon.js';

export { addDays, dateText, longDate, qs, useDebounced, useLoad, toNumber } from './salon.js';

export const nightsBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

export const BOOKING_STATUS = {
  CONFIRMED: { label: 'Booked', tone: 'brand' }, CHECKED_IN: { label: 'In the hotel', tone: 'success' }, CHECKED_OUT: { label: 'Checked out', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' }, NO_SHOW: { label: 'No-show', tone: 'warning' }
};

export const HK_STATUS = {
  CLEAN: { label: 'Clean', tone: 'success' }, DIRTY: { label: 'Dirty', tone: 'warning' }, INSPECTED: { label: 'Inspected', tone: 'brand' }, OUT_OF_ORDER: { label: 'Out of order', tone: 'danger' }
};

/* How a room looks on the rack: whether anyone is in it, and what it needs. */
export const OCCUPANCY = {
  OCCUPIED: { label: 'Occupied', cell: 'border-success/40 bg-success/10' }, DUE_OUT: { label: 'Due out', cell: 'border-warning/50 bg-warning/10' },
  ARRIVING: { label: 'Arriving', cell: 'border-brand-500/40 bg-brand-50' }, VACANT: { label: 'Vacant', cell: 'border-line bg-surface' }
};

export const SOURCES = [
  ['WALK_IN', 'Walk-in'], ['PHONE', 'Phone'], ['EMAIL', 'Email'], ['WEBSITE', 'Own website'], ['CORPORATE', 'Company'], ['TRAVEL_AGENT', 'Travel agent'],
  ['BOOKING_COM', 'Booking.com'], ['MAKEMYTRIP', 'MakeMyTrip'], ['GOIBIBO', 'Goibibo'], ['AGODA', 'Agoda'], ['EXPEDIA', 'Expedia'], ['AIRBNB', 'Airbnb'], ['OTHER', 'Other']
];
export const sourceName = (code) => SOURCES.find(([c]) => c === code)?.[1] || code;

export const METHODS = [['CASH', 'Cash'], ['UPI', 'UPI'], ['CARD', 'Card'], ['BANK_TRANSFER', 'Bank transfer'], ['CHEQUE', 'Cheque'], ['CREDIT', 'Bill to company'], ['OTHER', 'Other']];
export const methodName = (code) => METHODS.find(([c]) => c === code)?.[1] || code;

export const DEPARTMENTS = [['LAUNDRY', 'Laundry'], ['FNB', 'Food and drink'], ['SPA', 'Spa'], ['TRANSPORT', 'Transport'], ['BANQUET', 'Banquet'], ['MISC', 'Other'], ['ROOM', 'Room']];
export const departmentName = (code) => ({ ...Object.fromEntries(DEPARTMENTS), RESTAURANT: 'Restaurant' })[code] || code;

export const MEAL_PLANS = [['EP', 'Room only'], ['CP', 'With breakfast'], ['MAP', 'Breakfast and one meal'], ['AP', 'All meals']];

export const ID_TYPES = ['Aadhaar', 'Passport', 'Driving licence', 'Voter ID', 'PAN', 'Other'];

export const timeText = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

export const rangeText = (from, to) => {
  const f = new Date(`${from}T00:00:00Z`); const t = new Date(`${to}T00:00:00Z`);
  const o = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return `${f.toLocaleDateString('en-IN', o)} to ${t.toLocaleDateString('en-IN', { ...o, year: 'numeric' })}`;
};

export const shortDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
export const monthDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const isWeekend = (iso) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());

export const monthStart = (iso) => `${iso.slice(0, 8)}01`;

/* ── banquet ───────────────────────────────────────────────────────────── */

export const EVENT_STATUS = {
  ENQUIRY: { label: 'Enquiry', tone: 'neutral' }, TENTATIVE: { label: 'Held', tone: 'warning' }, CONFIRMED: { label: 'Confirmed', tone: 'brand' },
  COMPLETED: { label: 'Completed', tone: 'success' }, CANCELLED: { label: 'Cancelled', tone: 'danger' }
};
export const EVENT_TYPES = [['WEDDING', 'Wedding'], ['RECEPTION', 'Reception'], ['ENGAGEMENT', 'Engagement'], ['BIRTHDAY', 'Birthday'], ['CORPORATE', 'Corporate event'], ['CONFERENCE', 'Conference'], ['PARTY', 'Party'], ['OTHER', 'Other']];
export const eventTypeName = (c) => EVENT_TYPES.find(([k]) => k === c)?.[1] || c;
export const SETUP_STYLES = [['BANQUET_ROUNDS', 'Round tables'], ['THEATRE', 'Theatre rows'], ['CLASSROOM', 'Classroom'], ['U_SHAPE', 'U-shape'], ['COCKTAIL', 'Cocktail, standing'], ['BOARDROOM', 'Boardroom'], ['OTHER', 'Other']];
export const setupName = (c) => SETUP_STYLES.find(([k]) => k === c)?.[1] || c;
export const CHARGE_CATEGORIES = [['HALL', 'Hall'], ['FOOD', 'Food and drink'], ['DECOR', 'Decor and flowers'], ['AV', 'Sound and lights'], ['ROOMS', 'Guest rooms'], ['OTHER', 'Other']];
export const chargeCategory = (c) => CHARGE_CATEGORIES.find(([k]) => k === c)?.[1] || c;
export const DIETS = [['VEG', 'Vegetarian'], ['NON_VEG', 'Non-vegetarian'], ['JAIN', 'Jain'], ['MIXED', 'Veg and non-veg']];
export const hhmm = (t) => String(t || '').slice(0, 5);
