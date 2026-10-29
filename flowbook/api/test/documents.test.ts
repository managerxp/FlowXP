import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { ageing, allocatePayment, applyCreditNote, createPayment, getDocument, issueDocument, saveDraft, voidDocument, voidPayment } from '../src/documents.ts';
import type { DocIn } from '../src/documents.ts';
import { gstinCheckChar, validGstin } from '../src/gst.ts';
import { addTaxRate, createItem, createParty, seedTaxRates } from '../src/masters.ts';
import { documentIssues, partyBalances, reconcile, trialBalance } from '../src/reports.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);

/** An organization registered in Maharashtra (27) with rates, a customer in the same state and a vendor. */
const shop = async () => {
  const org = await newOrg(pool);
  const ids = await withOrg(pool, org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27' WHERE id = $1`, [org]);
    await seedTaxRates(c, org);
    const item = await createItem(c, org, { sku: 'TEA', name: 'Tea box', hsnSac: '0902', taxCode: 'GST18', salePrice: '500', purchasePrice: '300' }, 't');
    const cust = await createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi Stores', stateCode: '27' }, 't');
    const far = await createParty(c, org, { kind: 'CUSTOMER', name: 'Bengaluru Mart', stateCode: '29' }, 't');
    const vendor = await createParty(c, org, { kind: 'VENDOR', name: 'Tea Estate', stateCode: '27' }, 't');
    return { item, cust, far, vendor };
  });
  return { org, ...ids };
};
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);
const invoice = (partyId: bigint, extra: Partial<DocIn> = {}): DocIn => ({ kind: 'INVOICE', partyId, date: '2026-06-10', lines: [{ description: 'Tea', quantity: '2', unitPrice: '500', taxCode: 'GST18' }], ...extra });
const issue = (org: bigint, d: DocIn) => run(org, async (c) => { const id = await saveDraft(c, org, null, d, 't'); return { id, ...await issueDocument(c, org, d.kind, id, 't') }; });
const balance = async (org: bigint, key: string) => (await run(org, (c) => trialBalance(c, org, { to: '2027-03-31' }))).rows.find((r) => r.code === key || r.name === key);
const arOf = async (org: bigint) => (await run(org, (c) => partyBalances(c, org, 'AR', '2027-03-31'))).reduce((a, r) => a + r.balance, 0n);

test('GSTIN: shape and check character', { skip }, () => {
  const first14 = '27AAPFU0939F1Z';
  const good = first14 + gstinCheckChar(first14);
  assert.ok(validGstin(good));
  const wrong = first14 + (gstinCheckChar(first14) === 'A' ? 'B' : 'A');
  assert.ok(!validGstin(wrong), 'a wrong check character is caught');
  assert.ok(!validGstin('27AAPFU0939F1'), 'too short');
  assert.ok(!validGstin(good.toLowerCase()), 'must be upper case');
});

test('parties: a bad GSTIN or a state that does not match it is refused; a duplicate GSTIN too', { skip }, async () => {
  const { org } = await shop();
  const g = '29AABCU9603R1Z' ;
  const gstin = g + gstinCheckChar(g);
  await run(org, async (c) => {
    await assert.rejects(createParty(c, org, { kind: 'CUSTOMER', name: 'X', gstin: g + (gstinCheckChar(g) === 'A' ? 'B' : 'A') }, 't'), { code: 'bad_gstin' });
    await assert.rejects(createParty(c, org, { kind: 'CUSTOMER', name: 'X', gstin, stateCode: '27' }, 't'), { code: 'state_mismatch' });
    await createParty(c, org, { kind: 'CUSTOMER', name: 'Good', gstin }, 't');           // the state comes from the GSTIN
    await assert.rejects(createParty(c, org, { kind: 'VENDOR', name: 'Same', gstin }, 't'), { code: 'party_exists' });
  });
});

