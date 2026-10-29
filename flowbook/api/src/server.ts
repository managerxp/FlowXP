import { buildApp } from './app.ts';
import { createPool, migrate } from './db.ts';

try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* environment only */ }

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }
const pool = createPool(url);
if (process.env.RUN_MIGRATIONS !== 'false') console.log('[flowbook] migrations applied:', (await migrate(pool)).join(', ') || 'none');

const production = process.env.NODE_ENV === 'production';
const app = buildApp({
  pool,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  secureCookie: production || process.env.COOKIE_SECURE === 'true'
});
const port = Number(process.env.PORT ?? 5200);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`[flowbook] api listening on ${port}`);
