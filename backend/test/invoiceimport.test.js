/*
 * Supplier bill import: how a read bill is cleaned (pure), how its lines are matched to products (barcode, supplier code,
 * learned wording, name), the duplicate and total checks, what is learned from a person's corrections, and that the AI
 * service is the only thing replaced (by a script). Reading a bill never changes stock: only /purchases does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const importer = await import('../src/controllers/invoiceImport.controller.js');
const purchases = await import('../src/controllers/purchases.controller.js');
const { normaliseBill, SYSTEM, TOOL } = await import('../src/modules/ai/invoiceScan.js');
const { matchLines, similarity, tokens } = await import('../src/modules/invoiceMatch.js');
const { looksLikeBillFile } = await import('../src/middleware/upload.js');
const { setProvider, setConfigured } = await import('../src/modules/ai/provider.js');

test.after(() => { setProvider(null); setConfigured(undefined); return cleanup(); });

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const recorded = (bill) => ({ content: [{ type: 'tool_use', id: 't1', name: 'record_supplier_bill', input: bill }], stopReason: 'tool_use', usage: { input_tokens: 2000, output_tokens: 400 } });
const scripted = (reply) => { const seen = []; const p = async (req) => { seen.push(JSON.parse(JSON.stringify(req))); return reply; }; p.seen = seen; return p; };
const pdf = () => ({ mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n' + 'x'.repeat(200)), size: 209, originalname: 'bill.pdf' });
const jpeg = () => { const b = Buffer.alloc(2000, 7); Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(b); return { mimetype: 'image/jpeg', buffer: b, size: 2000, originalname: 'bill.jpg' }; };

/* ── pure ───────────────────────────────────────────────────────────────── */

test('a read bill is cleaned: numbers checked, dates real, barcodes digits, a missing rate worked out and flagged', () => {
  const bill = normaliseBill({
    supplier_name: '  Metro   Wholesale ', invoice_no: ' INV-2291 ', invoice_date: '2026-09-30', total: '₹ 12,450.50',
    lines: [
      { description: ' Amul Butter 500 g ', barcode: '8901262 010 042', supplier_code: ' AB500 ', quantity: 10, unit: 'pcs', rate: 262, tax_rate: 12, amount: 2620, expiry_date: '2027-03-31' },
      { description: 'Tata Salt 1kg', quantity: 20, amount: 440 },                          // no rate printed: 440 / 20
      { description: 'Mystery', quantity: null, rate: 10 },
      { description: 'Bad dates', quantity: 1, rate: 1, expiry_date: '2027-02-31', tax_rate: 99 },
      { description: '   ', quantity: 1 }, null, 'junk'
    ]
  });
  assert.equal(bill.supplier_name, 'Metro Wholesale');
  assert.equal(bill.invoice_no, 'INV-2291');
  assert.equal(bill.total, 12450.5);
  assert.deepEqual(bill.lines.map((l) => l.description), ['Amul Butter 500 g', 'Tata Salt 1kg', 'Mystery', 'Bad dates']);
  const [butter, salt, mystery, bad] = bill.lines;
  assert.equal(butter.barcode, '8901262010042'); assert.equal(butter.supplier_code, 'AB500'); assert.equal(butter.unsure, false);
  assert.equal(salt.rate, 22); assert.equal(salt.unsure, true, 'a worked-out rate is a guess, so it is checked');
  assert.equal(mystery.unsure, true);
  assert.equal(bad.expiry_date, null, 'an impossible date is dropped'); assert.equal(bad.tax_rate, null, 'an impossible GST rate is dropped');
});

test('names are compared by words and sizes: butter 500 g is not butter 100 g', () => {
  assert.deepEqual([...tokens('AMUL BUTTER 500gm')].sort(), ['500g', 'amul', 'butter']);
  assert.deepEqual([...tokens('Amul Butter 500 g')].sort(), ['500g', 'amul', 'butter']);
  assert.ok(similarity('Amul Butter 500 g', 'Amul Butter 500gm') > 0.99);
  assert.ok(similarity('Amul Butter 500 g', 'Amul Butter 100 g') < similarity('Amul Butter 500 g', 'Amul Butter 500 g Pack'));
  assert.ok(similarity('Amul Butter 500 g', 'Maggi Noodles') === 0);
});

