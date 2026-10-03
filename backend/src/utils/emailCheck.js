/*
 * Is this email address one a person can actually receive mail at? Checked at sign-up, before an account exists and
 * before any verification code is sent, so a mistyped address is caught on the form instead of leaving the person
 * waiting for a code that can never arrive.
 *
 * Three layers, cheapest first:
 *   1. Typos of the big mailbox providers (gmial.com, gmail.con, yaho.com...): the domain is close to one we know,
 *      so we say "Did you mean ...?". These domains are often registered by someone else and DO accept mail, so only
 *      a name check catches them.
 *   2. The domain's mail records (MX, falling back to a plain address record) must exist. A domain that does not
 *      exist (gmail.co.in typed as gmail.cim, a random word.xyz) can never receive the code.
 *   3. Nothing else can be proven without sending: whether the mailbox itself exists is what the code in the email
 *      is for.
 * A DNS lookup that fails for any reason other than "this domain does not exist" (timeout, resolver trouble) lets the
 * address through: a flaky network must not stop a real customer from signing up. In development and tests the
 * reserved names .test, .local, .localhost, .example and .invalid are accepted unchecked (the demo accounts use them).
 */
import dns from 'node:dns/promises';
import config from '../config/env.js';

const KNOWN = ['gmail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'rediffmail.com', 'proton.me', 'protonmail.com', 'zoho.com'];
const LOOKUP_TIMEOUT_MS = 3000;

/** Edit distance, capped: enough to tell "gmial" from "gmail" without caring about long unrelated names. */
const distance = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
};

/** A well-known provider this domain looks like a typo of, or null. A domain that IS a known provider is fine. */
export const suggestDomain = (domain) => {
  const d = String(domain || '').toLowerCase();
  if (!d || KNOWN.includes(d)) return null;
  let best = null;
  for (const known of KNOWN) {
    const dist = distance(d, known);
    if (dist <= 2 && (!best || dist < best.dist)) best = { known, dist };
  }
  // distance 2 only for a long domain, or "abc.com" would be "corrected" to a real provider every time
  return best && (best.dist === 1 || d.length >= 8) ? best.known : null;
};

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), ms))]);

const NO_SUCH_DOMAIN = new Set(['ENOTFOUND', 'ENODATA']);
const RESERVED = /\.(test|local|localhost|example|invalid)$/;

/** @returns null when the address looks deliverable, else a sentence to show the person. */
export const emailProblem = async (email, { lookup = dns } = {}) => {
  const address = String(email || '').trim().toLowerCase();
  const at = address.lastIndexOf('@');
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (at < 1 || !domain) return 'Enter a valid email address';
  if (/\.\./.test(address) || local.startsWith('.') || local.endsWith('.') || !/^[a-z0-9.-]+$/.test(domain) || domain.startsWith('-') || !domain.includes('.')) {
    return 'That email address does not look right. Check it for typing mistakes.';
  }
  if (!config.isProduction && RESERVED.test(domain)) return null;

  const suggestion = suggestDomain(domain);
  if (suggestion) return `Did you mean ${local}@${suggestion}? "${domain}" does not look like a real email provider.`;

  try {
    const mx = await withTimeout(lookup.resolveMx(domain), LOOKUP_TIMEOUT_MS);
    if (mx?.length) return null;
  } catch (error) {
    if (!NO_SUCH_DOMAIN.has(error.code)) return null;       // resolver trouble: do not block a real signup
  }
  try {
    const records = await withTimeout(lookup.resolve4(domain), LOOKUP_TIMEOUT_MS);   // a domain with no MX receives mail at its address
    if (records?.length) return null;
  } catch (error) {
    if (!NO_SUCH_DOMAIN.has(error.code)) return null;
  }
  return `We could not find "${domain}". Check the part after the @ for typing mistakes, like .con instead of .com.`;
};
