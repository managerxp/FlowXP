import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { issueDocument, saveDraft, voidDocument } from '../src/documents.ts';
import type { DocIn } from '../src/documents.ts';
import { buildEinvoice, cancelIrn, einvoiceBulk, einvoiceList, recordIrn } from '../src/einvoice.ts';
import { gstinCheckChar } from '../src/gst.ts';
import { createParty, seedTaxRates, updateParty } from '../src/masters.ts';
import { saveExtras } from '../src/profile.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);
const gstin = (state: string, pan: string) => { const f = `${state}${pan}1Z`; return f + gstinCheckChar(f); };

test('an e-invoice file is made for a registered buyer, lists what is missing, and keeps the IRP answer', { skip }, async () => {
  const org = await newOrg(pool);
  const { buyer, walkin } = await run(org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27', gstin = $2, legal_name = 'Sharma Traders Pvt Ltd' WHERE id = $1`, [org, gstin('27', 'AAAAA0000A')]);
    await seedTaxRates(c, org);
    return {
      buyer: await createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi Electricals', gstin: gstin('29', 'BBBBB1111B'), stateCode: '29' }, 't'),
      walkin: await createParty(c, org, { kind: 'CUSTOMER', name: 'Walk-in', stateCode: '27' }, 't')
    };
  });
  const line = { description: 'Machine', hsnSac: '8479', unit: 'NOS', quantity: '2', unitPrice: '40000', taxCode: 'GST18' };
  const issue = (partyId: bigint, extra: Partial<DocIn> = {}) => run(org, async (c) => { const x = await saveDraft(c, org, null, { kind: 'INVOICE', partyId, date: '2026-06-10', lines: [line], ...extra } as DocIn, 't'); await issueDocument(c, org, 'INVOICE', x, 't'); return x; });
  const id = await issue(buyer);
  const plain = await issue(walkin);

  const first = await run(org, (c) => buildEinvoice(c, org, id));
  assert.match(first.problems.join(';'), /business PIN code.*business address.*business city.*customer PIN code/);
  assert.equal((await run(org, (c) => buildEinvoice(c, org, plain))).file, null, 'a customer without a GSTIN needs no e-invoice');

  await run(org, async (c) => {
    await saveExtras(c, org, { addressLine: '12 MG Road', city: 'Pune', pincode: '411001' });
    await updateParty(c, org, buyer, { addressLine: '5 Brigade Rd', city: 'Bengaluru', pincode: '560001' }, 't');
  });
  const ok = await run(org, (c) => buildEinvoice(c, org, id));
  assert.deepEqual(ok.problems, []);
  const f = ok.file as Record<string, Record<string, unknown> & unknown>;
  assert.deepEqual(f.DocDtls, { Typ: 'INV', No: 'INV-26-27-000001', Dt: '10/06/2026' });
  assert.deepEqual([f.SellerDtls.Stcd, f.SellerDtls.Pin, f.SellerDtls.LglNm, f.BuyerDtls.Pos, f.BuyerDtls.Pin], ['27', 411001, 'Sharma Traders Pvt Ltd', '29', 560001]);
  assert.deepEqual(f.ValDtls, { AssVal: 80000, CgstVal: 0, SgstVal: 0, IgstVal: 14400, CesVal: 0, Discount: 0, RndOffAmt: 0, TotInvVal: 94400 });
  assert.deepEqual((f.ItemList as unknown as Record<string, unknown>[])[0], { SlNo: '1', PrdDesc: 'Machine', IsServc: 'N', HsnCd: '8479', Qty: 2, Unit: 'NOS', UnitPrice: 40000, TotAmt: 80000, Discount: 0, AssAmt: 80000, GstRt: 18, IgstAmt: 14400, CgstAmt: 0, SgstAmt: 0, CesRt: 0, CesAmt: 0, TotItemVal: 94400 });

  const list = await run(org, (c) => einvoiceList(c, org, '2026-04-01', '2027-03-31'));
  assert.deepEqual(list.map((r) => r.state), ['READY', 'NOT_REQUIRED']);
  const bulk = await run(org, (c) => einvoiceBulk(c, org, '2026-04-01', '2027-03-31'));
  assert.equal(bulk.count, 1); assert.equal(bulk.file.length, 1);

  const irn = 'a'.repeat(64);
  await assert.rejects(run(org, (c) => recordIrn(c, org, id, { irn: 'abc', ackNo: '1', ackDate: '2026-06-10T10:00:00+05:30' }, 't')), /64 letters/);
  await run(org, (c) => recordIrn(c, org, id, { irn, ackNo: '112010000012345', ackDate: '2026-06-10T10:00:00+05:30' }, 't'));
  assert.equal((await run(org, (c) => einvoiceList(c, org, '2026-04-01', '2027-03-31')))[0].state, 'REGISTERED');
  await assert.rejects(run(org, (c) => recordIrn(c, org, id, { irn: 'b'.repeat(64), ackNo: '2', ackDate: '2026-06-10T10:00:00+05:30' }, 't')), /already has an IRN/);
  await assert.rejects(run(org, (c) => voidDocument(c, org, 'INVOICE', id, { date: '2026-06-11', reason: 'x' }, 't')), /cancel the e-invoice/);

  await run(org, (c) => cancelIrn(c, org, id, 2, 'wrong quantity', 't'));
  await run(org, (c) => voidDocument(c, org, 'INVOICE', id, { date: '2026-06-11', reason: 'wrong quantity' }, 't'));
  assert.equal((await pool.query(`SELECT status FROM documents WHERE id = $1`, [id])).rows[0].status, 'VOID');
});
