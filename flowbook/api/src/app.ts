import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { audit } from './audit.ts';
import { DUMMY_HASH, hashPassword, hashToken, newToken, passwordProblem, verifyPassword } from './auth.ts';
import { withOrg } from './db.ts';
import { LedgerError, post, reverse } from './ledger.ts';
import { paiseToString, toPaise } from './money.ts';
import { can, ROLES } from './permissions.ts';
import type { Role } from './permissions.ts';
import { provisionOrganization } from './provision.ts';
import { balanceSheet, documentIssues, partyBalances, profitAndLoss, reconcile, trialBalance } from './reports.ts';
import { registerBookRoutes } from './routes.ts';
import { registerIntegrationRoutes } from './integration-routes.ts';
import { registerAssistant } from './assistant.ts';
import type { AiBridge } from './assistant.ts';
import { setPeriodStatus } from './periods.ts';
import type { PeriodStatus } from './periods.ts';
import { TEMPLATES } from './coa.ts';
import { readHandoff, signInFromFlowxp } from './sso.ts';

type Session = { sessionId: bigint; userId: bigint; email: string; name: string; viaCookie: boolean };
type OrgScope = { id: bigint; role: Role };
declare module 'fastify' { interface FastifyRequest { session?: Session; org?: OrgScope } }

export type AppOptions = {
  pool: pg.Pool;
  /** Origins allowed to make cookie-authenticated changes, e.g. https://app.flowbook.example. Empty: none from a browser. */
  allowedOrigins?: string[];
  /** Set the Secure flag on the session cookie (always true in production, off only for http://localhost). */
  secureCookie?: boolean;
  sessionDays?: number;
  /** Set when a background worker posts FlowXP events (see startInboxWorker): events are then stored and answered at once. Unset, they post inside the request. */
  onEvent?: () => void;
  /** attempts allowed per 15 minutes (defaults: sign-in 8 per email and address, sign-up 20 per address) */
  limits?: { login?: number; register?: number };
  /** FlowXP is the only sign-in. false answers /auth/register and /auth/login with 404 (server.ts: off in production unless FLOWBOOK_PASSWORD_AUTH=on). Default true so tests and scripts can register. */
  passwordAuth?: boolean;
  /** The AI provider behind the assistant (the FlowXP API hands in its own). Unset: the assistant says it is not switched on. */
  ai?: AiBridge;
};

const COOKIE = 'fb_session';
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const AMOUNT = '^\\d{1,13}(\\.\\d{1,2})?$';
const ID = '^\\d{1,18}$';

/* ids are bigint inside; on the wire they are strings and amounts are decimal strings, never floats */
const ID_KEYS = new Set(['id', 'party_id', 'entry_id', 'account_id', 'user_id', 'organization_id']);
const wire = (v: unknown, key = ''): unknown => {
  if (typeof v === 'bigint') return ID_KEYS.has(key) || /(^|_)id$|Id$/.test(key) ? v.toString() : paiseToString(v);
  if (Array.isArray(v)) return v.map((x) => wire(x, key));
  if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wire(x, k)]));
  return v;
};

const cookieValue = (header: string | undefined, name: string): string | null => {
  for (const part of (header ?? '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=') || null;
  }
  return null;
};

