/*
 * A small durable job queue on Postgres, and the worker loop that runs it.
 *
 * Emails (and anything else slow or fallible) are queued here instead of being
 * sent inside a request, so a mail server outage can never slow or fail a sale.
 * A failed job retries with a growing delay and is marked FAILED after five
 * attempts, with the last error kept for whoever looks.
 *
 * ponytail: Postgres queue polled every 30s from inside the API process. Move to
 * Redis + BullMQ and a separate worker process when job volume or latency
 * demands it — enqueue() and the handlers below are the only seam.
 */
import pool from '../config/database.js';
import { deliverMail } from './mailer.js';
import config from '../config/env.js';

const MAX_ATTEMPTS = 5;
const handlers = new Map();
export const registerHandler = (type, fn) => handlers.set(type, fn);

export const enqueue = async (type, payload = {}, { runAt = null, db = pool } = {}) =>
  (await db.query(`INSERT INTO jobs (type, payload, run_at) VALUES ($1,$2,COALESCE($3, CURRENT_TIMESTAMP)) RETURNING job_id`, [type, JSON.stringify(payload), runAt])).rows[0].job_id;

/** Claim and run every job that is due. Returns how many finished. */
export const runDueJobs = async (limit = 20) => {
  let done = 0;
  for (let i = 0; i < limit; i++) {
    const { rows } = await pool.query(
      `UPDATE jobs SET status = 'RUNNING', locked_at = CURRENT_TIMESTAMP, attempts = attempts + 1
       WHERE job_id = (SELECT job_id FROM jobs WHERE status = 'PENDING' AND run_at <= CURRENT_TIMESTAMP ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING job_id, type, payload, attempts`
    );
    const job = rows[0];
    if (!job) break;
    try {
      const handler = handlers.get(job.type);
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler(job.payload);
      await pool.query(`UPDATE jobs SET status = 'DONE', finished_at = CURRENT_TIMESTAMP, last_error = NULL WHERE job_id = $1`, [job.job_id]);
      done++;
    } catch (error) {
      const finalFailure = job.attempts >= MAX_ATTEMPTS;
      // 1, 4, 9, 16 minutes: a mail server that is down for a while gets several more chances.
      await pool.query(
        `UPDATE jobs SET status = $2::varchar, last_error = $3, run_at = CURRENT_TIMESTAMP + ($4 || ' minutes')::interval, finished_at = CASE WHEN $2::text = 'FAILED' THEN CURRENT_TIMESTAMP END WHERE job_id = $1`,
        [job.job_id, finalFailure ? 'FAILED' : 'PENDING', String(error.message).slice(0, 500), String(job.attempts ** 2)]
      );
      console.error(`[jobs] ${job.type} #${job.job_id} attempt ${job.attempts} failed: ${error.message}`);
    }
  }
  return done;
};

/** A job left RUNNING by a process that died is put back in the queue. */
export const recoverStuckJobs = async () =>
  (await pool.query(`UPDATE jobs SET status = 'PENDING' WHERE status = 'RUNNING' AND locked_at < CURRENT_TIMESTAMP - interval '10 minutes'`)).rowCount;

registerHandler('email', async ({ to, name, subject, title, body, link }) => {
  const url = link ? `${config.appOrigin}${link}` : config.appOrigin;
  await deliverMail({
    to, subject,
    text: [`Hi ${name || 'there'},`, '', title, body ? `\n${body}` : '', '', `Open FlowXP: ${url}`, '', 'You are getting this because of your notification settings in FlowXP. Change them under Notifications.', '', 'FlowXP by ManagerXP'].join('\n')
  });
});

/* ── the worker ───────────────────────────────────────────────────────────── */

let timer = null;
let ticking = false;
const scans = [];
export const registerScan = (scan) => scans.push(scan);

export const tick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    await recoverStuckJobs();
    await runDueJobs();
    for (const scan of scans) await scan();
  } catch (error) {
    console.error('[worker] tick failed:', error.message);   // a failing scan must never take the API down
  } finally {
    ticking = false;
  }
};

export const startWorker = (intervalMs = 30000) => {
  if (timer) return;
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  console.log(`[worker] started (every ${intervalMs / 1000}s)`);
};

export const stopWorker = () => { if (timer) clearInterval(timer); timer = null; };
