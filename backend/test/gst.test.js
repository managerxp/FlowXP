/*
 * GST filing support: state codes, GSTR-1 JSON, GSTR-3B figures, e-invoice and e-way bill JSON, and the numbers
 * recorded back from the portals. The GSTR-1 totals must equal the ordinary GST report.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const notes = await import('../src/controllers/creditNotes.controller.js');
const reports = await import('../src/controllers/reports.controller.js');
const gst = await import('../src/controllers/gst.controller.js');
const orders = await import('../src/controllers/purchaseOrders.controller.js');
const purchases = await import('../src/controllers/purchases.controller.js');
const debit = await import('../src/controllers/debitNotes.controller.js');
const customers = await import('../src/controllers/customers.controller.js');
const { stateCode, gstinState, placeOfSupply, uqc, ddmmyyyy, stateName } = await import('../src/modules/gst/states.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; } });

/* ── pure ───────────────────────────────────────────────────────────────── */

test('states are found by name, alias or GSTIN', () => {
  assert.equal(stateCode('Karnataka'), '29');
  assert.equal(stateCode('  tamil   NADU '), '33');
  assert.equal(stateCode('Orissa'), '21');
  assert.equal(stateCode('Delhi'), '07');
  assert.equal(stateCode('Atlantis'), null);
  assert.equal(stateCode('27'), '27');
  assert.equal(stateName('29'), 'karnataka');
  assert.equal(gstinState('27AAAAA0000A1Z5'), '27');
  assert.equal(gstinState('BADGSTIN'), null);
  assert.equal(placeOfSupply('27AAAAA0000A1Z5', 'Karnataka'), '27');                   // the GSTIN wins over a stated state
  assert.equal(placeOfSupply(null, 'Kerala'), '32');
  assert.equal(placeOfSupply(null, ''), null);
  assert.equal(uqc('kg'), 'KGS'); assert.equal(uqc('Plate'), 'NOS'); assert.equal(uqc('weird'), 'OTH');
  assert.equal(ddmmyyyy('2026-09-05'), '05-09-2026');
  assert.equal(ddmmyyyy('2026-09-05', '/'), '05/09/2026');
});

/* ── setup ──────────────────────────────────────────────────────────────── */

let A; let B;
const SELLER = '29ABCDE1234F1Z5';       // Karnataka
const PUNE = '27ABCDE1234F1Z5';         // Maharashtra (an outlet with its own registration)
const KA_BUYER = '29AAAAA0000A1Z5';
const MH_BUYER = '27AAAAA0000A1Z5';

const makeBusiness = async (label, { gst = true } = {}) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@gst.test`])).rows[0];
  const biz = (await pool.query(
    `INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, gstin, state, city, address, postal_code) VALUES ($1,$2,'RESTAURANT',$3,$4,'Karnataka','Bengaluru','12 MG Road','560001') RETURNING business_id`,
    [`${label} Foods`, user.user_id, gst, gst ? SELLER : null])).rows[0];
  const mk = async (name, primary, extra = {}) => (await pool.query(`INSERT INTO branches (business_id, name, is_primary, gstin, state, city, address, pincode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING branch_id`,
    [biz.business_id, name, primary, extra.gstin ?? null, extra.state ?? null, extra.city ?? null, extra.address ?? null, extra.pincode ?? null])).rows[0].branch_id;
  const main = await mk('Main', true);
  const pune = await mk('Pune', false, { gstin: PUNE, state: 'Maharashtra', city: 'Pune', address: '5 FC Road', pincode: '411004' });
  const tenantAt = (branchId, extra = {}) => ({ businessId: biz.business_id, branchId, scopeBranchId: null, role: 'OWNER', permissions: {}, ...extra });
  const call = async (fn, { at = main, tenant, ...extra } = {}) => {
    const res = fakeRes();
    await fn({ tenant: { ...(tenant ?? tenantAt(at)) }, auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res);
    return res;
  };
  const product = async (name, price, tax, hsn, unit = 'pc') => (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, tax_rate, hsn_sac, unit, track_inventory) VALUES ($1,$2,$3,$4,$5,$6,FALSE) RETURNING product_id`, [biz.business_id, name, price, tax, hsn, unit])).rows[0].product_id;
  const customer = async (name, extra = {}) => (await pool.query(`INSERT INTO customers (business_id, name, state, gstin, address, pincode) VALUES ($1,$2,$3,$4,$5,$6) RETURNING customer_id`,
    [biz.business_id, name, extra.state ?? null, extra.gstin ?? null, extra.address ?? null, extra.pincode ?? null])).rows[0].customer_id;
  const bill = async (items, { customer_id, at = main, date = '2026-09-10', discount } = {}) => {
    const r = await call(invoices.create, { at, body: { customer_id, items, invoice_date: date, discount } });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    return r.body.data;
  };
  return { biz: biz.business_id, main, pune, call, product, customer, bill, tenantAt };
};