test('an invoice: drafted, issued, numbered, posted, and paid in two parts', { skip }, async () => {
  const { org, cust } = await shop();
  const inv = await issue(org, invoice(cust));
  assert.equal(inv.number, 'INV-000001');
  const doc = await run(org, (c) => getDocument(c, 'INVOICE', inv.id));
  assert.equal(doc?.status, 'ISSUED');
  assert.deepEqual([doc?.subtotal_minor, doc?.tax_minor, doc?.total_minor, doc?.balance_minor], [100000n, 18000n, 118000n, 118000n]);
  assert.equal(doc?.inter_state, false);
  assert.equal(doc?.due_date, '2026-06-10');
  assert.equal((await balance(org, 'OUTPUT_CGST'))?.creditBalance ?? (await balance(org, 'Output CGST'))?.creditBalance, 9000n);
  assert.equal(await arOf(org), 118000n);

  const p1 = await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-12', mode: 'UPI', amount: 50000n, allocations: [{ documentId: inv.id, amount: 50000n }], idempotencyKey: 'pay-key-0001' }, 't'));
  assert.equal(p1.number, 'RCT-000001');
  assert.equal((await run(org, (c) => getDocument(c, 'INVOICE', inv.id)))?.balance_minor, 68000n);
  await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-13', mode: 'CASH', amount: 68000n, allocations: [{ documentId: inv.id, amount: 68000n }], idempotencyKey: 'pay-key-0002' }, 't'));
  assert.equal((await run(org, (c) => getDocument(c, 'INVOICE', inv.id)))?.balance_minor, 0n);
  assert.equal(await arOf(org), 0n);
  assert.deepEqual(await run(org, async (c) => [...await reconcile(c, org), ...await documentIssues(c, org)]), []);
});

test('an invoice to another state carries IGST, and the rate in force on the document date is the one used', { skip }, async () => {
  const { org, far } = await shop();
  await run(org, (c) => addTaxRate(c, org, { code: 'GST18', name: 'GST 18% (revised)', rateBp: 2000, effectiveFrom: '2027-01-01' }, 't'));
  const before = await issue(org, invoice(far, { date: '2026-12-31' }));
  const after = await issue(org, invoice(far, { date: '2027-01-05' }));
  const taxOf = async (id: bigint) => (await run(org, (c) => getDocument(c, 'INVOICE', id)))?.tax_minor;
  assert.equal(await taxOf(before.id), 18000n);
  assert.equal(await taxOf(after.id), 20000n);
  assert.equal(await taxOf(before.id), 18000n, 'the old invoice did not move');
  assert.equal(((await run(org, (c) => getDocument(c, 'INVOICE', before.id)))?.inter_state), true);
  const igst = (await run(org, (c) => trialBalance(c, org, { to: '2027-03-31' }))).rows.find((r) => r.name.toUpperCase().includes('IGST'));
  assert.equal(igst?.creditBalance, 38000n);
});

test('an issued document is frozen, a draft can still change, and a failed issue does not burn a number', { skip }, async () => {
  const { org, cust } = await shop();
  const first = await issue(org, invoice(cust));
  await assert.rejects(pool.query(`UPDATE documents SET total_minor = 1, balance_minor = 1 WHERE id = $1`, [first.id]), /cannot be edited/);
  await assert.rejects(pool.query(`UPDATE document_lines SET unit_price_minor = 1 WHERE document_id = $1`, [first.id]), /cannot change/);
  await assert.rejects(run(org, (c) => saveDraft(c, org, first.id, invoice(cust), 't')), { code: 'not_draft' });

  const outside = await run(org, (c) => saveDraft(c, org, null, invoice(cust, { date: '2030-01-01' }), 't'));
  await assert.rejects(run(org, (c) => issueDocument(c, org, 'INVOICE', outside, 't')), { code: 'no_period' });
  const next = await issue(org, invoice(cust));
  assert.equal(next.number, 'INV-000002', 'the failed attempt gave its number back');

  const draft = await run(org, (c) => saveDraft(c, org, null, invoice(cust), 't'));
  await run(org, (c) => saveDraft(c, org, draft, invoice(cust, { lines: [{ description: 'Chai', quantity: '3', unitPrice: '100', taxCode: 'GST5' }] }), 't'));
  assert.equal((await run(org, (c) => getDocument(c, 'INVOICE', draft)))?.total_minor, 31500n);
});

