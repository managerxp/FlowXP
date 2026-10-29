import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { issueDocument, saveDraft } from '../src/documents.ts';
import type { DocIn } from '../src/documents.ts';
import { ewayBill } from '../src/eway.ts';
import { gstinCheckChar } from '../src/gst.ts';
import { createParty, seedTaxRates, updateParty } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { saveExtras } from '../src/profile.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);
const gstin = (state: string, pan: string) => { const f = `${state}${pan}1Z`; return f + gstinCheckChar(f); };

test('profile extras validate and clear; party addresses save and update', { skip }, async () => {
  const org = await newOrg(pool);
  await run(org, (c) => saveExtras(c, org, { addressLine: '12 MG Road', city: 'Pune', pincode: '411001', bankIfsc: 'hdfc0001234', upiId: 'shop@upi', printSettings: { paper: 'A5', accent: '#1a56db' } }));
  const row = (await pool.query(`SELECT address_line, pincode, bank_ifsc, print_settings FROM organizations WHERE id = $1`, [org])).rows[0];
  assert.deepEqual([row.address_line, row.pincode, row.bank_ifsc, row.print_settings], ['12 MG Road', '411001', 'HDFC0001234', { paper: 'A5', accent: '#1a56db' }]);
  await assert.rejects(run(org, (c) => saveExtras(c, org, { pincode: '41100' })), /six digits/);
  await assert.rejects(run(org, (c) => saveExtras(c, org, { bankIfsc: 'BAD' })), /IFSC/);
  await run(org, (c) => saveExtras(c, org, { upiId: '' }));
  assert.equal((await pool.query(`SELECT upi_id FROM organizations WHERE id = $1`, [org])).rows[0].upi_id, null, 'an empty value clears it');

  const id = await run(org, async (c) => {
    const p = await createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi', stateCode: '29', addressLine: '5 Brigade Rd', city: 'Bengaluru', pincode: '560001' }, 't');
    await updateParty(c, org, p, { shipCity: 'Mysuru', shipPincode: '570001' }, 't');
    return p;
  });
  const p = (await pool.query(`SELECT address_line, city, pincode, ship_city, ship_pincode FROM parties WHERE id = $1`, [id])).rows[0];
  assert.deepEqual(Object.values(p), ['5 Brigade Rd', 'Bengaluru', '560001', 'Mysuru', '570001']);
  await assert.rejects(run(org, (c) => updateParty(c, org, id, { pincode: 'abc' }, 't')), /six digits/);
});

test('the e-way bill file is made from an issued invoice and says what is missing', { skip }, async () => {
  const org = await newOrg(pool);
  const { cust } = await run(org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27', gstin = $2 WHERE id = $1`, [org, gstin('27', 'AAAAA0000A')]);
    await seedTaxRates(c, org);
    await openFinancialYear(c, org, 2027, 4, 't');
    return { cust: await createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi', stateCode: '29' }, 't') };
  });
  const d: DocIn = { kind: 'INVOICE', partyId: cust, date: '2026-06-10', lines: [{ description: 'Machine', hsnSac: '8479', unit: 'NOS', quantity: '2', unitPrice: '40000', taxCode: 'GST18' }] };
  const id = await run(org, async (c) => { const x = await saveDraft(c, org, null, d, 't'); await issueDocument(c, org, 'INVOICE', x, 't'); return x; });

  await assert.rejects(run(org, (c) => ewayBill(c, org, id, { distanceKm: 120 })), /business PIN code is missing.*customer's PIN code is missing/);
  await run(org, async (c) => { await saveExtras(c, org, { addressLine: '12 MG Road', city: 'Pune', pincode: '411001' }); await updateParty(c, org, cust, { addressLine: '5 Brigade Rd', city: 'Bengaluru', pincode: '560001' }, 't'); });
  await assert.rejects(run(org, (c) => ewayBill(c, org, id, { distanceKm: 0 })), /at least 1 km/);
  const { file, warnings } = await run(org, (c) => ewayBill(c, org, id, { distanceKm: 840, vehicleNo: 'mh 12 ab 1234' }));
  const b = file.billLists[0] as Record<string, unknown> & { itemList: Record<string, unknown>[] };
  assert.deepEqual([b.docNo, b.docDate, b.fromPincode, b.toPincode, b.toStateCode, b.toGstin, b.vehicleNo, b.transDistance], ['INV-26-27-000001', '10/06/2026', 411001, 560001, 29, 'URP', 'MH12AB1234', 840]);
  assert.deepEqual([b.totalValue, b.igstValue, b.cgstValue, b.totInvValue], [80000, 14400, 0, 94400], 'other state: IGST');
  assert.deepEqual(b.itemList[0], { itemNo: 1, productName: 'Machine', productDesc: 'Machine', hsnCode: 8479, quantity: 2, qtyUnit: 'NOS', taxableAmount: 80000, cgstRate: 0, sgstRate: 0, igstRate: 18, cessRate: 0 });
  assert.deepEqual(warnings, []);
});
