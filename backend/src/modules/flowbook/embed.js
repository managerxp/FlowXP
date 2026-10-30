/*
 * FlowBook inside the FlowXP API process: one server, one port, one deploy, one database.
 *
 * FlowBook's code (flowbook/api, Fastify + TypeScript) is loaded here and answers every request under /books (so /books/v1/... is FlowBook's
 * /v1/...). It uses FlowXP's database, in its own schema named `flowbook`, so its tables never mix with FlowXP's. It is mounted before the
 * body parsers, because FlowBook reads the request body itself.
 *
 * If FlowBook cannot start (its folder is missing, or Node is older than 24 and cannot read the TypeScript) the FlowXP API still runs and
 * /books answers 503. FLOWBOOK_EMBEDDED=false turns it off, to run FlowBook as its own process (flowbook/api/src/server.ts) instead.
 */
import config from '../../config/env.js';
import { complete, isConfigured } from '../ai/provider.js';
import { CHECK_NOTE, ungrounded } from '../ai/grounding.js';
import { featuresOff, gate, record } from './gate.js';

export const embeddedFlowbook = () => {
  let booted = null;
  let failed = null;

  /** Start it: run after FlowXP's own migrations, so the database is ready. Never throws. */
  const start = async () => {
    if (process.env.FLOWBOOK_EMBEDDED === 'false') { failed = new Error('switched off'); return; }
    try {
      const { bootFlowbook } = await import('../../../../flowbook/api/src/boot.ts');
      const origins = [config.appOrigin, ...config.corsOrigins];
      if (config.flowbookAppUrl) origins.push(new URL(config.flowbookAppUrl).origin);
      booted = await bootFlowbook(config.databaseUrl, origins, { ai: { configured: isConfigured, complete, ungrounded, checkNote: CHECK_NOTE, gate, record }, featuresOff });
      console.log('[flowbook] running inside the FlowXP API at /books');
    } catch (error) {
      failed = error;
      console.error('[flowbook] could not start inside the FlowXP API:', error.message);
    }
  };

  const middleware = (req, res, next) => {
    if (booted) return booted.app.routing(req, res);
    if (failed?.message === 'switched off') return next();
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'unavailable', message: 'FlowBook is not available right now' } }));
    return undefined;
  };

  return { start, middleware, close: async () => { await booted?.close(); } };
};