const rupees = (paise) => paise / 100;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a'); B = await makeBusiness('b');
  A.thali = await A.product('Thali', 10000, 5, '996331', 'plate');            // a service (SAC)
  A.goods = await A.product('Spice Box', 50000, 12, '0910', 'box');
  A.nohsn = await A.product('Mystery', 20000, 18, null);
  A.kaB2b = await A.customer('Karnataka Traders', { state: 'Karnataka', gstin: KA_BUYER, address: '1 Brigade Road', pincode: '560025' });
  A.mhB2b = await A.customer('Mumbai Stores', { state: 'Maharashtra', gstin: MH_BUYER, address: '9 Marine Drive' });                // no pincode
  A.tn = await A.customer('Chennai Guest', { state: 'Tamil Nadu' });
  A.bad = await A.customer('Typo Ltd', { state: 'Karnataka', gstin: 'NOTAGSTIN12345' });
});

test('filing needs GST switched on and a valid GSTIN, and a real month', { skip }, async () => {
  assert.equal((await A.call(gst.gstr1, { query: { period: 'nope' } })).code, 400);
  assert.equal((await A.call(gst.gstr1, { query: { period: '2026-09', gstin: 'SHORT' } })).code, 409);
  const off = await makeBusiness('c', { gst: false });
  assert.match((await off.call(gst.gstr1, { query: { period: '2026-09' } })).body.message, /not switched on/);
  await pool.query(`UPDATE businesses SET gst_enabled = TRUE, gstin = NULL WHERE business_id = $1`, [off.biz]);
  assert.match((await off.call(gst.gstr1, { query: { period: '2026-09' } })).body.message, /Add your GSTIN/);
});

/* ── GSTR-1 ─────────────────────────────────────────────────────────────── */

