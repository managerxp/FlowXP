/*
 * Input validation at the trust boundary.
 *
 * Small and explicit rather than a schema library: every rule here is one
 * readable line, and there are few enough of them that a dependency would add
 * more surface than it removes. If the rule count triples, swap this for zod.
 *
 * Each validator returns an error string or null, so a route reads as a list
 * of checks and the first failure is the message the user sees.
 */

/* Deliberately permissive. Strict RFC 5322 regexes reject real addresses, and
   the only check that actually proves an address works is sending to it. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normaliseEmail = (value) => String(value ?? '').trim().toLowerCase();

export const checkEmail = (value) =>
  EMAIL.test(normaliseEmail(value)) ? null : 'Enter a valid email address';

export const checkName = (value, field = 'Name') => {
  const v = String(value ?? '').trim();
  if (v.length < 2) return `${field} is too short`;
  if (v.length > 120) return `${field} is too long`;
  return null;
};

/*
 * Length over composition rules.
 *
 * Forcing a symbol and a digit reliably produces "Password1!" — memorable to
 * an attacker's wordlist and to nobody else. Eight characters is the floor
 * that keeps bcrypt's work factor meaningful.
 */
export const checkPassword = (value) => {
  const v = String(value ?? '');
  if (v.length < 8) return 'Password must be at least 8 characters';
  if (v.length > 200) return 'Password is too long';
  return null;
};

/* Indian mobile numbers with an optional country code, plus room for landlines.
   Optional everywhere it is used — a signup that fails on a phone number the
   user could have skipped is a lost customer. */
export const checkPhone = (value) => {
  if (value == null || String(value).trim() === '') return null;
  const v = String(value).replace(/[\s-]/g, '');
  return /^\+?\d{7,15}$/.test(v) ? null : 'Enter a valid phone number';
};

/* 15 characters: 2 state + 10 PAN + 1 entity + 1 'Z' + 1 checksum. Format only
   — confirming a GSTIN is real needs the GSTN API, which V1 does not call. */
export const checkGstin = (value) => {
  if (value == null || String(value).trim() === '') return null;
  const v = String(value).trim().toUpperCase();
  return /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][\dA-Z]$/.test(v)
    ? null
    : 'Enter a valid 15-character GSTIN';
};

/* A UPI VPA is "handle@bank" — e.g. "shopname@okhdfcbank". Format only, same
   reasoning as checkGstin: confirming it actually resolves needs a real UPI
   provider call, which this never makes — see businesses.upi_vpa. */
export const checkUpiVpa = (value) => {
  if (value == null || String(value).trim() === '') return null;
  return /^[\w.-]{2,256}@[a-zA-Z][\w.-]{1,64}$/.test(String(value).trim())
    ? null
    : 'Enter a valid UPI ID, e.g. shopname@okhdfcbank';
};

export const BUSINESS_TYPES = [
  'RESTAURANT', 'CAFE', 'RETAIL', 'SUPERMARKET', 'PHARMACY', 'SALON',
  'SERVICES', 'ELECTRONICS', 'CLOTHING', 'GAMING_CAFE', 'RACING',
  'WHOLESALE', 'DISTRIBUTOR', 'OTHER'
];

export const checkBusinessType = (value) =>
  BUSINESS_TYPES.includes(String(value ?? '').toUpperCase())
    ? null
    : 'Choose a business type';

/**
 * Run a list of [value, validator] pairs and return the first failure.
 * Returns null when everything passes.
 */
export const firstError = (checks) => {
  for (const error of checks) {
    if (error) return error;
  }
  return null;
};
