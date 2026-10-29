/* The golden journals from docs/accounting-rules.md section 3, posted for real and read back through the statements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import { post, reverse } from '../src/ledger.ts';
import { creditNoteJournal, customerPaymentJournal, saleJournal, supplierBillJournal, supplierPaymentJournal } from '../src/rules.ts';
import { balanceSheet, partyBalances, profitAndLoss, reconcile, trialBalance } from '../src/reports.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);

/** the entry's lines as "DR account amount" / "CR account amount", for readable assertions */
const lines = async (org: bigint, entryId: bigint) => (await withOrg(pool, org, (c) => c.query(
  `SELECT a.name, l.side, l.base_amount_minor::text AS amt FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = $1 ORDER BY l.side DESC, a.code`, [entryId]))).rows
  .map((r) => `${r.side} ${r.name} ${r.amt}`);

test('example 1: cash sale of 1,000 + 18% GST', { skip }, async () => {
  const org = await newOrg(pool);
  const r = await withOrg(pool, org, (c) => post(c, org, saleJournal({ date: '2026-06-10', invoiceId: 'INV-1', lines: [{ taxable: 100000n, rateBp: 1800 }], interState: false, tenders: [{ mode: 'CASH', amount: 118000n }] })));
  assert.deepEqual(await lines(org, r.entryId), ['D Cash in hand 118000', 'C Output CGST 9000', 'C Output SGST 9000', 'C Sales 100000']);
});

test('example 2 and 3: credit sale (inter-state, IGST) then the customer pays', { skip }, async () => {
  const org = await newOrg(pool);
  const party = 7n;
  const sale = await withOrg(pool, org, (c) => post(c, org, saleJournal({ date: '2026-06-10', invoiceId: 'INV-2', partyId: party, lines: [{ taxable: 100000n, rateBp: 1800 }], interState: true })));
  assert.deepEqual(await lines(org, sale.entryId), ['D Accounts receivable 118000', 'C Output IGST 18000', 'C Sales 100000']);
  assert.deepEqual(await withOrg(pool, org, (c) => partyBalances(c, org, 'AR', '2026-06-30')), [{ party_id: 7n, balance: 118000n }]);
  const pay = await withOrg(pool, org, (c) => post(c, org, customerPaymentJournal({ date: '2026-06-20', paymentId: 'RCPT-1', partyId: party, mode: 'BANK', amount: 118000n })));
  assert.deepEqual(await lines(org, pay.entryId), ['D Bank 118000', 'C Accounts receivable 118000']);
  assert.deepEqual(await withOrg(pool, org, (c) => partyBalances(c, org, 'AR', '2026-06-30')), [{ party_id: 7n, balance: 0n }]);
});

test('split tender with the rest on credit, and a round-off line', { skip }, async () => {
  const org = await newOrg(pool);
  // two lines at 5% and 18%: tax 50.00 + 180.00 = 230.00, bill 2,230.00, 1,500.00 paid, 730.00 on credit
  const doc = { date: '2026-06-10', invoiceId: 'INV-3', partyId: 9n, interState: false, lines: [{ taxable: 100000n, rateBp: 500 }, { taxable: 100000n, rateBp: 1800 }],
    tenders: [{ mode: 'CASH' as const, amount: 100000n }, { mode: 'UPI' as const, amount: 50000n }], roundOff: 0n };
  const r = await withOrg(pool, org, (c) => post(c, org, saleJournal(doc)));
  assert.deepEqual(await lines(org, r.entryId), ['D Cash in hand 100000', 'D UPI clearing 50000', 'D Accounts receivable 73000', 'C Output CGST 11500', 'C Output SGST 11500', 'C Sales 200000']);
  const odd = await withOrg(pool, org, (c) => post(c, org, saleJournal({ ...doc, invoiceId: 'INV-4', tenders: [], lines: [{ taxable: 9999n, rateBp: 1800 }], roundOff: -40n })));
  assert.ok((await lines(org, odd.entryId)).includes('D Round off 40'));
  assert.throws(() => saleJournal({ ...doc, tenders: [{ mode: 'CASH', amount: 999999999n }] }), /exceed/);
});

