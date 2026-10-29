import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { createPayment, issueDocument, saveDraft } from '../src/documents.ts';
import type { DocIn } from '../src/documents.ts';
import { gstinCheckChar } from '../src/gst.ts';
import { gstr1, gstr3b } from '../src/gstr.ts';
import { createItem, createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { createTemplate, nextDue, runDue } from '../src/recurring.ts';
import { partyStatement } from '../src/statement.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);
const gstin = (state: string, pan: string) => { const f = `${state}${pan}1Z`; return f + gstinCheckChar(f); };

const shop = async () => {
  const org = await newOrg(pool);
  const ids = await run(org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27', gstin = $2 WHERE id = $1`, [org, gstin('27', 'AAAAA0000A')]);
    await seedTaxRates(c, org);
    await openFinancialYear(c, org, 2027, 4, 't');
    const registered = await createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi Stores', gstin: gstin('27', 'BBBBB1111B') }, 't');
    const walkIn = await createParty(c, org, { kind: 'CUSTOMER', name: 'Walk-in', stateCode: '29' }, 't');
    const vendor = await createParty(c, org, { kind: 'VENDOR', name: 'Supplier Co', stateCode: '27' }, 't');
    const item = await createItem(c, org, { sku: 'TEA', name: 'Tea', hsnSac: '0902', taxCode: 'GST5', unit: 'KGS', salePrice: '400' }, 't');
    return { registered, walkIn, vendor, item };
  });
  return { org, ...ids };
};
const issue = (org: bigint, d: DocIn) => run(org, async (c) => { const id = await saveDraft(c, org, null, d, 't'); await issueDocument(c, org, d.kind, id, 't'); return id; });

test('GSTR-1 sorts sales into B2B, B2C small and the HSN table, and 3B adds the credit on bills', { skip }, async () => {
  const { org, registered, walkIn, vendor, item } = await shop();
  await issue(org, { kind: 'INVOICE', partyId: registered, date: '2026-06-10', lines: [{ itemId: item, quantity: '2' }, { description: 'Setup', hsnSac: '998313', quantity: '1', unitPrice: '1000', taxCode: 'GST18' }] });
  await issue(org, { kind: 'INVOICE', partyId: walkIn, date: '2026-06-12', lines: [{ itemId: item, quantity: '1' }] });
  await issue(org, { kind: 'BILL', partyId: vendor, date: '2026-06-15', supplierRef: 'S-1', lines: [{ description: 'Packaging', hsnSac: '4819', quantity: '10', unitPrice: '100', taxCode: 'GST18' }] });

  const r = await run(org, (c) => gstr1(c, org, '2026-06'));
  assert.equal(r.problems.filter((p) => p.level === 'block').length, 0);
  assert.equal(r.file.fp, '062026');
  assert.deepEqual(r.counts, { invoices: 2, b2b: 1, b2cl: 0, b2cs: 1, creditNotes: 0, cancelled: 0 });
  const inv = (r.file.b2b[0]?.inv[0] ?? {}) as { inum: string; idt: string; val: number; itms: { itm_det: { rt: number; txval: number; camt: number; samt: number; iamt: number } }[] };
  assert.equal(inv.inum, 'INV-26-27-000001');
  assert.equal(inv.idt, '10-06-2026');
  assert.equal(inv.val, 800 + 40 + 1000 + 180, 'tea 800 at 5% (40) + setup 1000 at 18% (180)');
  assert.deepEqual(inv.itms.map((i) => [i.itm_det.rt, i.itm_det.txval, i.itm_det.camt, i.itm_det.samt, i.itm_det.iamt]), [[5, 800, 20, 20, 0], [18, 1000, 90, 90, 0]]);
  assert.deepEqual(r.file.b2cs.map((e) => [e.sply_ty, e.pos, e.rt, e.txval, e.iamt]), [['INTER', '29', 5, 400, 20]]);
  assert.deepEqual(r.file.hsn.data.map((h) => [h.hsn_sc, h.uqc, h.qty, h.txval]), [['0902', 'KGS', 3, 1200], ['998313', 'NA', 0, 1000]]);
  assert.deepEqual(r.file.doc_issue.doc_det, [{ doc_num: 1, docs: [{ num: 1, from: 'INV-26-27-000001', to: 'INV-26-27-000002', totnum: 2, cancel: 0, net_issue: 2 }] }]);

  const b = await run(org, (c) => gstr3b(c, org, '2026-06'));
  assert.equal(b.file.ret_period, '062026');
  assert.deepEqual(b.file.sup_details.osup_det, { txval: 2200, iamt: 20, camt: 110, samt: 110, csamt: 0 });
  assert.deepEqual(b.file.itc_elg.itc_avl.find((x) => x.ty === 'OTH'), { ty: 'OTH', iamt: 0, camt: 90, samt: 90, csamt: 0 });
  assert.equal((await run(org, (c) => gstr1(c, org, '2026-07'))).file.b2b.length, 0, 'another month is empty');
});

