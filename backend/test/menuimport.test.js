/*
 * Menu import from photos: what is sent to the AI service, how its answer is
 * cleaned up, duplicate detection, and the confirm step that is the only thing
 * that ever writes to the menu. The AI service is replaced by a script.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const menuImport = await import('../src/controllers/menuImport.controller.js');
const { normaliseItems, SYSTEM, TOOL } = await import('../src/modules/ai/menuScan.js');
const { setProvider, AIProviderError } = await import('../src/modules/ai/provider.js');

test.after(() => { setProvider(null); return cleanup(); });

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const recorded = (items, notes = null) => ({ content: [{ type: 'tool_use', id: 't1', name: 'record_menu', input: { items, notes } }], stopReason: 'tool_use', usage: { input_tokens: 1500, output_tokens: 300 } });
const scripted = (reply) => { const seen = []; const p = async (req) => { seen.push(JSON.parse(JSON.stringify(req))); if (reply instanceof Error) throw reply; return reply; }; p.seen = seen; return p; };
const photo = (type = 'image/jpeg', size = 2000) => ({ mimetype: type, buffer: Buffer.alloc(size, 7), size, originalname: 'menu.jpg' });

/* ── pure ───────────────────────────────────────────────────────────────── */

test('the model’s answer is cleaned: trimmed, prices checked, repeats dropped', () => {
  const items = normaliseItems([
    { name: '  Paneer   Tikka ', price: 240, category: ' Starters ', description: 'Char-grilled', is_veg: true },
    { name: 'Chicken Biryani (Half)', price: '₹ 180/-', category: 'Biryani' },
    { name: 'Chicken Biryani (Full)', price: 320.456 },
    { name: 'Paneer Tikka', price: 240, category: 'Starters' },                       // shown twice on two pages
    { name: 'Mystery Special', price: null },
    { name: '   ', price: 100 },                                                        // no name
    { name: 'Free Water', price: 0 },
    { name: 'Absurd', price: 99999999 },
    { name: 'Negative', price: -5 },
    null, 'junk'
  ]);
  assert.deepEqual(items.map((i) => [i.name, i.price]), [['Paneer Tikka', 240], ['Chicken Biryani (Half)', 180], ['Chicken Biryani (Full)', 320.46], ['Mystery Special', null], ['Free Water', 0], ['Absurd', null], ['Negative', null]]);
  assert.equal(items[0].category, 'Starters');
  assert.equal(items[0].is_veg, true);
  assert.deepEqual(items.filter((i) => i.unsure).map((i) => i.name), ['Mystery Special', 'Absurd', 'Negative'], 'no price means a person must check');
  assert.deepEqual(normaliseItems(undefined), []);
  assert.equal(normaliseItems(Array.from({ length: 400 }, (_, i) => ({ name: `Dish ${i}`, price: 10 }))).length, 300, 'a sane cap');
});

test('the prompt treats the menu as content, and the tool forces structured output', () => {
  assert.match(SYSTEM, /never instructions/i);
  assert.match(SYSTEM, /Do not invent/);
  assert.equal(TOOL.name, 'record_menu');
  assert.ok(TOOL.input_schema.required.includes('items'));
});

/* ── database ───────────────────────────────────────────────────────────── */

let biz; let user; let other;
const call = async (fn, { files, body = {}, businessId = biz } = {}) => {
  const res = fakeRes();
  await fn({ tenant: { businessId, branchId: null, role: 'OWNER', permissions: {} }, auth: { userId: user }, files, body, query: {}, params: {}, headers: {}, ip: '127.0.0.1' }, res);
  return res;
};
const products = async () => (await pool.query(`SELECT p.name, p.selling_price_paise, p.tax_rate, p.track_inventory, p.kind, c.name AS category FROM products p LEFT JOIN categories c ON c.category_id = p.category_id WHERE p.business_id = $1 ORDER BY p.product_id`, [biz])).rows;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@mi.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code, subscription_status, gst_enabled) VALUES ('Cafe',$1,'RESTAURANT','BUSINESS','ACTIVE',TRUE) RETURNING business_id`, [user])).rows[0].business_id;
  other = (await pool.query(`INSERT INTO businesses (name, owner_user_id) VALUES ('Other',$1) RETURNING business_id`, [user])).rows[0].business_id;
  await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,'Starters')`, [biz]);
  await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise) VALUES ($1,'Paneer Tikka','DISH',22000)`, [biz]);
  await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise) VALUES ($1,'Paneer Tikka','DISH',99900)`, [other]);
});

test('without an AI key the scan explains itself and nothing is sent', { skip }, async () => {
  setProvider(null);
  const res = await call(menuImport.scan, { files: [photo()] });
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'AI_NOT_CONFIGURED');
  assert.match(res.body.message, /add products by hand/);
});