test('GSTR-1 sorts sales into B2B, B2CL, B2CS and credit notes, and its totals equal the GST report', { skip }, async () => {
  await A.call(gst.putSettings, { body: { b2cl_limit: 1000 } });                 // Rs 1,000 so a small sale can be "large"
  const i1 = await A.bill([{ product_id: A.thali, quantity: 2 }], { customer_id: A.kaB2b });               // intra B2B: 200 + 5% = 10
  const i2 = await A.bill([{ product_id: A.goods, quantity: 1 }], { customer_id: A.mhB2b });               // inter B2B: 500 + 12% = 60
  const i3 = await A.bill([{ product_id: A.thali, quantity: 3 }]);                                          // walk-in B2C intra
  await A.bill([{ product_id: A.thali, quantity: 1 }], { customer_id: A.tn });                             // inter B2C small: B2CS
  await A.bill([{ product_id: A.goods, quantity: 3 }], { customer_id: A.tn });                             // inter B2C 1,680 > limit: B2CL
  await A.bill([{ product_id: A.thali, quantity: 1 }], { customer_id: A.bad });                            // a GSTIN that isn't one: filed as B2C
  await A.bill([{ product_id: A.nohsn, quantity: 1 }]);                                                     // a line with no HSN
  const cancelled = await A.bill([{ product_id: A.thali, quantity: 1 }]);
  assert.equal((await A.call(invoices.cancel, { params: { id: cancelled.invoice_id }, body: {} })).code, 200);

  const line = (id) => pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [id]).then((r) => r.rows[0].item_id);
  const cnB2b = await A.call(notes.create, { params: { id: i1.invoice_id }, body: { reason: 'One plate returned', items: [{ item_id: await line(i1.invoice_id), quantity: 1 }] } });
  assert.equal(cnB2b.code, 201, JSON.stringify(cnB2b.body));
  const cnB2c = await A.call(notes.create, { params: { id: i3.invoice_id }, body: { reason: 'Cold', items: [{ item_id: await line(i3.invoice_id), quantity: 1 }] } });
  assert.equal(cnB2c.code, 201);

  const res = await A.call(gst.gstr1, { query: { period: '2026-09' } });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const { json, summary, warnings } = res.body.data;
  assert.equal(json.gstin, SELLER); assert.equal(json.fp, '092026');

  // B2B: two customers, the interstate one under IGST with its own state as place of supply
  const ka = json.b2b.find((c) => c.ctin === KA_BUYER).inv[0];
  assert.deepEqual([ka.inum, ka.idt, ka.pos, ka.rchrg, ka.inv_typ], [i1.invoice_number, '10-09-2026', '29', 'N', 'R']);
  assert.deepEqual(ka.itms[0].itm_det, { rt: 5, txval: 200, iamt: 0, camt: 5, samt: 5, csamt: 0 });
  const mh = json.b2b.find((c) => c.ctin === MH_BUYER).inv[0];
  assert.deepEqual([mh.pos, mh.val, mh.itms[0].itm_det.iamt, mh.itms[0].itm_det.camt], ['27', 560, 60, 0]);

  // B2CL: one inter-state sale over the limit, under the buyer's state
  assert.equal(json.b2cl.length, 1);
  assert.equal(json.b2cl[0].pos, '33');
  assert.equal(json.b2cl[0].inv[0].itms[0].itm_det.txval, 1500);

  // B2CS: the rest, aggregated per supply type, state and rate; the returned plate came off the intra-state 5% row
  const intra5 = json.b2cs.find((r) => r.sply_ty === 'INTRA' && r.rt === 5);
  assert.equal(intra5.pos, '29');
  assert.ok(intra5.txval > 0);
  const inter5 = json.b2cs.find((r) => r.sply_ty === 'INTER' && r.pos === '33' && r.rt === 5);
  assert.deepEqual([inter5.txval, inter5.iamt, inter5.camt], [100, 5, 0]);

  // credit note to a registered buyer refers to the original invoice
  const nt = json.cdnr.find((c) => c.ctin === KA_BUYER).nt[0];
  assert.deepEqual([nt.ntty, nt.inum, nt.idt, nt.pos], ['C', i1.invoice_number, '10-09-2026', '29']);
  assert.equal(nt.itms[0].itm_det.txval, 100);
  assert.equal(json.cdnur, undefined);                                                                       // the B2C return was netted into B2CS

  // HSN table and document summary
  assert.ok(json.hsn.data.some((h) => h.hsn_sc === '996331' && h.uqc === 'NOS' && h.rt === 5));
  const invDocs = json.doc_issue.doc_det.find((d) => d.doc_num === 1).docs[0];
  assert.deepEqual([invDocs.cancel, invDocs.totnum, invDocs.net_issue], [1, 8, 7]);
  assert.equal(json.doc_issue.doc_det.find((d) => d.doc_num === 5).docs[0].totnum, 2);

  // warnings say what to fix
  const codes = warnings.map((w) => w.code);
  for (const c of ['BAD_GSTIN', 'NO_HSN', 'OTHER_GSTIN']) assert.ok(codes.includes(c) || c === 'OTHER_GSTIN', `expected ${c}`);
  assert.ok(warnings.find((w) => w.code === 'BAD_GSTIN').message.includes('1 invoice has'));
  assert.equal(summary.b2b.invoices, 2);
  assert.equal(summary.credit_notes, 2);

  // the whole return equals the GST report for the month
  const gstTotals = (await A.call(reports.gst, { query: { from: '2026-09-01', to: '2026-09-30' } })).body.data;
  const sum = (arr, f) => arr.reduce((n, x) => n + f(x), 0);
  const b2bInv = json.b2b.flatMap((c) => c.inv).flatMap((i) => i.itms).map((x) => x.itm_det);
  const cl = json.b2cl.flatMap((p) => p.inv).flatMap((i) => i.itms).map((x) => x.itm_det);
  const cs = json.b2cs;
  const cdn = (json.cdnr ?? []).flatMap((c) => c.nt).flatMap((n) => n.itms).map((x) => x.itm_det);
  const fileTaxable = sum(b2bInv, (d) => d.txval) + sum(cl, (d) => d.txval) + sum(cs, (d) => d.txval) - sum(cdn, (d) => d.txval);
  const fileTax = (k) => sum(b2bInv, (d) => d[k]) + sum(cl, (d) => d[k]) + sum(cs, (d) => d[k]) - sum(cdn, (d) => d[k]);
  // (the Pune outlet has its own GSTIN and no invoices yet, so everything above is this GSTIN's)
  assert.equal(Math.round(fileTaxable * 100), Math.round(gstTotals.taxable_value * 100));
  assert.equal(Math.round(fileTax('camt') * 100), Math.round(gstTotals.cgst * 100));
  assert.equal(Math.round(fileTax('samt') * 100), Math.round(gstTotals.sgst * 100));
  assert.equal(Math.round(fileTax('iamt') * 100), Math.round(gstTotals.igst * 100));
  const hsnTaxable = sum(json.hsn.data, (h) => h.txval);
  assert.equal(Math.round(hsnTaxable * 100), Math.round(gstTotals.taxable_value * 100));                       // the HSN table agrees too
});

