/*
 * Google Wallet passes for loyalty cards.
 *
 * STATUS: written against Google's published Wallet API shapes and unit tested with a locally made key, but NOT yet tested against Google itself, because that needs
 * the business's own Google Pay & Wallet Console issuer account. Until it is switched on with real credentials and a pass has been saved on a real phone, treat it
 * as untested. Whether Google issues loyalty passes for Indian businesses must be checked in that console too: nothing here assumes it.
 *
 * It is off unless both are set on the server:
 *   GOOGLE_WALLET_ISSUER_ID            the issuer id shown in the console
 *   GOOGLE_WALLET_SERVICE_ACCOUNT      path to the service account's JSON key file (or GOOGLE_WALLET_SERVICE_ACCOUNT_JSON: the JSON itself)
 *
 * "Add to Google Wallet" needs no call to Google: the pass (class and object) travels inside a signed link (JWT). Keeping a saved pass's balance current needs
 * the REST API, so a change to a member's balance is pushed best-effort; a failure there is logged and never fails a sale or a stamp.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import pool from '../config/database.js';
import config from '../config/env.js';

const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
const ID = /^[A-Za-z0-9_.-]+$/;

let cached = null;
/** The service account, or null when Google Wallet is not set up. Read once. */
export const account = () => {
  if (cached !== null) return cached || null;
  try {
    const raw = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON || (process.env.GOOGLE_WALLET_SERVICE_ACCOUNT ? fs.readFileSync(process.env.GOOGLE_WALLET_SERVICE_ACCOUNT, 'utf8') : '');
    const key = raw ? JSON.parse(raw) : null;
    const issuerId = String(process.env.GOOGLE_WALLET_ISSUER_ID || '').trim();
    cached = key?.client_email && key?.private_key && ID.test(issuerId) ? { issuerId, email: key.client_email, privateKey: key.private_key } : false;
  } catch (e) { console.error('[wallet] Google Wallet key could not be read:', e.message); cached = false; }
  return cached || null;
};
export const configured = () => Boolean(account());
/** For tests: forget the cached key so a changed environment is read again. */
export const resetForTests = () => { cached = null; token = null; };

export const sign = (payload, privateKey) => {
  const head = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${head}.${crypto.createSign('RSA-SHA256').update(head).sign(privateKey).toString('base64url')}`;
};

const classSuffix = (programmeId) => `fx_programme_${programmeId}`;
const objectSuffix = (membershipId) => `fx_member_${membershipId}`;
const stampLike = (kind) => kind === 'STAMPS' || kind === 'VISITS';

/** Google needs a public https address for the logo. The business's own logo when it has one, else FlowXP's. */
const logoUri = (logo) => (/^https:\/\//i.test(String(logo || '')) ? logo : `${config.appOrigin.replace(/\/$/, '')}/icon-512.png`);

/** The pass for one membership, as Google's loyaltyClass and loyaltyObject. `m` carries the membership, programme, customer and business fields (see loadMembership). */
export const passFor = (m, a = account()) => {
  const card = m.card || {};
  const origin = config.appOrigin.replace(/\/$/, '');
  const unit = stampLike(m.kind) ? 'Stamps' : 'Points';
  const loyaltyClass = {
    id: `${a.issuerId}.${classSuffix(m.programme_id)}`,
    issuerName: String(m.business_name).slice(0, 40),
    programName: String(card.title || m.programme_name).slice(0, 40),
    programLogo: { sourceUri: { uri: logoUri(m.logo_url || m.business_logo) }, contentDescription: { defaultValue: { language: 'en-US', value: String(m.business_name).slice(0, 60) } } },
    hexBackgroundColor: /^#[0-9a-f]{6}$/i.test(card.bg || '') ? card.bg : '#0f766e',
    countryCode: 'IN',
    reviewStatus: 'UNDER_REVIEW'
  };
  const loyaltyObject = {
    id: `${a.issuerId}.${objectSuffix(m.membership_id)}`,
    classId: loyaltyClass.id,
    state: 'ACTIVE',
    accountId: m.membership_no,
    accountName: m.customer_name,
    loyaltyPoints: { label: unit, balance: { int: Number(m.balance) || 0 } },
    barcode: { type: 'QR_CODE', value: `${origin}/card/${m.token}`, alternateText: m.membership_no },
    ...(card.message ? { textModulesData: [{ id: 'message', header: 'Message', body: String(card.message).slice(0, 140) }] } : {}),
    linksModuleData: { uris: [{ id: 'card', description: 'Your card', uri: `${origin}/card/${m.token}` }] }
  };
  return { loyaltyClass, loyaltyObject };
};

/** The "Add to Google Wallet" address for a membership: a link signed with the service account. */
export const saveUrl = (m) => {
  const a = account();
  if (!a) return null;
  const { loyaltyClass, loyaltyObject } = passFor(m, a);
  const jwt = sign({ iss: a.email, aud: 'google', typ: 'savetowallet', iat: Math.floor(Date.now() / 1000), origins: [config.appOrigin.replace(/\/$/, '')], payload: { loyaltyClasses: [loyaltyClass], loyaltyObjects: [loyaltyObject] } }, a.privateKey);
  return `https://pay.google.com/gp/v/save/${jwt}`;
};

export const loadMembership = async (db, where, params) => (await db.query(
  `SELECT m.membership_id, m.programme_id, m.membership_no, m.token, c.name AS customer_name, p.name AS programme_name, p.kind, p.card, p.logo_url,
          b.name AS business_name, b.receipt_settings->>'logo_url' AS business_logo,
          COALESCE((SELECT SUM(points) FROM points_ledger l WHERE l.membership_id = m.membership_id AND l.voided_at IS NULL), 0)::int AS balance
   FROM loyalty_memberships m JOIN customers c ON c.customer_id = m.customer_id JOIN loyalty_programmes p ON p.programme_id = m.programme_id JOIN businesses b ON b.business_id = m.business_id
   WHERE ${where}`, params)).rows;

/* ── keeping a saved pass current ─────────────────────────────────────── */
let token = null;
const accessToken = async (a) => {
  if (token && token.until > Date.now() + 60000) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const assertion = sign({ iss: a.email, scope: 'https://www.googleapis.com/auth/wallet_object.issuer', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }, a.privateKey);
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Google sign-in failed (${res.status})`);
  token = { value: body.access_token, until: Date.now() + (Number(body.expires_in) || 3000) * 1000 };
  return token.value;
};

/** After a bill: refresh the passes of every programme this customer is in. Fire and forget; does nothing at all when Google Wallet is not set up. */
export const pushForCustomer = (customerId) => {
  if (!account() || !customerId) return;
  pool.query(`SELECT membership_id FROM loyalty_memberships WHERE customer_id = $1`, [customerId]).then((r) => pushBalance(r.rows.map((x) => x.membership_id))).catch(() => {});
};

/** Pushes the member's current balance to the pass they saved. A member who never saved one is a 404 from Google, which is fine. Never throws. */
export const pushBalance = async (membershipIds) => {
  const a = account();
  if (!a || !membershipIds?.length) return;
  try {
    const bearer = await accessToken(a);
    for (const m of await loadMembership(pool, 'm.membership_id = ANY($1::int[])', [membershipIds])) {
      const { loyaltyObject } = passFor(m, a);
      const res = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(loyaltyObject.id)}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ loyaltyPoints: loyaltyObject.loyaltyPoints })
      });
      if (!res.ok && res.status !== 404) console.error('[wallet] Google balance update refused:', res.status);
    }
  } catch (e) { console.error('[wallet] Google balance update failed:', e.message); }
};
