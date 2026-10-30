/*
 * Starts FlowBook: connect, migrate, start the background workers, build the app. Used two ways:
 *  - mounted inside the FlowXP API process (backend/server.js), sharing FlowXP's database (FlowBook's tables are in the `flowbook` schema);
 *  - on its own (server.ts), listening on a port, for development and for tests of the HTTP layer.
 * Settings come from the environment, so both read the same variables.
 */
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import type { AiBridge } from './assistant.ts';
import { createPool, migrate } from './db.ts';
import { startInboxWorker } from './inbox.ts';
import { startReminderWorker } from './whatsapp.ts';

export type Booted = { app: FastifyInstance; close: () => Promise<void> };

/** @param extraOrigins browser origins that may make cookie-authenticated changes, on top of ALLOWED_ORIGINS
 *  @param host what the FlowXP API hands in when FlowBook is mounted inside it: its AI provider (with the plan and allowance check) and which features the super admin switched off */
export type Host = { ai?: AiBridge; featuresOff?: (flowxpBusinessId: string) => Promise<string[]> };
export const bootFlowbook = async (url: string, extraOrigins: string[] = [], host: Host = {}): Promise<Booted> => {
  const pool = createPool(url);
  if (process.env.RUN_MIGRATIONS !== 'false') console.log('[flowbook] migrations applied:', (await migrate(pool)).join(', ') || 'none');

  const production = process.env.NODE_ENV === 'production';
  const worker = process.env.INBOX_WORKER === 'false' ? null : startInboxWorker(pool);   // INBOX_WORKER=false posts events inside the request instead
  const reminders = process.env.WHATSAPP_WORKER !== 'false' ? startReminderWorker(pool) : null;   // automatic payment reminders, for businesses that turned them on
  const app = buildApp({
    pool,
    onEvent: worker?.kick,
    allowedOrigins: [...(process.env.ALLOWED_ORIGINS ?? '').split(','), ...extraOrigins].map((s) => s.trim()).filter(Boolean),
    passwordAuth: !production || process.env.FLOWBOOK_PASSWORD_AUTH === 'on',   // in production FlowXP is the only sign-in
    secureCookie: production || process.env.COOKIE_SECURE === 'true',
    ai: host.ai,
    featuresOff: host.featuresOff
  });
  await app.ready();
  return { app, close: async () => { worker?.stop(); reminders?.stop(); await app.close(); await pool.end(); } };
};
