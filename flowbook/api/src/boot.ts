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
import { findConnection, receiveEvent, startInboxWorker } from './inbox.ts';
import { useHostMail } from './email.ts';
import type { HostMail } from './email.ts';
import { startReminderWorker, useHostWhatsapp } from './whatsapp.ts';
import type { HostWhatsapp } from './whatsapp.ts';

/** `ingest` takes one FlowXP event for a FlowXP business, in this process (no address, no signature: the caller is FlowXP itself). */
export type Booted = { app: FastifyInstance; close: () => Promise<void>; ingest: (flowxpBusinessId: string, event: Parameters<typeof receiveEvent>[2]) => Promise<{ status: string; duplicate: boolean }> };

/** @param extraOrigins browser origins that may make cookie-authenticated changes, on top of ALLOWED_ORIGINS
 *  @param host what the FlowXP API hands in when FlowBook is mounted inside it: its AI provider (with the plan and allowance check) and which features the super admin switched off */
export type Host = { /** FlowBook is part of the FlowXP app: FlowXP signs the person in (see sso.ts) */ shared?: boolean; ai?: AiBridge; featuresOff?: (flowxpBusinessId: string) => Promise<string[]>; mail?: HostMail; whatsapp?: HostWhatsapp };
export const bootFlowbook = async (url: string, extraOrigins: string[] = [], host: Host = {}): Promise<Booted> => {
  const pool = createPool(url);
  useHostMail(host.mail ?? null);
  useHostWhatsapp(host.whatsapp ?? null);
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
    hostAuth: host.shared,
    ai: host.ai,
    featuresOff: host.featuresOff
  });
  await app.ready();
  const ingest: Booted['ingest'] = async (businessId, event) => {
    const conn = await findConnection(pool, businessId);
    if (!conn) throw new Error('these books are not open yet; open FlowBook once in FlowXP');
    const out = await receiveEvent(pool, conn, event, !worker);
    if (worker && !out.duplicate) worker.kick();
    return out;
  };
  return { ingest, app, close: async () => { worker?.stop(); reminders?.stop(); await app.close(); await pool.end(); } };
};
