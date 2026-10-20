/*
 * The prepaid wallet and hour packs: top-ups and bonuses, paying a bill from the balance (alone or split), a short balance refusing the whole bill,
 * races on one balance, refunds and cancellations giving money back once, adjustments, packs sold on an invoice, sessions played against a pack, and
 * two sessions never spending the same minutes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { TODAY, addDays, addDish, at, fakeRes, makeLounge, rs } from './helpers/gaming.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const stations = await import('../src/modules/gaming/stations.js');
const rates = await import('../src/modules/gaming/rates.js');
const sessions = await import('../src/modules/gaming/sessions.js');
const players = await import('../src/modules/gaming/players.js');
const wallet = await import('../src/modules/gaming/wallet.js');
const passes = await import('../src/modules/gaming/passes.js');
const { inTx, getSettings } = await import('../src/modules/gaming/common.js');
const orders = await import('../src/controllers/orders.controller.js');
const invoicesApi = await import('../src/controllers/invoices.controller.js');
const creditNotes = await import('../src/controllers/creditNotes.controller.js');
const walletApi = (await import('../src/controllers/gamingWallet.controller.js')).default;
const router = (await import('../src/routes/gaming.routes.js')).default;
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

let L; let M; let tenant; let userId; let ps5; let ps5b; let pool1; let dish; let asha; let bela;
const tx = (fn) => inTx(fn);
const start = (stationId, over = {}, when = at(0)) => tx((db) => sessions.startSession(db, tenant, userId, { station_id: stationId, players: 1, ...over }, { now: when }));
const stop = (id, when, body = {}) => tx((db) => sessions.stopSession(db, tenant, userId, id, body, { now: when }));
const call = (handler, extra, t = tenant) => L.call(handler, extra, t);
const balance = (c) => wallet.balanceOf(pool, L.businessId, c);
const topUp = async (customerId, amount, over = {}) => tx(async (db) => wallet.topUp(db, tenant, userId, customerId, { amount, method: 'UPI', ...over }, { settings: await getSettings(db, L.businessId) }));
const billTab = (orderId, body) => call(orders.bill, { params: { id: orderId }, body });
/** A tab with one dish on it, for a player: the quickest way to a bill of a known size (dish price + 5% GST). */
const tabWith = async (customerId, price) => {
  const d = await addDish(pool, L, { name: `Dish ${price}`, price, tax: 5 });
  const st = await tx((db) => stations.createStation(db, tenant, { name: `Spare ${Math.random().toString(36).slice(2, 7)}`, kind: 'TABLE_GAME' }));
  const order = await tx((db) => orders.getOrCreateOpenOrderForTable(db, { businessId: L.businessId, branchId: L.branchId, tableId: st.table_id, customerId, createdBy: userId }));
  assert.equal((await call(orders.addItems, { params: { id: order.order_id }, body: { items: [{ product_id: d, quantity: 1 }] } })).code, 201);
  return order.order_id;
};
const ledgerRows = async (c) => (await pool.query(`SELECT kind, amount_paise, source_type FROM gaming_wallet_ledger WHERE business_id = $1 AND customer_id = $2 ORDER BY entry_id`, [L.businessId, c])).rows;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  L = await makeLounge(pool, 'wal');
  M = await makeLounge(pool, 'wal2');
  tenant = L.tenantFor();
  userId = L.userId;
  dish = await addDish(pool, L, { name: 'Cold coffee', price: 100, tax: 5 });
  ps5 = await tx((db) => stations.createStation(db, tenant, { name: 'PS5-1', kind: 'CONSOLE' }));
  ps5b = await tx((db) => stations.createStation(db, tenant, { name: 'PS5-2', kind: 'CONSOLE' }));
  pool1 = await tx((db) => stations.createStation(db, tenant, { name: 'Pool-1', kind: 'POOL' }));
  await tx((db) => rates.createRate(db, L.businessId, { name: 'Console', kind: 'CONSOLE', tiers: [{ players: 1, hour: 120 }] }));
  await tx((db) => rates.createRate(db, L.businessId, { name: 'Pool', kind: 'POOL', tiers: [{ players: 1, hour: 120 }] }));
  asha = (await tx((db) => players.createPlayer(db, tenant, { name: 'Asha', phone: '9876500001' }))).customer_id;
  bela = (await tx((db) => players.createPlayer(db, tenant, { name: 'Bela', phone: '9876500002' }))).customer_id;
  await getSettings(pool, L.businessId);
  await pool.query(`UPDATE gaming_settings SET topup_bonus = $2::jsonb WHERE business_id = $1`, [L.businessId, JSON.stringify([{ min: 500, bonus: 50 }, { min: 1000, bonus: 150 }])]);
});

