import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { withOrg } from '../src/db.ts';
import { partyBalances, profitAndLoss, trialBalance } from '../src/reports.ts';
import { setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
const app = buildApp({ pool, limits: { register: 1000 } });
test.after(async () => { await app.close(); await cleanup(); });

type Res = { status: number; body: any };
const call = async (method: string, url: string, o: { token?: string; body?: unknown } = {}): Promise<Res> => {
  const r = await app.inject({ method: method as 'GET', url, headers: o.token ? { authorization: `Bearer ${o.token}` } : {}, payload: o.body as object | undefined });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};
let n = 0;
let evn = 0;

/** A fresh organization with a FlowXP connection; `send` signs and delivers an event the way FlowXP's outbox will. */
const connected = async (cutoverDate?: string) => {
  n += 1;
  const token = (await call('POST', '/v1/auth/register', { body: { name: 'Owner', email: `inbox${n}@example.com`, password: 'correct horse battery' } })).body.token as string;
  const org = (await call('POST', '/v1/organizations', { token, body: { name: 'Cafe', fyStartYear: 2026 } })).body.id as string;
  const biz = `biz-${n}`;
  const conn = (await call('POST', `/v1/orgs/${org}/integrations/flowxp/connections`, { token, body: { businessId: biz, cutoverDate } })).body;
  let secret = conn.secret as string;
  const send = async (type: string, payload: object, o: { id?: string; secret?: string; t?: number; business?: string; sign?: boolean } = {}) => {
    evn += 1;
    const body = JSON.stringify({ event_id: o.id ?? `evt-${n}-${evn}-padding`, event_type: type, schema_version: 1, business_id: o.business ?? biz, occurred_at: '2026-06-10T12:00:00+05:30', payload });
    const t = o.t ?? Math.floor(Date.now() / 1000);
    const sig = o.sign === false ? 'garbage' : `t=${t},v1=${createHmac('sha256', o.secret ?? secret).update(`${t}.${body}`).digest('hex')}`;
    const r = await app.inject({ method: 'POST', url: '/v1/integrations/flowxp/events', headers: { 'content-type': 'application/json', 'x-flowxp-signature': sig }, payload: body });
    return { status: r.statusCode, body: JSON.parse(r.body) };
  };
  const orgId = BigInt(org);
  const books = async () => {
    const tb = await withOrg(pool, orgId, (c) => trialBalance(c, orgId, { to: '2027-03-31' }));
    return (name: string) => { const r = tb.rows.find((x) => x.name.toLowerCase() === name.toLowerCase()); return r ? (r.debitBalance || r.creditBalance) : 0n; };
  };
  const entries = async () => (await pool.query(`SELECT count(*)::int AS n FROM journal_entries WHERE organization_id = $1`, [org])).rows[0].n as number;
  return { token, org, orgId, send, books, entries, base: `/v1/orgs/${org}`, setSecret: (s: string) => { secret = s; }, connId: conn.id as string };
};

// 1500.00 net with 205.00 GST (102.50 CGST + 102.50 SGST) is 1705.00, paid 1000 cash and 705 UPI
const sale = (extra: object = {}) => ({ invoice_id: 'inv-1', invoice_number: 'POS-0001', date: '2026-06-10', total_minor: 170500, unpaid_minor: 0,
  net_minor: 150000, cgst_minor: 10250, sgst_minor: 10250, igst_minor: 0, tenders: [{ mode: 'CASH', amount_minor: 100000 }, { mode: 'UPI', amount_minor: 70500 }], ...extra });

test('a signed sale from FlowXP posts a journal with split tenders; a re-delivery posts nothing more', { skip }, async () => {
  const s = await connected();
  const r = await s.send('sale.finalized', sale(), { id: 'evt-sale-0001' });
  assert.deepEqual([r.status, r.body.status, r.body.duplicate], [202, 'POSTED', false]);
  const books = await s.books();
  assert.deepEqual([books('Sales'), books('Cash in hand'), books('UPI clearing'), books('Output CGST'), books('Output SGST')], [150000n, 100000n, 70500n, 10250n, 10250n]);
  const before = await s.entries();
  const again = await s.send('sale.finalized', sale(), { id: 'evt-sale-0001' });
  assert.deepEqual([again.status, again.body.status, again.body.duplicate], [200, 'POSTED', true]);
  const resent = await s.send('sale.finalized', sale(), { id: 'evt-sale-0002' });          // the same sale under a new event id
  assert.equal(resent.body.status, 'POSTED');
  assert.equal(await s.entries(), before, 'the same invoice never posts twice');
  assert.deepEqual((await call('GET', `${s.base}/reports/reconcile`, { token: s.token })).body, { issues: [] });
});

test('signatures: wrong, stale, unsigned, another secret and an unknown business are all refused alike', { skip }, async () => {
  const s = await connected();
  const other = await connected();
  const results = [
    await s.send('sale.finalized', sale(), { sign: false }),
    await s.send('sale.finalized', sale(), { t: Math.floor(Date.now() / 1000) - 3600 }),
    await s.send('sale.finalized', sale(), { secret: 'fxs_not_the_secret' }),
    await s.send('sale.finalized', sale(), { business: 'nobody' }),
    await s.send('sale.finalized', sale(), { business: `biz-${n}`, secret: 'x' })            // the other organization's business, our secret
  ];
  for (const r of results) assert.deepEqual([r.status, r.body.error.code], [401, 'bad_signature']);
  assert.equal(await s.entries(), 0); assert.equal(await other.entries(), 0);
});

test('a credit sale puts the customer on receivables; their payment clears it; the document self-check ignores FlowXP entries', { skip }, async () => {
  const s = await connected();
  const cust = { id: 'c-9', name: 'Ravi Stores', state_code: '27' };
  assert.equal((await s.send('sale.finalized', sale({ customer: cust, tenders: [{ mode: 'CASH', amount_minor: 70500 }], unpaid_minor: 100000 }))).body.status, 'POSTED');
  const balance = async () => (await withOrg(pool, s.orgId, (c) => partyBalances(c, s.orgId, 'AR', '2027-03-31'))).map((r) => r.balance);
  assert.deepEqual(await balance(), [100000n]);
  assert.equal((await s.send('payment.received', { payment_id: 'pay-1', date: '2026-06-12', customer: cust, mode: 'BANK', amount_minor: 100000 })).body.status, 'POSTED');
  assert.equal((await balance()).reduce((a, b) => a + b, 0n), 0n);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM parties WHERE organization_id = $1 AND external_ref = 'flowxp:c-9'`, [s.org])).rows[0].n, 1, 'one party for the same FlowXP customer');
  assert.deepEqual((await call('GET', `${s.base}/reports/reconcile`, { token: s.token })).body, { issues: [] });
});

test('bad events are kept with the reason and post nothing: wrong total, missing customer for credit, unknown tender', { skip }, async () => {
  const s = await connected();
  const wrong = await s.send('sale.finalized', sale({ total_minor: 170501, unpaid_minor: 1 }));
  assert.equal(wrong.body.status, 'FAILED_VALIDATION');
  assert.equal((await s.send('sale.finalized', sale({ invoice_id: 'inv-2', tenders: [], unpaid_minor: 170500 }))).body.status, 'NEEDS_ATTENTION');
  assert.equal((await s.send('sale.finalized', sale({ invoice_id: 'inv-3', tenders: [{ mode: 'WALLET', amount_minor: 170500 }] }))).body.status, 'NEEDS_ATTENTION');
  assert.equal((await s.send('sale.finalized', sale({ invoice_id: 'inv-4', net_minor: -5 }))).body.status, 'FAILED_VALIDATION');
  assert.equal(await s.entries(), 0);
  const listed = (await call('GET', `${s.base}/integrations/events?status=FAILED_VALIDATION`, { token: s.token })).body;
  assert.equal(listed.length, 2); assert.match(listed[1].error, /total_minor/);
});

test('a sale in a locked period waits for attention, and replays once the period is reopened', { skip }, async () => {
  const s = await connected();
  await call('PUT', `${s.base}/periods`, { token: s.token, body: { date: '2026-06-10', status: 'CLOSED' } });
  const r = await s.send('sale.finalized', sale());
  assert.equal(r.body.status, 'NEEDS_ATTENTION');
  assert.equal(await s.entries(), 0);
  await call('PUT', `${s.base}/periods`, { token: s.token, body: { date: '2026-06-10', status: 'OPEN' } });
  const ev = (await call('GET', `${s.base}/integrations/events?status=NEEDS_ATTENTION`, { token: s.token })).body[0];
  const replay = await call('POST', `${s.base}/integrations/events/${ev.id}/replay`, { token: s.token });
  assert.equal(replay.body.status, 'POSTED');
  assert.equal((await call('POST', `${s.base}/integrations/events/${ev.id}/replay`, { token: s.token })).status, 409, 'a posted event is not replayed');
  assert.equal((await s.books())('Sales'), 150000n);
});

test('void takes the sale out of the books; a void that arrives before its sale waits; a repeated void changes nothing', { skip }, async () => {
  const s = await connected();
  const early = await s.send('sale.voided', { invoice_id: 'inv-1', date: '2026-06-11', reason: 'wrong bill' });
  assert.equal(early.body.status, 'NEEDS_ATTENTION');
  await s.send('sale.finalized', sale());
  const ev = (await call('GET', `${s.base}/integrations/events?status=NEEDS_ATTENTION`, { token: s.token })).body[0];
  assert.equal((await call('POST', `${s.base}/integrations/events/${ev.id}/replay`, { token: s.token })).body.status, 'POSTED');
  const pl = await withOrg(pool, s.orgId, (c) => profitAndLoss(c, s.orgId, '2026-04-01', '2027-03-31'));
  assert.equal(pl.netProfit, 0n);
  const n1 = await s.entries();
  assert.equal((await s.send('sale.voided', { invoice_id: 'inv-1', date: '2026-06-11' })).body.status, 'POSTED');
  assert.equal(await s.entries(), n1);
});

test('a return with a refund credits the sale back and pays the customer out of the same tender', { skip }, async () => {
  const s = await connected();
  await s.send('sale.finalized', sale());
  const r = await s.send('sale.returned', { note_id: 'cn-1', note_number: 'CN-0001', date: '2026-06-11', net_minor: 100000, cgst_minor: 9000, sgst_minor: 9000, total_minor: 118000, refund_tenders: [{ mode: 'CASH', amount_minor: 118000 }] });
  assert.equal(r.body.status, 'POSTED');
  const books = await s.books();
  // cash: 1000.00 taken, 1180.00 refunded, so 180.00 net out (shown as a credit balance); CGST 102.50 charged less 90.00 returned
  assert.deepEqual([books('Sales returns'), books('Cash in hand'), books('Output CGST')], [100000n, 18000n, 1250n]);
});

test('sales before the cut-over date are kept for reference and not posted', { skip }, async () => {
  const s = await connected('2026-07-01');
  assert.equal((await s.send('sale.finalized', sale())).body.status, 'IGNORED_CUTOVER');
  assert.equal(await s.entries(), 0);
  assert.equal((await s.send('sale.finalized', sale({ invoice_id: 'inv-9', date: '2026-07-02' }))).body.status, 'POSTED');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM external_documents WHERE organization_id = $1`, [s.org])).rows[0].n, 2);
  assert.equal((await s.send('stock.valuation', { anything: true })).body.status, 'IGNORED_UNSUPPORTED');
});

