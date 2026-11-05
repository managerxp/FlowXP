import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { getDocument, issueDocument, saveDraft } from '../src/documents.ts';
import type { DocIn } from '../src/documents.ts';
import { buildEinvoice } from '../src/einvoice.ts';
import { gstinCheckChar } from '../src/gst.ts';
import { gstr1, gstr3b } from '../src/gstr.ts';
import { createItem, createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { reconcile, trialBalance } from '../src/reports.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);
const gstin = (state: string, pan: string) => { const f = `${state}${pan}1Z`; return f + gstinCheckChar(f); };
const issue = (org: bigint, d: DocIn) => run(org, async (c) => { const id = await saveDraft(c, org, null, d, 't'); await issueDocument(c, org, d.kind, id, 't'); return id; });

test('cess: its own line on the document, its own ledger account, and its own column in GSTR-1, 3B and the e-invoice', { skip }, async () => {
  const org = await newOrg(pool);
  const { buyer, vendor, aerated } = await run(org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27', gstin = $2, legal_name = 'Shop', address_line = 'Main road', city = 'Pune', pincode = '411001' WHERE id = $1`, [org, gstin('27', 'AAAAA0000A')]);
    await seedTaxRates(c, org); await openFinancialYear(c, org, 2027, 4, 't');
    return {
      buyer: await createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi Stores', gstin: gstin('27', 'BBBBB1111B'), stateCode: '27', addressLine: 'Lane 1', city: 'Pune', pincode: '411002' } as never, 't'),
      vendor: await createParty(c, org, { kind: 'VENDOR', name: 'Supplier Co', stateCode: '27' }, 't'),
      aerated: await createItem(c, org, { sku: 'COLA', name: 'Aerated drink', hsnSac: '2202', taxCode: 'GST28', cessBp: 1200, unit: 'BTL', salePrice: '100' }, 't')
    };
  });
  // 100 bottles at 100: taxable 10,000; GST 28% = 2,800; cess 12% = 1,200; total 14,000
  const inv = await issue(org, { kind: 'INVOICE', partyId: buyer, date: '2026-06-10', lines: [{ itemId: aerated, quantity: '100' }] });
  const d = await run(org, (c) => getDocument(c, 'INVOICE', inv)) as { subtotal_minor: bigint; tax_minor: bigint; cess_minor: bigint; total_minor: bigint; lines: { cess_rate_bp: number; cess_minor: bigint }[] };
  assert.equal(d.subtotal_minor, 1_000_000n); assert.equal(d.tax_minor, 280_000n); assert.equal(d.cess_minor, 120_000n); assert.equal(d.total_minor, 1_400_000n);
  assert.equal(d.lines[0]?.cess_rate_bp, 1200); assert.equal(d.lines[0]?.cess_minor, 120_000n);

  const tb = await run(org, (c) => trialBalance(c, org, { to: '2026-12-31' }));
  assert.equal(tb.balanced, true);
  assert.equal(tb.rows.find((r) => r.name === 'Output cess')?.creditBalance, 120_000n);
  assert.equal(tb.rows.find((r) => r.name === 'Accounts receivable')?.debitBalance, 1_400_000n);

  // a bill with cess: credit on cess is its own input account
  await issue(org, { kind: 'BILL', partyId: vendor, date: '2026-06-12', lines: [{ description: 'Cola stock', hsnSac: '2202', quantity: '10', unitPrice: '100', taxCode: 'GST28', cessBp: 1200 }] });
  // and a credit note takes cess back
  await issue(org, { kind: 'CREDIT_NOTE', partyId: buyer, date: '2026-06-20', relatedDocumentId: inv, lines: [{ itemId: aerated, quantity: '10' }] });

  const r1 = await run(org, (c) => gstr1(c, org, '2026-06'));
  const f1 = r1.file as unknown as { b2b: { inv: { val: number; itms: { itm_det: { csamt: number } }[] }[] }[]; cdnr: { nt: { itms: { itm_det: { csamt: number } }[] }[] }[]; hsn: { data: { csamt: number }[] } };
  assert.equal(f1.b2b[0]?.inv[0]?.val, 14000); assert.equal(f1.b2b[0]?.inv[0]?.itms[0]?.itm_det.csamt, 1200);
  assert.equal(f1.cdnr[0]?.nt[0]?.itms[0]?.itm_det.csamt, 120);
  assert.equal(f1.hsn.data[0]?.csamt, 1080);   // 1,200 sold less 120 taken back

  const b3 = (await run(org, (c) => gstr3b(c, org, '2026-06'))).file as unknown as { sup_details: { osup_det: { csamt: number } }; itc_elg: { itc_avl: { ty: string; csamt: number }[] } };
  assert.equal(b3.sup_details.osup_det.csamt, 1080);
  assert.equal(b3.itc_elg.itc_avl.find((x) => x.ty === 'OTH')?.csamt, 120);   // 10 bottles x 100 x 12%

  const e = await run(org, (c) => buildEinvoice(c, org, inv));
  const file = e.file as unknown as { ItemList: { CesRt: number; CesAmt: number; TotItemVal: number }[]; ValDtls: { CesVal: number; TotInvVal: number } };
  assert.equal(file.ItemList[0]?.CesRt, 12); assert.equal(file.ItemList[0]?.CesAmt, 1200); assert.equal(file.ItemList[0]?.TotItemVal, 14000);
  assert.equal(file.ValDtls.CesVal, 1200); assert.equal(file.ValDtls.TotInvVal, 14000);
  assert.deepEqual((await run(org, (c) => reconcile(c, org))).issues ?? [], []);
});

test('cess on a price that includes tax is carved out of it, and a line without cess is unchanged', { skip }, async () => {
  const org = await newOrg(pool);
  const buyer = await run(org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27' WHERE id = $1`, [org]);
    await seedTaxRates(c, org); await openFinancialYear(c, org, 2027, 4, 't');
    return createParty(c, org, { kind: 'CUSTOMER', name: 'Walk-in', stateCode: '27' }, 't');
  });
  const id = await issue(org, { kind: 'INVOICE', partyId: buyer, date: '2026-06-10', lines: [{ description: 'Pan masala', hsnSac: '2106', quantity: '1', unitPrice: '1400', taxCode: 'GST28', cessBp: 1200, inclusive: true }, { description: 'Tea', hsnSac: '0902', quantity: '1', unitPrice: '105', taxCode: 'GST5' }] });
  const d = await run(org, (c) => getDocument(c, 'INVOICE', id)) as { total_minor: bigint; cess_minor: bigint; lines: { cess_minor: bigint }[] };
  assert.equal(d.total_minor, 151_025n);          // 1,400 typed with tax in it, plus 105 + 5% on the tea
  assert.equal(d.lines[0]?.cess_minor, 12_000n); assert.equal(d.lines[1]?.cess_minor, 0n); assert.equal(d.cess_minor, 12_000n);
  assert.equal((await run(org, (c) => trialBalance(c, org, { to: '2026-12-31' }))).balanced, true);
});
