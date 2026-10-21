/*
 * Rate limits that sit on top of the sign-in limits in routes/index.js. nginx already caps requests per address at the edge (deploy/nginx.conf); these are the app's own limits
 * for what an address cannot see:
 *
 *   apiLimiter       a safety net over the whole API, per address and generous, so a lunch rush or a till sending a queue of bills is never throttled. It only stops runaway scripts.
 *   emailLimiter     per email address, so one person's mailbox cannot be flooded with codes from many addresses.
 *   userLimiter(..)  per signed-in person, for the heavy jobs (imports, backup, restore): a stuck script cannot hammer them, a person doing real work never notices.
 *
 * In memory, which is right for one API process (see ecosystem.config.cjs). With more than one, move the store to Redis.
 */
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';

export const limiter = (max, minutes, message, options = {}) => rateLimit({
  windowMs: minutes * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { success: false, message }, ...options
});

const digest = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 24);

/** Who is asking: the sign-in they hold (token or cookie, hashed, never stored raw), else their address. */
export const callerKey = (req) => {
  const credential = req.headers?.authorization || req.headers?.cookie;
  return credential ? `c:${digest(credential)}` : `ip:${req.ip}`;
};
export const emailKey = (req) => `e:${String(req.body?.email ?? '').trim().toLowerCase().slice(0, 254)}`;
export const userKey = (req) => (req.auth?.userId != null ? `u:${req.auth.userId}` : callerKey(req));

/** The whole API, per address: 4,000 a minute (a shop's devices share one address, and nginx already allows about 30 a second). A runaway script is stopped; a lunch rush is not. Health checks and
    the payment provider's callbacks are never limited. Keyed by address only: a made-up cookie or token must not buy a fresh allowance. */
export const apiLimiter = limiter(4000, 1, 'Too many requests. Slow down for a moment.', {
  skip: (req) => req.path === '/health' || req.path === '/ready' || req.path.startsWith('/webhooks/')
});

/** Codes sent to one mailbox: sign-up codes, resends and password resets share the allowance. */
export const emailLimiter = limiter(4, 60, 'Too many codes were asked for that email. Try again in an hour.', { keyGenerator: emailKey });

/** A heavy job per signed-in person. */
export const userLimiter = (max, minutes, message) => limiter(max, minutes, message, { keyGenerator: userKey });
export const importLimiter = userLimiter(30, 10, 'Too many imports in a short time. Wait a few minutes and try again.');
export const bulkLimiter = userLimiter(20, 60, 'That was done a few times already. Try again later.');
export const backupLimiter = userLimiter(10, 60, 'Too many backups were asked for. Try again later.');
export const restoreLimiter = userLimiter(5, 60, 'Too many restores were tried. Try again later.');
