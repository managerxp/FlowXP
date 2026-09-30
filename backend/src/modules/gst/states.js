/*
 * GST state codes. The first two digits of a GSTIN are the state code, so for a registered party the GSTIN says
 * where they are; for everyone else the state name is matched against this table.
 */
export const STATE_CODES = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', punjab: '03', chandigarh: '04', uttarakhand: '05', haryana: '06', delhi: '07',
  rajasthan: '08', 'uttar pradesh': '09', bihar: '10', sikkim: '11', 'arunachal pradesh': '12', nagaland: '13', manipur: '14',
  mizoram: '15', tripura: '16', meghalaya: '17', assam: '18', 'west bengal': '19', jharkhand: '20', odisha: '21', chhattisgarh: '22',
  'madhya pradesh': '23', gujarat: '24', 'dadra and nagar haveli and daman and diu': '26', maharashtra: '27', 'andhra pradesh': '37',
  karnataka: '29', goa: '30', lakshadweep: '31', kerala: '32', 'tamil nadu': '33', puducherry: '34', 'andaman and nicobar islands': '35',
  telangana: '36', ladakh: '38'
};

const ALIASES = {
  orissa: 'odisha', pondicherry: 'puducherry', 'j&k': 'jammu and kashmir', 'jammu & kashmir': 'jammu and kashmir', uttaranchal: 'uttarakhand',
  'nct of delhi': 'delhi', 'new delhi': 'delhi', 'daman and diu': 'dadra and nagar haveli and daman and diu', 'dadra and nagar haveli': 'dadra and nagar haveli and daman and diu',
  'andaman & nicobar islands': 'andaman and nicobar islands', 'a&n islands': 'andaman and nicobar islands'
};

export const stateName = (code) => Object.entries(STATE_CODES).find(([, c]) => c === code)?.[0] ?? null;

const clean = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** 2-digit code from a state name, or null when it isn't recognised. A two-digit string is taken as a code already. */
export const stateCode = (name) => {
  const n = clean(name);
  if (!n) return null;
  if (/^\d{2}$/.test(n)) return n;
  return STATE_CODES[ALIASES[n] ?? n] ?? null;
};

/** The state a GSTIN belongs to (its first two digits), or null when it doesn't look like one. */
export const gstinState = (gstin) => {
  const g = String(gstin ?? '').trim().toUpperCase();
  return /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][\dA-Z]$/.test(g) ? g.slice(0, 2) : null;
};

/** Place of supply for a buyer: their GSTIN's state, else their stated state. */
export const placeOfSupply = (gstin, state) => gstinState(gstin) ?? stateCode(state);

/** Unit of measure as the GST portals name it. */
const UQC = { pc: 'NOS', pcs: 'NOS', piece: 'NOS', nos: 'NOS', unit: 'UNT', kg: 'KGS', g: 'GMS', gm: 'GMS', l: 'LTR', litre: 'LTR', liter: 'LTR', ml: 'MLT', box: 'BOX', pack: 'PAC', dozen: 'DOZ', m: 'MTR', plate: 'NOS', serve: 'NOS', portion: 'NOS' };
export const uqc = (unit) => UQC[clean(unit)] ?? 'OTH';

/** dd-mm-yyyy (GSTR-1) or dd/mm/yyyy (e-invoice, e-way bill) from a date or ISO string. */
export const ddmmyyyy = (date, sep = '-') => {
  const iso = date instanceof Date ? date.toISOString() : String(date);
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}${sep}${m}${sep}${y}`;
};

/** Money for the portals: rupees to 2 decimals, as a number. */
export const rs = (paise) => Math.round(Number(paise)) / 100;