test('a bill: the same supplier invoice number cannot be entered twice; paying it settles it', { skip }, async () => {
  const { org, vendor, cust } = await shop();
  const bill: DocIn = { kind: 'BILL', partyId: vendor, date: '2026-06-05', supplierRef: 'EST/77', lines: [{ description: 'Leaves', quantity: '10', unitPrice: '300', taxCode: 'GST5' }] };
  const b1 = await issue(org, bill);
  assert.equal(b1.number, 'BILL-000001');
  await assert.rejects(issue(org, bill), { code: 'duplicate_bill' });
  await assert.rejects(run(org, (c) => saveDraft(c, org, null, { ...bill, partyId: cust }, 't')), { code: 'wrong_party_kind' });
  const doc = await run(org, (c) => getDocument(c, 'BILL', b1.id));
  assert.equal(doc?.total_minor, 315000n);                       // 3000.00 + 5% = 3150.00
  await run(org, (c) => createPayment(c, org, { direction: 'OUT', partyId: vendor, date: '2026-06-20', mode: 'BANK', amount: 315000n, allocations: [{ documentId: b1.id, amount: 315000n }], idempotencyKey: 'pay-key-0003' }, 't'));
  assert.equal((await run(org, (c) => getDocument(c, 'BILL', b1.id)))?.balance_minor, 0n);
  assert.deepEqual(await run(org, async (c) => [...await reconcile(c, org), ...await documentIssues(c, org)]), []);
});

test('a credit note settles part of an invoice without any money moving', { skip }, async () => {
  const { org, cust } = await shop();
  const inv = await issue(org, invoice(cust));
  const note = await issue(org, { kind: 'CREDIT_NOTE', partyId: cust, date: '2026-06-15', relatedDocumentId: inv.id, lines: [{ description: 'Returned tea', quantity: '1', unitPrice: '500', taxCode: 'GST18' }] });
  assert.equal(note.number, 'CN-000001');
  assert.equal(await arOf(org), 118000n - 59000n);
  await run(org, (c) => applyCreditNote(c, org, note.id, [{ documentId: inv.id, amount: 59000n }], 't'));
  assert.equal((await run(org, (c) => getDocument(c, 'INVOICE', inv.id)))?.balance_minor, 59000n);
  assert.equal((await run(org, (c) => getDocument(c, 'CREDIT_NOTE', note.id)))?.balance_minor, 0n);
  await assert.rejects(run(org, (c) => applyCreditNote(c, org, note.id, [{ documentId: inv.id, amount: 1n }], 't')), { code: 'over_allocation' });
  assert.deepEqual(await run(org, async (c) => [...await reconcile(c, org), ...await documentIssues(c, org)]), []);
});

test('payments: never applied beyond what is owed, to another party, or twice; the same key posts once; an advance can be applied later', { skip }, async () => {
  const { org, cust, far } = await shop();
  const inv = await issue(org, invoice(cust));
  const other = await issue(org, invoice(far));
  const pay = (amount: bigint, allocations: { documentId: bigint; amount: bigint }[], key: string, party = cust) =>
    run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: party, date: '2026-06-12', mode: 'BANK', amount, allocations, idempotencyKey: key }, 't'));
  await assert.rejects(pay(200000n, [{ documentId: inv.id, amount: 118001n }], 'key-over-0001'), { code: 'over_allocation' });
  await assert.rejects(pay(100000n, [{ documentId: other.id, amount: 100000n }], 'key-party-001'), { code: 'party_mismatch' });
  await assert.rejects(pay(100000n, [{ documentId: inv.id, amount: 10n }, { documentId: inv.id, amount: 10n }], 'key-twice-001'), { code: 'duplicate_allocation' });
  await assert.rejects(pay(1000n, [{ documentId: inv.id, amount: 2000n }], 'key-bigger-001'), { code: 'over_allocation' });
  assert.equal(await arOf(org), 236000n, 'nothing from the refused attempts was kept');

  const a = await pay(200000n, [{ documentId: inv.id, amount: 118000n }], 'key-good-0001');
  const again = await pay(200000n, [{ documentId: inv.id, amount: 118000n }], 'key-good-0001');
  assert.deepEqual([again.replayed, again.id], [true, a.id]);
  assert.equal(await arOf(org), 236000n - 200000n, 'posted once');
  assert.equal((await pool.query(`SELECT unallocated_minor FROM payments WHERE id = $1`, [a.id])).rows[0].unallocated_minor, 82000n);

  const adv = await pay(50000n, [], 'key-advance-01', far);                          // an advance, nothing applied yet
  await run(org, (c) => allocatePayment(c, org, adv.id, [{ documentId: other.id, amount: 50000n }], 't'));
  assert.equal((await run(org, (c) => getDocument(c, 'INVOICE', other.id)))?.balance_minor, 68000n);
  assert.deepEqual(await run(org, async (c) => [...await reconcile(c, org), ...await documentIssues(c, org)]), []);
});