test('rotating the secret: the new one works at once, the old one for a day, and strangers see nothing of the Hub', { skip }, async () => {
  const s = await connected();
  const old = (await pool.query(`SELECT secret FROM integration_connections WHERE id = $1`, [s.connId])).rows[0].secret as string;
  const rotated = await call('POST', `${s.base}/integrations/flowxp/connections/${s.connId}/rotate-secret`, { token: s.token });
  assert.equal(rotated.status, 200);
  assert.equal((await s.send('sale.finalized', sale(), { secret: old })).status, 202);
  assert.equal((await s.send('sale.finalized', sale({ invoice_id: 'inv-2' }), { secret: rotated.body.secret })).status, 202);
  await pool.query(`UPDATE integration_connections SET previous_secret_until = now() - interval '1 minute' WHERE id = $1`, [s.connId]);
  assert.equal((await s.send('sale.finalized', sale({ invoice_id: 'inv-3' }), { secret: old })).status, 401, 'the old secret expired');
  const stranger = (await call('POST', '/v1/auth/register', { body: { name: 'S', email: 'stranger-inbox@example.com', password: 'correct horse battery' } })).body.token;
  assert.equal((await call('GET', `${s.base}/integrations/events`, { token: stranger })).status, 404);
  assert.equal((await call('POST', `${s.base}/integrations/flowxp/connections`, { token: s.token, body: { businessId: `biz-${n}` } })).status, 409);
});