test('the return says what the portal would reject', { skip }, async () => {
  const { org, registered } = await shop();
  await run(org, (c) => c.query(`UPDATE organizations SET gstin = NULL WHERE id = $1`, [org]));
  await issue(org, { kind: 'INVOICE', partyId: registered, date: '2026-06-10', lines: [{ description: 'Thing', quantity: '1', unitPrice: '100', taxCode: 'GST12' }] });
  const msgs = (await run(org, (c) => gstr1(c, org, '2026-06'))).problems.map((p) => p.message).join('\n');
  assert.match(msgs, /GSTIN is missing/);
  assert.match(msgs, /no HSN/);
});

test('recurring templates make drafts on their due dates, catch up, and stop at the end date', { skip }, async () => {
  const { org, registered, item } = await shop();
  assert.deepEqual([nextDue('2026-01-31', 'MONTH'), nextDue('2026-02-28', 'MONTH', 31), nextDue('2026-05-01', 'WEEK'), nextDue('2026-02-10', 'YEAR'), nextDue('2026-11-15', 'QUARTER')], ['2026-02-28', '2026-03-31', '2026-05-08', '2027-02-10', '2027-02-15']);
  const t = await run(org, (c) => createTemplate(c, org, { kind: 'INVOICE', partyId: registered, every: 'MONTH', startDate: '2026-06-05', endDate: '2026-08-31', lines: [{ itemId: String(item), quantity: '1' }] }, 't'));
  const first = await run(org, (c) => runDue(c, org, '2026-07-10', 't'));
  assert.deepEqual(first.made.map((m) => m.date), ['2026-06-05', '2026-07-05'], 'a missed period is caught up');
  assert.equal((await run(org, (c) => runDue(c, org, '2026-07-10', 't'))).made.length, 0, 'nothing twice');
  const later = await run(org, (c) => runDue(c, org, '2026-12-01', 't'));
  assert.deepEqual(later.made.map((m) => m.date), ['2026-08-05']);
  const row = (await run(org, (c) => c.query(`SELECT active, runs FROM recurring_templates WHERE id = $1`, [t]))).rows[0];
  assert.deepEqual([row.active, row.runs], [false, 3], 'the template switches itself off after its end date');
  const drafts = (await run(org, (c) => c.query(`SELECT status FROM documents WHERE kind = 'INVOICE'`))).rows;
  assert.deepEqual(drafts.map((d) => d.status), ['DRAFT', 'DRAFT', 'DRAFT']);
});

test('a party statement runs a balance through invoices, credit and payments', { skip }, async () => {
  const { org, registered, item } = await shop();
  await issue(org, { kind: 'INVOICE', partyId: registered, date: '2026-05-10', lines: [{ itemId: item, quantity: '10' }] });
  await issue(org, { kind: 'INVOICE', partyId: registered, date: '2026-06-10', lines: [{ itemId: item, quantity: '5' }] });
  await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: registered, date: '2026-06-20', mode: 'CASH', amount: 100000n, idempotencyKey: 'stmt-key-001' }, 't'));
  const s = await run(org, (c) => partyStatement(c, registered, '2026-06-01', '2026-06-30'));
  assert.equal(s.opening, 420000n);
  assert.deepEqual(s.lines.map((l) => [l.type, l.debit, l.credit, l.balance]), [['Invoice', 210000n, 0n, 630000n], ['Payment received', 0n, 100000n, 530000n]]);
  assert.equal(s.closing, 530000n);
});