test('a top-up is money in and a balance; the bonus follows the highest rule it reaches', { skip }, async () => {
  const a = await topUp(asha, 500);
  assert.equal(a.bonus_paise, rs(50));
  assert.equal(a.balance_paise, rs(550));
  const pay = (await pool.query(`SELECT * FROM payments WHERE payment_id = $1`, [a.payment_id])).rows[0];
  assert.equal(pay.invoice_id, null, 'an advance, not a sale');
  assert.equal(pay.payment_method, 'UPI');
  assert.equal(Number(pay.amount_paise), rs(500), 'the money in is what was paid, not the bonus');
  assert.deepEqual((await ledgerRows(asha)).map((r) => r.kind), ['TOPUP', 'BONUS']);
  const b = await topUp(asha, 1200);
  assert.equal(b.bonus_paise, rs(150), 'the 1000 rule beats the 500 rule');
  assert.equal(b.balance_paise, rs(550 + 1200 + 150));
  assert.equal((await topUp(bela, 300)).bonus_paise, 0, 'below the first rule: no bonus');
  assert.equal((await topUp(bela, 700, { no_bonus: true })).bonus_paise, 0, 'a manager can leave it off');
  await assert.rejects(() => topUp(asha, 0.5), /less than/);
  await assert.rejects(() => topUp(asha, 600000), /at most/);
  await assert.rejects(() => topUp(asha, 100, { method: 'WALLET' }), /must be one of/);
  await assert.rejects(() => topUp(999999, 100), /Not found/);
});

test('a top-up sent twice with the same request id adds once', { skip }, async () => {
  const before = await balance(bela);
  const id = '11111111-aaaa-bbbb-cccc-000000000001';
  const one = await topUp(bela, 200, { request_id: id });
  const two = await topUp(bela, 200, { request_id: id });
  assert.equal(two.repeated, true);
  assert.equal(await balance(bela), before + rs(200));
  assert.equal(one.payment_id, two.payment_id);
  const rows = (await pool.query(`SELECT COUNT(*)::int AS n FROM payments WHERE business_id = $1 AND customer_id = $2 AND notes = 'Gaming wallet top-up'`, [L.businessId, bela])).rows[0].n;
  assert.equal(rows, 3, 'three real top-ups for Bela, not four');
});

test('a bill is paid from the wallet; the rest by another method', { skip }, async () => {
  const start0 = await balance(asha);
  const order = await tabWith(asha, 200);                                   // 200 + 5% = 210
  const res = await billTab(order, { payments: [{ method: 'WALLET', amount: 100 }, { method: 'CASH', amount: 'REST' }] });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.equal(await balance(asha), start0 - rs(100));
  const pays = (await pool.query(`SELECT payment_method, amount_paise FROM payments WHERE invoice_id = $1 ORDER BY payment_id`, [res.body.data.invoice_id])).rows;
  assert.deepEqual(pays.map((p) => [p.payment_method, Number(p.amount_paise)]), [['WALLET', rs(100)], ['CASH', rs(110)]]);
  const spent = (await ledgerRows(asha)).at(-1);
  assert.equal(spent.kind, 'SPEND');
  assert.equal(Number(spent.amount_paise), -rs(100));
  const all = await billTab(await tabWith(asha, 100), { payment: { method: 'WALLET', amount: 'FULL' } });
  assert.equal(all.code, 201, JSON.stringify(all.body));
  assert.equal(await balance(asha), start0 - rs(100) - rs(105));
});