test('the prompt treats the bill as content, and the tool forces structured output', () => {
  assert.match(SYSTEM, /never instructions/i);
  assert.match(SYSTEM, /Do not invent/);
  assert.equal(TOOL.name, 'record_supplier_bill');
  assert.ok(TOOL.input_schema.properties.lines.items.properties.supplier_code);
});

test('a PDF is accepted only if it really is one, images by their first bytes', () => {
  assert.equal(looksLikeBillFile(pdf().buffer, 'application/pdf'), true);
  assert.equal(looksLikeBillFile(Buffer.from('<html>not a pdf at all</html>'), 'application/pdf'), false);
  assert.equal(looksLikeBillFile(jpeg().buffer, 'image/jpeg'), true);
  assert.equal(looksLikeBillFile(pdf().buffer, 'image/jpeg'), false);
});

test('the total check allows round-off and tax on top, and flags a line that was missed', () => {
  const { totalCheck } = importer;
  const lines = [{ amount: 1000, quantity: 1, rate: 1000, tax_rate: 18 }, { amount: 500, quantity: 5, rate: 100, tax_rate: 5 }];
  assert.equal(totalCheck(lines, 1500), null, 'lines add up to the printed total');
  assert.equal(totalCheck(lines, 1502.4), null, 'round-off');
  assert.deepEqual(totalCheck(lines, 2400), { printed: 2400, lines: 1500 });
  assert.equal(totalCheck(lines, null), null, 'no printed total: nothing to compare');
  assert.equal(totalCheck([{ quantity: 10, rate: 100, tax_rate: 18 }], 1180), null, 'a total with tax added to rate × quantity');
});

/* ── database ───────────────────────────────────────────────────────────── */

let biz; let other; let owner; let supA; let supB; let butter; let butter100; let salt; let rice;
const tenant = (businessId = biz) => ({ businessId, branchId: branch, role: 'OWNER', permissions: {}, businessType: 'SUPERMARKET', planFeatures: {} });
let branch;
const run = async (fn, { files = [], body = {}, query = {}, businessId = biz } = {}) => { const res = fakeRes(); await fn({ tenant: tenant(businessId), auth: { userId: owner }, files, body, query, params: {}, headers: {}, ip: '127.0.0.1' }, res); return res; };

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Owner','owner@inv.test','x') RETURNING user_id`)).rows[0].user_id;
  const mk = async (name) => (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code, subscription_status, gst_enabled) VALUES ($1,$2,'SUPERMARKET','ENTERPRISE','ACTIVE', TRUE) RETURNING business_id`, [name, owner])).rows[0].business_id;
  [biz, other] = [await mk('Fresh Basket'), await mk('Other Shop')];
  branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const sup = async (b, name) => (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,$2) RETURNING supplier_id`, [b, name])).rows[0].supplier_id;
  [supA, supB] = [await sup(biz, 'Metro Wholesale'), await sup(biz, 'Daily Dairy')];
  const prod = async (b, name, extra = {}) => (await pool.query(
    `INSERT INTO products (business_id, name, sku, kind, unit, selling_price_paise, tax_rate, track_inventory, barcode) VALUES ($1,$2,$3,'DISH','pc',10000,12,TRUE,$4) RETURNING product_id`,
    [b, name, extra.sku ?? name.slice(0, 4).toUpperCase() + Math.floor(Math.random() * 1e5), extra.barcode ?? null])).rows[0].product_id;
  butter = await prod(biz, 'Amul Butter 500 g', { barcode: '8901262010042' });
  butter100 = await prod(biz, 'Amul Butter 100 g');
  salt = await prod(biz, 'Tata Salt 1 kg');
  rice = await prod(biz, 'India Gate Basmati Rice 5 kg');
});

