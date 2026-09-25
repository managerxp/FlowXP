/*
 * FlowXP API server.
 *
 * A JSON API, plus the one static exception: uploaded product photos (see
 * middleware/upload.js) live on this server's own local disk under
 * /uploads, since there is no object storage service configured yet. The
 * browser app itself is still a separate Vite build served from its own
 * origin — this process returns no page HTML for a CSP to govern, only JSON
 * and the occasional image file.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';
import config from './src/config/env.js';
import pool, { initializeDatabase } from './src/config/database.js';
import { ensureSuperAdmin } from './src/config/seedSuperAdmin.js';
import routes from './src/routes/index.js';
import './src/modules/scans.js';
import { startWorker, stopWorker } from './src/modules/jobs.js';

const app = express();

/* Behind a load balancer (Render, Railway, nginx) every request arrives from
   the proxy. Without this, express-rate-limit sees one client address for the
   whole internet and locks everybody out together. */
if (config.isProduction) app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));

/* One line of JSON per request: an id (also returned to the client, so a user can quote it in a
   support message), the route, status and duration. No bodies, no tokens, no query strings. */
app.use((req, res, next) => {
  const id = crypto.randomBytes(6).toString('hex');
  const started = process.hrtime.bigint();
  res.set('X-Request-Id', id);
  res.on('finish', () => {
    if (req.path === '/health' || req.path === '/ready') return;
    if (!config.isProduction && res.statusCode < 400) return;   // quiet in development unless something is wrong
    console.log(JSON.stringify({ t: new Date().toISOString(), id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6) }));
  });
  next();
});

/*
 * CORS is an allowlist, not a wildcard. The app and the marketing site are the
 * only browser origins that call this API; a token in localStorage plus
 * `origin: *` means any site the user visits can spend their session.
 */
const allowedOrigins = new Set([config.appOrigin, ...config.corsOrigins]);
app.use(cors({
  origin: (origin, callback) => {
    // No Origin header: curl, a mobile app, a server-to-server call. Not a
    // browser, so the same-origin policy this protects does not apply.
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

/* An explicit ceiling. The largest legitimate body here is an invoice with a
   long line-item list; 1mb is generous for that and refuses a body sent only
   to exhaust memory. */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* /health: the process is up (a container restarts if this fails).
   /ready: it can actually serve, i.e. the database answers (a load balancer stops sending traffic if this fails). */
app.get('/health', (_req, res) => res.json({ ok: true, service: 'flowxp-api' }));
app.get('/ready', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS migrations FROM schema_migrations`);
    res.json({ ok: true, migrations: rows[0].migrations });
  } catch {
    res.status(503).json({ ok: false });
  }
});
/* Local-disk uploads only; with STORAGE_DRIVER=s3 photos are served straight from the bucket. */
if (config.storage.driver === 'local') app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), { maxAge: '7d', immutable: true }));
app.use('/api', routes);

app.use((_req, res) => res.status(404).json({ success: false, message: 'Not found' }));

/* Last-resort handler. Anything reaching here is a bug, so it is logged in
   full and the client is told nothing — stack traces in a response body are a
   map of the codebase. */
app.use((error, _req, res, _next) => {
  console.error('[server] unhandled:', error);
  res.status(500).json({ success: false, message: 'Something went wrong' });
});

const start = async () => {
  try {
    await initializeDatabase();
    await ensureSuperAdmin();
  } catch (error) {
    console.error('[server] database initialisation failed:', error.message);
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    console.log(`[server] FlowXP API on http://localhost:${config.port}`);
  });
  if (process.env.WORKER_ENABLED !== 'false') startWorker();

  /* Finish in-flight requests before dying, so a deploy does not truncate
     someone's invoice mid-write. */
  const shutdown = async (signal) => {
    console.log(`[server] ${signal} — shutting down`);
    stopWorker();
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

/* A crash we didn't expect is logged with its cause and the process exits, so the platform restarts
   it clean instead of leaving a half-working server. */
process.on('unhandledRejection', (reason) => { console.error('[server] unhandled rejection:', reason); process.exit(1); });
process.on('uncaughtException', (error) => { console.error('[server] uncaught exception:', error); process.exit(1); });

start();

export default app;
