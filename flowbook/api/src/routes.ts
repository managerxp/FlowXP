import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { audit } from './audit.ts';
import { withOrg } from './db.ts';
import type { Db } from './db.ts';
import { ageing, allocatePayment, applyCreditNote, applyDebitNote, convertDocument, createOpeningBalance, createPayment, deleteDraft, getDocument, getPayment, issueDocument, listDocuments, listPayments, saveDraft, setOutcome, voidDocument, voidPayment } from './documents.ts';
import type { Alloc, DocIn, DocKind } from './documents.ts';
import { listExpenses, recordExpense, voidExpense } from './expenses.ts';
import { ewayBill } from './eway.ts';
import { gstr1, gstr3b } from './gstr.ts';
import { PROFILE_COLUMNS, saveExtras } from './profile.ts';
import type { ProfileExtras } from './profile.ts';
import { IMPORT_LIMIT, importItems, importParties } from './import.ts';
import { getSettings as getWhatsapp, listMessages, saveSettings as saveWhatsapp, sendMessage } from './whatsapp.ts';
import { createTemplate, deleteTemplate, listTemplates, runDue, setTemplateActive } from './recurring.ts';
import type { Every } from './recurring.ts';
import { salesAnalysis } from './analysis.ts';
import { getEmailSettings, listEmails, saveEmailSettings, sendDocument } from './email.ts';
import type { EmailSettingsIn } from './email.ts';
import { CURRENCIES, listRates, rateOn, saveRate } from './fx.ts';
import { addTime, createProject, deleteTime, getProject, invoiceTime, listProjects, updateProject } from './projects.ts';
import { addAsset, assetRegister, cancelAsset, disposeAsset, runDepreciation } from './assets.ts';
import type { AssetIn } from './assets.ts';
import { adjust, setTracking, stockLedger, stockSummary } from './stock.ts';
import { addEntry, bankAccounts, importStatement, matchLine, setIgnored, unmatchLine, workbench } from './reconcile.ts';
import { partyStatement } from './statement.ts';
import { UQC, validGstin, validStateCode } from './gst.ts';
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
  quantity: { type: 'string', pattern: QTY }, unitPrice: { type: 'string', pattern: AMOUNT }, discount: { type: 'string', pattern: AMOUNT }, taxCode: { type: 'string', maxLength: 20 }, unit: { type: 'string', enum: UQC }, inclusive: { type: 'boolean' } } };
const docBody = { type: 'object', required: ['partyId', 'date', 'lines'], additionalProperties: false, properties: {
  partyId: { type: 'string', pattern: ID }, date: { type: 'string', pattern: DATE }, dueDate: { type: 'string', pattern: DATE }, placeOfSupply: { type: 'string', pattern: '^\\d{2}$' },
  supplierRef: { type: 'string', maxLength: 60 }, relatedDocumentId: { type: 'string', pattern: ID }, memo: { type: 'string', maxLength: 500 }, roundOff: { type: 'boolean' },
  reverseCharge: { type: 'boolean' }, tcsRateBp: { type: 'integer', minimum: 0, maximum: 2000 }, tcsSection: { type: 'string', maxLength: 30 },
  projectId: { type: 'string', pattern: ID }, currency: { type: 'string', pattern: '^[A-Z]{3}$' }, fxRate: { type: 'string', pattern: '^\\d{1,9}(\\.\\d{1,6})?$' },
  lines: { type: 'array', minItems: 1, maxItems: 200, items: line } } };
const allocBody = { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', required: ['documentId', 'amount'], additionalProperties: false, properties: {
  documentId: { type: 'string', pattern: ID }, amount: { type: 'string', pattern: AMOUNT } } } };
const allocs = (a: { documentId: string; amount: string }[]): Alloc[] => a.map((x) => ({ documentId: BigInt(x.documentId), amount: toPaise(x.amount) }));
const voidBody = { type: 'object', required: ['date', 'reason'], additionalProperties: false, properties: { date: { type: 'string', pattern: DATE }, reason: { type: 'string', minLength: 1, maxLength: 300 }, ...override } };

type RawDoc = { projectId?: string; currency?: string; fxRate?: string; partyId: string; date: string; dueDate?: string; placeOfSupply?: string; supplierRef?: string; relatedDocumentId?: string; memo?: string; roundOff?: boolean; reverseCharge?: boolean; tcsRateBp?: number; tcsSection?: string;
  lines: { itemId?: string; description?: string; hsnSac?: string; quantity?: string; unitPrice?: string; discount?: string; taxCode?: string; unit?: string; inclusive?: boolean }[] };
