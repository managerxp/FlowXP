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

const keyFor = (domain) => crypto.createHash('sha256').update(`${domain}:${config.jwtSecret}`).digest();

export const encrypt = (plain, domain) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(domain), iv);
  const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')}`;
};

export const decrypt = (stored, domain) => {
  const raw = Buffer.from(String(stored).replace(/^v1:/, ''), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', keyFor(domain), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
};
