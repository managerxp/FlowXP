/*
 * WhatsApp credit. A business on a paid plan spends from a rupee wallet the Super Admin tops up: each WhatsApp message
 * that Meta accepted costs the price of its category (what Meta charges plus FlowXP's margin, set in Settings, Messaging).
 * Nothing changes until the Super Admin switches "Wallet required" on. Trials keep their free message count, sign-in
 * codes are never charged, and a failed message costs nothing.
 */
import { getPlatformSetting } from '../platformSettings.js';
import { TEMPLATES } from './templates.js';

export const FREE_KINDS = ['OTP'];
export const DEFAULT_LOW_ALERT_RUPEES = 100;   // the owner is told when credit falls to this; Settings, Messaging can change it
export const DEFAULT_PRICES = { UTILITY: 0.15, AUTHENTICATION: 0.15, MARKETING: 0.9 };   // rupees a message; Settings, Messaging can change them

/** The category Meta bills a kind of message under. */
export const categoryOf = (kind) => {
  const t = TEMPLATES[kind];
  if (!t) return 'UTILITY';
  if (t.promo) return 'MARKETING';
  return kind === 'OTP' || /_OTP$/.test(kind) ? 'AUTHENTICATION' : 'UTILITY';
};

const paise = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) : Math.round(fallback * 100); };

/** { required, prices: { UTILITY, AUTHENTICATION, MARKETING } in paise } from the Super Admin's settings. */
export const walletSettings = async () => {
  const v = (await getPlatformSetting('messaging').catch(() => null))?.value || {};
  const utility = paise(v.rateUtility, DEFAULT_PRICES.UTILITY);
  const low = Number(v.lowCreditAlert);
  return { required: v.walletRequired === 'on', lowAlert: Math.round((Number.isFinite(low) && low >= 0 ? low : DEFAULT_LOW_ALERT_RUPEES) * 100), prices: { UTILITY: utility, AUTHENTICATION: utility, MARKETING: paise(v.rateMarketing, DEFAULT_PRICES.MARKETING) } };
};

export const balanceOf = async (db, businessId) => Number((await db.query(`SELECT wallet_paise FROM businesses WHERE business_id = $1`, [businessId])).rows[0]?.wallet_paise ?? 0);

/** { cost, balance } when this message is paid from the wallet, else null (switched off, a trial, or a free kind). */
export const gate = async (db, businessId, kind) => {
  if (FREE_KINDS.includes(kind)) return null;
  const s = await walletSettings();
  if (!s.required) return null;
  const b = (await db.query(`SELECT subscription_status, wallet_paise FROM businesses WHERE business_id = $1`, [businessId])).rows[0];
  if (!b || b.subscription_status === 'TRIAL') return null;
  return { cost: s.prices[categoryOf(kind)], balance: Number(b.wallet_paise) };
};

/** Add (or, with a negative amount, take back) credit and record it. Returns the new balance. */
export const adjust = async (db, businessId, amountPaise, { kind = 'TOPUP', note = null, messageId = null, by = null } = {}) => {
  const r = await db.query(`UPDATE businesses SET wallet_paise = wallet_paise + $2 WHERE business_id = $1 RETURNING wallet_paise`, [businessId, amountPaise]);
  if (!r.rows.length) return null;
  const after = Number(r.rows[0].wallet_paise);
  await db.query(`INSERT INTO wallet_ledger (business_id, amount_paise, kind, message_id, note, balance_after_paise, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [businessId, amountPaise, kind, messageId, note, after, by]);
  return after;
};

/** Tell the business's owner once, the moment the balance falls to the alert level (or to nothing). Never breaks a send. */
export const alertIfLow = async (db, businessId, before, after, s) => {
  const empty = before > 0 && after <= 0;
  const low = !empty && s.lowAlert > 0 && before > s.lowAlert && after <= s.lowAlert;
  if (!empty && !low) return;
  try {
    const { notify } = await import('../notifications.js');
    const left = Math.max(0, Math.floor(after / (s.prices.UTILITY || 1)));
    const day = new Date().toISOString().slice(0, 10);
    await notify(businessId, empty
      ? { category: 'credit', type: 'credit_empty', severity: 'critical', title: 'WhatsApp credit has run out', body: 'Bills and messages to your customers are on hold. Ask FlowXP to load more credit.', dedupeKey: `credit-empty-${day}`, route: 'messaging', urgent: true }
      : { category: 'credit', type: 'credit_low', severity: 'warning', title: 'WhatsApp credit is running low', body: `About ${left} messages left (₹${(after / 100).toFixed(2)}). Ask FlowXP to load more credit before it runs out.`, dedupeKey: `credit-low-${day}`, route: 'messaging' }, db);
  } catch (e) { console.warn('[wallet] low-credit alert failed:', e.message); }
};

/** Called once a message was accepted by Meta: take its price from the wallet. */
export const chargeMessage = async (db, row) => {
  if (row.channel !== 'WHATSAPP' || row.status !== 'SENT') return;
  const g = await gate(db, row.business_id, row.kind);
  if (!g || g.cost <= 0) return;
  const after = await adjust(db, row.business_id, -g.cost, { kind: 'MESSAGE', messageId: row.message_id, note: row.kind });
  if (after !== null) await alertIfLow(db, row.business_id, g.balance, after, await walletSettings());
  await db.query(`UPDATE messages SET charge_paise = $2 WHERE message_id = $1`, [row.message_id, g.cost]);
};
