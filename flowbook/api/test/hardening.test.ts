import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { ageing, createPayment, fyStart, issueDocument, saveDraft, voidPayment } from '../src/documents.ts';
import type { DocIn } from '../src/documents.ts';
import { drainInbox } from '../src/inbox.ts';
import { createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

const shop = async () => {
  const org = await newOrg(pool);
  const cust = await run(org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27' WHERE id = $1`, [org]);
    await seedTaxRates(c, org);
    await openFinancialYear(c, org, 2027, 4, 't');
    return createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi Stores', stateCode: '27' }, 't');
  });
  return { org, cust };
};
const invoice = (partyId: bigint, date: string): DocIn => ({ kind: 'INVOICE', partyId, date, dueDate: date, lines: [{ description: 'Tea', quantity: '2', unitPrice: '500', taxCode: 'GST18' }] });
const issue = (org: bigint, d: DocIn) => run(org, async (c) => { const id = await saveDraft(c, org, null, d, 't'); return { id, ...await issueDocument(c, org, d.kind, id, 't') }; });

test('the financial year runs April to March', { skip }, () => {
  assert.deepEqual([fyStart('2026-04-01'), fyStart('2027-03-31'), fyStart('2027-04-01'), fyStart('2026-01-15')], [2026, 2026, 2027, 2025]);
});

test('numbers restart each financial year and stay within 16 characters; a prefix starts its own series', { skip }, async () => {
  const { org, cust } = await shop();
  assert.equal((await issue(org, invoice(cust, '2026-06-10'))).number, 'INV-26-27-000001');
  assert.equal((await issue(org, invoice(cust, '2026-06-11'))).number, 'INV-26-27-000002');
  assert.equal((await issue(org, invoice(cust, '2027-05-01'))).number, 'INV-27-28-000001', 'a new year starts again at one');
  await run(org, (c) => c.query(`UPDATE organizations SET invoice_prefix = 'SAL' WHERE id = $1`, [org]));
  const sal = await issue(org, invoice(cust, '2026-06-12'));
  assert.equal(sal.number, 'SAL-26-27-000001');
  assert.ok(sal.number.length <= 16);
  await assert.rejects(run(org, (c) => c.query(`UPDATE organizations SET invoice_prefix = 'TOOLONG' WHERE id = $1`, [org])), /invoice_prefix/);
});

test('a posted payment cannot be edited or deleted, and its allocations cannot be rewritten', { skip }, async () => {
  const { org, cust } = await shop();
  const inv = await issue(org, invoice(cust, '2026-06-10'));
  const pay = await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-12', mode: 'CASH', amount: 50000n, allocations: [{ documentId: inv.id, amount: 50000n }], idempotencyKey: 'freeze-key-1' }, 't'));
  await assert.rejects(run(org, (c) => c.query(`UPDATE payments SET amount_minor = 1, unallocated_minor = 0 WHERE id = $1`, [pay.id])), /posted payment cannot be edited/);
  await assert.rejects(run(org, (c) => c.query(`UPDATE payments SET pay_date = '2026-01-01' WHERE id = $1`, [pay.id])), /posted payment cannot be edited/);
  await assert.rejects(run(org, async (c) => { await c.query('RESET ROLE'); await c.query(`DELETE FROM payments WHERE id = $1`, [pay.id]); }), /cannot be deleted/);
  await assert.rejects(run(org, (c) => c.query(`UPDATE payment_allocations SET amount_minor = 1 WHERE source_id = $1`, [pay.id])), /cannot be edited/);
  await assert.rejects(run(org, async (c) => { await c.query('RESET ROLE'); await c.query(`DELETE FROM payment_allocations WHERE source_id = $1`, [pay.id]); }), /cannot be deleted/);
  await run(org, (c) => voidPayment(c, org, pay.id, { date: '2026-06-13', reason: 'test' }, 't'));     // the legitimate change still works
  await assert.rejects(run(org, (c) => c.query(`UPDATE payments SET reference = 'x' WHERE id = $1`, [pay.id])), /void payment cannot change/);
});