test('a short wallet refuses the whole bill and moves nothing', { skip }, async () => {
  const before = await balance(bela);
  const order = await tabWith(bela, 5000);                                  // 5250, far more than Bela has
  const res = await billTab(order, { payment: { method: 'WALLET', amount: 'FULL' } });
  assert.equal(res.code, 400);
  assert.match(res.body.message, /less than/);
  assert.equal(await balance(bela), before);
  assert.equal((await pool.query(`SELECT status FROM orders WHERE order_id = $1`, [order])).rows[0].status, 'OPEN', 'the tab is still open');
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM invoices WHERE order_id = $1`, [order])).rows[0].n), 0, 'and no invoice was made');
  const none = await billTab(await tabWith(null, 100), { payment: { method: 'WALLET', amount: 'FULL' } });
  assert.equal(none.code, 400, 'a walk-in has no wallet');
  assert.match(none.body.message, /Choose the player/);
});

test('two bills against one balance: only as many as it can pay succeed, and it never goes negative', { skip }, async () => {
  const c = (await tx((db) => players.createPlayer(db, tenant, { name: 'Race', phone: '9876500003' }))).customer_id;
  await topUp(c, 200, { no_bonus: true });
  const orders3 = [await tabWith(c, 100), await tabWith(c, 100), await tabWith(c, 100)];   // 105 each; the wallet holds 200
  const results = await Promise.all(orders3.map((o) => billTab(o, { payment: { method: 'WALLET', amount: 'FULL' } })));
  assert.equal(results.filter((r) => r.code === 201).length, 1, 'one bill of 105 fits in 200, a second does not');
  assert.equal(await balance(c), rs(95));
  assert.ok(await balance(c) >= 0);
});

test('a credit note can refund to the wallet, once; cancelling a wallet-paid bill gives the wallet its money back, once', { skip }, async () => {
  const c = (await tx((db) => players.createPlayer(db, tenant, { name: 'Refunds', phone: '9876500004' }))).customer_id;
  await topUp(c, 500, { no_bonus: true });
  const order = await tabWith(c, 100);
  const bill = await billTab(order, { payment: { method: 'WALLET', amount: 'FULL' } });
  assert.equal(await balance(c), rs(500 - 105));
  const invoiceId = bill.body.data.invoice_id;
  const item = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [invoiceId])).rows[0].item_id;
  const note = await call(creditNotes.create ?? creditNotes.default?.create, { params: { id: invoiceId }, body: { reason: 'Wrong item', items: [{ item_id: item, quantity: 1 }], refund: { method: 'WALLET' } } });
  assert.equal(note.code, 201, JSON.stringify(note.body));
  assert.equal(await balance(c), rs(500), 'the 105 is back');
  assert.equal((await ledgerRows(c)).filter((r) => r.kind === 'REFUND').length, 1);

  // a second bill, cancelled outright
  const o2 = await tabWith(c, 200);
  const b2 = await billTab(o2, { payments: [{ method: 'WALLET', amount: 100 }, { method: 'CASH', amount: 'REST' }] });
  assert.equal(await balance(c), rs(400));
  const cancel = await call(invoicesApi.cancel, { params: { id: b2.body.data.invoice_id }, body: { reason: 'Test cancel' } });
  assert.equal(cancel.code, 200, JSON.stringify(cancel.body));
  assert.equal(await balance(c), rs(500), 'only the wallet part went back; the cash is a refund for a person to decide');
  const again = await tx((db) => wallet.returnWalletForCancelled(db, { businessId: L.businessId, invoiceId: b2.body.data.invoice_id, userId }));
  assert.equal(again, rs(100));
  assert.equal(await balance(c), rs(500), 'a second return of the same bill changes nothing');
  // a refund to the wallet is for a lounge only
  const other = await makeLounge(pool, 'cafe', { type: 'CAFE' });
  const note2 = await other.call(creditNotes.create, { params: { id: 1 }, body: { reason: 'x', items: [{ item_id: 1, quantity: 1 }], refund: { method: 'WALLET' } } }, other.tenantFor());
  assert.equal(note2.code, 400);
});

test('an adjustment needs a reason and cannot take the wallet below zero', { skip }, async () => {
  const c = (await tx((db) => players.createPlayer(db, tenant, { name: 'Adjust', phone: '9876500005' }))).customer_id;
  await topUp(c, 100, { no_bonus: true });
  await assert.rejects(() => tx((db) => wallet.adjust(db, tenant, userId, c, { amount: 50 })), /reason/);
  assert.equal((await tx((db) => wallet.adjust(db, tenant, userId, c, { amount: 50, reason: 'Goodwill' }))).balance_paise, rs(150));
  await assert.rejects(() => tx((db) => wallet.adjust(db, tenant, userId, c, { amount: -200, reason: 'Too much' })), /below zero/);
  assert.equal((await tx((db) => wallet.adjust(db, tenant, userId, c, { amount: -150, reason: 'Left the city' }))).balance_paise, 0);
  await assert.rejects(() => tx((db) => wallet.adjust(db, tenant, userId, c, { amount: 0, reason: 'x' })), /zero/);
  const { rows, total } = await wallet.ledger(pool, tenant, c, { limit: 10, offset: 0 });
  assert.equal(total, 3);
  assert.equal(rows[0].kind, 'ADJUST');
});

test('the wallet and its lounge are private: another business sees nothing and cannot spend it', { skip }, async () => {
  const other = M.tenantFor();
  await assert.rejects(() => players.getPlayer(pool, other, asha), /Not found/);
  await assert.rejects(() => tx((db) => wallet.topUp(db, other, M.userId, asha, { amount: 100 }, { settings: { topup_bonus: [] } })), /Not found/);
  await assert.rejects(() => tx((db) => wallet.spend(db, { businessId: M.businessId, customerId: asha, amountPaise: 1, invoiceId: null, paymentId: 1, userId: M.userId })), /Not found/);
  assert.equal((await wallet.liability(pool, M.businessId)).owed_paise, 0);
  const l = await wallet.liability(pool, L.businessId);
  assert.ok(l.owed_paise > 0 && l.players >= 3);
  assert.ok(l.month_topups_paise > 0 && l.month_bonus_paise > 0 && l.month_spent_paise > 0);
});

test('a WALLET payment at a business that is not a lounge is only a label', { skip }, async () => {
  const cafe = await makeLounge(pool, 'label', { type: 'CAFE' });
  const t = cafe.tenantFor();
  const d = await addDish(pool, cafe, { name: 'Tea', price: 20, tax: 5 });
  const inv = await tx((db) => createInvoiceInTransaction(db, t, cafe.userId, { items: [{ product_id: d, quantity: 1 }], payment: { method: 'WALLET', amount: 'FULL' } }));
  assert.equal(inv.payments_taken[0].method, 'WALLET');
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM gaming_wallet_ledger WHERE business_id = $1`, [cafe.businessId])).rows[0].n), 0);
});