test('examples 4 to 7: supplier bill, supplier payment, credit note; the books stay balanced and tie to the statements', { skip }, async () => {
  const org = await newOrg(pool);
  const bill = await withOrg(pool, org, (c) => post(c, org, supplierBillJournal({ date: '2026-07-01', billId: 'BILL-1', partyId: 3n, lines: [{ taxable: 500000n, rateBp: 1800 }], interState: false })));
  assert.deepEqual(await lines(org, bill.entryId), ['D Input CGST 45000', 'D Input SGST 45000', 'D Purchases 500000', 'C Accounts payable 590000']);
  const pay = await withOrg(pool, org, (c) => post(c, org, supplierPaymentJournal({ date: '2026-07-05', paymentId: 'PAY-1', partyId: 3n, mode: 'BANK', amount: 590000n })));
  assert.deepEqual(await lines(org, pay.entryId), ['D Accounts payable 590000', 'C Bank 590000']);
  await withOrg(pool, org, (c) => post(c, org, saleJournal({ date: '2026-07-10', invoiceId: 'INV-9', partyId: 4n, lines: [{ taxable: 100000n, rateBp: 1800 }], interState: false })));
  const cn = await withOrg(pool, org, (c) => post(c, org, creditNoteJournal({ date: '2026-07-12', noteId: 'CN-1', partyId: 4n, lines: [{ taxable: 50000n, rateBp: 1800 }], interState: false })));
  assert.deepEqual(await lines(org, cn.entryId), ['D Output CGST 4500', 'D Output SGST 4500', 'D Sales returns 50000', 'C Accounts receivable 59000']);

  await withOrg(pool, org, async (c) => {
    const tb = await trialBalance(c, org, { to: '2026-12-31' });
    assert.ok(tb.balanced); assert.equal(tb.totalDebit, tb.totalCredit);
    const pl = await profitAndLoss(c, org, '2026-04-01', '2027-03-31');
    assert.equal(pl.totalIncome, 50000n);              // 100000 sales less 50000 returned
    assert.equal(pl.totalExpense, 500000n);            // the purchase
    assert.equal(pl.netProfit, -450000n);
    const bs = await balanceSheet(c, org, '2026-12-31');
    assert.ok(bs.balanced, `assets ${bs.totalAssets} vs ${bs.totalLiabilitiesAndEquity}`);
    assert.equal(bs.profitToDate, -450000n);
    assert.deepEqual(await reconcile(c, org), []);
  });
});

test('a drafted-but-unposted entry never shows in a report, and reversing a sale takes it out of the profit', { skip }, async () => {
  const org = await newOrg(pool);
  const s = await withOrg(pool, org, (c) => post(c, org, saleJournal({ date: '2026-06-10', invoiceId: 'INV-5', lines: [{ taxable: 100000n, rateBp: 0 }], interState: false, tenders: [{ mode: 'CASH', amount: 100000n }] })));
  await withOrg(pool, org, async (c) => {   // a draft (never posted) with real lines
    const id = (await c.query(`INSERT INTO journal_entries (organization_id, entry_no, posting_date, source_type, source_id) VALUES ($1, 'DRAFT-1', '2026-06-10', 'x', '1') RETURNING id`, [org])).rows[0].id;
    await c.query(`INSERT INTO journal_lines (organization_id, entry_id, line_no, account_id, side, amount_minor, base_amount_minor) SELECT $1, $2, 1, id, 'D', 777, 777 FROM accounts WHERE system_key = 'CASH'`, [org, id]);
  });
  assert.equal((await withOrg(pool, org, (c) => profitAndLoss(c, org, '2026-04-01', '2027-03-31'))).netProfit, 100000n);
  assert.equal((await withOrg(pool, org, (c) => trialBalance(c, org, { to: '2026-12-31' }))).totalDebit, 100000n);
  await withOrg(pool, org, (c) => reverse(c, org, s.entryId, { date: '2026-06-11', reason: 'cancelled bill' }));
  assert.equal((await withOrg(pool, org, (c) => profitAndLoss(c, org, '2026-04-01', '2027-03-31'))).netProfit, 0n);
});

test('industry templates add their own accounts; system accounts are marked', { skip }, async () => {
  const org = await newOrg(pool, 'Iron Gym', 'GYM');
  const rows = (await withOrg(pool, org, (c) => c.query(`SELECT code, name, is_system FROM accounts WHERE code IN ('2210', '4010', '1100') ORDER BY code`))).rows;
  assert.deepEqual(rows.map((r) => r.name), ['Accounts receivable', 'Deferred membership revenue', 'Membership income']);
  assert.deepEqual(rows.map((r) => r.is_system), [true, false, false]);
});
