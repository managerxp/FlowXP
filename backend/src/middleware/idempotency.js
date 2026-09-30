/*
 * Idempotency for money-moving POSTs.
 *
 * A client sends `Idempotency-Key: <uuid>` once per user action and reuses it on
 * a retry. The first request runs and its response is stored; a retry with the
 * same key gets that stored response back instead of writing a second invoice,
 * payment or order. Without the header the request runs as before, so nothing
 * that doesn't send one breaks.
 *
 * ponytail: the key row is marked DONE after the handler's own COMMIT, not
 * inside it. A crash between the two leaves an IN_PROGRESS row, and a retry
 * gets 409 until cleanup rather than a duplicate write — the safe direction.
 * True exactly-once would insert the key inside each handler's transaction.
 */
import crypto from 'node:crypto';
import pool from '../config/database.js';

const defaultScope = (req) => (req.tenant ? `b:${req.tenant.businessId}` : null);

export const idempotent = (scopeOf = defaultScope) => async (req, res, next) => {
  const key = req.get('Idempotency-Key');
  if (!key) return next();
  if (key.length > 128) return res.status(400).json({ success: false, message: 'Idempotency-Key is too long' });

  const scope = scopeOf(req);
  if (!scope) return next();

  const requestHash = crypto.createHash('sha256')
    .update(`${req.method} ${req.originalUrl} ${JSON.stringify(req.body ?? null)}`)
    .digest('hex');

  try {
    const inserted = await pool.query(
      `INSERT INTO idempotency_keys (scope, key, method, path, request_hash, status)
       VALUES ($1,$2,$3,$4,$5,'IN_PROGRESS') ON CONFLICT (scope, key) DO NOTHING RETURNING key`,
      [scope, key, req.method, req.originalUrl, requestHash]
    );

    if (!inserted.rows.length) {
      const { rows } = await pool.query(
        `SELECT request_hash, status, response_status, response_body FROM idempotency_keys WHERE scope = $1 AND key = $2`,
        [scope, key]
      );
      const existing = rows[0];
      if (!existing) return next(); // expired between the two queries; run it fresh
      if (existing.request_hash !== requestHash) {
        return res.status(422).json({ success: false, message: 'This Idempotency-Key was already used for a different request' });
      }
      if (existing.status === 'IN_PROGRESS') {
        return res.status(409).json({ success: false, message: 'This request is already being processed' });
      }
      res.set('Idempotent-Replay', 'true');
      return res.status(existing.response_status).json(existing.response_body);
    }

    pool.query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '48 hours'`).catch(() => {});

    const send = res.json.bind(res);
    res.json = (body) => {
      // 5xx: the write may not have happened, so free the key and let the client retry safely.
      const done = res.statusCode >= 500
        ? pool.query(`DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2`, [scope, key])
        : pool.query(
            `UPDATE idempotency_keys SET status = 'DONE', response_status = $3, response_body = $4 WHERE scope = $1 AND key = $2`,
            [scope, key, res.statusCode, JSON.stringify(body ?? null)]
          );
      done.catch((error) => console.error('[idempotency] store failed:', error.message)).finally(() => send(body));
      return res;
    };
    next();
  } catch (error) {
    console.error('[idempotency] check failed:', error.message);
    next(); // never block a sale because the guard failed
  }
};
