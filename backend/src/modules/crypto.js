/*
 * Shared AES-256-GCM secret encryption, domain-separated: the same key
 * material (derived from JWT_SECRET) produces a different actual key per
 * domain string, so a secret encrypted for one purpose can't be decrypted
 * as another even if the ciphertexts were ever mixed up. modules/security.js's
 * 2FA secrets use domain 'flowxp-2fa' (unchanged, so already-stored secrets
 * keep decrypting); platform settings (payment gateway / messaging keys) use
 * their own domains below.
 */
import crypto from 'node:crypto';
import config from '../config/env.js';

const keyFor = (domain, material) => crypto.createHash('sha256').update(`${domain}:${material}`).digest();

/* v1 = keyed from JWT_SECRET (what existed before); v2 = keyed from ENCRYPTION_KEY. New values use v2 when that key is set, and both kinds always still read. */
export const encrypt = (plain, domain) => {
  const v2 = Boolean(config.encryptionKey);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(domain, v2 ? config.encryptionKey : config.jwtSecret), iv);
  const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `${v2 ? 'v2' : 'v1'}:${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')}`;
};

export const decrypt = (stored, domain) => {
  const text = String(stored);
  const v2 = text.startsWith('v2:');
  if (v2 && !config.encryptionKey) throw new Error('This value needs ENCRYPTION_KEY, which is not set');
  const raw = Buffer.from(text.replace(/^v[12]:/, ''), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', keyFor(domain, v2 ? config.encryptionKey : config.jwtSecret), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
};

/** Is this stored value still on the old (JWT_SECRET) key while an ENCRYPTION_KEY is set? */
export const needsReencrypt = (stored) => Boolean(config.encryptionKey) && !String(stored).startsWith('v2:');