test('the photos and the request reach the AI service in the right shape', { skip }, async () => {
  const provider = scripted(recorded([{ name: 'Butter Naan', price: 45, category: 'Breads' }]));
  setProvider(provider);
  const res = await call(menuImport.scan, { files: [photo('image/jpeg'), photo('image/png')] });
  assert.equal(res.code, 200);
  const req = provider.seen[0];
  const blocks = req.messages[0].content;
  assert.deepEqual(blocks.filter((b) => b.type === 'image').map((b) => b.source.media_type), ['image/jpeg', 'image/png']);
  assert.equal(blocks.find((b) => b.type === 'image').source.type, 'base64');
  assert.equal(blocks.find((b) => b.type === 'image').source.data, Buffer.alloc(2000, 7).toString('base64'));
  assert.match(blocks.at(-1).text, /2 photos are pages of one menu/);
  assert.deepEqual(req.toolChoice, { type: 'tool', name: 'record_menu' }, 'must answer with the tool, not prose');
  assert.equal(req.tools[0].name, 'record_menu');
  assert.match(req.system, /rupees/);
});

test('a scan returns a draft, flags what is already on the menu, and saves nothing', { skip }, async () => {
  const before = await products();
  setProvider(scripted(recorded([
    { name: 'paneer  tikka', price: 240, category: 'Starters' },
    { name: 'Chicken 65', price: 260, category: 'Starters', description: 'Spicy fried chicken', is_veg: false },
    { name: 'Gobi Manchurian', price: null, unsure: true }
  ], 'The bottom of the page was cut off.')));
  const res = await call(menuImport.scan, { files: [photo()] });
  assert.equal(res.code, 200);
  const d = res.body.data;
  assert.equal(d.items.length, 3);
  assert.deepEqual(d.items[0].duplicate_of, { product_id: d.items[0].duplicate_of.product_id, name: 'Paneer Tikka', price: 220 }, 'matched ignoring case and spacing, and shows the current price');
  assert.equal(d.items[1].duplicate_of, null);
  assert.equal(d.items[2].unsure, true);
  assert.equal(d.notes, 'The bottom of the page was cut off.');
  assert.deepEqual(d.categories, ['Starters']);
  assert.equal(d.gst_enabled, true);
  assert.deepEqual(await products(), before, 'reading a photo never changes the menu');
  // another business's dish of the same name is not "already on your menu"
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1`, [biz])).rows[0].n, 1);
});

test('bad uploads are refused before anything is sent', { skip }, async () => {
  const provider = scripted(recorded([]));
  setProvider(provider);
  assert.equal((await call(menuImport.scan, { files: [] })).code, 400);
  assert.equal((await call(menuImport.scan, {})).code, 400);
  assert.equal((await call(menuImport.scan, { files: [photo('application/pdf')] })).code, 400);
  assert.equal((await call(menuImport.scan, { files: [photo('image/gif')] })).code, 400);
  assert.equal((await call(menuImport.scan, { files: Array.from({ length: 6 }, () => photo()) })).code, 400);
  assert.equal(provider.seen.length, 0);
});

test('a scan counts as one AI request, a failure costs nothing, and the switches are respected', { skip }, async () => {
  const count = async () => (await pool.query(`SELECT COUNT(*)::int AS n FROM ai_usage WHERE business_id = $1`, [biz])).rows[0].n;
  setProvider(scripted(recorded([{ name: 'X', price: 1 }])));
  const before = await count();
  const ok = await call(menuImport.scan, { files: [photo()] });
  assert.equal(await count(), before + 1);
  assert.equal(ok.body.data.remaining, 2000 - (before + 1));
  const usage = (await pool.query(`SELECT input_tokens, output_tokens FROM ai_usage WHERE business_id = $1 ORDER BY usage_id DESC LIMIT 1`, [biz])).rows[0];
  assert.deepEqual(usage, { input_tokens: 1500, output_tokens: 300 });

  setProvider(scripted(new AIProviderError('The AI service took too long to answer')));
  assert.equal((await call(menuImport.scan, { files: [photo()] })).code, 502);
  assert.equal(await count(), before + 1, 'a failed scan is not charged');

  setProvider(scripted(recorded([{ name: 'X', price: 1 }])));
  await pool.query(`UPDATE businesses SET ai_enabled = FALSE WHERE business_id = $1`, [biz]);
  const off = await call(menuImport.scan, { files: [photo()] });
  assert.equal(off.code, 403);
  assert.equal(off.body.code, 'AI_DISABLED');
  await pool.query(`UPDATE businesses SET ai_enabled = TRUE WHERE business_id = $1`, [biz]);

  await pool.query(`UPDATE plans SET limits = limits || jsonb_build_object('ai_queries', $1::int) WHERE plan_code = 'BUSINESS'`, [await count()]);
  const over = await call(menuImport.scan, { files: [photo()] });
  assert.equal(over.code, 402);
  assert.equal(over.body.code, 'AI_LIMIT');
  await pool.query(`UPDATE plans SET limits = limits || jsonb_build_object('ai_queries', 2000) WHERE plan_code = 'BUSINESS'`);
});

test('confirm creates categories and dishes with the reviewed names and prices, and nothing else', { skip }, async () => {
  const res = await call(menuImport.confirm, {
    body: {
      tax_rate: 5,
      items: [
        { name: 'Chicken 65', price: 260, category: 'Starters', description: 'Spicy fried chicken' },
        { name: ' Butter  Naan ', price: '45', category: 'breads' },
        { name: 'Garlic Naan', price: 55, category: 'Breads' },                      // same category, different case
        { name: 'Sweet Lassi', price: 90 }                                            // no category
      ]
    }
  });
  assert.equal(res.code, 201);
  assert.deepEqual(res.body.data, { created: 4, updated: 0, skipped: 0, categories_created: 1 }, 'Starters existed; Breads is new and shared');
  const all = await products();
  const added = all.filter((p) => p.name !== 'Paneer Tikka');
  assert.deepEqual(added.map((p) => [p.name, Number(p.selling_price_paise), p.category]), [['Chicken 65', 26000, 'Starters'], ['Butter Naan', 4500, 'breads'], ['Garlic Naan', 5500, 'breads'], ['Sweet Lassi', 9000, null]]);
  assert.ok(added.every((p) => p.kind === 'DISH' && Number(p.tax_rate) === 5 && p.track_inventory === false), 'dishes for sale, GST as chosen, not stock-tracked');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1`, [other])).rows[0].n, 1, 'the other business is untouched');
});