test('a discount taken off the bill after tax is kept as its own line, and the books still balance', { skip }, async () => {
  const s = await connected();
  // 1000 net + 180 GST - 50 discount = 1130 paid in cash
  const r = await s.send('sale.finalized', { invoice_id: 'inv-d', invoice_number: 'POS-D', date: '2026-06-10', net_minor: 100000, cgst_minor: 9000, sgst_minor: 9000, discount_minor: 5000,
    total_minor: 113000, unpaid_minor: 0, tenders: [{ mode: 'CASH', amount_minor: 113000 }] });
  assert.equal(r.body.status, 'POSTED');
  const books = await s.books();
  assert.deepEqual([books('Sales'), books('Discount given'), books('Cash in hand')], [100000n, 5000n, 113000n]);
  const pl = await withOrg(pool, s.orgId, (c) => profitAndLoss(c, s.orgId, '2026-04-01', '2027-03-31'));
  assert.equal(pl.netProfit, 95000n);
});

test('the exact shapes the FlowXP sender builds are accepted: sale, later payment, return with refund, cancellation, test ping', { skip }, async () => {
  const s = await connected();
  const cust = { id: '3', name: 'Ravi Stores', state_code: '27' };
  assert.equal((await s.send('sale.finalized', { invoice_id: '7', invoice_number: 'INV-0007', date: '2026-06-10', customer: cust, net_minor: 100000, cgst_minor: 9000, sgst_minor: 9000, igst_minor: 0,
    discount_minor: 0, round_off_minor: 0, total_minor: 118000, tenders: [{ mode: 'BANK', amount_minor: 30000, reference: 'UTR1' }], unpaid_minor: 88000 })).body.status, 'POSTED');
  assert.equal((await s.send('payment.received', { payment_id: '9', invoice_id: '7', date: '2026-06-12', customer: cust, mode: 'UPI', amount_minor: 38000, reference: 'r' })).body.status, 'POSTED');
  assert.equal((await s.send('sale.returned', { note_id: '2', note_number: 'CN-0002', invoice_id: '7', invoice_number: 'INV-0007', date: '2026-06-11', customer: cust, net_minor: 50000,
    cgst_minor: 4500, sgst_minor: 4500, igst_minor: 0, discount_minor: 0, total_minor: 59000, refund_tenders: [] })).body.status, 'POSTED');
  assert.equal((await s.send('sale.voided', { invoice_id: '7', date: '2026-06-13', reason: 'Cancelled in FlowXP' })).body.status, 'POSTED');
  assert.equal((await s.send('connection.test', {})).body.status, 'IGNORED_UNSUPPORTED');
  assert.deepEqual((await call('GET', `${s.base}/reports/reconcile`, { token: s.token })).body, { issues: [] });
});