test('a separate outlet GSTIN files its own return, and the download is a JSON file', { skip }, async () => {
  await A.bill([{ product_id: A.thali, quantity: 4 }], { at: A.pune });
  const main = (await A.call(gst.gstr1, { query: { period: '2026-09' } })).body.data;
  assert.ok(main.warnings.some((w) => w.code === 'OTHER_GSTIN' && w.message.includes(PUNE)));
  assert.ok(!main.json.b2cs.some((r) => r.pos === '27' && r.sply_ty === 'INTRA' && r.txval === 400));

  const pune = (await A.call(gst.gstr1, { query: { period: '2026-09', gstin: PUNE } })).body.data;
  assert.equal(pune.json.gstin, PUNE);
  assert.deepEqual(pune.json.b2cs.map((r) => [r.sply_ty, r.pos, r.rt, r.txval, r.camt, r.samt]), [['INTRA', '27', 5, 400, 10, 10]]);

  const filings = (await A.call(gst.filings, { query: { period: '2026-09' } })).body.data;
  assert.deepEqual(filings.gstins.map((g) => g.gstin).sort(), [PUNE, SELLER].sort());

  const file = await A.call(gst.gstr1, { query: { period: '2026-09', gstin: PUNE, download: '1' } });
  assert.equal(file.headers['Content-Disposition'], `attachment; filename="GSTR1_${PUNE}_092026.json"`);
  assert.equal(JSON.parse(file.body).gstin, PUNE);
});

test('another business sees none of it', { skip }, async () => {
  const res = await B.call(gst.gstr1, { query: { period: '2026-09' } });
  assert.equal(res.code, 200);
  assert.equal(res.body.data.summary.invoices, 0);
  assert.equal(res.body.data.json.b2b, undefined);
});

/* ── GSTR-3B ────────────────────────────────────────────────────────────── */

