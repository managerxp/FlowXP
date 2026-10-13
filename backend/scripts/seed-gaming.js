/*
 * Demo lounge: "Pixel Lounge", Pune, one outlet: four PS5s, two private rooms, three pool tables and a snooker table, a small food and drink menu, and
 * three weeks of real sessions.
 *
 *   npm run seed:gaming        (re-running replaces the demo lounge)
 *
 * Nothing is typed into the tables: sessions are started, paused, moved and stopped through the same module the board uses (with the clock set to the
 * day they happened), food and drink are ordered onto the station's tab, and every tab is billed through the invoice engine, so the dashboard and the
 * reports are the real thing. A few sessions are left running, paused, or waiting to be paid, so the board has something on it.
 *
 * Sign in: gaming@flowxp.test / demo1234   (staff: gaming-manager@ and gaming-desk@ (attendant), same password)
 */
import './no-production.js'; // loads .env, and stops here in production
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import { createInvoiceInTransaction } from '../src/modules/billing.js';
import { inTx, getSettings } from '../src/modules/gaming/common.js';
import * as stations from '../src/modules/gaming/stations.js';
import * as rates from '../src/modules/gaming/rates.js';
import * as sessions from '../src/modules/gaming/sessions.js';
import * as players from '../src/modules/gaming/players.js';
import * as wallet from '../src/modules/gaming/wallet.js';
import * as passes from '../src/modules/gaming/passes.js';
import * as bookings from '../src/modules/gaming/bookings.js';
import * as tournaments from '../src/modules/gaming/tournaments.js';
import { insertOrderItems } from '../src/controllers/orders.controller.js';

const PASSWORD = 'demo1234';
const mulberry32 = (seed) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry32(20261013);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
const MIN = 60000;

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ananya', 'Rohan', 'Kavya', 'Arjun', 'Meera', 'Sanjay', 'Priya', 'Rahul', 'Neha', 'Vikram', 'Pooja', 'Karthik', 'Imran', 'Farah', 'Sameer', 'Tanvi', 'Yash', 'Omkar', 'Siddharth', 'Riya', 'Harsh'];
const LAST = ['Sharma', 'Kulkarni', 'Joshi', 'Patil', 'Deshmukh', 'Gupta', 'Shah', 'Khan', 'Iyer', 'Pawar', 'More', 'Jadhav', 'Singh', 'Kapoor'];
const GAMES = ['FIFA 26', 'Tekken 8', 'GTA V', 'Call of Duty', 'God of War', 'Mortal Kombat 1', 'Gran Turismo 7', 'UFC 5'];
const MENU = [['Cold coffee', 120, 5], ['Masala chai', 40, 5], ['Veg sandwich', 110, 5], ['Cheese nachos', 160, 5], ['French fries', 120, 5], ['Maggi', 80, 5], ['Soft drink', 50, 18], ['Brownie', 90, 5], ['Water bottle', 20, 18]];