/* ── packs ────────────────────────────────────────────────────────────────── */

let pack10; let packPool;
test('selling a pack makes a GST invoice, paid in full, and a pack with minutes and an expiry', { skip }, async () => {
  pack10 = await tx((db) => rates.createBundle(db, L.businessId, { name: '10 hours', kind: 'PACK', minutes: 600, price: 800, kinds: ['CONSOLE'], valid_days: 90 }));
  packPool = await tx((db) => rates.createBundle(db, L.businessId, { name: 'Pool 2 hours', kind: 'PACK', minutes: 120, price: 300, valid_days: 30 }));
  await assert.rejects(() => tx((db) => passes.sellPass(db, tenant, userId, asha, { bundle_id: pack10.bundle_id })), /Take the payment/);
  await assert.rejects(() => tx((db) => passes.sellPass(db, tenant, userId, asha, { bundle_id: pack10.bundle_id, payment: { method: 'CASH', amount: 100 } })), /paid in full/);
  const sold = await tx((db) => passes.sellPass(db, tenant, userId, asha, { bundle_id: pack10.bundle_id, payment: { method: 'UPI', amount: 'FULL' } }));
  assert.equal(sold.pass.minutes_left, 600);
  assert.equal(sold.pass.state, 'ACTIVE');
  assert.equal(sold.pass.expires_on, addDays(TODAY, 90), '90 days from the lounge day');
  const inv = (await pool.query(`SELECT total_paise, tax_paise, payment_status FROM invoices WHERE invoice_id = $1`, [sold.invoice.invoice_id])).rows[0];
  assert.equal(Number(inv.total_paise), 94400, '800 + 18% GST');
  assert.equal(inv.payment_status, 'PAID');
  await assert.rejects(() => tx((db) => passes.sellPass(db, tenant, userId, asha, { bundle_id: 999999, payment: { method: 'CASH', amount: 'FULL' } })), /does not exist/);
  assert.equal((await passes.listPasses(pool, tenant, asha)).length, 1);
});