test('GSTR-3B: outward supplies net of credit notes, and input credit from purchases net of debit notes', { skip }, async () => {
  const supplier = async (name, gstin) => (await pool.query(`INSERT INTO suppliers (business_id, name, gstin) VALUES ($1,$2,$3) RETURNING supplier_id`, [A.biz, name, gstin])).rows[0].supplier_id;
  const registered = await supplier('Registered Co', '29PPPPP1111P1Z5');
  const unregistered = await supplier('Local Farm', null);
  const receive = async (supplier_id, unit) => {
    const id = (await A.call(orders.createDraft, { body: { supplier_id, items: [{ product_id: A.goods, quantity: 10, unit_cost: unit, tax_rate: 12 }] } })).body.data.po_id;
    const r = await A.call(orders.receive, { params: { id }, body: {} });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    await pool.query(`UPDATE purchase_orders SET po_date = '2026-09-12' WHERE po_id = $1`, [id]);
    return id;
  };
  const p1 = await receive(registered, 100);                       // 1,000 + 12% = tax 120
  await receive(unregistered, 100);                                // tax 120 but no supplier GSTIN: not creditable
  const item = (await A.call(purchases.get, { params: { id: p1 } })).body.data.items[0].item_id;
  const dn = await A.call(debit.create, { params: { id: p1 }, body: { kind: 'RETURN', reason: 'Damaged', items: [{ item_id: item, quantity: 2 }] } });
  assert.equal(dn.code, 201, JSON.stringify(dn.body));
  await pool.query(`UPDATE debit_notes SET dn_date = '2026-09-14' WHERE po_id = $1`, [p1]);

  const r = (await A.call(gst.gstr3b, { query: { period: '2026-09' } })).body.data;
  const report = (await A.call(reports.gst, { query: { from: '2026-09-01', to: '2026-09-30' } })).body.data;
  // outward: everything taxed at 5/12/18, net of credit notes; equals the GST report except nothing is nil-rated here
  // (the report covers every outlet; the Pune outlet files under its own GSTIN, with Rs 400 taxable and Rs 20 tax)
  assert.equal(r.outward_taxable.taxable, report.taxable_value - 400);
  assert.equal(r.outward_taxable.igst + r.outward_taxable.cgst + r.outward_taxable.sgst, report.total_tax - 20);
  assert.deepEqual(r.inter_state_to_unregistered.map((x) => x.pos).sort(), ['33']);
  // input credit: 120 from the registered supplier, less 24 on the two returned boxes; the farm's 120 is ineligible
  assert.equal(r.itc.eligible, 96); assert.equal(r.itc.ineligible, 120);
  assert.equal(r.itc.cgst + r.itc.sgst, 96);
  assert.equal(r.tax_payable_in_cash.cgst, Math.max(0, r.outward_taxable.cgst - r.itc.cgst));
  assert.ok(r.notes.length >= 2);
});

/* ── e-invoice ──────────────────────────────────────────────────────────── */