const docIn = (kind: DocKind, b: RawDoc): DocIn => ({ ...b, kind, partyId: BigInt(b.partyId), projectId: b.projectId ? BigInt(b.projectId) : undefined, relatedDocumentId: b.relatedDocumentId ? BigInt(b.relatedDocumentId) : undefined,
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
    run(req, async (c, orgId) => (await c.query(`SELECT id, name, legal_name, pan, gstin, state_code, invoice_prefix, ${PROFILE_COLUMNS} FROM organizations WHERE id = $1`, [orgId])).rows[0]));
  app.put(`${base}/profile`, { preHandler: scope('org.manage'), schema: { body: { type: 'object', additionalProperties: false, properties: {
    legalName: { type: 'string', maxLength: 200 }, gstin: { type: 'string', maxLength: 15 }, stateCode: { type: 'string', pattern: '^\\d{2}$' }, pan: { type: 'string', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$' },
    invoicePrefix: { type: 'string', pattern: '^[A-Z0-9]{1,3}$' },
    addressLine: { type: 'string', maxLength: 200 }, city: { type: 'string', maxLength: 80 }, pincode: { type: 'string', maxLength: 6 }, phone: { type: 'string', maxLength: 20 }, email: { type: 'string', maxLength: 200 },
    bankName: { type: 'string', maxLength: 80 }, bankAccount: { type: 'string', maxLength: 30 }, bankIfsc: { type: 'string', maxLength: 11 }, upiId: { type: 'string', maxLength: 80 }, terms: { type: 'string', maxLength: 1000 },
    printSettings: { type: 'object', additionalProperties: false, properties: { paper: { type: 'string', enum: ['A4', 'A5', 'THERMAL'] }, accent: { type: 'string', maxLength: 7 }, title: { type: 'string', maxLength: 40 },
      showHsn: { type: 'boolean' }, showBank: { type: 'boolean' }, showTerms: { type: 'boolean' }, showUnit: { type: 'boolean' } } } } } } }, async (req) => {
    const b = req.body as { legalName?: string; gstin?: string; stateCode?: string; pan?: string; invoicePrefix?: string } & ProfileExtras;
    if (b.gstin && !validGstin(b.gstin.toUpperCase())) throw new LedgerError('bad_gstin', `${b.gstin} is not a valid GSTIN`);
    if (b.stateCode && !validStateCode(b.stateCode)) throw new LedgerError('bad_state', `${b.stateCode} is not a GST state code`);
    const state = b.stateCode ?? (b.gstin ? b.gstin.slice(0, 2) : null);
    return run(req, async (c, orgId) => {
      await c.query(`UPDATE organizations SET legal_name = COALESCE($2, legal_name), gstin = COALESCE($3, gstin), state_code = COALESCE($4, state_code), pan = COALESCE($5, pan), invoice_prefix = COALESCE($6, invoice_prefix) WHERE id = $1`,
        [orgId, b.legalName ?? null, b.gstin?.toUpperCase() ?? null, state, b.pan ?? null, b.invoicePrefix ?? null]);
      await saveExtras(c, orgId, b);
      await audit(c, orgId, { actor: me(req), action: 'organization.profile_updated', entityType: 'organization', entityId: orgId });
      return (await c.query(`SELECT id, name, legal_name, pan, gstin, state_code, invoice_prefix, ${PROFILE_COLUMNS} FROM organizations WHERE id = $1`, [orgId])).rows[0];
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
    creditDays: { type: 'integer', minimum: 0, maximum: 365 }, externalRef: { type: 'string', maxLength: 80 },
    addressLine: { type: 'string', maxLength: 200 }, city: { type: 'string', maxLength: 80 }, pincode: { type: 'string', maxLength: 6 }, shipAddressLine: { type: 'string', maxLength: 200 }, shipCity: { type: 'string', maxLength: 80 }, shipPincode: { type: 'string', maxLength: 6 } };
  app.get(`${base}/parties`, { preHandler: scope('party.read'), schema: { querystring: { type: 'object', properties: {
    kind: { type: 'string', enum: ['CUSTOMER', 'VENDOR'] }, q: { type: 'string', maxLength: 80 }, limit: { type: 'integer', minimum: 1, maximum: 500 } } } } }, async (req) => {
    const q = req.query as { kind?: string; q?: string; limit?: number };
    return run(req, async (c) => (await c.query(
      `SELECT id, kind, name, gstin, state_code, phone, email, credit_days, active, external_ref, whatsapp_opt_out, address_line, city, pincode, ship_address_line, ship_city, ship_pincode FROM parties
        WHERE ($1::text IS NULL OR kind IN ($1, 'BOTH')) AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%') ORDER BY name LIMIT $3`, [q.kind ?? null, q.q ?? null, q.limit ?? 200])).rows);
  });
  app.post(`${base}/parties`, { preHandler: scope('party.write'), schema: { body: { type: 'object', required: ['kind', 'name'], additionalProperties: false, properties: partyProps } } }, async (req, reply) => {
    const id = await run(req, (c, orgId) => createParty(c, orgId, req.body as Parameters<typeof createParty>[2], me(req)));
    return reply.code(201).send({ id });
  });
  app.get(`${base}/parties/:id`, { preHandler: scope('party.read'), schema: idParam }, async (req, reply) => {
    const row = await run(req, async (c) => (await c.query(`SELECT id, kind, name, gstin, pan, state_code, phone, email, credit_days, active, external_ref, whatsapp_opt_out, address_line, city, pincode, ship_address_line, ship_city, ship_pincode FROM parties WHERE id = $1`, [(req.params as { id: string }).id])).rows[0]);
    return row ?? notFound(reply, 'party');
  });
  app.patch(`${base}/parties/:id`, { preHandler: scope('party.write'), schema: { ...idParam, body: { type: 'object', additionalProperties: false, properties: { ...partyProps, active: { type: 'boolean' }, whatsappOptOut: { type: 'boolean' } } } } }, async (req, reply) => {
    const ok = await run(req, (c, orgId) => updateParty(c, orgId, BigInt((req.params as { id: string }).id), req.body as Parameters<typeof updateParty>[3], me(req)));
    return ok ? { ok: true } : notFound(reply, 'party');
  });

  /* ---- items */
  app.get(`${base}/items`, { preHandler: scope('item.read') }, async (req) => run(req, async (c) => (await c.query(
    `SELECT id, sku, name, kind, hsn_sac, unit, tax_code, sale_price_minor, purchase_price_minor, active, track_stock FROM items ORDER BY name LIMIT 1000`)).rows));
  app.post(`${base}/items`, { preHandler: scope('item.write'), schema: { body: { type: 'object', required: ['sku', 'name'], additionalProperties: false, properties: {
    sku: { type: 'string', minLength: 1, maxLength: 60 }, name: { type: 'string', minLength: 1, maxLength: 160 }, kind: { type: 'string', enum: ['GOODS', 'SERVICE'] }, hsnSac: { type: 'string', maxLength: 12 }, unit: { type: 'string', enum: UQC },
    taxCode: { type: 'string', maxLength: 20 }, salePrice: { type: 'string', pattern: AMOUNT }, purchasePrice: { type: 'string', pattern: AMOUNT }, trackStock: { type: 'boolean' }, reorderLevel: { type: 'string', pattern: QTY } } } } }, async (req, reply) => {
    const { trackStock, reorderLevel, ...item } = req.body as Parameters<typeof createItem>[2] & { trackStock?: boolean; reorderLevel?: string };
    const id = await run(req, async (c, orgId) => {
      const made = await createItem(c, orgId, item, me(req));
      if (trackStock || reorderLevel) await setTracking(c, orgId, made, { trackStock, reorderLevel }, me(req));
      return made;
    });
    return reply.code(201).send({ id });
  });
  app.patch(`${base}/items/:id`, { preHandler: scope('item.write'), schema: { ...idParam, body: { type: 'object', additionalProperties: false, properties: { trackStock: { type: 'boolean' }, reorderLevel: { type: 'string', pattern: QTY } } } } }, async (req) => {
    await run(req, (c, orgId) => setTracking(c, orgId, BigInt((req.params as { id: string }).id), req.body as { trackStock?: boolean; reorderLevel?: string }, me(req)));
    return { ok: true };
  });

  /* ---- projects and time */
  const money = { type: 'string', pattern: AMOUNT };
  app.get(`${base}/projects`, { preHandler: scope('invoice.read'), schema: { querystring: { type: 'object', properties: { status: { type: 'string', enum: ['ACTIVE', 'COMPLETED', 'ARCHIVED'] } } } } }, async (req) => run(req, (c) => listProjects(c, (req.query as { status?: string }).status)));
  app.post(`${base}/projects`, { preHandler: scope('invoice.write'), schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: {
    name: { type: 'string', minLength: 1, maxLength: 160 }, code: { type: 'string', maxLength: 30 }, customerId: { type: 'string', pattern: ID }, hourlyRate: money, budget: money, notes: { type: 'string', maxLength: 1000 } } } } }, async (req, reply) => {
    const b = req.body as { name: string; code?: string; customerId?: string; hourlyRate?: string; budget?: string; notes?: string };
    return reply.code(201).send({ id: await run(req, (c, orgId) => createProject(c, orgId, { ...b, customerId: b.customerId ? BigInt(b.customerId) : undefined }, me(req))) });
  });
  app.get(`${base}/projects/:id`, { preHandler: scope('invoice.read'), schema: idParam }, async (req, reply) =>
    (await run(req, (c) => getProject(c, BigInt((req.params as { id: string }).id)))) ?? notFound(reply, 'project'));
  app.patch(`${base}/projects/:id`, { preHandler: scope('invoice.write'), schema: { ...idParam, body: { type: 'object', additionalProperties: false, properties: {
    name: { type: 'string', minLength: 1, maxLength: 160 }, customerId: { type: 'string', pattern: ID }, hourlyRate: money, budget: money, notes: { type: 'string', maxLength: 1000 }, status: { type: 'string', enum: ['ACTIVE', 'COMPLETED', 'ARCHIVED'] } } } } }, async (req) => {
    const b = req.body as { customerId?: string } & Record<string, unknown>;
    await run(req, (c, orgId) => updateProject(c, orgId, BigInt((req.params as { id: string }).id), { ...b, customerId: b.customerId ? BigInt(b.customerId) : undefined } as Parameters<typeof updateProject>[3], me(req)));
    return { ok: true };
  });
  app.post(`${base}/projects/:id/time`, { preHandler: scope('invoice.write'), schema: { ...idParam, body: { type: 'object', required: ['date', 'hours'], additionalProperties: false, properties: {
    date: { type: 'string', pattern: DATE }, hours: { type: 'string', maxLength: 8 }, notes: { type: 'string', maxLength: 300 }, billable: { type: 'boolean' }, rate: money } } } }, async (req, reply) =>
    reply.code(201).send({ id: await run(req, (c, orgId) => addTime(c, orgId, BigInt((req.params as { id: string }).id), req.body as Parameters<typeof addTime>[3], me(req))) }));
  app.delete(`${base}/time/:id`, { preHandler: scope('invoice.write'), schema: idParam }, async (req) => {
    await run(req, (c, orgId) => deleteTime(c, orgId, BigInt((req.params as { id: string }).id), me(req)));
    return { ok: true };
  });
  app.post(`${base}/projects/:id/invoice`, { preHandler: scope('invoice.write'), schema: { ...idParam, body: { type: 'object', required: ['date', 'taxCode'], additionalProperties: false, properties: {
    date: { type: 'string', pattern: DATE }, taxCode: { type: 'string', minLength: 1, maxLength: 20 }, entryIds: { type: 'array', maxItems: 500, items: { type: 'string', pattern: ID } } } } } }, async (req, reply) => {
    const b = req.body as { date: string; taxCode: string; entryIds?: string[] };
    return reply.code(201).send(await run(req, (c, orgId) => invoiceTime(c, orgId, BigInt((req.params as { id: string }).id), { ...b, entryIds: b.entryIds?.map((x) => BigInt(x)) }, me(req))));
  });

  /* ---- fixed assets */
  const acct = { type: 'string', minLength: 1, maxLength: 40 };
  app.get(`${base}/assets`, { preHandler: scope('journal.read') }, async (req) => run(req, (c) => assetRegister(c)));
  app.post(`${base}/assets`, { preHandler: scope('journal.post'), schema: { body: { type: 'object', required: ['name', 'purchaseDate', 'cost', 'method', 'paidFrom'], additionalProperties: false, properties: {
    name: { type: 'string', minLength: 1, maxLength: 160 }, tag: { type: 'string', maxLength: 40 }, category: { type: 'string', maxLength: 60 }, purchaseDate: { type: 'string', pattern: DATE }, startDate: { type: 'string', pattern: DATE },
    cost: { type: 'string', pattern: AMOUNT }, salvage: { type: 'string', pattern: AMOUNT }, method: { type: 'string', enum: ['SLM', 'WDV', 'NONE'] }, lifeYears: { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,2})?$' },
    ratePercent: { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,2})?$' }, paidFrom: acct, openingAccumulated: { type: 'string', pattern: AMOUNT }, ...override } } } }, async (req, reply) => {
    const b = req.body as AssetIn & { overrideReason?: string };
    return reply.code(201).send(await run(req, (c, orgId) => addAsset(c, orgId, b, me(req), lockOverride(req, b.overrideReason))));
  });
  app.post(`${base}/assets/depreciation`, { preHandler: scope('journal.post'), schema: { body: { type: 'object', required: ['through'], additionalProperties: false, properties: { through: { type: 'string', pattern: '^\\d{4}-\\d{2}$' }, ...override } } } }, async (req) => {
    const b = req.body as { through: string; overrideReason?: string };
    return run(req, (c, orgId) => runDepreciation(c, orgId, b.through, me(req), lockOverride(req, b.overrideReason)));
  });
  app.post(`${base}/assets/:id/dispose`, { preHandler: scope('journal.post'), schema: { ...idParam, body: { type: 'object', required: ['date'], additionalProperties: false, properties: { date: { type: 'string', pattern: DATE }, proceeds: { type: 'string', pattern: AMOUNT }, receivedIn: acct, ...override } } } }, async (req) => {
    const b = req.body as { date: string; proceeds?: string; receivedIn?: string; overrideReason?: string };
    return run(req, (c, orgId) => disposeAsset(c, orgId, BigInt((req.params as { id: string }).id), { date: b.date, proceeds: b.proceeds ?? '0', receivedIn: b.receivedIn }, me(req), lockOverride(req, b.overrideReason)));
  });
  app.post(`${base}/assets/:id/cancel`, { preHandler: scope('journal.post'), schema: { ...idParam, body: voidBody } }, async (req) => {
    const b = req.body as { date: string; reason: string; overrideReason?: string };
    await run(req, (c, orgId) => cancelAsset(c, orgId, BigInt((req.params as { id: string }).id), b.reason, b.date, me(req), lockOverride(req, b.overrideReason)));
    return { ok: true };
  });

  /* ---- exchange rates */
  app.get(`${base}/exchange-rates`, { preHandler: scope('org.read') }, async (req) => run(req, async (c) => ({ currencies: CURRENCIES, rates: await listRates(c) })));
  app.get(`${base}/exchange-rates/on`, { preHandler: scope('org.read'), schema: { querystring: { type: 'object', required: ['currency', 'date'], properties: { currency: { type: 'string', pattern: '^[A-Z]{3}$' }, date: { type: 'string', pattern: DATE } } } } }, async (req) => {
    const q = req.query as { currency: string; date: string };
    return run(req, async (c) => ({ rate: await rateOn(c, q.currency, q.date) }));
  });
  app.put(`${base}/exchange-rates`, { preHandler: scope('org.manage'), schema: { body: { type: 'object', required: ['currency', 'date', 'rate'], additionalProperties: false, properties: {
    currency: { type: 'string', pattern: '^[A-Z]{3}$' }, date: { type: 'string', pattern: DATE }, rate: { type: 'string', pattern: '^\\d{1,9}(\\.\\d{1,6})?$' } } } } }, async (req) => {
    await run(req, (c, orgId) => saveRate(c, orgId, req.body as { currency: string; date: string; rate: string }, me(req)));
    return { ok: true };
  });

  /* ---- stock */
  app.get(`${base}/stock`, { preHandler: scope('item.read') }, async (req) => run(req, (c) => stockSummary(c)));
  app.get(`${base}/stock/items/:id`, { preHandler: scope('item.read'), schema: idParam }, async (req) => run(req, (c) => stockLedger(c, BigInt((req.params as { id: string }).id), 200)));
  app.post(`${base}/stock/adjustments`, { preHandler: scope('item.write'), schema: { body: { type: 'object', required: ['itemId', 'date', 'direction', 'quantity', 'counterAccount', 'reason'], additionalProperties: false, properties: {
    itemId: { type: 'string', pattern: ID }, date: { type: 'string', pattern: DATE }, direction: { type: 'string', enum: ['IN', 'OUT'] }, quantity: { type: 'string', pattern: QTY }, unitCost: { type: 'string', pattern: AMOUNT }, counterAccount: { type: 'string', minLength: 1, maxLength: 40 }, reason: { type: 'string', minLength: 1, maxLength: 200 } } } } }, async (req) => {
    const b = req.body as { itemId: string; date: string; direction: 'IN' | 'OUT'; quantity: string; unitCost?: string; counterAccount: string; reason: string };
    return run(req, (c, orgId) => adjust(c, orgId, { ...b, itemId: BigInt(b.itemId) }, me(req)));
  });


  /* ---- invoices, bills and credit notes */
  const kinds: [string, DocKind, string, string][] = [['invoices', 'INVOICE', 'invoice', 'invoice'], ['bills', 'BILL', 'bill', 'bill'], ['credit-notes', 'CREDIT_NOTE', 'invoice', 'credit note'], ['quotes', 'QUOTE', 'invoice', 'quote'], ['sales-orders', 'SALES_ORDER', 'invoice', 'sales order'], ['purchase-orders', 'PURCHASE_ORDER', 'bill', 'purchase order'], ['debit-notes', 'DEBIT_NOTE', 'bill', 'debit note']];
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
  for (const [path, perm] of [['quotes', 'invoice'], ['sales-orders', 'invoice'], ['purchase-orders', 'bill']] as const) {
    const idOf = (req: FastifyRequest) => BigInt((req.params as { id: string }).id);
    app.post(`${base}/${path}/:id/outcome`, { preHandler: scope(`${perm}.write`), schema: { ...idParam, body: { type: 'object', required: ['outcome'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['ACCEPTED', 'DECLINED'] } } } } }, async (req) => {
      await run(req, (c, orgId) => setOutcome(c, orgId, idOf(req), (req.body as { outcome: 'ACCEPTED' | 'DECLINED' }).outcome, me(req))); return { ok: true };
    });
    app.post(`${base}/${path}/:id/convert`, { preHandler: scope(`${perm}.write`), schema: { ...idParam, body: { type: 'object', required: ['to', 'date'], additionalProperties: false, properties: { to: { type: 'string', enum: ['SALES_ORDER', 'INVOICE', 'BILL'] }, date: { type: 'string', pattern: DATE } } } } }, async (req, reply) => {
      const b = req.body as { to: 'SALES_ORDER' | 'INVOICE' | 'BILL'; date: string };
      return reply.code(201).send(await run(req, (c, orgId) => convertDocument(c, orgId, idOf(req), b.to, b.date, me(req))));
    });
  }
  app.post(`${base}/debit-notes/:id/apply`, { preHandler: scope('bill.write'), schema: { ...idParam, body: { type: 'object', required: ['allocations'], additionalProperties: false, properties: { allocations: allocBody } } } }, async (req) => {
    await run(req, (c, orgId) => applyDebitNote(c, orgId, BigInt((req.params as { id: string }).id), allocs((req.body as { allocations: { documentId: string; amount: string }[] }).allocations), me(req)));
    return { ok: true };
  });
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
  /* ---- bank reconciliation */
  const lineParam = { params: { type: 'object', properties: { lineId: { type: 'string', pattern: ID } } } };
  const lineId = (req: FastifyRequest) => BigInt((req.params as { lineId: string }).lineId);
  app.get(`${base}/bank/accounts`, { preHandler: scope('journal.read') }, async (req) => run(req, (c, orgId) => bankAccounts(c, orgId)));
  app.get(`${base}/bank/accounts/:accountId`, { preHandler: scope('journal.read'), schema: { params: { type: 'object', properties: { accountId: { type: 'string', pattern: ID } } }, querystring: { type: 'object', required: ['asOf'], properties: { asOf: { type: 'string', pattern: DATE } } } } }, async (req) =>
    run(req, (c, orgId) => workbench(c, orgId, BigInt((req.params as { accountId: string }).accountId), (req.query as { asOf: string }).asOf)));
  app.post(`${base}/bank/accounts/:accountId/import`, { preHandler: scope('journal.post'), bodyLimit: 2_000_000, schema: { params: { type: 'object', properties: { accountId: { type: 'string', pattern: ID } } }, body: { type: 'object', required: ['rows'], additionalProperties: false, properties: {
    rows: { type: 'array', minItems: 1, maxItems: 2000, items: { type: 'object', required: ['date', 'amount'], additionalProperties: false, properties: { date: { type: 'string', pattern: DATE }, description: { type: 'string', maxLength: 300 }, reference: { type: 'string', maxLength: 100 }, amount: { type: 'string', maxLength: 20 } } } } } } } }, async (req) =>
    run(req, (c, orgId) => importStatement(c, orgId, BigInt((req.params as { accountId: string }).accountId), (req.body as { rows: Parameters<typeof importStatement>[3] }).rows, me(req))));
  app.post(`${base}/bank/lines/:lineId/match`, { preHandler: scope('journal.post'), schema: { ...lineParam, body: { type: 'object', required: ['journalLineId'], additionalProperties: false, properties: { journalLineId: { type: 'string', pattern: ID } } } } }, async (req) => {
    await run(req, (c, orgId) => matchLine(c, orgId, lineId(req), BigInt((req.body as { journalLineId: string }).journalLineId), me(req))); return { ok: true };
  });
  app.post(`${base}/bank/lines/:lineId/unmatch`, { preHandler: scope('journal.post'), schema: lineParam }, async (req) => { await run(req, (c, orgId) => unmatchLine(c, orgId, lineId(req), me(req))); return { ok: true }; });
  app.post(`${base}/bank/lines/:lineId/ignore`, { preHandler: scope('journal.post'), schema: { ...lineParam, body: { type: 'object', additionalProperties: false, properties: { ignored: { type: 'boolean' } } } } }, async (req) => {
    await run(req, (c, orgId) => setIgnored(c, orgId, lineId(req), (req.body as { ignored?: boolean } | undefined)?.ignored !== false, me(req))); return { ok: true };
  });
  app.post(`${base}/bank/lines/:lineId/add-entry`, { preHandler: scope('journal.post'), schema: { ...lineParam, body: { type: 'object', required: ['counterAccountId'], additionalProperties: false, properties: { counterAccountId: { type: 'string', pattern: ID }, memo: { type: 'string', maxLength: 200 }, ...override } } } }, async (req) => {
    const b = req.body as { counterAccountId: string; memo?: string; overrideReason?: string };
    return run(req, (c, orgId) => addEntry(c, orgId, lineId(req), { counterAccountId: BigInt(b.counterAccountId), memo: b.memo }, me(req), lockOverride(req, b.overrideReason)));
  });

  app.post(`${base}/opening-balances`, { preHandler: scope('party.write'), schema: { body: { type: 'object', required: ['kind', 'partyId', 'date', 'amount'], additionalProperties: false, properties: {
    kind: { type: 'string', enum: ['INVOICE', 'BILL'] }, partyId: { type: 'string', pattern: ID }, date: { type: 'string', pattern: DATE }, dueDate: { type: 'string', pattern: DATE }, amount: { type: 'string', pattern: AMOUNT }, memo: { type: 'string', maxLength: 200 }, ...override } } } }, async (req, reply) => {
    const b = req.body as { kind: 'INVOICE' | 'BILL'; partyId: string; date: string; dueDate?: string; amount: string; memo?: string; overrideReason?: string };
    const out = await run(req, (c, orgId) => createOpeningBalance(c, orgId, { kind: b.kind, partyId: BigInt(b.partyId), date: b.date, dueDate: b.dueDate, amount: toPaise(b.amount), memo: b.memo }, me(req), lockOverride(req, b.overrideReason)));
    return reply.code(201).send({ id: out.id, number: out.number });
  });
  app.post(`${base}/payments`, { preHandler: scope('payment.write'), schema: { body: { type: 'object', required: ['direction', 'partyId', 'date', 'mode', 'amount'], additionalProperties: false, properties: {
    direction: { type: 'string', enum: ['IN', 'OUT'] }, partyId: { type: 'string', pattern: ID }, date: { type: 'string', pattern: DATE }, mode: { type: 'string', enum: ['CASH', 'BANK', 'UPI', 'CARD'] },
    amount: { type: 'string', pattern: AMOUNT }, tds: { type: 'string', pattern: AMOUNT }, tdsSection: { type: 'string', maxLength: 30 }, reference: { type: 'string', maxLength: 80 }, allocations: allocBody, fx: { type: 'object', required: ['documentId', 'foreignAmount'], additionalProperties: false, properties: { documentId: { type: 'string', pattern: ID }, foreignAmount: { type: 'string', pattern: AMOUNT } } }, ...override } } } }, async (req, reply) => {
    const key = String(req.headers['idempotency-key'] ?? '');
    if (key.length < 8 || key.length > 128) return reply.code(400).send({ error: { code: 'idempotency_key_required', message: 'send an Idempotency-Key header (8 to 128 characters), one per user action' } });
    const b = req.body as { direction: 'IN' | 'OUT'; partyId: string; date: string; mode: 'CASH' | 'BANK' | 'UPI' | 'CARD'; amount: string; tds?: string; tdsSection?: string; reference?: string; allocations?: { documentId: string; amount: string }[]; fx?: { documentId: string; foreignAmount: string }; overrideReason?: string };
    const out = await run(req, (c, orgId) => createPayment(c, orgId, { direction: b.direction, partyId: BigInt(b.partyId), date: b.date, mode: b.mode, amount: toPaise(b.amount), tds: b.tds ? toPaise(b.tds) : undefined, tdsSection: b.tdsSection, reference: b.reference,
      allocations: b.allocations ? allocs(b.allocations) : undefined, fx: b.fx ? { documentId: BigInt(b.fx.documentId), foreignAmount: toPaise(b.fx.foreignAmount) } : undefined, idempotencyKey: key }, me(req), lockOverride(req, b.overrideReason)));
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
  app.get(`${base}/reports/sales-analysis`, { preHandler: scope('report.read'), schema: { querystring: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', pattern: DATE }, to: { type: 'string', pattern: DATE } } } } }, async (req) => {
    const q = req.query as { from: string; to: string };
    return run(req, (c) => salesAnalysis(c, q.from, q.to));
  });
  app.get(`${base}/reports/ageing`, { preHandler: scope('report.read'), schema: { querystring: { type: 'object', required: ['type', 'asOf'], properties: {
    type: { type: 'string', enum: ['receivables', 'payables'] }, asOf: { type: 'string', pattern: DATE } } } } }, async (req) => {
    const q = req.query as { type: string; asOf: string };
    return run(req, (c, orgId) => ageing(c, orgId, q.type === 'receivables' ? 'INVOICE' : 'BILL', q.asOf));
  });

  /* ---- e-way bill file for an issued invoice */
  app.get(`${base}/invoices/:id/eway-bill`, { preHandler: scope('invoice.read'), schema: { ...idParam, querystring: { type: 'object', required: ['distanceKm'], properties: {
    distanceKm: { type: 'integer', minimum: 1, maximum: 4000 }, mode: { type: 'integer', enum: [1, 2, 3, 4] }, vehicleNo: { type: 'string', maxLength: 15 }, transporterId: { type: 'string', maxLength: 15 },
    transporterName: { type: 'string', maxLength: 100 }, transDocNo: { type: 'string', maxLength: 15 }, transDocDate: { type: 'string', pattern: DATE } } } } }, async (req) =>
    run(req, (c, orgId) => ewayBill(c, orgId, BigInt((req.params as { id: string }).id), req.query as Parameters<typeof ewayBill>[3])));

  /* ---- expenses paid at the time */
  app.get(`${base}/expenses`, { preHandler: scope('bill.read'), schema: { querystring: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', pattern: DATE }, to: { type: 'string', pattern: DATE }, limit: { type: 'integer', minimum: 1, maximum: 500 } } } } }, async (req) => {
    const q = req.query as { from: string; to: string; limit?: number };
    return run(req, (c) => listExpenses(c, { from: q.from, to: q.to, limit: q.limit ?? 200 }));
  });
  app.post(`${base}/expenses`, { preHandler: scope('bill.write'), schema: { body: { type: 'object', required: ['date', 'accountId', 'amount', 'paidWith', 'description', 'idempotencyKey'], additionalProperties: false, properties: {
    date: { type: 'string', pattern: DATE }, accountId: { type: 'string', pattern: ID }, amount: { type: 'string', pattern: AMOUNT }, taxCode: { type: 'string', maxLength: 20 }, interState: { type: 'boolean' },
    paidWith: { type: 'string', enum: ['CASH', 'BANK', 'UPI', 'CARD'] }, description: { type: 'string', minLength: 1, maxLength: 200 }, paidTo: { type: 'string', maxLength: 120 }, reference: { type: 'string', maxLength: 60 },
    idempotencyKey: { type: 'string', minLength: 8, maxLength: 80 }, projectId: { type: 'string', pattern: ID }, ...override } } } }, async (req, reply) => {
    const b = req.body as { accountId: string; projectId?: string; overrideReason?: string } & Omit<Parameters<typeof recordExpense>[2], 'accountId' | 'projectId'>;
    const out = await run(req, (c, orgId) => recordExpense(c, orgId, { ...b, accountId: BigInt(b.accountId), projectId: b.projectId ? BigInt(b.projectId) : undefined }, me(req), lockOverride(req, b.overrideReason)));
    return reply.code(201).send(out);
  });
  app.post(`${base}/expenses/:id/void`, { preHandler: scope('bill.void'), schema: { ...idParam, body: voidBody } }, async (req) => {
    const b = req.body as { date: string; reason: string };
    await run(req, (c, orgId) => voidExpense(c, orgId, BigInt((req.params as { id: string }).id), { date: b.date, reason: b.reason }, me(req)));
    return { ok: true };
  });

  /* ---- bulk import (rows already read from a CSV by the web app) */
  const importBody = (row: object) => ({ type: 'object', required: ['rows'], additionalProperties: false, properties: { dryRun: { type: 'boolean' }, rows: { type: 'array', minItems: 1, maxItems: IMPORT_LIMIT, items: row } } });
  const str = (max: number) => ({ type: 'string', maxLength: max });
  app.post(`${base}/import/parties`, { preHandler: scope('party.write'), schema: { body: importBody({ type: 'object', required: ['kind', 'name'], additionalProperties: false, properties: {
    kind: { type: 'string', enum: ['CUSTOMER', 'VENDOR', 'BOTH'] }, name: str(160), gstin: str(15), pan: str(10), stateCode: str(2), phone: str(20), email: str(200), creditDays: { type: 'integer', minimum: 0, maximum: 365 } } }) } }, async (req) => {
    const b = req.body as { dryRun?: boolean; rows: Parameters<typeof importParties>[2] };
    return run(req, (c, orgId) => importParties(c, orgId, b.rows, Boolean(b.dryRun), me(req)));
  });
  app.post(`${base}/import/items`, { preHandler: scope('item.write'), schema: { body: importBody({ type: 'object', required: ['sku', 'name'], additionalProperties: false, properties: {
    sku: str(60), name: str(160), kind: { type: 'string', enum: ['GOODS', 'SERVICE'] }, hsnSac: str(12), unit: { type: 'string', enum: UQC }, taxCode: str(20), salePrice: { type: 'string', pattern: AMOUNT }, purchasePrice: { type: 'string', pattern: AMOUNT } } }) } }, async (req) => {
    const b = req.body as { dryRun?: boolean; rows: Parameters<typeof importItems>[2] };
    return run(req, (c, orgId) => importItems(c, orgId, b.rows, Boolean(b.dryRun), me(req)));
  });

  /* ---- WhatsApp */
  app.get(`${base}/whatsapp/settings`, { preHandler: scope('org.read') }, async (req) => run(req, (c) => getWhatsapp(c)));
  app.put(`${base}/whatsapp/settings`, { preHandler: scope('org.manage'), schema: { body: { type: 'object', additionalProperties: false, properties: {
    mode: { type: 'string', enum: ['OFF', 'LINK', 'CLOUD'] }, phoneNumberId: { type: 'string', pattern: '^\\d{5,30}$' }, token: { type: 'string', minLength: 10, maxLength: 1000 }, language: { type: 'string', pattern: '^[a-z]{2}(_[A-Z]{2})?$' },
    autoReminders: { type: 'boolean' }, reminderOffsets: { type: 'array', maxItems: 6, items: { type: 'integer', minimum: -30, maximum: 90 } },
    templateInvoice: { type: 'string', pattern: '^[a-z0-9_]{1,512}$' }, templateReminder: { type: 'string', pattern: '^[a-z0-9_]{1,512}$' }, templateReceipt: { type: 'string', pattern: '^[a-z0-9_]{1,512}$' } } } } }, async (req) => {
    await run(req, (c, orgId) => saveWhatsapp(c, orgId, req.body as Parameters<typeof saveWhatsapp>[2], me(req)));
    return { ok: true };
  });
  app.post(`${base}/whatsapp/send`, { preHandler: scope('invoice.write'), schema: { body: { type: 'object', required: ['kind'], additionalProperties: false, properties: {
    kind: { type: 'string', enum: ['INVOICE', 'REMINDER', 'RECEIPT'] }, documentId: { type: 'string', pattern: ID }, paymentId: { type: 'string', pattern: ID } } } } }, async (req, reply) => {
    const b = req.body as { kind: 'INVOICE' | 'REMINDER' | 'RECEIPT'; documentId?: string; paymentId?: string };
    if (b.kind === 'RECEIPT' ? !b.paymentId : !b.documentId) return reply.code(400).send({ error: { code: 'bad_request', message: b.kind === 'RECEIPT' ? 'a receipt needs a paymentId' : 'this message needs a documentId' } });
    return sendMessage(pool, orgOf(req), b.kind, { documentId: b.documentId ? BigInt(b.documentId) : undefined, paymentId: b.paymentId ? BigInt(b.paymentId) : undefined }, { actor: me(req) });
  });
  app.get(`${base}/whatsapp/messages`, { preHandler: scope('invoice.read'), schema: { querystring: { type: 'object', properties: { documentId: { type: 'string', pattern: ID }, limit: { type: 'integer', minimum: 1, maximum: 200 } } } } }, async (req) => {
    const q = req.query as { documentId?: string; limit?: number };
    return run(req, (c) => listMessages(c, { documentId: q.documentId ? BigInt(q.documentId) : undefined, limit: q.limit ?? 50 }));
  });

  /* ---- Email (the business's own SMTP mailbox) */
  const addr = { type: 'string', maxLength: 254 };
  app.get(`${base}/email/settings`, { preHandler: scope('org.read') }, async (req) => run(req, (c) => getEmailSettings(c)));
  app.put(`${base}/email/settings`, { preHandler: scope('org.manage'), schema: { body: { type: 'object', additionalProperties: false, properties: {
    enabled: { type: 'boolean' }, replyTo: addr, bccSelf: { type: 'boolean' } } } } }, async (req) => {
    await run(req, (c, orgId) => saveEmailSettings(c, orgId, req.body as EmailSettingsIn, me(req)));
    return { ok: true };
  });
  app.post(`${base}/email/send`, { preHandler: scope('invoice.write'), schema: { body: { type: 'object', additionalProperties: false, properties: {
    documentId: { type: 'string', pattern: ID }, paymentId: { type: 'string', pattern: ID }, to: addr, message: { type: 'string', maxLength: 1000 } } } } }, async (req, reply) => {
    const b = req.body as { documentId?: string; paymentId?: string; to?: string; message?: string };
    if (Boolean(b.documentId) === Boolean(b.paymentId)) return reply.code(400).send({ error: { code: 'bad_request', message: 'send either a document or a payment receipt' } });
    return run(req, (c, orgId) => sendDocument(c, orgId, { documentId: b.documentId ? BigInt(b.documentId) : undefined, paymentId: b.paymentId ? BigInt(b.paymentId) : undefined }, { to: b.to, message: b.message }, me(req)));
  });
  app.get(`${base}/email/messages`, { preHandler: scope('invoice.read'), schema: { querystring: { type: 'object', properties: { documentId: { type: 'string', pattern: ID }, paymentId: { type: 'string', pattern: ID }, limit: { type: 'integer', minimum: 1, maximum: 200 } } } } }, async (req) => {
    const q = req.query as { documentId?: string; paymentId?: string; limit?: number };
    return run(req, (c) => listEmails(c, { documentId: q.documentId ? BigInt(q.documentId) : undefined, paymentId: q.paymentId ? BigInt(q.paymentId) : undefined, limit: q.limit ?? 50 }));
  });

  /* ---- GST returns (drafts), party statement, recurring documents */
  const month = { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' };
  app.get(`${base}/gst/gstr1`, { preHandler: scope('report.read'), schema: { querystring: { type: 'object', required: ['month'], properties: { month, hsnDigits: { type: 'integer', enum: [4, 6, 8] } } } } }, async (req) => {
    const q = req.query as { month: string; hsnDigits?: number };
    return run(req, (c, orgId) => gstr1(c, orgId, q.month, { hsnDigits: q.hsnDigits }));
  });
  app.get(`${base}/gst/gstr3b`, { preHandler: scope('report.read'), schema: { querystring: { type: 'object', required: ['month'], properties: { month } } } }, async (req) =>
    run(req, (c, orgId) => gstr3b(c, orgId, (req.query as { month: string }).month)));
  app.get(`${base}/parties/:id/statement`, { preHandler: scope('report.read'), schema: { ...idParam, querystring: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', pattern: DATE }, to: { type: 'string', pattern: DATE } } } } }, async (req) => {
    const q = req.query as { from: string; to: string };
    return run(req, (c) => partyStatement(c, BigInt((req.params as { id: string }).id), q.from, q.to));
  });

  // Recurring documents use the invoice permissions for both kinds.
  app.get(`${base}/recurring`, { preHandler: scope('invoice.read') }, async (req) => run(req, (c) => listTemplates(c)));
  app.post(`${base}/recurring`, { preHandler: scope('invoice.write'), schema: { body: { type: 'object', required: ['kind', 'partyId', 'every', 'startDate', 'lines'], additionalProperties: false, properties: {
    kind: { type: 'string', enum: ['INVOICE', 'BILL'] }, partyId: { type: 'string', pattern: ID }, every: { type: 'string', enum: ['WEEK', 'MONTH', 'QUARTER', 'YEAR'] },
    startDate: { type: 'string', pattern: DATE }, endDate: { type: 'string', pattern: DATE }, memo: { type: 'string', maxLength: 500 }, lines: { type: 'array', minItems: 1, maxItems: 200, items: line } } } } }, async (req, reply) => {
    const b = req.body as { kind: 'INVOICE' | 'BILL'; partyId: string; every: Every; startDate: string; endDate?: string; memo?: string; lines: RawDoc['lines'] };
    const id = await run(req, (c, orgId) => createTemplate(c, orgId, { ...b, partyId: BigInt(b.partyId) }, me(req)));
    return reply.code(201).send({ id });
  });
  app.post(`${base}/recurring/run`, { preHandler: scope('invoice.write') }, async (req) => run(req, (c, orgId) => runDue(c, orgId, new Date().toLocaleDateString('en-CA'), me(req))));
  app.post(`${base}/recurring/:id/active`, { preHandler: scope('invoice.write'), schema: { ...idParam, body: { type: 'object', required: ['active'], additionalProperties: false, properties: { active: { type: 'boolean' } } } } }, async (req, reply) =>
    (await run(req, (c, orgId) => setTemplateActive(c, orgId, BigInt((req.params as { id: string }).id), (req.body as { active: boolean }).active, me(req)))) ? { ok: true } : notFound(reply, 'template'));
  app.delete(`${base}/recurring/:id`, { preHandler: scope('invoice.write'), schema: idParam }, async (req, reply) =>
    (await run(req, (c, orgId) => deleteTemplate(c, orgId, BigInt((req.params as { id: string }).id), me(req)))) ? { ok: true } : notFound(reply, 'template'));
};