const main = async () => {
  await initializeDatabase();
  for (const { business_id } of (await pool.query(`SELECT business_id FROM businesses WHERE name = 'Pixel Lounge'`)).rows) await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]);
  await pool.query(`DELETE FROM users WHERE email LIKE 'gaming%@flowxp.test'`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = {};
  for (const [key, email, name, role] of [['owner', 'gaming@flowxp.test', 'Aarav Kapoor', 'OWNER'], ['manager', 'gaming-manager@flowxp.test', 'Neha Joshi', 'MANAGER'], ['desk', 'gaming-desk@flowxp.test', 'Rohan Patil', 'GAMING_ATTENDANT']]) {
    staff[key] = { userId: (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1,$2,$3,TRUE) RETURNING user_id`, [name, email, hash])).rows[0].user_id, role };
  }
  const businessId = (await pool.query(
    `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, address, city, state, gstin, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step, upi_vpa, round_off_enabled)
     VALUES ('Pixel Lounge','GAMING_CAFE',$1,'gaming@flowxp.test','9822000000','Lane 5, Koregaon Park','Pune','Maharashtra','27AABCP1234F1Z5',TRUE,'ACTIVE','ENTERPRISE','MONTHLY',10,'pixellounge@okhdfcbank',FALSE) RETURNING business_id`,
    [staff.owner.userId])).rows[0].business_id;
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary, city, state) VALUES ($1,'Koregaon Park',TRUE,'Pune','Maharashtra') RETURNING branch_id`, [businessId])).rows[0].branch_id;
  for (const [key, { userId, role }] of Object.entries(staff)) {
    await pool.query(`INSERT INTO business_users (business_id, user_id, role, status, branch_id) VALUES ($1,$2,$3,'ACTIVE',$4)`, [businessId, userId, role, key === 'desk' ? branchId : null]);
  }
  await getSettings(pool, businessId);
  const tenant = { businessId, branchId, scopeBranchId: branchId, userId: staff.manager.userId, role: 'MANAGER', permissions: {}, businessType: 'GAMING_CAFE', planFeatures: {} };
  const uid = staff.desk.userId;

  // the menu
  const dishes = [];
  for (const [name, price, tax] of MENU) {
    dishes.push((await pool.query(`INSERT INTO products (business_id, name, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, kind) VALUES ($1,$2,'pc',$3,$4,$5,FALSE,'DISH') RETURNING product_id`, [businessId, name, price * 100, Math.round(price * 35), tax])).rows[0].product_id);
  }

  // stations, rates, offers, games
  const zone = {};
  for (const [i, name] of ['Console lounge', 'Private rooms', 'Pool and snooker'].entries()) zone[name] = (await inTx((db) => stations.createZone(db, tenant, { name, sort_order: i }))).zone_id;
  const made = [];
  const add = async (name, kind, z, label, max) => { const s = await inTx((db) => stations.createStation(db, tenant, { name, kind, zone_id: zone[z], label, max_players: max })); made.push(s); return s; };
  const ps5 = [];
  for (let i = 1; i <= 4; i += 1) ps5.push(await add(`PS5-${i}`, 'CONSOLE', 'Console lounge', 'PS5', 4));
  const rooms = [await add('Room A', 'CONSOLE', 'Private rooms', 'PS5 private room', 8), await add('Room B', 'CONSOLE', 'Private rooms', 'PS5 + big screen', 8)];
  const pools = [];
  for (let i = 1; i <= 3; i += 1) pools.push(await add(`Pool-${i}`, 'POOL', 'Pool and snooker', '8-ball', 4));
  const snooker = await add('Snooker-1', 'SNOOKER', 'Pool and snooker', 'Full size', 4);
  await inTx((db) => rates.createRate(db, businessId, {
    name: 'PS5 by the hour', kind: 'CONSOLE', tiers: [{ players: 1, hour: 100 }, { players: 2, hour: 150 }, { players: 4, hour: 200 }], extra_player_hour: 40, block_minutes: 15, grace_minutes: 3, min_minutes: 30,
    bands: [{ name: 'Weekend evening', days: [5, 6, 0], from: '18:00', to: '23:59', multiplier_pct: 120 }, { name: 'Happy hour', days: [1, 2, 3, 4], from: '12:00', to: '15:00', multiplier_pct: 80 }]
  }));
  await inTx((db) => rates.createRate(db, businessId, { name: 'Private room', zone_id: zone['Private rooms'], tiers: [{ players: 8, hour: 400 }], block_minutes: 30, min_minutes: 60 }));
  await inTx((db) => rates.createRate(db, businessId, { name: 'Pool by the frame', kind: 'POOL', bill_time: false, unit_label: 'frame', unit_price: 60 }));
  await inTx((db) => rates.createRate(db, businessId, { name: 'Snooker by the hour', kind: 'SNOOKER', tiers: [{ players: 1, hour: 180 }, { players: 4, hour: 240 }], block_minutes: 1, min_minutes: 30 }));
  const bundles = [];
  for (const b of [
    { name: '1 hour, 2 players', minutes: 60, price: 130, players: 2, kinds: ['CONSOLE'] },
    { name: '3 hours, 2 players', minutes: 180, price: 330, players: 2, kinds: ['CONSOLE'] },
    { name: '5 hours, 4 players', minutes: 300, price: 750, players: 4, kinds: ['CONSOLE'] }
  ]) bundles.push(await inTx((db) => rates.createBundle(db, businessId, b)));
  const gameIds = [];
  for (const name of GAMES) gameIds.push((await inTx((db) => stations.createGame(db, businessId, { name }))).game_id);

  // players: regulars with names and mobiles
  const crew = [];
  for (let i = 0; i < 24; i += 1) {
    crew.push(await inTx((db) => players.createPlayer(db, tenant, { name: `${FIRST[i % FIRST.length]} ${pick(LAST)}`, phone: `98220${String(10000 + i).slice(-5)}`, gamer_tag: chance(0.6) ? `${FIRST[i % FIRST.length]}${int(7, 99)}` : null })));
  }

  // the wallet: a top-up bonus, balances for the regulars, and an hour pack with some of it used
  await pool.query(`UPDATE gaming_settings SET topup_bonus = $2::jsonb WHERE business_id = $1`, [businessId, JSON.stringify([{ min: 500, bonus: 50 }, { min: 1000, bonus: 150 }, { min: 2000, bonus: 400 }])]);
  const settings = await getSettings(pool, businessId);
  for (const [i, c] of crew.slice(0, 10).entries()) {
    await inTx((db) => wallet.topUp(db, tenant, uid, c.customer_id, { amount: pick([500, 500, 1000, 1000, 2000]), method: i % 2 ? 'UPI' : 'CASH' }, { settings }));
  }
  const packs = [];
  for (const b of [{ name: '10 hours (consoles)', kind: 'PACK', minutes: 600, price: 800, kinds: ['CONSOLE'], valid_days: 90 }, { name: '5 hours (consoles)', kind: 'PACK', minutes: 300, price: 450, kinds: ['CONSOLE'], valid_days: 60 }]) {
    packs.push(await inTx((db) => rates.createBundle(db, businessId, b)));
  }
  const packSold = await inTx((db) => passes.sellPass(db, tenant, uid, crew[1].customer_id, { bundle_id: packs[0].bundle_id, payment: { method: 'UPI', amount: 'FULL' } }));
  for (let i = 0; i < 3; i += 1) {                                                // three evenings spent from the pack
    const t0 = new Date(Date.now() - (9 - i * 3) * 86400000 - 3 * 3600000);
    const s = await inTx((db) => sessions.startSession(db, tenant, uid, { station_id: ps5[i].station_id, players: 2, mode: 'PACK', pack_id: packSold.pass.pass_id, customer_id: crew[1].customer_id }, { now: t0 }));
    await inTx((db) => sessions.stopSession(db, tenant, uid, s.session_id, {}, { now: new Date(t0.getTime() + int(60, 120) * MIN) }));
  }

  const ymd = (ms) => new Date(ms + 330 * MIN).toISOString().slice(0, 10);          // a date in Kolkata
  const dayStart = (daysAgo) => { const d = new Date(); const kolkata = new Date(d.getTime() + 330 * MIN); const base = Date.UTC(kolkata.getUTCFullYear(), kolkata.getUTCMonth(), kolkata.getUTCDate()) - 330 * MIN; return base - daysAgo * 86400000; };

  // bill a station's tab the way the till does, on the day it happened
  const bill = async (orderId, when) => inTx(async (db) => {
    const order = (await db.query(`SELECT * FROM orders WHERE order_id = $1 FOR UPDATE`, [orderId])).rows[0];
    const items = (await db.query(`SELECT order_item_id, product_id, description, quantity, unit_price_paise, modifiers FROM order_items WHERE order_id = $1 AND status <> 'CANCELLED' AND invoice_id IS NULL ORDER BY order_item_id`, [orderId])).rows;
    if (!items.length) return null;
    const method = chance(0.5) ? 'UPI' : chance(0.75) ? 'CASH' : 'CARD';
    const total = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price_paise), 0);
    const useWallet = order.customer_id && (await wallet.balanceOf(db, businessId, order.customer_id)) >= total * 1.2 && chance(0.7);
    const invoice = await createInvoiceInTransaction(db, { ...tenant, branchId: order.branch_id }, uid, {
      customerId: order.customer_id, orderId, invoiceDate: ymd(when.getTime()),
      items: items.map((i) => ({ product_id: i.product_id, description: i.description, unit_price: Number(i.unit_price_paise) / 100, modifiers: i.modifiers || [], quantity: Number(i.quantity) })),
      payment: { method: useWallet ? 'WALLET' : method, amount: 'FULL' }
    });
    await db.query(`UPDATE order_items SET invoice_id = $1 WHERE order_item_id = ANY($2::int[])`, [invoice.invoice_id, items.map((i) => i.order_item_id)]);
    await db.query(`UPDATE orders SET status = 'BILLED', invoice_id = $1 WHERE order_id = $2`, [invoice.invoice_id, orderId]);
    await db.query(`UPDATE invoices SET created_at = $2 WHERE invoice_id = $1`, [invoice.invoice_id, when]);
    await db.query(`UPDATE payments SET created_at = $2, payment_date = $3 WHERE invoice_id = $1`, [invoice.invoice_id, when, ymd(when.getTime())]);
    await db.query(`UPDATE gaming_wallet_ledger SET created_at = $2 WHERE invoice_id = $1`, [invoice.invoice_id, when]);
    return invoice;
  });

  const orderFood = (orderId, when) => inTx(async (db) => {
    const picks = Array.from({ length: int(1, 3) }, () => ({ product_id: pick(dishes), quantity: int(1, 3) }));
    const rows = await insertOrderItems(db, businessId, orderId, picks);
    await db.query(`UPDATE order_items SET status = 'SERVED', sent_at = $2, served_at = $2 WHERE order_item_id = ANY($1::int[])`, [rows.map((r) => r.order_item_id), when]);
  });

  // three weeks of sessions, one day at a time
  const consoleSeats = [...ps5, ...rooms];
  let sessionsMade = 0;
  for (let daysAgo = 21; daysAgo >= 1; daysAgo -= 1) {
    const start = dayStart(daysAgo);
    const weekend = [5, 6, 0].includes(new Date(start + 330 * MIN).getUTCDay());
    const count = weekend ? int(16, 24) : int(8, 15);
    // each station can host one sitting at a time, so lay the day out station by station
    const busyUntil = new Map();
    for (let i = 0; i < count; i += 1) {
      const kindRoll = rand();
      const st = kindRoll < 0.6 ? pick(consoleSeats.filter((s) => !s.name.startsWith('Room') || chance(0.3))) : kindRoll < 0.9 ? pick(pools) : snooker;
      const earliest = Math.max(busyUntil.get(st.station_id) ?? 0, 11 * 60 + int(0, 600));
      const begin = Math.min(earliest, 22 * 60);
      const length = st.kind === 'POOL' ? int(30, 90) : st.kind === 'SNOOKER' ? int(40, 120) : pick([30, 45, 60, 60, 90, 120, 150, 180]);
      const t0 = new Date(start + begin * MIN);
      busyUntil.set(st.station_id, begin + length + int(5, 20));
      const isConsole = st.kind === 'CONSOLE';
      const fixed = isConsole && chance(0.2) && !st.name.startsWith('Room');
      const bundle = fixed ? pick(bundles.filter((b) => b.minutes >= 60)) : null;
      const who = chance(0.55) ? pick(crew) : null;
      const n = isConsole ? (fixed ? Math.min(bundle.players, int(1, 2)) : int(1, st.name.startsWith('Room') ? 6 : 4)) : int(1, 4);
      const s = await inTx((db) => sessions.startSession(db, tenant, uid, { station_id: st.station_id, players: n, mode: fixed ? 'FIXED' : 'OPEN', bundle_id: bundle?.bundle_id, customer_id: who?.customer_id, game_id: isConsole && chance(0.7) ? pick(gameIds) : undefined }, { now: t0 }));
      let gap = 0;
      if (length >= 60 && chance(0.2)) {                                            // a pause, say for food: the clock stops for a while
        const pausedAt = new Date(t0.getTime() + int(15, 40) * MIN);
        gap = int(5, 15);
        await inTx((db) => sessions.pauseSession(db, tenant, uid, s.session_id, { now: pausedAt }));
        await inTx((db) => sessions.resumeSession(db, tenant, uid, s.session_id, { now: new Date(pausedAt.getTime() + gap * MIN) }));
      }
      if (st.kind === 'POOL') {
        const frames = Math.max(1, Math.round(length / 22));
        for (let f = 0; f < frames; f += 1) await inTx((db) => sessions.setUnits(db, tenant, uid, s.session_id, { delta: 1 }, { now: new Date(t0.getTime() + (f + 1) * 20 * MIN) }));
      }
      const stopAt = new Date(t0.getTime() + (length + gap) * MIN);
      if (chance(0.7)) await orderFood(s.order_id, new Date(t0.getTime() + int(10, Math.max(11, length - 5)) * MIN));
      const done = await inTx((db) => sessions.stopSession(db, tenant, uid, s.session_id, {}, { now: stopAt }));
      if (!done.tab_closed) await bill(s.order_id, stopAt);
      sessionsMade += 1;
    }
  }

  const now = Date.now();
  // earlier today: a few finished, billed sittings, so today's figures are not empty (only those that ended well before the live ones began)
  const today0 = dayStart(0);
  for (const [st, from, mins, food] of [[ps5[0], 11 * 60, 90, true], [ps5[1], 12 * 60, 60, false], [pools[0], 12 * 60 + 30, 60, true], [rooms[0], 13 * 60, 120, true], [ps5[2], 14 * 60, 120, true], [ps5[3], 15 * 60, 60, false], [snooker, 16 * 60, 90, true], [pools[1], 17 * 60, 60, false]]) {
    const t0 = new Date(today0 + from * MIN); const end = new Date(t0.getTime() + mins * MIN);
    if (end.getTime() > now - 100 * MIN) continue;
    const s = await inTx((db) => sessions.startSession(db, tenant, uid, { station_id: st.station_id, players: st.kind === 'CONSOLE' ? int(1, 3) : 2, customer_id: chance(0.5) ? pick(crew).customer_id : undefined }, { now: t0 }));
    if (st.kind === 'POOL' || st.kind === 'SNOOKER') await inTx((db) => sessions.setUnits(db, tenant, uid, s.session_id, { delta: int(1, 3) }, { now: new Date(t0.getTime() + 20 * MIN) }));
    if (food) await orderFood(s.order_id, new Date(t0.getTime() + 20 * MIN));
    const done = await inTx((db) => sessions.stopSession(db, tenant, uid, s.session_id, {}, { now: end }));
    if (!done.tab_closed) await bill(s.order_id, end);
  }

  // today: what is on the board right now
  const startNow = (st, minutesAgo, body) => inTx((db) => sessions.startSession(db, tenant, uid, { station_id: st.station_id, ...body }, { now: new Date(now - minutesAgo * MIN) }));
  const r1 = await startNow(ps5[0], 38, { players: 2, planned_minutes: 60, customer_id: crew[0].customer_id, game_id: gameIds[0] });
  const r2 = await startNow(ps5[1], 75, { players: 1, mode: 'FIXED', bundle_id: bundles[0].bundle_id, game_id: gameIds[1] });   // an hour sold, 15 minutes over
  const r3 = await startNow(ps5[2], 20, { players: 4 });
  await inTx((db) => sessions.pauseSession(db, tenant, uid, r3.session_id, { now: new Date(now - 8 * MIN) }));
  const r4 = await startNow(pools[0], 55, { players: 2 });
  for (let f = 0; f < 2; f += 1) await inTx((db) => sessions.setUnits(db, tenant, uid, r4.session_id, { delta: 1 }, { now: new Date(now - (40 - f * 15) * MIN) }));
  const r5 = await startNow(rooms[0], 50, { players: 6, customer_id: crew[3].customer_id });
  await orderFood(r1.order_id, new Date(now - 20 * MIN));
  await orderFood(r5.order_id, new Date(now - 30 * MIN));
  const done = await startNow(pools[1], 80, { players: 2 });
  await inTx((db) => sessions.setUnits(db, tenant, uid, done.session_id, { delta: 3 }, { now: new Date(now - 10 * MIN) }));
  await orderFood(done.order_id, new Date(now - 50 * MIN));
  await inTx((db) => sessions.stopSession(db, tenant, uid, done.session_id, {}, { now: new Date(now - 6 * MIN) }));       // stopped, still to be paid
  await inTx((db) => stations.setStationStatus(db, tenant, pools[2].station_id, { out_of_service: true, note: 'Torn cloth, repair on Friday' }));

  // bookings: tomorrow's afternoon and evening (a lounge books ahead), and one for later today
  const tomorrow = dayStart(-1);
  const local = (base, hours) => new Date(base + hours * 3600000).toISOString();
  for (const [st, base, h, mins, name, n] of [
    [ps5[0], tomorrow, 12, 90, 'Tanvi', 2], [ps5[3], tomorrow, 15, 120, 'Rohit and friends', 4], [rooms[1], tomorrow, 17, 180, 'Birthday: Sana', 8], [pools[1], tomorrow, 18, 60, 'Imran', 2],
    [snooker, tomorrow, 19, 120, 'Corporate evening', 4], [ps5[1], tomorrow, 20, 60, 'Yash', 2], [rooms[0], tomorrow, 14, 120, 'Office team', 6], [pools[0], tomorrow, 16, 90, 'Harsh', 2]
  ]) {
    await inTx((db) => bookings.createBooking(db, tenant, uid, { station_id: st.station_id, starts_at: local(base, h), minutes: mins, guest_name: name, guest_phone: '9822099999', players: n }, { now: new Date(now) }));
  }
  await inTx((db) => bookings.createBooking(db, tenant, uid, { station_id: ps5[3].station_id, starts_at: new Date(now + 2 * 3600000).toISOString(), minutes: 120, guest_name: 'Later tonight', guest_phone: '9822099999', players: 3 }, { now: new Date(now) }));
  const cup = await inTx((db) => tournaments.createTournament(db, tenant, uid, { name: 'FIFA 26 Friday Cup', game_name: 'FIFA 26', starts_at: new Date(now + 3 * 86400000).toISOString(), entry_fee: 200, prize_pool: 1500, max_players: 16, notes: 'Knockout on the big screen in Room B' }));
  for (const [i, c] of crew.slice(0, 9).entries()) {
    await inTx((db) => tournaments.register(db, tenant, uid, cup.tournament_id, { customer_id: c.customer_id, ...(i < 7 ? { payment: { method: i % 2 ? 'UPI' : 'CASH', amount: 'FULL' } } : {}) }));
  }
  const past = await inTx((db) => tournaments.createTournament(db, tenant, uid, { name: 'Tekken 8 Night', game_name: 'Tekken 8', starts_at: new Date(now - 6 * 86400000).toISOString(), entry_fee: 150, prize_pool: 800, max_players: 8 }));
  const pastEntries = [];
  for (const c of crew.slice(10, 16)) pastEntries.push((await inTx((db) => tournaments.register(db, tenant, uid, past.tournament_id, { customer_id: c.customer_id, payment: { method: 'UPI', amount: 'FULL' } }))).entry);
  await inTx((db) => tournaments.recordResults(db, tenant, past.tournament_id, [{ entry_id: pastEntries[0].entry_id, placement: 1, prize: 500 }, { entry_id: pastEntries[1].entry_id, placement: 2, prize: 200 }, { entry_id: pastEntries[2].entry_id, placement: 3, prize: 100 }]));

  console.log(`
Pixel Lounge is ready: ${made.length} stations, ${sessionsMade} sessions over three weeks, and a live board.
  Sign in    gaming@flowxp.test / ${PASSWORD}   (staff: gaming-manager@ and gaming-desk@ (attendant), same password)
  Board      /app/gaming
`);
  await pool.end();
};

main().catch((error) => { console.error(error); process.exit(1); });