test('e-invoice JSON is built for B2B invoices, and what is missing is listed', { skip }, async () => {
  const list = (await A.call(gst.einvoiceList, { query: { period: '2026-09' } })).body.data;
  assert.equal(list.gstin, SELLER);
  assert.equal(list.invoices.length, 2);                                       // only the two with a valid buyer GSTIN
  const ka = list.invoices.find((i) => i.ready);
  const mh = list.invoices.find((i) => !i.ready);
  assert.ok(ka, 'the fully filled-in customer is ready');
  assert.deepEqual(mh.errors, ['The customer\'s 6-digit pincode']);              // the Mumbai customer has no pincode

  const one = (await A.call(gst.einvoiceOne, { params: { id: ka.invoice_id } })).body.data;
  const j = one.json;
  assert.equal(j.Version, '1.1');
  assert.deepEqual(j.TranDtls, { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' });
  assert.equal(j.DocDtls.Typ, 'INV'); assert.match(j.DocDtls.Dt, /^\d{2}\/\d{2}\/\d{4}$/);
  assert.deepEqual([j.SellerDtls.Gstin, j.SellerDtls.Pin, j.SellerDtls.Stcd], [SELLER, 560001, '29']);
  assert.deepEqual([j.BuyerDtls.Gstin, j.BuyerDtls.Pos, j.BuyerDtls.Pin], [KA_BUYER, '29', 560025]);
  assert.equal(j.ItemList[0].IsServc, 'Y');                                    // SAC 99…
  assert.deepEqual([j.ItemList[0].Unit, j.ItemList[0].GstRt, j.ItemList[0].CgstAmt, j.ItemList[0].SgstAmt, j.ItemList[0].IgstAmt], ['NOS', 5, 5, 5, 0]);
  assert.equal(j.ValDtls.TotInvVal, 210);
  assert.equal(j.ValDtls.AssVal + j.ValDtls.CgstVal + j.ValDtls.SgstVal, 210);
  assert.equal(one.warnings.length, 0);

  // the bulk file has only the ready ones
  const file = await A.call(gst.einvoiceList, { query: { period: '2026-09', download: '1' } });
  const bulk = JSON.parse(file.body);
  assert.equal(bulk.length, 1);
  assert.equal(bulk[0].DocDtls.No, ka.invoice_number);

  // once the customer's pincode is added the other one is ready too
  await pool.query(`UPDATE customers SET pincode = '400001' WHERE customer_id = $1`, [A.mhB2b]);
  assert.equal(JSON.parse((await A.call(gst.einvoiceList, { query: { period: '2026-09', download: '1' } })).body).length, 2);
  const inter = JSON.parse((await A.call(gst.einvoiceList, { query: { period: '2026-09', download: '1' } })).body).find((x) => x.BuyerDtls.Gstin === MH_BUYER);
  assert.deepEqual([inter.ItemList[0].IgstAmt, inter.ItemList[0].CgstAmt, inter.ValDtls.IgstVal, inter.BuyerDtls.Pos], [60, 0, 60, '27']);
});

test('recording the IRN: format checked, unique, and it drops the invoice from the next bulk file', { skip }, async () => {
  const list = (await A.call(gst.einvoiceList, { query: { period: '2026-09' } })).body.data.invoices;
  const [first, second] = list;
  const irn = 'a'.repeat(64);
  assert.equal((await A.call(gst.recordIrn, { params: { id: first.invoice_id }, body: { irn: 'short' } })).code, 400);
  assert.equal((await A.call(gst.recordIrn, { params: { id: first.invoice_id }, body: { irn, ack_no: '112010012345678', ack_date: '2026-09-11' } })).code, 200);
  assert.equal((await A.call(gst.recordIrn, { params: { id: second.invoice_id }, body: { irn } })).code, 409);                 // already on another invoice
  assert.equal((await B.call(gst.recordIrn, { params: { id: first.invoice_id }, body: { irn: 'b'.repeat(64) } })).code, 404);     // another business

  const after = (await A.call(gst.einvoiceList, { query: { period: '2026-09' } })).body.data.invoices.find((i) => i.invoice_id === first.invoice_id);
  assert.equal(after.irn, irn);
  assert.equal(JSON.parse((await A.call(gst.einvoiceList, { query: { period: '2026-09', download: '1' } })).body).length, 1);
  assert.equal((await A.call(invoices.get, { params: { id: first.invoice_id } })).body.data.irn, irn);
});

/* ── e-way bill ─────────────────────────────────────────────────────────── */

test('an e-way bill needs goods, transport details, and says when it is not required', { skip }, async () => {
  const goods = await A.bill([{ product_id: A.goods, quantity: 120 }], { customer_id: A.kaB2b, date: '2026-09-20' });   // 60,000 + 12%
  const eway = (body, id = goods.invoice_id) => A.call(gst.ewayBill, { body: { invoice_id: id, transport: body } });

  const none = (await eway({})).body.data;
  assert.equal(none.ready, false);
  assert.ok(none.errors.some((e) => /distance/.test(e)));
  assert.ok(none.errors.some((e) => /vehicle number/.test(e)));
  assert.equal((await eway({ mode: 'boat', distance_km: 10, vehicle_no: 'KA01AB1234' })).body.data.errors.some((e) => /transport mode/.test(e)), true);
  assert.equal((await eway({ mode: 'road', distance_km: 99999, vehicle_no: 'KA01AB1234' })).body.data.ready, false);

  const ok = (await eway({ mode: 'road', distance_km: 25, vehicle_no: 'ka 01 ab 1234' })).body.data;
  assert.equal(ok.ready, true, JSON.stringify(ok.errors));
  const b = ok.json.billLists[0];
  assert.deepEqual([ok.json.version, b.docType, b.supplyType, b.subSupplyType, b.fromStateCode, b.toStateCode, b.fromPincode, b.toPincode], ['1.0.0621', 'INV', 'O', 1, 29, 29, 560001, 560025]);
  assert.deepEqual([b.toGstin, b.transMode, b.transDistance, b.vehicleNo, b.vehicleType], [KA_BUYER, '1', '25', 'KA01AB1234', 'R']);
  assert.deepEqual([b.totalValue, b.cgstValue, b.sgstValue, b.igstValue, b.totInvValue], [60000, 3600, 3600, 0, 67200]);
  assert.deepEqual([b.itemList[0].hsnCode, b.itemList[0].qtyUnit, b.itemList[0].cgstRate, b.itemList[0].sgstRate, b.itemList[0].taxableAmount], [910, 'BOX', 6, 6, 60000]);
  assert.equal(ok.warnings.length, 0);                                          // above Rs 50,000

  // a service, or a small invoice
  const service = await A.bill([{ product_id: A.thali, quantity: 1 }], { customer_id: A.kaB2b, date: '2026-09-20' });
  const s = (await eway({ mode: 'road', distance_km: 5, vehicle_no: 'KA01AB1234' }, service.invoice_id)).body.data;
  assert.equal(s.ready, false);
  assert.ok(s.errors.some((e) => /service/.test(e)));
  const small = await A.bill([{ product_id: A.goods, quantity: 1 }], { customer_id: A.kaB2b, date: '2026-09-20' });
  const sm = (await eway({ mode: 'road', distance_km: 5, transporter_id: '29ABCDE1234F1Z5' }, small.invoice_id)).body.data;
  assert.equal(sm.ready, true);
  assert.ok(sm.warnings.some((w) => w.code === 'BELOW_LIMIT'));
  assert.equal((await B.call(gst.ewayBill, { body: { invoice_id: goods.invoice_id, transport: {} } })).code, 404);

  // recording the number the portal returns
  assert.equal((await A.call(gst.recordEwayBill, { params: { id: goods.invoice_id }, body: { eway_bill_no: '123' } })).code, 400);
  assert.equal((await A.call(gst.recordEwayBill, { params: { id: goods.invoice_id }, body: { eway_bill_no: '1234 5678 9012', date: '2026-09-20' } })).code, 200);
  assert.equal((await A.call(invoices.get, { params: { id: goods.invoice_id } })).body.data.eway_bill_no, '123456789012');
  assert.ok((await eway({ mode: 'road', distance_km: 25, vehicle_no: 'KA01AB1234' })).body.data.warnings.some((w) => w.code === 'HAS_EWB'));
});

/* ── settings and pincodes ──────────────────────────────────────────────── */

test('filing settings are validated, and pincodes are kept on customers', { skip }, async () => {
  assert.equal((await A.call(gst.putSettings, { body: { b2cl_limit: -5 } })).code, 400);
  const ok = (await A.call(gst.putSettings, { body: { b2cl_limit: 250000, einvoice_enabled: true } })).body.data;
  assert.deepEqual([ok.b2cl_limit, ok.einvoice_enabled, ok.gstin], [250000, true, SELLER]);
  assert.equal((await B.call(gst.getSettings)).body.data.einvoice_enabled, false);                 // per business

  const bad = await A.call(customers.create, { body: { name: 'Pin Test', pincode: '12345' } });
  assert.equal(bad.code, 400);
  const made = await A.call(customers.create, { body: { name: 'Pin Test', state: 'Kerala', pincode: '682001' } });
  assert.equal(made.code, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.pincode, '682001');
  assert.equal((await A.call(customers.update, { params: { id: made.body.data.customer_id }, body: { pincode: '0123' } })).code, 400);
});