test('a session plays against a pack: the pack covers its minutes, the rest is charged, and the minutes come off the pack', { skip }, async () => {
  const pass = (await passes.listPasses(pool, tenant, asha))[0];
  await assert.rejects(() => start(ps5.station_id, { mode: 'PACK', pack_id: pass.pass_id }), /Choose the player/);
  await assert.rejects(() => start(ps5.station_id, { mode: 'PACK', pack_id: pass.pass_id, customer_id: bela }), /belongs to someone else/);
  await assert.rejects(() => start(pool1.station_id, { mode: 'PACK', pack_id: pass.pass_id, customer_id: asha }), /not for this kind/);
  await assert.rejects(() => start(ps5.station_id, { mode: 'PACK' }), /Choose the pack/);
  const s = await start(ps5.station_id, { mode: 'PACK', pack_id: pass.pass_id, customer_id: asha }, at(0));
  assert.equal(s.planned_minutes, 600, 'the countdown is the time left on the pack');
  await assert.rejects(() => start(ps5b.station_id, { mode: 'PACK', pack_id: pass.pass_id, customer_id: asha }, at(1)), (e) => e.code === 'PACK_BUSY');
  await assert.rejects(() => tx((db) => sessions.extendSession(db, tenant, userId, s.session_id, { minutes: 30 }, { now: at(2) })), /cannot be extended/);
  const done = await stop(s.session_id, at(90));
  assert.equal(done.time_paise, 0, 'an hour and a half, all from the pack');
  assert.equal(done.tab_closed, true, 'nothing to pay, so the tab closes');
  const after = (await passes.listPasses(pool, tenant, asha))[0];
  assert.equal(after.minutes_left, 510);
  assert.equal(after.minutes_used, 90);
});