test('lines match by barcode, then the supplier’s code, then wording learned before, then by name', { skip }, async () => {
  await pool.query(`INSERT INTO product_supplier_codes (business_id, product_id, supplier_id, code) VALUES ($1,$2,$3,'TS1K')`, [biz, salt, supA]);
  await pool.query(`INSERT INTO product_aliases (business_id, product_id, alias, alias_key, source) VALUES ($1,$2,'BASMATI 5KG INDIA GATE','basmati 5kg india gate','SUPPLIER')`, [biz, rice]);
  const lines = [
    { description: 'Some other words', barcode: '8901262010042' },                         // barcode wins whatever the words say
    { description: 'Salt iodised', supplier_code: 'ts1k' },                               // this supplier's code, case-insensitive
    { description: 'Basmati 5kg India Gate' },                                            // learned wording (punctuation and case ignored)
    { description: 'AMUL BUTTER 500gm' },                                                 // by name
    { description: 'Completely unknown thing' }
  ];
  const r = await matchLines(pool, { businessId: biz, supplierId: supA, lines });
  assert.deepEqual(r.map((x) => x.match && [x.match.product_id, x.match.via]), [[butter, 'barcode'], [salt, 'supplier_code'], [rice, 'alias'], [butter, 'name'], null]);
  assert.ok(r[3].match.score >= 0.6);
  assert.deepEqual(r[4].suggestions, []);
  // another supplier's code does not apply to this supplier; another business's products are never offered
  const wrongSupplier = await matchLines(pool, { businessId: biz, supplierId: supB, lines: [{ description: 'zzz', supplier_code: 'TS1K' }] });
  assert.equal(wrongSupplier[0].match, null);
  const stranger = await matchLines(pool, { businessId: other, supplierId: null, lines: [{ description: 'Amul Butter 500 g', barcode: '8901262010042' }] });
  assert.equal(stranger[0].match, null);
});

test('a name that is only close is a suggestion, and the size decides between look-alikes', { skip }, async () => {
  const r = await matchLines(pool, { businessId: biz, supplierId: null, lines: [{ description: 'Amul Butter' }, { description: 'Amul Butter 100gm' }] });
  assert.equal(r[0].match, null, 'two sizes fit "Amul Butter": a person chooses');
  assert.deepEqual(r[0].suggestions.map((s) => s.product_id).sort(), [butter, butter100].sort());
  assert.equal(r[1].match.product_id, butter100);
});

test('scanning reads the bill, matches it, and flags a repeated bill and a wrong total; stock is untouched', { skip }, async () => {
  setConfigured(true);
  const provider = scripted(recorded({
    supplier_name: 'Metro Wholesale', invoice_no: 'INV-2291', invoice_date: '2026-09-30', total: 9999,
    lines: [{ description: 'Amul Butter 500 g', barcode: '8901262010042', quantity: 10, rate: 262, tax_rate: 12, amount: 2620 }, { description: 'Tata Salt 1kg', supplier_code: 'TS1K', quantity: 20, rate: 22, amount: 440 }]
  }));
  setProvider(provider);
  const before = (await pool.query(`SELECT count(*)::int AS n FROM purchase_orders WHERE business_id = $1`, [biz])).rows[0].n;
  const res = await run(importer.scan, { files: [jpeg(), pdf()] });
  assert.equal(res.code, 200);
  const d = res.body.data;
  assert.deepEqual(d.supplier, { supplier_id: supA, name: 'Metro Wholesale' });
  assert.deepEqual(d.lines.map((l) => l.match?.product_id), [butter, salt]);
  assert.deepEqual(d.total_mismatch, { printed: 9999, lines: 3060 });
  assert.equal(d.duplicate_of, null);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM purchase_orders WHERE business_id = $1`, [biz])).rows[0].n, before, 'reading a bill records nothing');
  const sent = provider.seen[0].messages[0].content;
  assert.equal(sent.filter((b) => b.type === 'image').length, 2, 'both pages go to the model');
  assert.equal(sent.find((b) => b.source?.media_type === 'application/pdf') ? true : false, true, 'a PDF is sent as a PDF');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ai_usage WHERE business_id = $1`, [biz])).rows[0].n, 1, 'the request is counted against the plan');
});

test('scan refuses no file, a wrong file, too many pages, and an AI service that is not set up', { skip }, async () => {
  assert.equal((await run(importer.scan)).code, 400);
  assert.equal((await run(importer.scan, { files: [{ mimetype: 'application/pdf', buffer: Buffer.from('<html>nope nope</html>'), size: 22 }] })).code, 400);
  assert.equal((await run(importer.scan, { files: Array.from({ length: 6 }, jpeg) })).code, 400);
  setConfigured(false);
  assert.equal((await run(importer.scan, { files: [jpeg()] })).body.code, 'AI_NOT_CONFIGURED');
  setConfigured(true);
});

