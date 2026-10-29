import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { audit } from './audit.ts';
import { withOrg } from './db.ts';
import { findConnection, newSecret, processEvent, receiveEvent, verifySignature } from './inbox.ts';

type Scope = (permission: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
type Deps = { pool: pg.Pool; scope: Scope; me: (req: FastifyRequest) => string; /** called after an event is stored, when a background worker will post it */ onEvent?: () => void };
declare module 'fastify' { interface FastifyRequest { rawBody?: string } }

const ID = '^\\d{1,18}$';
const deny = (reply: FastifyReply) => reply.code(401).send({ error: { code: 'bad_signature', message: 'the signature, timestamp or connection is not valid' } });

export const registerIntegrationRoutes = (app: FastifyInstance, { pool, scope, me, onEvent }: Deps): void => {
  /* ---- the inbox: signed by FlowXP, no session. Its own plugin, so keeping the raw body (the signature covers the exact bytes) changes no other route. */
  app.register(async (inbox) => {
    inbox.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 1_000_000 }, (req, body, done) => {
      req.rawBody = body as string;
      try { done(null, JSON.parse(body as string)); } catch { const e = new Error('the body is not valid JSON') as Error & { statusCode: number }; e.statusCode = 400; done(e); }
    });
    inbox.post('/v1/integrations/flowxp/events', { schema: { body: { type: 'object', required: ['event_id', 'event_type', 'schema_version', 'business_id', 'payload'], properties: {
      event_id: { type: 'string', minLength: 8, maxLength: 80 }, event_type: { type: 'string', maxLength: 60 }, schema_version: { type: 'integer', minimum: 1 },
      business_id: { anyOf: [{ type: 'string' }, { type: 'integer' }] }, sequence: { anyOf: [{ type: 'string' }, { type: 'integer' }] }, occurred_at: { type: 'string', maxLength: 40 }, payload: { type: 'object' } } } } }, async (req, reply) => {
      const b = req.body as { event_id: string; event_type: string; schema_version: number; business_id: string | number; sequence?: string | number; occurred_at?: string; payload: Record<string, unknown> };
      const conn = await findConnection(pool, String(b.business_id));
      // an unknown business and a wrong signature answer alike, so the endpoint does not say which businesses are connected
      if (!conn || !verifySignature(req.headers['x-flowxp-signature'] as string | undefined, req.rawBody ?? '', conn)) return deny(reply);
      const out = await receiveEvent(pool, conn, b, !onEvent);   // with a worker the event is stored and answered at once; without one it posts here
      if (onEvent && !out.duplicate) onEvent();
      return reply.code(out.duplicate ? 200 : 202).send({ event_id: b.event_id, status: out.status, duplicate: out.duplicate });
    });
  });

  /* ---- the Integrations Hub: connect, rotate the secret, see events, replay what needs attention */
  const base = '/v1/orgs/:orgId/integrations';
  const orgOf = (req: FastifyRequest) => req.org?.id as bigint;

  app.get(`${base}/flowxp/connections`, { preHandler: scope('integration.manage') }, async (req) =>
    withOrg(pool, orgOf(req), async (c) => (await c.query(`SELECT id, external_business_id, cutover_date::text AS cutover_date, active, created_at FROM integration_connections ORDER BY id`)).rows));

  app.post(`${base}/flowxp/connections`, { preHandler: scope('integration.manage'), schema: { body: { type: 'object', required: ['businessId'], additionalProperties: false, properties: {
    businessId: { anyOf: [{ type: 'string' }, { type: 'integer' }] }, cutoverDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } } } }, async (req, reply) => {
    const b = req.body as { businessId: string | number; cutoverDate?: string };
    const secret = newSecret();
    const row = await withOrg(pool, orgOf(req), async (c) => {
      const r = (await c.query(
        `INSERT INTO integration_connections (organization_id, provider, external_business_id, secret, cutover_date) VALUES ($1, 'FLOWXP', $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id`,
        [orgOf(req), String(b.businessId), secret, b.cutoverDate ?? null])).rows[0];
      if (r) await audit(c, orgOf(req), { actor: me(req), action: 'integration.connected', entityType: 'integration_connection', entityId: r.id as bigint, detail: { businessId: String(b.businessId) } });
      return r;
    });
    if (!row) return reply.code(409).send({ error: { code: 'already_connected', message: 'that FlowXP business is already connected' } });
    return reply.code(201).send({ id: row.id, secret });   // shown once; paste it into FlowXP
  });

  app.post(`${base}/flowxp/connections/:id/rotate-secret`, { preHandler: scope('integration.manage'), schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: ID } } } } }, async (req, reply) => {
    const secret = newSecret();
    const ok = await withOrg(pool, orgOf(req), async (c) => {
      const r = await c.query(`UPDATE integration_connections SET previous_secret = secret, previous_secret_until = now() + interval '24 hours', secret = $2 WHERE id = $1`, [(req.params as { id: string }).id, secret]);
      if (r.rowCount) await audit(c, orgOf(req), { actor: me(req), action: 'integration.secret_rotated', entityType: 'integration_connection', entityId: (req.params as { id: string }).id });
      return r.rowCount;
    });
    return ok ? { secret, oldSecretValidForHours: 24 } : reply.code(404).send({ error: { code: 'not_found', message: 'no such connection' } });
  });

  app.get(`${base}/events`, { preHandler: scope('integration.manage'), schema: { querystring: { type: 'object', properties: {
    status: { type: 'string' }, before: { type: 'string', pattern: ID }, limit: { type: 'integer', minimum: 1, maximum: 200 } } } } }, async (req) => {
    const q = req.query as { status?: string; before?: string; limit?: number };
    return withOrg(pool, orgOf(req), async (c) => (await c.query(
      `SELECT id, event_id, event_type, status, error, sequence, occurred_at, received_at, processed_at, attempts, payload FROM integration_events
        WHERE ($1::text IS NULL OR status = $1) AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3`, [q.status ?? null, q.before ?? null, q.limit ?? 50])).rows);
  });

  app.post(`${base}/events/:id/replay`, { preHandler: scope('integration.manage'), schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: ID } } } } }, async (req, reply) => {
    const found = await withOrg(pool, orgOf(req), async (c) => (await c.query(
      `SELECT e.id, e.status, e.connection_id FROM integration_events e WHERE e.id = $1`, [(req.params as { id: string }).id])).rows[0]);
    if (!found) return reply.code(404).send({ error: { code: 'not_found', message: 'no such event' } });
    if (!['RECEIVED', 'WAITING', 'NEEDS_ATTENTION', 'FAILED_VALIDATION'].includes(found.status)) return reply.code(409).send({ error: { code: 'not_replayable', message: `an event that is ${found.status} cannot be replayed` } });
    const conn = (await pool.query(
      `SELECT id, organization_id, secret, previous_secret, previous_secret_until, cutover_date::text AS cutover_date FROM integration_connections WHERE id = $1`, [found.connection_id])).rows[0];
    return { status: await processEvent(pool, conn, found.id as bigint) };
  });
};