test('stopping a pack session taken back gives the minutes back', { skip }, async () => {
  const pass = (await passes.listPasses(pool, tenant, asha))[0];
  const s = await start(ps5.station_id, { mode: 'PACK', pack_id: pass.pass_id, customer_id: asha }, at(200));
  await stop(s.session_id, at(260));
  assert.equal((await passes.listPasses(pool, tenant, asha))[0].minutes_left, 450);
  // everything was covered, so the tab closed and cannot be reopened; use a station with food on the tab to keep it open
  const s2 = await start(ps5b.station_id, { mode: 'PACK', pack_id: pass.pass_id, customer_id: asha }, at(300));
  assert.equal((await call(orders.addItems, { params: { id: s2.order_id }, body: { items: [{ product_id: dish, quantity: 1 }] } })).code, 201);
  await stop(s2.session_id, at(330));
  assert.equal((await passes.listPasses(pool, tenant, asha))[0].minutes_left, 420);
  await tx((db) => sessions.reopenSession(db, tenant, userId, s2.session_id, { now: at(340) }));
  assert.equal((await passes.listPasses(pool, tenant, asha))[0].minutes_left, 450, 'the 30 minutes are back');
  await stop(s2.session_id, at(350));
  assert.equal((await passes.listPasses(pool, tenant, asha))[0].minutes_left, 420 - 10);
  await billTabIgnore(s2.order_id);
});
const billTabIgnore = (orderId) => billTab(orderId, { payment: { method: 'CASH', amount: 'FULL' } });

test('time past what the pack has left is charged by the minute', { skip }, async () => {
  const c = (await tx((db) => players.createPlayer(db, tenant, { name: 'Short pack', phone: '9876500006' }))).customer_id;
  const small = await tx((db) => rates.createBundle(db, L.businessId, { name: '1 hour', kind: 'PACK', minutes: 60, price: 100 }));
  await tx((db) => passes.sellPass(db, tenant, userId, c, { bundle_id: small.bundle_id, payment: { method: 'CASH', amount: 'FULL' } }));
  const pass = (await passes.listPasses(pool, tenant, c))[0];
  const s = await start(ps5.station_id, { mode: 'PACK', pack_id: pass.pass_id, customer_id: c }, at(400));
  const done = await stop(s.session_id, at(490));                               // 90 minutes: 60 from the pack, 30 at Rs 120 an hour
  assert.equal(done.time_paise, rs(60) * 1, '30 of the 90 minutes at Rs 120 an hour');
  assert.equal((await passes.listPasses(pool, tenant, c))[0].state, 'USED');
  const line = (await pool.query(`SELECT description FROM order_items WHERE order_id = $1`, [s.order_id])).rows[0];
  assert.match(line.description, /60 min from the pack/);
  await billTabIgnore(s.order_id);
  await assert.rejects(() => start(ps5.station_id, { mode: 'PACK', pack_id: pass.pass_id, customer_id: c }, at(600)), /no time left/);
});

