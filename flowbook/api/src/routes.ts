import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { audit } from './audit.ts';
import { withOrg } from './db.ts';
import type { Db } from './db.ts';
import { ageing, allocatePayment, applyCreditNote, createPayment, deleteDraft, getDocument, getPayment, issueDocument, listDocuments, listPayments, saveDraft, voidDocument, voidPayment } from './documents.ts';
import type { Alloc, DocIn, DocKind } from './documents.ts';
import { validGstin, validStateCode } from './gst.ts';
import { LedgerError } from './ledger.ts';
import { addTaxRate, createItem, createParty, updateParty } from './masters.ts';
import { toPaise } from './money.ts';
import { can } from './permissions.ts';
import type { Role } from './permissions.ts';

/* Routes for the people you trade with, what you sell, tax rates, and the documents and payments between you.
   Every change runs inside `withOrg`, so row level security applies and one failed step undoes the whole request. */

const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const AMOUNT = '^\\d{1,13}(\\.\\d{1,2})?$';
const ID = '^\\d{1,18}$';
const QTY = '^\\d{1,9}(\\.\\d{1,3})?$';
const idParam = { params: { type: 'object', properties: { id: { type: 'string', pattern: ID } } } };
const override = { overrideReason: { type: 'string', maxLength: 300 } };

type Scope = (permission: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
type Deps = { pool: pg.Pool; scope: Scope; me: (req: FastifyRequest) => string };

const line = { type: 'object', additionalProperties: false, properties: {
  itemId: { type: 'string', pattern: ID }, description: { type: 'string', maxLength: 300 }, hsnSac: { type: 'string', maxLength: 12 },
  quantity: { type: 'string', pattern: QTY }, unitPrice: { type: 'string', pattern: AMOUNT }, discount: { type: 'string', pattern: AMOUNT }, taxCode: { type: 'string', maxLength: 20 } } };
const docBody = { type: 'object', required: ['partyId', 'date', 'lines'], additionalProperties: false, properties: {
  partyId: { type: 'string', pattern: ID }, date: { type: 'string', pattern: DATE }, dueDate: { type: 'string', pattern: DATE }, placeOfSupply: { type: 'string', pattern: '^\\d{2}$' },
  supplierRef: { type: 'string', maxLength: 60 }, relatedDocumentId: { type: 'string', pattern: ID }, memo: { type: 'string', maxLength: 500 }, roundOff: { type: 'boolean' },
  lines: { type: 'array', minItems: 1, maxItems: 200, items: line } } };
const allocBody = { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', required: ['documentId', 'amount'], additionalProperties: false, properties: {
  documentId: { type: 'string', pattern: ID }, amount: { type: 'string', pattern: AMOUNT } } } };
const allocs = (a: { documentId: string; amount: string }[]): Alloc[] => a.map((x) => ({ documentId: BigInt(x.documentId), amount: toPaise(x.amount) }));
const voidBody = { type: 'object', required: ['date', 'reason'], additionalProperties: false, properties: { date: { type: 'string', pattern: DATE }, reason: { type: 'string', minLength: 1, maxLength: 300 }, ...override } };

type RawDoc = { partyId: string; date: string; dueDate?: string; placeOfSupply?: string; supplierRef?: string; relatedDocumentId?: string; memo?: string; roundOff?: boolean;
  lines: { itemId?: string; description?: string; hsnSac?: string; quantity?: string; unitPrice?: string; discount?: string; taxCode?: string }[] };
const docIn = (kind: DocKind, b: RawDoc): DocIn => ({ ...b, kind, partyId: BigInt(b.partyId), relatedDocumentId: b.relatedDocumentId ? BigInt(b.relatedDocumentId) : undefined,
  lines: b.lines.map((l) => ({ ...l, itemId: l.itemId ? BigInt(l.itemId) : undefined })) });