test('void: a document with money applied is refused; otherwise its journal is reversed; a void payment gives the balance back', { skip }, async () => {
  const { org, cust } = await shop();
  const inv = await issue(org, invoice(cust));
  const p = await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-12', mode: 'UPI', amount: 30000n, allocations: [{ documentId: inv.id, amount: 30000n }], idempotencyKey: 'pay-key-void1' }, 't'));
  await assert.rejects(run(org, (c) => voidDocument(c, org, 'INVOICE', inv.id, { date: '2026-06-20', reason: 'mistake' }, 't')), { code: 'has_allocations' });

  await run(org, (c) => voidPayment(c, org, p.id, { date: '2026-06-20', reason: 'bounced' }, 't'));
  const restored = await run(org, (c) => getDocument(c, 'INVOICE', inv.id));
  assert.equal(restored?.balance_minor, 118000n);
  assert.equal(await arOf(org), 118000n);
  await assert.rejects(run(org, (c) => voidPayment(c, org, p.id, { date: '2026-06-20', reason: 'again' }, 't')), { code: 'not_posted' });

  await run(org, (c) => voidDocument(c, org, 'INVOICE', inv.id, { date: '2026-06-20', reason: 'wrong customer' }, 't'));
  const voided = await run(org, (c) => getDocument(c, 'INVOICE', inv.id));
  assert.deepEqual([voided?.status, voided?.balance_minor, voided?.number], ['VOID', 0n, 'INV-000001']);
  assert.equal(await arOf(org), 0n);
  assert.equal(((await run(org, (c) => trialBalance(c, org, { to: '2027-03-31' }))).balanced), true);
  assert.deepEqual(await run(org, async (c) => [...await reconcile(c, org), ...await documentIssues(c, org)]), []);
});

test('ageing puts what is owed into buckets by days past due', { skip }, async () => {
  const { org, cust, far } = await shop();
  await issue(org, invoice(cust, { date: '2026-04-10', dueDate: '2026-05-10' }));                    // 51 days past due on 30 June
  await issue(org, invoice(far, { date: '2026-06-20', dueDate: '2026-07-20' }));                     // not yet due
  const a = await run(org, (c) => ageing(c, org, 'INVOICE', '2026-06-30'));
  assert.equal(a.total, 236000n);
  const row = (name: string) => a.rows.find((r: any) => r.party_name === name) as any;
  assert.equal(row('Ravi Stores').days_31_60, 118000n);
  assert.equal(row('Bengaluru Mart').not_due, 118000n);
});

test('one organization cannot see or touch the parties and documents of another', { skip }, async () => {
  const a = await shop(); const b = await shop();
  assert.equal((await run(b.org, (c) => c.query(`SELECT 1 FROM parties WHERE id = $1`, [a.cust]))).rowCount, 0);
  await assert.rejects(run(b.org, (c) => saveDraft(c, b.org, null, invoice(a.cust), 't')), { code: 'not_found' });
  const inv = await issue(a.org, invoice(a.cust));
  assert.equal(await run(b.org, (c) => getDocument(c, 'INVOICE', inv.id)), null);
});