test('two sessions cannot spend the same pack minutes, and an expired or withdrawn pack cannot be played', { skip }, async () => {
  const c = (await tx((db) => players.createPlayer(db, tenant, { name: 'Race pack', phone: '9876500007' }))).customer_id;
  const bundle = await tx((db) => rates.createBundle(db, L.businessId, { name: '2 hours', kind: 'PACK', minutes: 120, price: 200 }));
  const sold = await tx((db) => passes.sellPass(db, tenant, userId, c, { bundle_id: bundle.bundle_id, payment: { method: 'CASH', amount: 'FULL' } }));
  // both stations try to start at once: only one gets the pack
  const results = await Promise.allSettled([start(ps5.station_id, { mode: 'PACK', pack_id: sold.pass.pass_id, customer_id: c }, at(700)), start(ps5b.station_id, { mode: 'PACK', pack_id: sold.pass.pass_id, customer_id: c }, at(700))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const win = results.find((r) => r.status === 'fulfilled').value;
  await stop(win.session_id, at(760), { void: true, reason: 'cleanup' });
  // an expired pack
  await pool.query(`UPDATE gaming_passes SET expires_on = '2026-10-01' WHERE pass_id = $1`, [sold.pass.pass_id]);
  await assert.rejects(() => start(ps5.station_id, { mode: 'PACK', pack_id: sold.pass.pass_id, customer_id: c }, at(800)), /expired/);
  await pool.query(`UPDATE gaming_passes SET expires_on = NULL WHERE pass_id = $1`, [sold.pass.pass_id]);
  // its invoice cancelled: the pack is no longer valid
  assert.equal((await call(invoicesApi.cancel, { params: { id: sold.invoice.invoice_id }, body: { reason: 'Mistake' } })).code, 200);
  await assert.rejects(() => start(ps5.station_id, { mode: 'PACK', pack_id: sold.pass.pass_id, customer_id: c }, at(900)), /not valid/);
  assert.equal((await passes.passView(pool, tenant, sold.pass.pass_id)).state, 'CANCELLED');
  // a withdrawn pack
  const again = await tx((db) => passes.sellPass(db, tenant, userId, c, { bundle_id: bundle.bundle_id, payment: { method: 'CASH', amount: 'FULL' } }));
  await tx((db) => passes.cancelPass(db, tenant, again.pass.pass_id));
  await assert.rejects(() => start(ps5.station_id, { mode: 'PACK', pack_id: again.pass.pass_id, customer_id: c }, at(1000)), /not valid/);
  await assert.rejects(() => passes.passView(pool, M.tenantFor(), again.pass.pass_id), /Not found/);
});

test('the wallet and pack routes are behind permissions and the wallet plan feature', { skip }, async () => {
  const routes = router.stack.filter((l) => l.route).map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, stack: l.route.stack.map((s) => s.handle) }));
  const gate = async (method, path, t) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    assert.ok(route, `${method} ${path}`);
    for (const mw of route.stack.slice(2, -1)) {
      const res = fakeRes(); let passed = false;
      await mw({ tenant: t, method, headers: {}, body: {}, get: () => undefined, originalUrl: path }, res, () => { passed = true; });
      if (!passed) return res.code;
    }
    return 200;
  };
  for (const [method, path, want] of [
    ['POST', '/players/:id/wallet/topup', { OWNER: 200, GAMING_ATTENDANT: 200, CASHIER: 403 }],
    ['POST', '/players/:id/wallet/adjust', { OWNER: 200, MANAGER: 200, GAMING_ATTENDANT: 403 }],
    ['POST', '/players/:id/passes', { OWNER: 200, GAMING_ATTENDANT: 200, CASHIER: 403 }],
    ['POST', '/passes/:id/cancel', { OWNER: 200, GAMING_ATTENDANT: 403 }],
    ['GET', '/wallet/liability', { OWNER: 200, ACCOUNTANT: 200, GAMING_ATTENDANT: 403 }]
  ]) for (const [role, code] of Object.entries(want)) assert.equal(await gate(method, path, L.tenantFor(role)), code, `${role} ${method} ${path}`);
  assert.equal(await gate('POST', '/players/:id/wallet/topup', L.tenantFor('OWNER', { planFeatures: { gaming_wallet: false } })), 402);
  assert.equal(await gate('GET', '/players', L.tenantFor('OWNER', { planFeatures: { gaming_wallet: false } })), 200, 'players and the board work without the wallet');
  // starting a session against a pack needs the plan feature too
  const res = fakeRes();
  await (await import('../src/controllers/gamingSessions.controller.js')).default.start({ tenant: L.tenantFor('OWNER', { planFeatures: { gaming_wallet: false } }), auth: { userId }, body: { mode: 'PACK', station_id: 1 }, params: {} }, res, () => {});
  assert.equal(res.code, 402);
  // the controller path for a top-up
  const r = await L.call(walletApi.topup, { params: { id: asha }, body: { amount: 100, method: 'CASH', request_id: 'abc-123-xyz-000001' } });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  const rep = await L.call(walletApi.topup, { params: { id: asha }, body: { amount: 100, method: 'CASH', request_id: 'abc-123-xyz-000001' } });
  assert.equal(rep.code, 200);
});
