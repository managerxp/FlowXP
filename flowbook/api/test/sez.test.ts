import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { getDocument, issueDocument, saveDraft } from '../src/documents.ts';
import type { DocIn } from '../src/documents.ts';
import { buildEinvoice } from '../src/einvoice.ts';
import { gstinCheckChar } from '../src/gst.ts';
import { gstr1, gstr3b } from '../src/gstr.ts';
import { createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { reconcile, trialBalance } from '../src/reports.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);
const gstin = (state: string, pan: string) => { const f = `${state}${pan}1Z`; return f + gstinCheckChar(f); };
const issue = (org: bigint, d: DocIn) => run(org, async (c) => { const id = await saveDraft(c, org, null, d, 't'); await issueDocument(c, org, d.kind, id, 't'); return id; });
const line = (taxCode: string) => ({ description: 'Goods', hsnSac: '8471', quantity: '1', unitPrice: '10000', taxCode, unit: 'NOS' as const });

test('SEZ and deemed-export sales: invoice type in GSTR-1, zero-rated in 3B, SupTyp in the e-invoice, and the rules that guard them', { skip }, async () => {
  const org = await newOrg(pool);
  const { sez, plain, local, both } = await run(org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27', gstin = $2, legal_name = 'Shop', address_line = 'Main road', city = 'Pune', pincode = '411001' WHERE id = $1`, [org, gstin('27', 'AAAAA0000A')]);
    await seedTaxRates(c, org); await openFinancialYear(c, org, 2027, 4, 't');
    const p = (name: string, g: string | null, st: string) => createParty(c, org, { kind: 'CUSTOMER', name, ...(g ? { gstin: g } : {}), stateCode: st, addressLine: 'Lane 1', city: 'Pune', pincode: '411002' } as never, 't');
    return { sez: await p('SEZ Unit', gstin('27', 'CCCCC2222C'), '27'), plain: await p('Walk-in', null, '27'), local: await p('Local Co', gstin('27', 'DDDDD3333D'), '27'),
      both: await createParty(c, org, { kind: 'BOTH', name: 'Both Ltd', gstin: gstin('27', 'EEEEE4444E'), stateCode: '27' }, 't') };
  });
  // the guards
  await assert.rejects(() => issue(org, { kind: 'INVOICE', partyId: plain, date: '2026-06-05', supplyType: 'SEZ_WITH_PAY', lines: [line('GST18')] }), /GSTIN/);
  await assert.rejects(() => issue(org, { kind: 'INVOICE', partyId: sez, date: '2026-06-05', supplyType: 'SEZ_WITHOUT_PAY', lines: [line('GST18')] }), /no GST/);
  await assert.rejects(() => issue(org, { kind: 'BILL', partyId: both, date: '2026-06-05', supplyType: 'SEZ_WITH_PAY', lines: [line('GST18')] }), /sales invoices only/);

  // SEZ, tax paid: IGST even though the unit is in our own state; without payment: no tax; deemed export: ordinary CGST/SGST here
  const wp = await issue(org, { kind: 'INVOICE', partyId: sez, date: '2026-06-10', supplyType: 'SEZ_WITH_PAY', lines: [line('GST18')] });
  const wop = await issue(org, { kind: 'INVOICE', partyId: sez, date: '2026-06-11', supplyType: 'SEZ_WITHOUT_PAY', lines: [line('GST0')] });
  const de = await issue(org, { kind: 'INVOICE', partyId: local, date: '2026-06-12', supplyType: 'DEEMED_EXPORT', lines: [line('GST18')] });
  await issue(org, { kind: 'INVOICE', partyId: local, date: '2026-06-13', lines: [line('GST18')] });   // an ordinary sale beside them
  const d = await run(org, (c) => getDocument(c, 'INVOICE', wp)) as { inter_state: boolean; supply_type: string; tax_minor: bigint };
  assert.equal(d.inter_state, true); assert.equal(d.supply_type, 'SEZ_WITH_PAY'); assert.equal(d.tax_minor, 180_000n);
  // a credit note follows its invoice
  const cn = await issue(org, { kind: 'CREDIT_NOTE', partyId: sez, date: '2026-06-20', relatedDocumentId: wp, lines: [{ ...line('GST18'), unitPrice: '1000' }] });
  assert.equal(((await run(org, (c) => getDocument(c, 'CREDIT_NOTE', cn))) as { supply_type: string }).supply_type, 'SEZ_WITH_PAY');

  const f1 = (await run(org, (c) => gstr1(c, org, '2026-06'))).file as unknown as { b2b: { ctin: string; inv: { inv_typ: string; itms: { itm_det: { iamt: number; camt: number } }[] }[] }[]; cdnr: { nt: { inv_typ: string }[] }[] };
  const sezInv = f1.b2b.find((b) => b.ctin === gstin('27', 'CCCCC2222C'))?.inv ?? [];
  assert.deepEqual(sezInv.map((i) => i.inv_typ).sort(), ['SEWOP', 'SEWP']);
  assert.equal(sezInv.find((i) => i.inv_typ === 'SEWP')?.itms[0]?.itm_det.iamt, 1800);
  assert.deepEqual(f1.b2b.find((b) => b.ctin === gstin('27', 'DDDDD3333D'))?.inv.map((i) => i.inv_typ).sort(), ['DE', 'R']);
  assert.equal(f1.cdnr[0]?.nt[0]?.inv_typ, 'SEWP');

  // 3B: SEZ sales are zero-rated 3.1(b) (10,000 + 10,000 - 1,000 credit; IGST 1,800 - 180); deemed export and the ordinary sale are 3.1(a)
  const f3 = (await run(org, (c) => gstr3b(c, org, '2026-06'))).file as unknown as { sup_details: { osup_zero: { txval: number; iamt: number }; osup_det: { txval: number; camt: number; samt: number; iamt: number } } };
  assert.equal(f3.sup_details.osup_zero.txval, 19000); assert.equal(f3.sup_details.osup_zero.iamt, 1620);
  assert.equal(f3.sup_details.osup_det.txval, 20000); assert.equal(f3.sup_details.osup_det.camt, 1800); assert.equal(f3.sup_details.osup_det.iamt, 0);

  // e-invoice
  for (const [id, typ] of [[wp, 'SEZWP'], [wop, 'SEZWOP'], [de, 'DEXP']] as const) {
    const e = await run(org, (c) => buildEinvoice(c, org, id));
    assert.equal((e.file?.TranDtls as { SupTyp: string }).SupTyp, typ);
  }
  assert.equal((await run(org, (c) => trialBalance(c, org, { to: '2026-12-31' }))).balanced, true);
  assert.deepEqual((await run(org, (c) => reconcile(c, org))).issues ?? [], []);
});