export const registerBookRoutes = (app: FastifyInstance, { pool, scope, me }: Deps): void => {
  const base = '/v1/orgs/:orgId';
  const orgOf = (req: FastifyRequest) => req.org?.id as bigint;
  const run = <T>(req: FastifyRequest, fn: (c: Db, orgId: bigint) => Promise<T>) => withOrg(pool, orgOf(req), (c) => fn(c, orgOf(req)));
  const notFound = (reply: FastifyReply, what: string) => reply.code(404).send({ error: { code: 'not_found', message: `no such ${what}` } });
  /** A locked period can be posted into only with a stated reason, and only by a role allowed to. */
  const lockOverride = (req: FastifyRequest, reason?: string) => {
    if (!reason) return undefined;
    if (!can(req.org?.role as Role, 'period.override')) throw new LedgerError('forbidden_override', 'your role cannot post into a locked period');
    return { reason };
  };

  /* ---- organization profile and tax rates */
  app.get(`${base}/profile`, { preHandler: scope('org.read') }, async (req) =>
    run(req, async (c, orgId) => (await c.query(`SELECT id, name, legal_name, pan, gstin, state_code FROM organizations WHERE id = $1`, [orgId])).rows[0]));
  app.put(`${base}/profile`, { preHandler: scope('org.manage'), schema: { body: { type: 'object', additionalProperties: false, properties: {
    legalName: { type: 'string', maxLength: 200 }, gstin: { type: 'string', maxLength: 15 }, stateCode: { type: 'string', pattern: '^\\d{2}$' }, pan: { type: 'string', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$' } } } } }, async (req) => {
    const b = req.body as { legalName?: string; gstin?: string; stateCode?: string; pan?: string };
    if (b.gstin && !validGstin(b.gstin.toUpperCase())) throw new LedgerError('bad_gstin', `${b.gstin} is not a valid GSTIN`);
    if (b.stateCode && !validStateCode(b.stateCode)) throw new LedgerError('bad_state', `${b.stateCode} is not a GST state code`);
    const state = b.stateCode ?? (b.gstin ? b.gstin.slice(0, 2) : null);
    return run(req, async (c, orgId) => {
      await c.query(`UPDATE organizations SET legal_name = COALESCE($2, legal_name), gstin = COALESCE($3, gstin), state_code = COALESCE($4, state_code), pan = COALESCE($5, pan) WHERE id = $1`,
        [orgId, b.legalName ?? null, b.gstin?.toUpperCase() ?? null, state, b.pan ?? null]);
      await audit(c, orgId, { actor: me(req), action: 'organization.profile_updated', entityType: 'organization', entityId: orgId });
      return (await c.query(`SELECT id, name, legal_name, pan, gstin, state_code FROM organizations WHERE id = $1`, [orgId])).rows[0];
    });
  });

  app.get(`${base}/tax-rates`, { preHandler: scope('org.read') }, async (req) =>
    run(req, async (c) => (await c.query(`SELECT code, name, rate_bp, effective_from::text AS effective_from FROM tax_rates ORDER BY code, effective_from`)).rows));
  app.post(`${base}/tax-rates`, { preHandler: scope('tax.manage'), schema: { body: { type: 'object', required: ['code', 'name', 'rateBp', 'effectiveFrom'], additionalProperties: false, properties: {
    code: { type: 'string', pattern: '^[A-Z0-9_]{2,20}$' }, name: { type: 'string', minLength: 1, maxLength: 80 }, rateBp: { type: 'integer', minimum: 0, maximum: 10000 }, effectiveFrom: { type: 'string', pattern: DATE } } } } }, async (req, reply) => {
    const b = req.body as { code: string; name: string; rateBp: number; effectiveFrom: string };
    await run(req, (c, orgId) => addTaxRate(c, orgId, b, me(req)));
    return reply.code(201).send(b);
  });

  /* ---- parties */
  const partyProps = { kind: { type: 'string', enum: ['CUSTOMER', 'VENDOR', 'BOTH'] }, name: { type: 'string', minLength: 1, maxLength: 160 }, gstin: { type: 'string', maxLength: 15 },
    pan: { type: 'string', maxLength: 10 }, stateCode: { type: 'string', pattern: '^\\d{2}$' }, phone: { type: 'string', maxLength: 20 }, email: { type: 'string', maxLength: 200 },
    creditDays: { type: 'integer', minimum: 0, maximum: 365 }, externalRef: { type: 'string', maxLength: 80 } };
  app.get(`${base}/parties`, { preHandler: scope('party.read'), schema: { querystring: { type: 'object', properties: {
    kind: { type: 'string', enum: ['CUSTOMER', 'VENDOR'] }, q: { type: 'string', maxLength: 80 }, limit: { type: 'integer', minimum: 1, maximum: 500 } } } } }, async (req) => {
    const q = req.query as { kind?: string; q?: string; limit?: number };
    return run(req, async (c) => (await c.query(
      `SELECT id, kind, name, gstin, state_code, phone, email, credit_days, active, external_ref FROM parties
        WHERE ($1::text IS NULL OR kind IN ($1, 'BOTH')) AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%') ORDER BY name LIMIT $3`, [q.kind ?? null, q.q ?? null, q.limit ?? 200])).rows);
  });
  app.post(`${base}/parties`, { preHandler: scope('party.write'), schema: { body: { type: 'object', required: ['kind', 'name'], additionalProperties: false, properties: partyProps } } }, async (req, reply) => {
    const id = await run(req, (c, orgId) => createParty(c, orgId, req.body as Parameters<typeof createParty>[2], me(req)));
    return reply.code(201).send({ id });
  });
  app.get(`${base}/parties/:id`, { preHandler: scope('party.read'), schema: idParam }, async (req, reply) => {
    const row = await run(req, async (c) => (await c.query(`SELECT id, kind, name, gstin, pan, state_code, phone, email, credit_days, active, external_ref FROM parties WHERE id = $1`, [(req.params as { id: string }).id])).rows[0]);
    return row ?? notFound(reply, 'party');
  });
  app.patch(`${base}/parties/:id`, { preHandler: scope('party.write'), schema: { ...idParam, body: { type: 'object', additionalProperties: false, properties: { ...partyProps, active: { type: 'boolean' } } } } }, async (req, reply) => {
    const ok = await run(req, (c, orgId) => updateParty(c, orgId, BigInt((req.params as { id: string }).id), req.body as Parameters<typeof updateParty>[3], me(req)));
    return ok ? { ok: true } : notFound(reply, 'party');
  });

  /* ---- items */
  app.get(`${base}/items`, { preHandler: scope('item.read') }, async (req) => run(req, async (c) => (await c.query(
    `SELECT id, sku, name, kind, hsn_sac, tax_code, sale_price_minor, purchase_price_minor, active FROM items ORDER BY name LIMIT 1000`)).rows));
  app.post(`${base}/items`, { preHandler: scope('item.write'), schema: { body: { type: 'object', required: ['sku', 'name'], additionalProperties: false, properties: {
    sku: { type: 'string', minLength: 1, maxLength: 60 }, name: { type: 'string', minLength: 1, maxLength: 160 }, kind: { type: 'string', enum: ['GOODS', 'SERVICE'] }, hsnSac: { type: 'string', maxLength: 12 },
    taxCode: { type: 'string', maxLength: 20 }, salePrice: { type: 'string', pattern: AMOUNT }, purchasePrice: { type: 'string', pattern: AMOUNT } } } } }, async (req, reply) => {
    const id = await run(req, (c, orgId) => createItem(c, orgId, req.body as Parameters<typeof createItem>[2], me(req)));
    return reply.code(201).send({ id });
  });

  /* ---- invoices, bills and credit notes */
  const kinds: [string, DocKind, string, string][] = [['invoices', 'INVOICE', 'invoice', 'invoice'], ['bills', 'BILL', 'bill', 'bill'], ['credit-notes', 'CREDIT_NOTE', 'invoice', 'credit note']];
  for (const [path, kind, perm, label] of kinds) {
    const url = `${base}/${path}`;
    app.get(url, { preHandler: scope(`${perm}.read`), schema: { querystring: { type: 'object', properties: {
      status: { type: 'string', enum: ['DRAFT', 'ISSUED', 'VOID'] }, partyId: { type: 'string', pattern: ID }, before: { type: 'string', pattern: ID }, limit: { type: 'integer', minimum: 1, maximum: 200 } } } } }, async (req) => {
      const q = req.query as { status?: string; partyId?: string; before?: string; limit?: number };
      const limit = q.limit ?? 50;
      const rows = await run(req, (c) => listDocuments(c, kind, { status: q.status, partyId: q.partyId ? BigInt(q.partyId) : undefined, before: q.before ? BigInt(q.before) : undefined, limit }));
      return { documents: rows, next: rows.length === limit ? rows[rows.length - 1]?.id : null };
    });
    app.post(url, { preHandler: scope(`${perm}.write`), schema: { body: docBody } }, async (req, reply) =>
      reply.code(201).send({ id: await run(req, (c, orgId) => saveDraft(c, orgId, null, docIn(kind, req.body as RawDoc), me(req))) }));
    app.get(`${url}/:id`, { preHandler: scope(`${perm}.read`), schema: idParam }, async (req, reply) =>
      (await run(req, (c) => getDocument(c, kind, BigInt((req.params as { id: string }).id)))) ?? notFound(reply, label));
    app.put(`${url}/:id`, { preHandler: scope(`${perm}.write`), schema: { ...idParam, body: docBody } }, async (req) => {
      const id = BigInt((req.params as { id: string }).id);
      await run(req, (c, orgId) => saveDraft(c, orgId, id, docIn(kind, req.body as RawDoc), me(req)));
      return { id };
    });
    app.delete(`${url}/:id`, { preHandler: scope(`${perm}.write`), schema: idParam }, async (req) => {
      await run(req, (c, orgId) => deleteDraft(c, orgId, kind, BigInt((req.params as { id: string }).id), me(req)));
      return { ok: true };
    });
    app.post(`${url}/:id/issue`, { preHandler: scope(`${perm}.write`), schema: { ...idParam, body: { type: ['object', 'null'], additionalProperties: false, properties: override } } }, async (req) => {
      const b = (req.body ?? {}) as { overrideReason?: string };
      return run(req, (c, orgId) => issueDocument(c, orgId, kind, BigInt((req.params as { id: string }).id), me(req), lockOverride(req, b.overrideReason)));
    });
    app.post(`${url}/:id/void`, { preHandler: scope(`${perm}.void`), schema: { ...idParam, body: voidBody } }, async (req) => {
      const b = req.body as { date: string; reason: string; overrideReason?: string };
      await run(req, (c, orgId) => voidDocument(c, orgId, kind, BigInt((req.params as { id: string }).id), b, me(req), lockOverride(req, b.overrideReason)));
      return { ok: true };
    });
  }
  app.post(`${base}/credit-notes/:id/apply`, { preHandler: scope('invoice.write'), schema: { ...idParam, body: { type: 'object', required: ['allocations'], additionalProperties: false, properties: { allocations: allocBody } } } }, async (req) => {
    await run(req, (c, orgId) => applyCreditNote(c, orgId, BigInt((req.params as { id: string }).id), allocs((req.body as { allocations: { documentId: string; amount: string }[] }).allocations), me(req)));
    return { ok: true };
  });

  /* ---- payments */
  app.get(`${base}/payments`, { preHandler: scope('payment.read'), schema: { querystring: { type: 'object', properties: {
    direction: { type: 'string', enum: ['IN', 'OUT'] }, partyId: { type: 'string', pattern: ID }, before: { type: 'string', pattern: ID }, limit: { type: 'integer', minimum: 1, maximum: 200 } } } } }, async (req) => {
    const q = req.query as { direction?: string; partyId?: string; before?: string; limit?: number };
    const limit = q.limit ?? 50;
    const rows = await run(req, (c) => listPayments(c, { direction: q.direction, partyId: q.partyId ? BigInt(q.partyId) : undefined, before: q.before ? BigInt(q.before) : undefined, limit }));
    return { payments: rows, next: rows.length === limit ? rows[rows.length - 1]?.id : null };
  });
  app.post(`${base}/payments`, { preHandler: scope('payment.write'), schema: { body: { type: 'object', required: ['direction', 'partyId', 'date', 'mode', 'amount'], additionalProperties: false, properties: {
    direction: { type: 'string', enum: ['IN', 'OUT'] }, partyId: { type: 'string', pattern: ID }, date: { type: 'string', pattern: DATE }, mode: { type: 'string', enum: ['CASH', 'BANK', 'UPI', 'CARD'] },
    amount: { type: 'string', pattern: AMOUNT }, reference: { type: 'string', maxLength: 80 }, allocations: allocBody, ...override } } } }, async (req, reply) => {
    const key = String(req.headers['idempotency-key'] ?? '');
    if (key.length < 8 || key.length > 128) return reply.code(400).send({ error: { code: 'idempotency_key_required', message: 'send an Idempotency-Key header (8 to 128 characters), one per user action' } });
    const b = req.body as { direction: 'IN' | 'OUT'; partyId: string; date: string; mode: 'CASH' | 'BANK' | 'UPI' | 'CARD'; amount: string; reference?: string; allocations?: { documentId: string; amount: string }[]; overrideReason?: string };
    const out = await run(req, (c, orgId) => createPayment(c, orgId, { direction: b.direction, partyId: BigInt(b.partyId), date: b.date, mode: b.mode, amount: toPaise(b.amount), reference: b.reference,
      allocations: b.allocations ? allocs(b.allocations) : undefined, idempotencyKey: key }, me(req), lockOverride(req, b.overrideReason)));
    return reply.code(out.replayed ? 200 : 201).send({ id: out.id, number: out.number, replayed: out.replayed });
  });
  app.get(`${base}/payments/:id`, { preHandler: scope('payment.read'), schema: idParam }, async (req, reply) =>
    (await run(req, (c) => getPayment(c, BigInt((req.params as { id: string }).id)))) ?? notFound(reply, 'payment'));
  app.post(`${base}/payments/:id/allocations`, { preHandler: scope('payment.write'), schema: { ...idParam, body: { type: 'object', required: ['allocations'], additionalProperties: false, properties: { allocations: allocBody } } } }, async (req) => {
    await run(req, (c, orgId) => allocatePayment(c, orgId, BigInt((req.params as { id: string }).id), allocs((req.body as { allocations: { documentId: string; amount: string }[] }).allocations), me(req)));
    return { ok: true };
  });
  app.post(`${base}/payments/:id/void`, { preHandler: scope('payment.void'), schema: { ...idParam, body: voidBody } }, async (req) => {
    const b = req.body as { date: string; reason: string; overrideReason?: string };
    await run(req, (c, orgId) => voidPayment(c, orgId, BigInt((req.params as { id: string }).id), b, me(req), lockOverride(req, b.overrideReason)));
    return { ok: true };
  });

  /* ---- ageing */
  app.get(`${base}/reports/ageing`, { preHandler: scope('report.read'), schema: { querystring: { type: 'object', required: ['type', 'asOf'], properties: {
    type: { type: 'string', enum: ['receivables', 'payables'] }, asOf: { type: 'string', pattern: DATE } } } } }, async (req) => {
    const q = req.query as { type: string; asOf: string };
    return run(req, (c, orgId) => ageing(c, orgId, q.type === 'receivables' ? 'INVOICE' : 'BILL', q.asOf));
  });
};