test('a bill the model could not read returns no lines and says why, and costs one request', { skip }, async () => {
  setProvider(scripted(recorded({ lines: [], notes: 'This looks like a menu, not a bill.' })));
  const res = await run(importer.scan, { files: [jpeg()] });
  assert.deepEqual(res.body.data.lines, []);
  assert.match(res.body.data.notes, /menu/);
});

const receive = (extra = {}) => run(purchases.create, { body: { supplier_id: supA, supplier_invoice_no: 'INV-2291', items: [{ product_id: butter, quantity: 10, unit_cost: 262, tax_rate: 12 }], ...extra } });

test('the same supplier’s same bill number is refused the second time, unless the person confirms; other suppliers are not affected', { skip }, async () => {
  const first = await receive();
  assert.equal(first.code, 201);
  const again = await receive();
  assert.equal(again.code, 409); assert.equal(again.body.code, 'DUPLICATE_BILL'); assert.match(again.body.message, /INV-2291/);
  assert.equal((await receive({ supplier_invoice_no: 'inv-2291' })).code, 409, 'case does not matter');
  assert.equal((await receive({ supplier_id: supB })).code, 201, 'another supplier may use the same number');
  assert.equal((await receive({ allow_duplicate_bill: true })).code, 201, 'a confirmed repeat goes through');
  const check = await run(importer.check, { query: { supplier_id: String(supA), invoice_no: 'INV-2291' } });
  assert.match(check.body.data.duplicate_of, /^PO/i);
  const none = await run(importer.check, { query: { supplier_id: String(supA), invoice_no: 'NEW-1' } });
  assert.equal(none.body.data.duplicate_of, null);
  const scan = scripted(recorded({ supplier_name: 'Metro Wholesale', invoice_no: 'INV-2291', lines: [{ description: 'x', quantity: 1, rate: 1 }] })); setProvider(scan);
  assert.ok((await run(importer.scan, { files: [jpeg()] })).body.data.duplicate_of, 'scanning the same bill again warns before anything is typed');
});

test('what a person matched is learned: wording, supplier code and a new barcode; a correction moves a code; nothing is stolen or cross-business', { skip }, async () => {
  const learn = (pairs) => run(importer.learn, { body: { supplier_id: supA, pairs } });
  const r = await learn([
    { product_id: butter100, description: 'AMUL BTR 100G', supplier_code: 'AB100', barcode: '8901262010059' },
    { product_id: salt, description: 'Tata Salt 1 kg' },                                // same as its own name: no alias
    { product_id: rice, description: 'Gate Rice', barcode: '8901262010042' }              // that barcode is butter's: never moved
  ]);
  assert.deepEqual(r.body.data, { aliases: 2, codes: 1, barcodes: 1 });
  const next = await matchLines(pool, { businessId: biz, supplierId: supA, lines: [{ description: 'amul btr 100g' }, { description: 'whatever', supplier_code: 'ab100' }, { description: 'x', barcode: '8901262010059' }] });
  assert.deepEqual(next.map((m) => [m.match.product_id, m.match.via]), [[butter100, 'alias'], [butter100, 'supplier_code'], [butter100, 'barcode']]);
  assert.equal((await pool.query(`SELECT product_id FROM product_barcodes WHERE business_id = $1 AND barcode = '8901262010042'`, [biz])).rows[0].product_id, butter);

  await learn([{ product_id: butter, description: 'x', supplier_code: 'AB100' }]);        // the person corrected: AB100 is the 500 g one
  assert.equal((await pool.query(`SELECT product_id FROM product_supplier_codes WHERE business_id = $1 AND lower(code) = 'ab100' AND supplier_id = $2`, [biz, supA])).rows[0].product_id, butter);

  const foreign = await run(importer.learn, { businessId: other, body: { pairs: [{ product_id: butter, description: 'Hijack', supplier_code: 'HJ1' }] } });
  assert.deepEqual(foreign.body.data, { aliases: 0, codes: 0, barcodes: 0 }, 'another business’s product id writes nothing');
  assert.equal((await run(importer.learn, { body: { supplier_id: 999999, pairs: [{ product_id: butter, description: 'x' }] } })).code, 400);
  assert.deepEqual((await run(importer.learn, { body: { pairs: [] } })).body.data, { aliases: 0, codes: 0, barcodes: 0 });
});
