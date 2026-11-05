import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import { post } from '../src/ledger.ts';
import { cashFlow } from '../src/reports.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);

const e = (id: string, date: string, lines: { account: string; side: 'D' | 'C'; amount: bigint }[]) => ({ date, sourceType: 'invoice', sourceId: id, lines });

test('cash flow: opening, what came in and went out by purpose, closing matches the books', { skip }, async () => {
  const org = await newOrg(pool);
  await withOrg(pool, org, async (c) => {
    await post(c, org, e('o1', '2026-05-01', [{ account: 'CASH', side: 'D', amount: 100000n }, { account: 'OPENING_BALANCE', side: 'C', amount: 100000n }]));
    await post(c, org, e('s1', '2026-06-10', [{ account: 'BANK', side: 'D', amount: 118000n }, { account: 'SALES', side: 'C', amount: 100000n }, { account: 'OUTPUT_CGST', side: 'C', amount: 9000n }, { account: 'OUTPUT_SGST', side: 'C', amount: 9000n }]));
    await post(c, org, e('r1', '2026-06-12', [{ account: 'PURCHASES', side: 'D', amount: 30000n }, { account: 'CASH', side: 'C', amount: 30000n }]));
    await post(c, org, e('a1', '2026-06-15', [{ account: 'FIXED_ASSETS', side: 'D', amount: 50000n }, { account: 'BANK', side: 'C', amount: 50000n }]));
    await post(c, org, e('c1', '2026-06-20', [{ account: 'CASH', side: 'D', amount: 20000n }, { account: 'BANK', side: 'C', amount: 20000n }]));   // between cash accounts: nothing
  });
  const r = await withOrg(pool, org, (c) => cashFlow(c, org, '2026-06-01', '2026-06-30'));
  assert.equal(r.opening, 100000n);
  assert.equal(r.operating.totalIn, 118000n); assert.equal(r.operating.totalOut, 30000n);
  assert.equal(r.investing.net, -50000n); assert.equal(r.financing.net, 0n);
  assert.equal(r.change, 38000n); assert.equal(r.closing, 138000n); assert.equal(r.matchesBooks, true);
  assert.ok(r.operating.rows.some((x) => x.name === 'Sales' && x.in === 100000n));
});
