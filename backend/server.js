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
    // the route's pattern (/public/menu/:token), never the real address: links to a menu, a bill or a webhook carry a secret that must not sit in a log file
    const where = req.route ? `${req.baseUrl}${typeof req.route.path === 'string' ? req.route.path : ''}` : '(no route)';
    console.log(JSON.stringify({ t: new Date().toISOString(), id, method: req.method, path: where, status: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6) }));
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
/* Headers every response should carry. The API only returns JSON, so nothing here should ever be framed, sniffed
   or cached by a shared proxy (answers are per person). */
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-site'
  });
  if (config.isProduction) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

/* verify stashes the raw bytes for webhook signature checks (Cashfree signs
   the raw body; the re-serialised JSON is not guaranteed to match it byte for byte). */
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
/* A NUL character cannot be stored in a text column (the database refuses the whole request), and no honest customer name, note or address contains one. Dropped from every string in the body. */
const dropNul = (v) => (typeof v === 'string' ? v.replaceAll(String.fromCharCode(0), '') : Array.isArray(v) ? v.map(dropNul) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dropNul(x)])) : v);
app.use((req, _res, next) => { if (req.body && typeof req.body === 'object') req.body = dropNul(req.body); next(); });
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
if (config.storage.driver === 'local') app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), { maxAge: '7d', immutable: true, setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'none'; sandbox") }));
app.use('/api', routes);

app.use((_req, res) => res.status(404).json({ success: false, message: 'Not found' }));

/* Last-resort handler. Anything reaching here is a bug, so it is logged in
   full and the client is told nothing — stack traces in a response body are a
   map of the codebase. */
app.use((error, _req, res, _next) => {
  // a browser from an origin that is not allowed: refuse it plainly rather than as a crash
  if (error?.message === 'Not allowed by CORS') return res.status(403).json({ success: false, message: 'This website is not allowed to use the API' });
  // a body that isn't valid JSON, or is too large, is the caller's mistake
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'That request was not valid JSON' });
  if (error?.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'That request is too large' });
  if (error?.name === 'InputError') return res.status(400).json({ success: false, message: error.message });
  // text the database cannot hold (a stray byte, an unsupported character) is the caller's input too
  if (['22021', '22P05'].includes(error?.code)) return res.status(400).json({ success: false, message: 'One of the values contains a character that cannot be saved' });
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
  if (process.env.WORKER_ENABLED !== 'false') startWorker(Number(process.env.WORKER_INTERVAL_MS) || 30000);

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