test('ageing is worked out for the date asked, not for today', { skip }, async () => {
  const { org, cust } = await shop();
  const inv = await issue(org, invoice(cust, '2026-06-10'));            // 1,180.00 due 10 June
  const pay = await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-07-20', mode: 'CASH', amount: 118000n, allocations: [{ documentId: inv.id, amount: 118000n }], idempotencyKey: 'age-key-001' }, 't'));
  const at = (d: string) => run(org, (c) => ageing(c, org, 'INVOICE', d));
  assert.equal((await at('2026-06-05')).total, 0n, 'before it was issued');
  assert.equal((await at('2026-06-10')).rows[0]?.not_due, 118000n, 'on the due date nothing is late');
  const july = await at('2026-07-01');
  assert.deepEqual([july.rows[0]?.days_1_30, july.total], [118000n, 118000n], '21 days late, still unpaid then');
  assert.equal((await at('2026-08-01')).total, 0n, 'paid by then');
  await run(org, (c) => voidPayment(c, org, pay.id, { date: '2026-08-05', reason: 'bounced' }, 't'));
  assert.equal((await at('2099-01-01')).total, 118000n, 'after the payment is voided the invoice is open again');
  assert.equal((await at('2026-08-01')).total, 0n, 'and the past still shows it as paid until the day it was voided');
});

/* ---- the background worker and events that wait for the document they depend on */
const app = buildApp({ pool, limits: { register: 1000 }, onEvent: () => {} });
test.after(() => app.close());
let evn = 0;
const call = async (method: string, url: string, o: { token?: string; body?: unknown } = {}) => {
  const r = await app.inject({ method: method as 'GET', url, headers: o.token ? { authorization: `Bearer ${o.token}` } : {}, payload: o.body as object | undefined });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

test('with a worker, an event is stored and answered at once; a cancellation that arrives before its sale waits and then runs by itself', { skip }, async () => {
  const token = (await call('POST', '/v1/auth/register', { body: { name: 'Owner', email: 'worker@example.com', password: 'correct horse battery' } })).body.token as string;
  const org = (await call('POST', '/v1/organizations', { token, body: { name: 'Cafe', fyStartYear: 2026 } })).body.id as string;
  const conn = (await call('POST', `/v1/orgs/${org}/integrations/flowxp/connections`, { token, body: { businessId: 'worker-biz' } })).body;
  const send = async (type: string, payload: object) => {
    evn += 1;
    const body = JSON.stringify({ event_id: `evt-worker-${evn}-padding`, event_type: type, schema_version: 1, business_id: 'worker-biz', payload });
    const t = Math.floor(Date.now() / 1000);
    const r = await app.inject({ method: 'POST', url: '/v1/integrations/flowxp/events', headers: { 'content-type': 'application/json', 'x-flowxp-signature': `t=${t},v1=${createHmac('sha256', conn.secret).update(`${t}.${body}`).digest('hex')}` }, payload: body });
    return { status: r.statusCode, body: JSON.parse(r.body) };
  };
  const statuses = async () => (await withOrg(pool, BigInt(org), async (c) => (await c.query(`SELECT event_type, status FROM integration_events ORDER BY id`)).rows)).map((r) => `${r.event_type}:${r.status}`);
  const entries = async () => (await pool.query(`SELECT count(*)::int AS n FROM journal_entries WHERE organization_id = $1`, [org])).rows[0].n as number;

  const voided = await send('sale.voided', { invoice_id: 'w-1', date: '2026-06-11', reason: 'customer left' });
  assert.deepEqual([voided.status, voided.body.status], [202, 'RECEIVED'], 'answered without posting');
  assert.equal(await entries(), 0);
  assert.equal(await drainInbox(pool), 1);
  assert.deepEqual(await statuses(), ['sale.voided:WAITING'], 'it waits for the sale');

  await send('sale.finalized', { invoice_id: 'w-1', invoice_number: 'POS-9', date: '2026-06-10', total_minor: 118000, unpaid_minor: 0, net_minor: 100000, cgst_minor: 9000, sgst_minor: 9000, igst_minor: 0, tenders: [{ mode: 'CASH', amount_minor: 118000 }] });
  assert.equal(await drainInbox(pool), 1);
  assert.deepEqual(await statuses(), ['sale.voided:POSTED', 'sale.finalized:POSTED'], 'the sale posted, then the waiting cancellation ran');
  assert.equal(await entries(), 2, 'one journal for the sale, one reversing it');
  assert.equal(await drainInbox(pool), 0, 'nothing left to do');
});
