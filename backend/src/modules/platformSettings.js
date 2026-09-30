/*
 * Generic key-value store for platform config that should be admin-editable
 * instead of env-only (owner's request, 2026-09-29): which payment gateway is
 * live and its keys, and which email/SMS/WhatsApp provider is live and its
 * credentials. Read at call time, not cached — these are low-frequency calls
 * (a payment link here, a webhook there), so a cache and its invalidation
 * would cost more than they save.
 *
 * Each setting's value is a plain object. SECRET_FIELDS below names which of
 * a setting's keys are encrypted at rest (modules/crypto.js, one domain per
 * setting key so a leaked payment-gateway secret can't be replayed as a
 * messaging one). A setting with no secret fields listed round-trips as-is.
 */
import pool from '../config/database.js';
import { encrypt, decrypt } from './crypto.js';

const SECRET_FIELDS = {
  payment_gateway: ['cashfreeSecretKey'],
  email: ['smtpPass'],
  messaging: ['whatsappToken', 'twilioToken']
};

const domain = (key) => `flowxp-platform-setting:${key}`;

const encryptFields = (key, value) => {
  const out = { ...value };
  for (const f of SECRET_FIELDS[key] || []) if (out[f]) out[f] = encrypt(out[f], domain(key));
  return out;
};

const decryptFields = (key, value) => {
  const out = { ...value };
  for (const f of SECRET_FIELDS[key] || []) {
    if (!out[f]) continue;
    try { out[f] = decrypt(out[f], domain(key)); } catch { out[f] = ''; } // corrupt/foreign ciphertext: fail closed, not crash
  }
  return out;
};

/** `{ value, updatedAt }` with secrets decrypted, or null when nothing has been saved for this key yet. */
export const getPlatformSetting = async (key) => {
  const { rows } = await pool.query(`SELECT value, updated_at FROM platform_settings WHERE setting_key = $1`, [key]);
  if (!rows.length) return null;
  return { value: decryptFields(key, rows[0].value), updatedAt: rows[0].updated_at };
};

/** Same, with every secret field replaced by a placeholder — what the admin UI reads, since a saved secret is never sent back to the browser. */
export const getPlatformSettingMasked = async (key) => {
  const setting = await getPlatformSetting(key);
  if (!setting) return null;
  const masked = { ...setting.value };
  for (const f of SECRET_FIELDS[key] || []) masked[f] = masked[f] ? '••••••••' : '';
  return { value: masked, updatedAt: setting.updatedAt };
};

/**
 * Merge `patch` into the setting's current value and save it. A blank/missing
 * secret field in `patch` keeps the existing secret rather than wiping it —
 * the admin UI always sends '' for a secret field the person didn't retype.
 */
export const setPlatformSetting = async (key, patch, userId) => {
  const existing = (await getPlatformSetting(key))?.value || {};
  const merged = { ...existing, ...patch };
  for (const f of SECRET_FIELDS[key] || []) if (!patch[f]) merged[f] = existing[f] || '';
  await pool.query(
    `INSERT INTO platform_settings (setting_key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (setting_key) DO UPDATE SET value = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP`,
    [key, JSON.stringify(encryptFields(key, merged)), userId]
  );
  return getPlatformSettingMasked(key);
};