export const buildApp = (opts: AppOptions): FastifyInstance => {
  const { pool } = opts;
  const origins = new Set(opts.allowedOrigins ?? []);
  const days = opts.sessionDays ?? 30;
  const app = Fastify({ logger: false, bodyLimit: 1_000_000, trustProxy: true });

  app.setReplySerializer((payload) => JSON.stringify(wire(payload)));
  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown; code?: string }, _req, reply) => {
    if (error instanceof LedgerError) return reply.code(error.code === 'not_found' ? 404 : 422).send({ error: { code: error.code, message: error.message } });
    if (error.validation) return reply.code(400).send({ error: { code: 'invalid_request', message: error.message } });
    if (error.code === 'P0001') return reply.code(422).send({ error: { code: 'rule_violation', message: error.message.replace(/^error: /, '') } });
    if (error instanceof RangeError) return reply.code(400).send({ error: { code: 'invalid_request', message: error.message } });
    if (error.statusCode && error.statusCode < 500) return reply.code(error.statusCode).send({ error: { code: 'bad_request', message: error.message } });
    console.error('[flowbook] unhandled error:', error);
    return reply.code(500).send({ error: { code: 'internal', message: 'something went wrong on our side' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'not_found', message: 'no such route' } }));

  /* ---- a throttle on sign-in and sign-up, per 15 minutes. In memory, so one process only.
         ponytail: move to Redis when there is more than one API process. */
  const tries = new Map<string, { n: number; reset: number }>();
  const throttled = (key: string, max: number): boolean => {
    const now = Date.now();
    const t = tries.get(key);
    if (!t || t.reset < now) { tries.set(key, { n: 1, reset: now + 15 * 60_000 }); return false; }
    t.n += 1;
    return t.n > max;
  };

  /* ---- sessions */
  const authenticate = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const cookie = bearer ? null : cookieValue(req.headers.cookie, COOKIE);
    const token = bearer ?? cookie;
    if (!token) { reply.code(401).send({ error: { code: 'unauthenticated', message: 'sign in first' } }); return false; }
    const row = (await pool.query(
      `SELECT s.id AS session_id, u.id AS user_id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'ACTIVE'`, [hashToken(token)])).rows[0];
    if (!row) { reply.code(401).send({ error: { code: 'unauthenticated', message: 'your session has ended; sign in again' } }); return false; }
    // a cookie is sent by the browser on its own, so a change made with one must come from one of our own pages (CSRF)
    if (cookie && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !origins.has(req.headers.origin ?? '')) {
      reply.code(403).send({ error: { code: 'bad_origin', message: 'this request did not come from an allowed page' } });
      return false;
    }
    req.session = { sessionId: row.session_id as bigint, userId: row.user_id as bigint, email: row.email as string, name: row.name as string, viaCookie: Boolean(cookie) };
    return true;
  };

  /** Sign in, find the organization in the path, check the person belongs to it and may do this. Not a member looks like not found. */
  const scope = (permission: string) => async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!(await authenticate(req, reply))) return;
    const raw = (req.params as { orgId?: string }).orgId ?? '';
    const m = /^\d{1,18}$/.test(raw) ? (await pool.query(
      `SELECT m.role, o.plan = 'TRIAL' AND o.trial_ends_at <= now() AS trial_over FROM memberships m JOIN organizations o ON o.id = m.organization_id WHERE m.organization_id = $1 AND m.user_id = $2`, [raw, req.session?.userId])).rows[0] : null;
    if (!m) { reply.code(404).send({ error: { code: 'not_found', message: 'no such organization' } }); return; }
    if (!can(m.role as Role, permission)) { reply.code(403).send({ error: { code: 'forbidden', message: `your role cannot do this (${permission})` } }); return; }
    // a finished free trial keeps the books readable and exportable but takes no new entries
    if (m.trial_over && req.method !== 'GET' && req.method !== 'HEAD') { reply.code(402).send({ error: { code: 'trial_ended', message: 'your 7-day free trial has ended. Your books are safe and can still be read; pay for your plan in FlowXP (Settings, Subscription) and open FlowBook again' } }); return; }
    req.org = { id: BigInt(raw), role: m.role as Role };
  };
  const me = (req: FastifyRequest) => `user:${req.session?.userId}`;

  const startSession = async (req: FastifyRequest, reply: FastifyReply, userId: bigint): Promise<string> => {
    const token = newToken();
    await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent) VALUES ($1, $2, now() + ($3 || ' days')::interval, $4, $5)`,
      [userId, hashToken(token), String(days), req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300)]);
    reply.header('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${opts.secureCookie ? '; Secure' : ''}`);
    return token;
  };

  /* ---- auth */
  const passwordAuthOff = (_req: FastifyRequest, reply: FastifyReply, done: () => void): void => { if (opts.passwordAuth === false) reply.code(404).send({ error: { code: 'not_found', message: 'sign in through FlowXP' } }); else done(); };
  app.post('/v1/auth/register', { preHandler: passwordAuthOff,  schema: { body: { type: 'object', required: ['name', 'email', 'password'], additionalProperties: false, properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 }, email: { type: 'string', format: 'email', maxLength: 200 }, password: { type: 'string' } } } } }, async (req, reply) => {
    const b = req.body as { name: string; email: string; password: string };
    if (throttled(`register:${req.ip}`, opts.limits?.register ?? 20)) return reply.code(429).send({ error: { code: 'rate_limited', message: 'too many attempts; wait a few minutes' } });
    const problem = passwordProblem(b.password);
    if (problem) return reply.code(400).send({ error: { code: 'weak_password', message: problem } });
    const hash = await hashPassword(b.password);
    const row = (await pool.query(`INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`, [b.email.trim(), b.name.trim(), hash])).rows[0];
    if (!row) return reply.code(409).send({ error: { code: 'email_taken', message: 'that email already has an account' } });
    const token = await startSession(req, reply, row.id as bigint);
    return reply.code(201).send({ user: { id: row.id, name: b.name.trim(), email: b.email.trim() }, token });
  });

  app.post('/v1/auth/login', { preHandler: passwordAuthOff,  schema: { body: { type: 'object', required: ['email', 'password'], additionalProperties: false, properties: {
    email: { type: 'string', maxLength: 200 }, password: { type: 'string', maxLength: 200 } } } } }, async (req, reply) => {
    const b = req.body as { email: string; password: string };
    if (throttled(`login:${b.email.toLowerCase()}:${req.ip}`, opts.limits?.login ?? 8)) return reply.code(429).send({ error: { code: 'rate_limited', message: 'too many attempts; wait a few minutes' } });
    const user = (await pool.query(`SELECT id, name, email, password_hash, status FROM users WHERE lower(email) = lower($1)`, [b.email.trim()])).rows[0];
    const ok = await verifyPassword(b.password, (user?.password_hash as string | undefined) ?? DUMMY_HASH);   // same work whether or not the user exists
    if (!user || !ok || user.status !== 'ACTIVE') return reply.code(401).send({ error: { code: 'bad_credentials', message: 'email or password is wrong' } });
    const token = await startSession(req, reply, user.id as bigint);
    return { user: { id: user.id, name: user.name, email: user.email }, token };
  });

  /** The one sign-in: FlowXP's signed handoff in, a FlowBook session out. */
  app.post('/v1/auth/flowxp', { schema: { body: { type: 'object', required: ['token'], additionalProperties: false, properties: { token: { type: 'string', maxLength: 2000 } } } } }, async (req, reply) => {
    if (throttled(`sso:${req.ip}`, opts.limits?.login ?? 8 * 5)) return reply.code(429).send({ error: { code: 'rate_limited', message: 'too many attempts; wait a few minutes' } });
    const h = readHandoff((req.body as { token: string }).token, process.env.FLOWBOOK_SSO_SECRET ?? '');
    if (!h) return reply.code(401).send({ error: { code: 'bad_handoff', message: 'that sign-in link is not valid or has expired; open FlowBook again from FlowXP' } });
    const r = await signInFromFlowxp(pool, h);
    if (!r) return reply.code(403).send({ error: { code: 'ask_owner', message: 'ask the owner or an admin of this business to open FlowBook first' } });
    const token = await startSession(req, reply, r.userId);
    return { user: { id: r.userId, name: h.name, email: h.email }, token, organizationId: r.orgId };
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    if (!(await authenticate(req, reply))) return;
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.session?.sessionId]);
    reply.header('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { ok: true };
  });

  app.get('/v1/me', async (req, reply) => {
    if (!(await authenticate(req, reply))) return;
    const orgs = (await pool.query(
      `SELECT o.id, o.name, m.role, o.plan, o.trial_ends_at, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (o.trial_ends_at - now())) / 86400))::int AS trial_days_left FROM memberships m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = $1 ORDER BY o.name`, [req.session?.userId])).rows;
    return { user: { id: req.session?.userId, name: req.session?.name, email: req.session?.email }, organizations: orgs };
  });

  /* ---- organizations */
  app.post('/v1/organizations', { schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: {
    name: { type: 'string', minLength: 1, maxLength: 160 }, legalName: { type: 'string', maxLength: 200 }, pan: { type: 'string', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$' },
    template: { type: 'string', enum: TEMPLATES }, fyStartYear: { type: 'integer', minimum: 2000, maximum: 2100 } } } } }, async (req, reply) => {
    if (!(await authenticate(req, reply))) return;
    const b = req.body as { name: string; legalName?: string; pan?: string; template?: string; fyStartYear?: number };
    const id = await provisionOrganization(pool, { ...b, ownerUserId: req.session?.userId as bigint });
    return reply.code(201).send({ id, name: b.name, role: 'owner' });
  });

  const orgRoute = '/v1/orgs/:orgId';

  app.get(`${orgRoute}/members`, { preHandler: scope('members.manage') }, async (req) => (await pool.query(
    `SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 ORDER BY u.name`, [req.org?.id])).rows);

  app.post(`${orgRoute}/members`, { preHandler: scope('members.manage'), schema: { body: { type: 'object', required: ['email', 'role'], additionalProperties: false, properties: {
    email: { type: 'string', maxLength: 200 }, role: { type: 'string', enum: [...ROLES] } } } } }, async (req, reply) => {
    const b = req.body as { email: string; role: Role };
    if (b.role === 'owner' && req.org?.role !== 'owner') return reply.code(403).send({ error: { code: 'forbidden', message: 'only an owner can make another owner' } });
    const user = (await pool.query(`SELECT id, name, email FROM users WHERE lower(email) = lower($1) AND status = 'ACTIVE'`, [b.email.trim()])).rows[0];
    if (!user) return reply.code(404).send({ error: { code: 'no_such_user', message: 'that person has no FlowBook account yet; ask them to register first' } });
    await pool.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [req.org?.id, user.id, b.role]);
    await withOrg(pool, req.org?.id as bigint, (c) => audit(c, req.org?.id as bigint, { actor: me(req), action: 'member.set_role', entityType: 'user', entityId: user.id as bigint, detail: { role: b.role } }));
    return reply.code(201).send({ id: user.id, name: user.name, email: user.email, role: b.role });
  });

  /* ---- chart of accounts */
  app.get(`${orgRoute}/accounts`, { preHandler: scope('accounts.read') }, async (req) =>
    withOrg(pool, req.org?.id as bigint, async (c) => (await c.query(`SELECT id, code, name, type, normal_balance, system_key, is_system, active FROM accounts ORDER BY code`)).rows));

  app.post(`${orgRoute}/accounts`, { preHandler: scope('accounts.write'), schema: { body: { type: 'object', required: ['code', 'name', 'type'], additionalProperties: false, properties: {
    code: { type: 'string', pattern: '^[A-Za-z0-9.-]{1,12}$' }, name: { type: 'string', minLength: 1, maxLength: 120 }, type: { type: 'string', enum: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] } } } } }, async (req, reply) => {
    const b = req.body as { code: string; name: string; type: string };
    const orgId = req.org?.id as bigint;
    const row = await withOrg(pool, orgId, async (c) => {
      const r = (await c.query(
        `INSERT INTO accounts (organization_id, code, name, type, normal_balance) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id, code, name, type`,
        [orgId, b.code, b.name, b.type, b.type === 'ASSET' || b.type === 'EXPENSE' ? 'D' : 'C'])).rows[0];
      if (r) await audit(c, orgId, { actor: me(req), action: 'account.created', entityType: 'account', entityId: r.id as bigint, detail: { code: b.code } });
      return r;
    });
    if (!row) return reply.code(409).send({ error: { code: 'code_taken', message: `account code ${b.code} already exists` } });
    return reply.code(201).send(row);
  });

  /* ---- journals */
  app.post(`${orgRoute}/journals`, { preHandler: scope('journal.post'), schema: { body: { type: 'object', required: ['date', 'lines'], additionalProperties: false, properties: {
    date: { type: 'string', pattern: DATE }, memo: { type: 'string', maxLength: 500 }, overrideReason: { type: 'string', maxLength: 300 },
    lines: { type: 'array', minItems: 2, maxItems: 200, items: { type: 'object', required: ['account', 'side', 'amount'], additionalProperties: false, properties: {
      account: { type: 'string', maxLength: 40 }, side: { type: 'string', enum: ['D', 'C'] }, amount: { type: 'string', pattern: AMOUNT },
      partyId: { type: 'string', pattern: ID }, memo: { type: 'string', maxLength: 200 } } } } } } } }, async (req, reply) => {
    const key = String(req.headers['idempotency-key'] ?? '');
    if (key.length < 8 || key.length > 128) return reply.code(400).send({ error: { code: 'idempotency_key_required', message: 'send an Idempotency-Key header (8 to 128 characters), one per user action' } });
    const b = req.body as { date: string; memo?: string; overrideReason?: string; lines: { account: string; side: 'D' | 'C'; amount: string; partyId?: string; memo?: string }[] };
    if (b.overrideReason && !can(req.org?.role as Role, 'period.override')) return reply.code(403).send({ error: { code: 'forbidden', message: 'your role cannot post into a locked period' } });
    const orgId = req.org?.id as bigint;
    const out = await withOrg(pool, orgId, (c) => post(c, orgId, {
      date: b.date, memo: b.memo, sourceSystem: 'api', sourceType: 'manual_journal', sourceId: key, kind: 'POST', actor: me(req),
      override: b.overrideReason ? { reason: b.overrideReason } : undefined,
      lines: b.lines.map((l) => ({ account: l.account, side: l.side, amount: toPaise(l.amount), partyId: l.partyId ? BigInt(l.partyId) : undefined, memo: l.memo }))
    }));
    return reply.code(out.replayed ? 200 : 201).send({ id: out.entryId, entryNo: out.entryNo, replayed: out.replayed });
  });

  app.get(`${orgRoute}/journals`, { preHandler: scope('journal.read'), schema: { querystring: { type: 'object', properties: {
    from: { type: 'string', pattern: DATE }, to: { type: 'string', pattern: DATE }, before: { type: 'string', pattern: ID }, limit: { type: 'integer', minimum: 1, maximum: 200 } } } } }, async (req) => {
    const q = req.query as { from?: string; to?: string; before?: string; limit?: number };
    const limit = q.limit ?? 50;
    return withOrg(pool, req.org?.id as bigint, async (c) => {
      const rows = (await c.query(
        `SELECT e.id, e.entry_no, e.posting_date::text AS posting_date, e.memo, e.source_type, e.source_id, e.reverses_entry_id,
                (SELECT SUM(base_amount_minor) FROM journal_lines l WHERE l.entry_id = e.id AND l.side = 'D')::bigint AS total
           FROM journal_entries e WHERE e.status = 'POSTED' AND ($1::date IS NULL OR e.posting_date >= $1) AND ($2::date IS NULL OR e.posting_date <= $2)
            AND ($3::bigint IS NULL OR e.id < $3) ORDER BY e.id DESC LIMIT $4`, [q.from ?? null, q.to ?? null, q.before ?? null, limit])).rows;
      return { entries: rows, next: rows.length === limit ? rows[rows.length - 1]?.id : null };
    });
  });

  app.get(`${orgRoute}/journals/:entryId`, { preHandler: scope('journal.read') }, async (req, reply) => {
    const id = (req.params as { entryId: string }).entryId;
    if (!new RegExp(ID).test(id)) return reply.code(404).send({ error: { code: 'not_found', message: 'no such journal entry' } });
    const out = await withOrg(pool, req.org?.id as bigint, async (c) => {
      const e = (await c.query(`SELECT id, entry_no, posting_date::text AS posting_date, status, memo, source_type, source_id, reverses_entry_id FROM journal_entries WHERE id = $1`, [id])).rows[0];
      if (!e) return null;
      const lines = (await c.query(
        `SELECT l.line_no, a.code AS account_code, a.name AS account_name, l.side, l.base_amount_minor AS amount, l.party_id, l.memo FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = $1 ORDER BY l.line_no`, [id])).rows;
      return { ...e, lines };
    });
    return out ?? reply.code(404).send({ error: { code: 'not_found', message: 'no such journal entry' } });
  });

  app.post(`${orgRoute}/journals/:entryId/reverse`, { preHandler: scope('journal.reverse'), schema: { body: { type: 'object', required: ['date', 'reason'], additionalProperties: false, properties: {
    date: { type: 'string', pattern: DATE }, reason: { type: 'string', minLength: 1, maxLength: 300 }, overrideReason: { type: 'string', maxLength: 300 } } } } }, async (req, reply) => {
    const id = (req.params as { entryId: string }).entryId;
    if (!new RegExp(ID).test(id)) return reply.code(404).send({ error: { code: 'not_found', message: 'no such journal entry' } });
    const b = req.body as { date: string; reason: string; overrideReason?: string };
    if (b.overrideReason && !can(req.org?.role as Role, 'period.override')) return reply.code(403).send({ error: { code: 'forbidden', message: 'your role cannot post into a locked period' } });
    const orgId = req.org?.id as bigint;
    const out = await withOrg(pool, orgId, (c) => reverse(c, orgId, BigInt(id), { date: b.date, reason: b.reason, actor: me(req), override: b.overrideReason ? { reason: b.overrideReason } : undefined }));
    return reply.code(201).send({ id: out.entryId, entryNo: out.entryNo });
  });

  /* ---- periods */
  app.get(`${orgRoute}/periods`, { preHandler: scope('org.read') }, async (req) =>
    withOrg(pool, req.org?.id as bigint, async (c) => (await c.query(`SELECT id, start_date::text AS start_date, end_date::text AS end_date, status FROM accounting_periods ORDER BY start_date`)).rows));

  app.put(`${orgRoute}/periods`, { preHandler: scope('period.manage'), schema: { body: { type: 'object', required: ['date', 'status'], additionalProperties: false, properties: {
    date: { type: 'string', pattern: DATE }, status: { type: 'string', enum: ['OPEN', 'SOFT_LOCKED', 'CLOSED'] } } } } }, async (req, reply) => {
    const b = req.body as { date: string; status: PeriodStatus };
    const orgId = req.org?.id as bigint;
    return withOrg(pool, orgId, async (c) => {
      const cur = (await c.query(`SELECT status FROM accounting_periods WHERE $1::date BETWEEN start_date AND end_date`, [b.date])).rows[0];
      if (!cur) return reply.code(404).send({ error: { code: 'no_period', message: `no accounting period covers ${b.date}` } });
      if (cur.status === 'CLOSED' && b.status !== 'CLOSED' && !can(req.org?.role as Role, 'period.override')) {
        return reply.code(403).send({ error: { code: 'forbidden', message: 'only an owner or accountant can reopen a closed period' } });
      }
      await setPeriodStatus(c, orgId, b.date, b.status, me(req));
      return { date: b.date, status: b.status };
    });
  });

  /* ---- reports */
  const rangeSchema = { querystring: { type: 'object', required: ['to'], properties: { from: { type: 'string', pattern: DATE }, to: { type: 'string', pattern: DATE } } } };
  app.get(`${orgRoute}/reports/trial-balance`, { preHandler: scope('report.read'), schema: rangeSchema }, async (req) => {
    const q = req.query as { from?: string; to: string };
    return withOrg(pool, req.org?.id as bigint, (c) => trialBalance(c, req.org?.id as bigint, q));
  });
  app.get(`${orgRoute}/reports/profit-and-loss`, { preHandler: scope('report.read'), schema: { querystring: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', pattern: DATE }, to: { type: 'string', pattern: DATE } } } } }, async (req) => {
    const q = req.query as { from: string; to: string };
    return withOrg(pool, req.org?.id as bigint, (c) => profitAndLoss(c, req.org?.id as bigint, q.from, q.to));
  });
  app.get(`${orgRoute}/reports/balance-sheet`, { preHandler: scope('report.read'), schema: { querystring: { type: 'object', required: ['asOf'], properties: { asOf: { type: 'string', pattern: DATE } } } } }, async (req) =>
    withOrg(pool, req.org?.id as bigint, (c) => balanceSheet(c, req.org?.id as bigint, (req.query as { asOf: string }).asOf)));
  app.get(`${orgRoute}/reports/party-balances`, { preHandler: scope('report.read'), schema: { querystring: { type: 'object', required: ['account', 'to'], properties: {
    account: { type: 'string', enum: ['AR', 'AP'] }, to: { type: 'string', pattern: DATE } } } } }, async (req) => {
    const q = req.query as { account: string; to: string };
    return withOrg(pool, req.org?.id as bigint, (c) => partyBalances(c, req.org?.id as bigint, q.account, q.to));
  });
  app.get(`${orgRoute}/reports/reconcile`, { preHandler: scope('report.read') }, async (req) =>
    ({ issues: await withOrg(pool, req.org?.id as bigint, async (c) => [...await reconcile(c, req.org?.id as bigint), ...await documentIssues(c, req.org?.id as bigint)]) }));

  registerBookRoutes(app, { pool, scope, me });
  registerIntegrationRoutes(app, { pool, scope, me, onEvent: opts.onEvent });
  registerAssistant(app, { pool, scope, ai: opts.ai });

  /* ---- audit */
  app.get(`${orgRoute}/audit`, { preHandler: scope('audit.read'), schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } } } } }, async (req) =>
    withOrg(pool, req.org?.id as bigint, async (c) => (await c.query(
      `SELECT id, created_at, actor, action, entity_type, entity_id, detail FROM audit_log ORDER BY id DESC LIMIT $1`, [(req.query as { limit?: number }).limit ?? 50])).rows));

  app.get('/health', async () => ({ ok: true }));
  return app;
};