test('importing the same menu again skips what exists, or updates prices when asked', { skip }, async () => {
  const items = [{ name: 'Paneer Tikka', price: 260, category: 'Starters' }, { name: 'chicken 65', price: 280 }, { name: 'Onion Rings', price: 120 }, { name: 'Onion Rings', price: 125 }];
  const skip1 = await call(menuImport.confirm, { body: { items } });
  assert.deepEqual(skip1.body.data, { created: 1, updated: 0, skipped: 3, categories_created: 0 }, 'two existing, and the second Onion Rings is a repeat within the batch');
  const price = async (name) => Number((await pool.query(`SELECT selling_price_paise FROM products WHERE business_id = $1 AND name = $2`, [biz, name])).rows[0].selling_price_paise);
  assert.equal(await price('Paneer Tikka'), 22000, 'unchanged');
  assert.equal(await price('Onion Rings'), 12000, 'first one wins');

  const upd = await call(menuImport.confirm, { body: { on_duplicate: 'update_price', items: [{ name: 'Paneer Tikka', price: 260 }, { name: 'Chicken 65', price: 280 }] } });
  assert.deepEqual(upd.body.data, { created: 0, updated: 2, skipped: 0, categories_created: 0 });
  assert.equal(await price('Paneer Tikka'), 26000);
  assert.equal(await price('Chicken 65'), 28000);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1 AND name = 'Paneer Tikka'`, [other])).rows[0].n, 1);
  assert.equal(Number((await pool.query(`SELECT selling_price_paise FROM products WHERE business_id = $1`, [other])).rows[0].selling_price_paise), 99900, 'never touches another business');
});

test('a bad row rejects the whole batch, naming it, and nothing is saved', { skip }, async () => {
  const before = (await products()).length;
  const bad = async (items, pattern, extra = {}) => {
    const res = await call(menuImport.confirm, { body: { items, ...extra } });
    assert.equal(res.code, 400);
    assert.match(res.body.message, pattern);
  };
  await bad([{ name: 'Fine Dish', price: 10 }, { name: 'No Price' }], /No Price: enter a price/);
  await bad([{ name: 'Fine Dish', price: 10 }, { name: 'Text Price', price: 'abc' }], /Text Price: enter a price/);
  await bad([{ name: 'Negative', price: -1 }], /between 0 and/);
  await bad([{ name: '', price: 10 }], /Item 1: enter a name/);
  await bad([{ name: 'x'.repeat(161), price: 10 }], /Item 1/);
  await bad([], /at least one/);
  await bad([{ name: 'Dish', price: 10 }], /GST rate/, { tax_rate: 90 });
  await bad(Array.from({ length: 301 }, (_, i) => ({ name: `D${i}`, price: 1 })), /at most 300/);
  assert.equal((await products()).length, before);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1 AND name = 'Fine Dish'`, [biz])).rows[0].n, 0, 'the good row before the bad one was not saved');
});

test('an import is recorded in the activity log', { skip }, async () => {
  const { recordAudit } = await import('../src/modules/events.js');
  const { describeAction } = await import('../src/modules/auditText.js');
  assert.equal(describeAction('menu.imported', { created: 12, updated: 2, skipped: 1 }), 'Imported the menu from a photo: 12 added 2 prices updated 1 skipped');
  void recordAudit;
  let rows = [];
  for (let i = 0; i < 30 && rows.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 100));
    rows = (await pool.query(`SELECT metadata FROM audit_log WHERE business_id = $1 AND action = 'menu.imported' ORDER BY audit_id`, [biz])).rows;
  }
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].metadata.created, 4);
});
