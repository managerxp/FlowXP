/*
 * Demo hotel: "Sea Pearl Resort", Port Blair, Andaman and Nicobar Islands (so it bills CGST + UTGST), with a restaurant and 40 days of real trading.
 *
 *   npm run seed:hotel        (re-running replaces the demo hotel)
 *
 * 24 rooms in four types, a room-only and a with-breakfast rate plan, peak-season rates, a restaurant menu, and banquet halls with weddings and conferences. The days are not typed in: they are run through the
 * hotel module itself, day by day (bookings made ahead, guests checked in and out, charges posted, night audit closed), so the reports are the real thing. It ends
 * today with guests in the hotel, bookings arriving over the next weeks, and a few rooms waiting to be cleaned.
 *
 * Sign in: hotel@flowxp.test / demo1234   (staff: hotel-manager@, hotel-frontdesk@, hotel-housekeeping@ and hotel-auditor@, same password)
 */
import './no-production.js'; // loads .env, and stops here in production
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import { createInvoiceInTransaction } from '../src/modules/billing.js';
import { addDaysISO, businessToday } from '../src/utils/dates.js';
import { getProperty } from '../src/modules/hotel/common.js';
import * as setup from '../src/modules/hotel/setup.js';
import * as stay from '../src/modules/hotel/stay.js';
import * as folio from '../src/modules/hotel/folio.js';
import * as hk from '../src/modules/hotel/housekeeping.js';
import { freeRooms } from '../src/modules/hotel/availability.js';
import { runNightAudit } from '../src/modules/hotel/nightAudit.js';
import * as bq from '../src/modules/hotel/banquet.js';
import * as hr from '../src/modules/hotel/staff.js';
import { postInvoiceToRoom, roomGuestCustomer } from '../src/modules/hotel/roomCharge.js';

const DAYS_BACK = 40;
const AHEAD = 45;
const PASSWORD = 'demo1234';
const mulberry32 = (seed) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry32(20261011);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const weighted = (entries) => { const total = entries.reduce((s, [, w]) => s + w, 0); let r = rand() * total; for (const [v, w] of entries) { r -= w; if (r <= 0) return v; } return entries[entries.length - 1][0]; };
const rupees = (n) => Math.round(n * 100);

const ROOM_TYPES = [
  // name, code, rack rate, extra adult, base adults, max adults, max children, count, first room number, floor, plan rate with breakfast, peak rate
  ['Standard AC', 'STD', 3200, 700, 2, 3, 1, 8, 101, '1', 3800, 4200],
  ['Deluxe', 'DLX', 4800, 900, 2, 3, 2, 8, 201, '2', 5500, 6200],
  ['Sea View', 'SVW', 7000, 1200, 2, 3, 2, 6, 301, '3', 7800, 9000],
  ['Suite', 'STE', 11000, 1800, 2, 4, 2, 2, 401, '4', 12000, 14000]
];
const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ananya', 'Diya', 'Ishita', 'Rohan', 'Kavya', 'Arjun', 'Meera', 'Sanjay', 'Priya', 'Rahul', 'Neha', 'Vikram', 'Pooja', 'Karthik', 'Divya', 'Suresh', 'Lakshmi', 'Imran', 'Farah', 'Joseph', 'Mary', 'Tarun', 'Sneha', 'Gaurav', 'Nisha', 'Manoj', 'Rekha'];
const LAST = ['Sharma', 'Iyer', 'Nair', 'Reddy', 'Menon', 'Patel', 'Gupta', 'Das', 'Bose', 'Singh', 'Kumar', 'Rao', 'Pillai', 'Joshi', 'Khan', 'Thomas', 'Mukherjee', 'Banerjee', 'Chatterjee', 'Naidu'];
const FOREIGN = [['Emma Wilson', 'British'], ['Lukas Meyer', 'German'], ['Sofia Rossi', 'Italian'], ['Daniel Brown', 'Australian'], ['Hana Sato', 'Japanese'], ['Olivia Martin', 'French']];
const SOURCES = [['PHONE', 18], ['TRAVEL_AGENT', 22], ['MAKEMYTRIP', 16], ['BOOKING_COM', 14], ['WALK_IN', 10], ['WEBSITE', 9], ['CORPORATE', 5], ['EMAIL', 6]];
const EXTRAS = [['LAUNDRY', 'Laundry', 150, 18], ['FNB', 'Room service: breakfast', 450, 5], ['FNB', 'Room service: dinner', 900, 5], ['FNB', 'Minibar', 320, 18], ['TRANSPORT', 'Airport pickup', 900, 5], ['TRANSPORT', 'Scooter rental', 700, 18], ['SPA', 'Spa massage', 1800, 18], ['MISC', 'Extra bed', 800, 18], ['TRANSPORT', 'Ferry to Havelock (per guest)', 1400, 5]];
const DISHES = [
  ['Fresh Lime Soda', 'Drinks', 90], ['Tender Coconut', 'Drinks', 80], ['Masala Chai', 'Drinks', 60], ['Filter Coffee', 'Drinks', 70], ['Fresh Fruit Juice', 'Drinks', 140], ['Beer (bottle)', 'Drinks', 260],
  ['Veg Fried Rice', 'Mains', 240], ['Paneer Butter Masala', 'Mains', 320], ['Dal Tadka', 'Mains', 210], ['Chicken Biryani', 'Mains', 340], ['Butter Naan', 'Breads', 60], ['Tandoori Roti', 'Breads', 40],
  ['Grilled Fish (Surmai)', 'Seafood', 520], ['Prawn Curry', 'Seafood', 580], ['Crab Masala', 'Seafood', 720], ['Lobster Thermidor', 'Seafood', 1450], ['Fish Thali', 'Seafood', 420], ['Calamari Rings', 'Starters', 380],
  ['Veg Spring Rolls', 'Starters', 220], ['Chicken Tikka', 'Starters', 340], ['Tomato Soup', 'Soups', 140], ['Gulab Jamun', 'Desserts', 120], ['Coconut Pudding', 'Desserts', 150], ['Masala Omelette', 'Breakfast', 130], ['Poori Bhaji', 'Breakfast', 150]
];

const HALLS = [['Coral Ballroom', 300, 450, 90000, ['Stage', 'Air conditioning', 'Projector', 'Bridal room']], ['Sea Lawn', 250, 400, 60000, ['Open air', 'Sunset view', 'Stage']], ['Lagoon Conference Room', 40, 0, 15000, ['Projector', 'Video conferencing', 'Wi-Fi']]];
const PACKAGES = [['Classic Veg', 'VEG', 950, 50, 'Welcome drink, two starters, three mains, dal, rice, breads, two desserts'], ['Royal Non-veg', 'NON_VEG', 1450, 50, 'Welcome drink, three starters, fish and chicken mains, biryani, breads, desserts'], ['Island Seafood Feast', 'MIXED', 1950, 40, 'Prawn and calamari starters, grilled fish, crab masala, veg mains, desserts'], ['Conference Lunch', 'VEG', 650, 10, 'Tea and snacks, buffet lunch, evening tea']];
const EVENTS = [['WEDDING', 'wedding', 'Reception'], ['WEDDING', 'wedding', 'Sangeet'], ['ENGAGEMENT', 'engagement', 'Engagement lunch'], ['BIRTHDAY', 'birthday party', 'Birthday dinner'], ['CORPORATE', 'company conference', 'Conference'], ['PARTY', 'anniversary dinner', 'Anniversary dinner']];

// name, department, designation, pay type, salary, weekly off (0 = Sunday), usual shift
const STAFF = [
  ['Suman Das', 'Front office', 'Front office manager', 'MONTHLY', 32000, 1, 'Morning'], ['Anita Roy', 'Front office', 'Receptionist', 'MONTHLY', 18000, 2, 'Morning'], ['Pradeep Nath', 'Front office', 'Receptionist', 'MONTHLY', 18000, 3, 'Evening'], ['Thomas George', 'Front office', 'Night auditor', 'MONTHLY', 22000, 4, 'Night'],
  ['Lakshmi Pillai', 'Housekeeping', 'Housekeeping supervisor', 'MONTHLY', 24000, 0, 'Morning'], ['Mary Joseph', 'Housekeeping', 'Housekeeper', 'MONTHLY', 14000, 1, 'Morning'], ['Rekha Kumari', 'Housekeeping', 'Housekeeper', 'MONTHLY', 14000, 2, 'Morning'], ['Selvi Murugan', 'Housekeeping', 'Housekeeper', 'MONTHLY', 14000, 3, 'Morning'], ['Bina Das', 'Housekeeping', 'Housekeeper', 'MONTHLY', 14000, 4, 'Evening'], ['Ravi Tirkey', 'Housekeeping', 'Laundry attendant', 'DAILY', 550, 5, 'Morning'],
  ['Deepa Nair', 'Management', 'General manager', 'MONTHLY', 65000, 0, 'Morning'], ['Joseph Francis', 'Accounts', 'Accountant', 'MONTHLY', 28000, 0, 'Morning'],
  ['Arjun Menon', 'Food and beverage', 'Restaurant manager', 'MONTHLY', 30000, 1, 'Evening'], ['Salim Khan', 'Food and beverage', 'Waiter', 'MONTHLY', 15000, 2, 'Evening'], ['Vijay Anand', 'Food and beverage', 'Waiter', 'MONTHLY', 15000, 3, 'Morning'], ['Kumar Raja', 'Food and beverage', 'Bartender', 'MONTHLY', 18000, 4, 'Evening'],
  ['Chef Ramesh Babu', 'Kitchen', 'Head chef', 'MONTHLY', 45000, 0, 'Morning'], ['Mohan Lal', 'Kitchen', 'Cook', 'MONTHLY', 22000, 1, 'Morning'], ['Biju Thomas', 'Kitchen', 'Cook', 'MONTHLY', 22000, 2, 'Evening'], ['Anil Mondal', 'Kitchen', 'Kitchen helper', 'DAILY', 600, 3, 'Morning'],
  ['Ganesh Iyer', 'Banquet', 'Banquet manager', 'MONTHLY', 35000, 1, 'Evening'], ['Yusuf Ali', 'Maintenance', 'Electrician', 'MONTHLY', 20000, 2, 'Morning'], ['Paul Xaxa', 'Security', 'Security guard', 'DAILY', 600, 3, 'Night'], ['Hari Singh', 'Security', 'Security guard', 'DAILY', 600, 4, 'Morning']
];

const tx = async (fn) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const out = await fn(client); await client.query('COMMIT'); return out; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
};

const main = async () => {
  await initializeDatabase();
  for (const { business_id } of (await pool.query(`SELECT business_id FROM businesses WHERE name = 'Sea Pearl Resort'`)).rows) await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]);
  await pool.query(`DELETE FROM users WHERE email LIKE 'hotel%@flowxp.test'`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = {};
  for (const [key, email, name, role] of [['owner', 'hotel@flowxp.test', 'Capt. Ravi Menon', 'OWNER'], ['manager', 'hotel-manager@flowxp.test', 'Deepa Nair', 'MANAGER'], ['desk', 'hotel-frontdesk@flowxp.test', 'Suman Das', 'FRONT_DESK'], ['hk', 'hotel-housekeeping@flowxp.test', 'Lakshmi Pillai', 'HOUSEKEEPER'], ['audit', 'hotel-auditor@flowxp.test', 'Thomas George', 'NIGHT_AUDITOR']]) {
    staff[key] = { userId: (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1,$2,$3,TRUE) RETURNING user_id`, [name, email, hash])).rows[0].user_id, role };
  }
  const businessId = (await pool.query(
    `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, address, city, state, gstin, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step, upi_vpa, round_off_enabled)
     VALUES ('Sea Pearl Resort','HOTEL',$1,'hotel@flowxp.test','9531011111','Marine Drive, Aberdeen Bazaar','Port Blair','Andaman and Nicobar Islands','35AABCS5432G1Z8',TRUE,'ACTIVE','ENTERPRISE','MONTHLY',10,'seapearl@okicici',TRUE) RETURNING business_id`,
    [staff.owner.userId])).rows[0].business_id;
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, code, city, state, is_primary) VALUES ($1,'Port Blair','PBL','Port Blair','Andaman and Nicobar Islands',TRUE) RETURNING branch_id`, [businessId])).rows[0].branch_id;
  for (const s of Object.values(staff)) await pool.query(`INSERT INTO business_users (business_id, user_id, role, branch_id) VALUES ($1,$2,$3,$4)`, [businessId, s.userId, s.role, s.role === 'OWNER' ? null : branchId]);
  const tenant = { businessId, branchId };
  const desk = staff.desk.userId; const audit = staff.audit.userId; const owner = staff.owner.userId;

  // the property, its rooms and rates
  const today = await businessToday(businessId, pool);
  const start = addDaysISO(today, -DAYS_BACK);
  await getProperty(pool, tenant);
  await pool.query(`UPDATE hotel_properties SET business_date = $2, res_prefix = 'SPR' WHERE branch_id = $1`, [branchId, start]);
  const typeIds = {};
  for (const [name, code, rate, extraAdult, baseAdults, maxAdults, maxChildren, count, firstNo, floor] of ROOM_TYPES) {
    const t = await setup.createRoomType(pool, tenant, { name, code, description: null, base_rate_paise: rupees(rate), extra_adult_paise: rupees(extraAdult), extra_child_paise: 0, base_adults: baseAdults, max_adults: maxAdults, max_children: maxChildren, amenities: ['Air conditioning', 'TV', 'Wi-Fi', ...(code === 'SVW' || code === 'STE' ? ['Sea view'] : [])], sort_order: ROOM_TYPES.findIndex((x) => x[1] === code) });
    typeIds[code] = t.room_type_id;
    await setup.createRooms(pool, tenant, { room_type_id: t.room_type_id, from: firstNo, to: firstNo + count - 1, floor, prefix: '' });
  }
  const plans = await setup.listRatePlans(pool, tenant);
  const ep = plans.find((p) => p.code === 'EP');
  const cp = await setup.saveRatePlan(pool, tenant, null, { name: 'With breakfast', code: 'CP', meal_plan: 'CP', is_default: false, rates: Object.fromEntries(ROOM_TYPES.map((t) => [typeIds[t[1]], rupees(t[10])])) });
  for (const t of ROOM_TYPES) {
    // peak season (1 November to 31 March), and weekends a little higher the rest of the year
    const year = Number(today.slice(0, 4));
    for (const [from, to] of [[`${year - 1}-11-01`, `${year}-03-31`], [`${year}-11-01`, `${year + 1}-03-31`]]) await setup.createOverride(pool, tenant, { room_type_id: typeIds[t[1]], rate_plan_id: ep.rate_plan_id, name: 'Peak season', from_date: from, to_date: to, days_of_week: null, rate_paise: rupees(t[11]) });
  }
  const ratePlanIds = [ep.rate_plan_id, cp.rate_plan_id];

  // the restaurant
  const catIds = {};
  for (const c of new Set(DISHES.map((d) => d[1]))) catIds[c] = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id`, [businessId, c])).rows[0].category_id;
  const dishIds = [];
  for (const [name, category, price] of DISHES) dishIds.push({ id: (await pool.query(`INSERT INTO products (business_id, category_id, name, kind, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory) VALUES ($1,$2,$3,'DISH','pc',$4,$5,5,FALSE) RETURNING product_id`, [businessId, catIds[category], name, rupees(price), rupees(price * 0.38)])).rows[0].product_id, price });

  const hallIds = [];
  for (const [name, seated, floating, rent, amenities] of HALLS) hallIds.push((await bq.saveHall(pool, tenant, null, { name, capacity_seated: seated, capacity_floating: floating, rent_paise: rupees(rent), amenities, sort_order: hallIds.length, is_active: true })).hall_id);
  const pkgIds = [];
  for (const [name, diet, price, min, menu] of PACKAGES) pkgIds.push((await bq.savePackage(pool, tenant, null, { name, diet, per_plate_paise: rupees(price), min_guests: min, tax_rate: 18, menu, sort_order: pkgIds.length, is_active: true })).package_id);

  const guestPool = [];
  for (let i = 0; i < 70; i++) {
    const foreign = i % 9 === 0 ? FOREIGN[i % FOREIGN.length] : null;
    guestPool.push(foreign ? { name: foreign[0], phone: `+44${int(7000000000, 7999999999)}`, nationality: foreign[1], id_type: 'Passport', id_number: `P${int(1000000, 9999999)}` }
      : { name: `${pick(FIRST)} ${pick(LAST)}`, phone: `9${int(600000000, 999999999)}`, nationality: 'Indian', id_type: pick(['Aadhaar', 'Aadhaar', 'Driving licence', 'Voter ID']), id_number: String(int(100000000000, 999999999999)) });
  }

  let bookings = 0; let stays = 0; let bills = 0;
  const book = async (date, leadMax) => {
    const demand = date >= `${today.slice(0, 4)}-11-01` ? 1.35 : 0.9;   // the peak season starts on 1 November
    const lead = leadMax === 0 ? 0 : weighted([[int(0, 3), 4], [int(4, 14), 5], [int(15, leadMax), 3]]);
    const arrival = addDaysISO(date, lead);
    const nights = weighted([[1, 2], [2, 5], [3, 6], [4, 4], [5, 3], [7, 2]]);
    const g = pick(guestPool);
    const lines = weighted([[1, 7], [2, 3], [3, 1]]);
    const rooms = [];
    for (let i = 0; i < lines; i++) {
      const code = weighted([['STD', 30], ['DLX', 34], ['SVW', 24], ['STE', 5]]);
      rooms.push({ room_type_id: typeIds[code], adults: weighted([[1, 2], [2, 7], [3, 2]]), children: weighted([[0, 7], [1, 2]]) });
    }
    if (rand() > demand * 0.8 && lead > 0) return;
    const source = leadMax === 0 ? 'WALK_IN' : weighted(SOURCES);
    const advance = rand() < 0.42 && source !== 'WALK_IN' ? { amount_paise: rupees(pick([1000, 1500, 2000, 3000, 5000])), method: pick(['UPI', 'UPI', 'BANK_TRANSFER', 'CARD']), reference: `ADV${int(10000, 99999)}` } : undefined;
    try {
      await tx((c) => stay.createBooking(c, tenant, desk, {
        guest: g, arrival, departure: addDaysISO(arrival, nights), rooms, rate_plan_id: pick(ratePlanIds), source, source_ref: ['MAKEMYTRIP', 'BOOKING_COM'].includes(source) ? `${source === 'BOOKING_COM' ? 'BK' : 'MMT'}${int(100000000, 999999999)}` : undefined, advance
      }));
      bookings++;
    } catch (error) { if (error.name !== 'HotelError') throw error; }   // no room of that type on those nights: the guest goes elsewhere
  };

  const makeEvent = async (date, { status = 'CONFIRMED', leadMin = 3, leadMax = 24 } = {}) => {
    const [type, label, fname] = pick(EVENTS);
    const g = pick(guestPool);
    const hallIdx = type === 'CORPORATE' ? 2 : weighted([[0, 6], [1, 5]]);
    const day = addDaysISO(date, int(leadMin, leadMax));
    const pkgId = type === 'CORPORATE' ? pkgIds[3] : pick(pkgIds.slice(0, 3));
    const pax = type === 'CORPORATE' ? int(15, 35) : int(60, 240);
    const evening = type !== 'CORPORATE' && fname !== 'Engagement lunch';
    const functions = [{ hall_id: hallIds[hallIdx], name: fname, event_date: day, start_time: evening ? '19:00' : '11:30', end_time: evening ? '23:30' : '16:00', expected_guests: pax, guaranteed_guests: status === 'CONFIRMED' ? pax - int(0, 10) : null, package_id: pkgId }];
    if (type === 'WEDDING' && rand() < 0.5) functions.unshift({ hall_id: hallIds[1], name: 'Mehendi', event_date: addDaysISO(day, -1), start_time: '16:00', end_time: '20:00', expected_guests: Math.round(pax * 0.6), guaranteed_guests: null, package_id: pkgIds[0] });
    const title = `${g.name.split(' ')[1] || g.name} ${label}`;
    try {
      const id = await tx((c) => bq.createEvent(c, tenant, desk, { guest: g, title, event_type: type, status, hold_until: status === 'TENTATIVE' ? addDaysISO(date, int(3, 10)) : undefined, source: pick(['PHONE', 'PHONE', 'WEBSITE', 'CORPORATE', 'TRAVEL_AGENT']), functions: functions.map((f) => ({ ...f, name: f.name })), instructions: type === 'WEDDING' ? 'Bridal party arrives 2 hours early. Keep a separate jain counter. Live music from 8 pm.' : undefined }));
      if (status === 'CONFIRMED' && rand() < 0.7) await tx((c) => bq.postCharge(c, tenant, desk, id, { category: pick(['DECOR', 'AV']), description: pick(['Stage and floral decor', 'Sound, lights and DJ', 'Welcome gate and entrance decor']), quantity: 1, unit_price_paise: rupees(pick([25000, 40000, 60000])), tax_rate: 18 }));
      if (status === 'CONFIRMED' && rand() < 0.8) await tx((c) => bq.addPayment(c, tenant, desk, id, { kind: 'ADVANCE', method: pick(['BANK_TRANSFER', 'UPI', 'CHEQUE']), amount_paise: rupees(pick([50000, 100000, 150000, 200000])), reference: `ADV${int(10000, 99999)}` }));
    } catch (error) { if (error.name !== 'HotelError') throw error; }   // the hall is held at that time: the organiser picks another day
  };

  const runDay = async (date, { closing = true } = {}) => {
    // events that have taken place are completed into their invoices
    for (const e of (await pool.query(`SELECT e.event_id FROM banquet_events e WHERE e.branch_id = $1 AND e.status = 'CONFIRMED' AND (SELECT MAX(event_date) FROM banquet_functions f WHERE f.event_id = e.event_id) <= $2 ORDER BY e.event_id`, [branchId, date])).rows) {
      await tx(async (c) => {
        const tn = await bq.totalsOf(c, e.event_id);
        if (tn.paid_paise > tn.charges_paise) return bq.complete(c, tenant, desk, e.event_id, { refundMethod: 'BANK_TRANSFER' });
        return bq.complete(c, tenant, desk, e.event_id, { settlement: { method: pick(['BANK_TRANSFER', 'UPI', 'CARD', 'CHEQUE']), reference: `FIN${int(10000, 99999)}` } });
      }).catch((er) => { if (er.name !== 'HotelError') throw er; });
    }
    if (rand() < 0.4) await makeEvent(date);
    // new bookings come in all day, most of them for later
    for (let i = 0, n = int(4, 9); i < n; i++) await book(date, 40);
    // a few cancellations of bookings that have not arrived
    const pending = (await pool.query(`SELECT booking_id FROM hotel_bookings WHERE branch_id = $1 AND status = 'CONFIRMED' AND arrival > $2 ORDER BY random() LIMIT 2`, [branchId, date])).rows;
    for (const b of pending) if (rand() < 0.22) await tx((c) => stay.cancelBooking(c, tenant, desk, b.booking_id, pick(['Change of plans', 'Flight cancelled', 'Found another hotel', 'Illness in the family']))).catch(() => {});

    // guests leaving today
    for (const b of (await pool.query(`SELECT booking_id FROM hotel_bookings WHERE branch_id = $1 AND status = 'CHECKED_IN' AND departure <= $2 ORDER BY booking_id`, [branchId, date])).rows) {
      await tx(async (c) => {
        const tn = await folio.totalsOf(c, b.booking_id);
        if (tn.paid_paise > tn.charges_paise) return stay.checkOut(c, tenant, desk, b.booking_id, { refundMethod: 'CASH' });
        return stay.checkOut(c, tenant, desk, b.booking_id, { settlement: { method: weighted([['UPI', 42], ['CARD', 26], ['CASH', 24], ['BANK_TRANSFER', 4], ['CREDIT', 4]]), reference: `T${int(10000, 99999)}` } });
      }).catch((e) => { if (e.name !== 'HotelError') throw e; });
    }
    // the housekeeping round: the rooms left dirty are cleaned
    for (const r of (await pool.query(`SELECT room_id FROM rooms WHERE branch_id = $1 AND hk_status = 'DIRTY' ORDER BY room_id`, [branchId])).rows) await tx((c) => hk.setRoomStatus(c, tenant, staff.hk.userId, r.room_id, rand() < 0.4 ? 'INSPECTED' : 'CLEAN'));

    // guests arriving today
    for (const b of (await pool.query(`SELECT booking_id FROM hotel_bookings WHERE branch_id = $1 AND status = 'CONFIRMED' AND arrival <= $2 ORDER BY booking_id`, [branchId, date])).rows) {
      if (rand() < 0.04) { await tx((c) => stay.markNoShow(c, tenant, desk, b.booking_id)); continue; }
      await tx(async (c) => {
        const rooms = (await c.query(`SELECT rr_id, room_type_id, departure::text FROM hotel_booking_rooms WHERE booking_id = $1 AND status = 'RESERVED' ORDER BY rr_id`, [b.booking_id])).rows;
        const assignments = []; const used = new Set();
        for (const r of rooms) {
          const free = (await freeRooms(c, tenant, { roomTypeId: r.room_type_id, arrival: date, departure: r.departure })).filter((x) => !used.has(x.room_id) && x.hk_status !== 'DIRTY');
          const room = free[0] || (await freeRooms(c, tenant, { arrival: date, departure: r.departure })).find((x) => !used.has(x.room_id) && x.hk_status !== 'DIRTY');
          if (!room) throw Object.assign(new Error('no room'), { name: 'HotelError' });
          used.add(room.room_id); assignments.push({ rr_id: r.rr_id, room_id: room.room_id });
        }
        await stay.checkIn(c, tenant, desk, b.booking_id, { assignments });
        stays++;
      }).catch((e) => { if (e.name !== 'HotelError') throw e; });
    }
    // walk-ins
    for (let i = 0, n = rand() < 0.55 ? 1 : 0; i < n; i++) {
      const code = weighted([['STD', 45], ['DLX', 40], ['SVW', 15]]);
      const free = await freeRooms(pool, tenant, { roomTypeId: typeIds[code], arrival: date, departure: addDaysISO(date, 1) });
      const room = free.find((x) => x.hk_status !== 'DIRTY');
      if (!room) continue;
      const g = pick(guestPool);
      await tx((c) => stay.walkIn(c, tenant, desk, { guest: g, departure: addDaysISO(date, int(1, 3)), rooms: [{ room_type_id: typeIds[code], room_id: room.room_id, adults: int(1, 2) }], source: 'WALK_IN' })).then(() => { bookings++; stays++; }).catch((e) => { if (e.name !== 'HotelError') throw e; });
    }
    // charges to guests in the hotel
    for (const b of (await pool.query(`SELECT booking_id FROM hotel_bookings WHERE branch_id = $1 AND status = 'CHECKED_IN' ORDER BY booking_id`, [branchId])).rows) {
      if (rand() > 0.22) continue;
      const [department, description, price, tax] = pick(EXTRAS);
      await tx((c) => folio.postCharge(c, tenant, desk, b.booking_id, { department, description, quantity: int(1, 3), unit_price_paise: rupees(price), tax_rate: tax })).catch((e) => { if (e.name !== 'HotelError') throw e; });
    }
    // the restaurant's own sales that day
    const inHotel = (await pool.query(`SELECT COALESCE(SUM(adults), 0)::int AS n FROM hotel_booking_rooms WHERE branch_id = $1 AND status = 'IN_HOUSE'`, [branchId])).rows[0].n;
    for (let i = 0, n = Math.round(6 + inHotel * 0.8 + rand() * 6); i < n; i++) {
      const items = []; const used = new Set();
      for (let l = weighted([[1, 3], [2, 5], [3, 4], [4, 2]]); l > 0; l--) { const d = pick(dishIds); if (used.has(d.id)) continue; used.add(d.id); items.push({ product_id: d.id, quantity: weighted([[1, 7], [2, 3]]) }); }
      const method = weighted([['UPI', 45], ['CARD', 25], ['CASH', 30]]);
      // about one in five is charged to a guest's room and paid at check-out
      const guest = rand() < 0.2 ? (await pool.query(`SELECT booking_id FROM hotel_bookings WHERE branch_id = $1 AND status = 'CHECKED_IN' ORDER BY random() LIMIT 1`, [branchId])).rows[0] : null;
      const inv = await tx(async (c) => {
        const customerId = guest ? await roomGuestCustomer(c, tenant, guest.booking_id) : undefined;
        const made = await createInvoiceInTransaction(c, tenant, desk, { items, customerId, invoiceDate: date, allowNegativeStock: true, payment: guest ? undefined : { method, amount: 'FULL' } });
        if (guest) await postInvoiceToRoom(c, tenant, desk, { bookingId: guest.booking_id, invoiceId: made.invoice_id });
        return made;
      });
      const at = new Date(`${date}T${String(int(8, 22)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:00+05:30`);
      await pool.query(`UPDATE invoices SET created_at = $2 WHERE invoice_id = $1`, [inv.invoice_id, at]);
      bills++;
    }
    if (closing) await tx((c) => runNightAudit(c, tenant, audit, { noShowAll: true }));
  };

  for (let d = start; d < today; d = addDaysISO(d, 1)) await runDay(d);

  // the staff: records, a roster, attendance for every day so far, leave, and payroll for last month (final) and this month (draft)
  const depts = new Map((await hr.listDepartments(pool, tenant)).map((d) => [d.name, d.dept_id]));
  const shiftIds = new Map((await hr.listShifts(pool, tenant)).map((x) => [x.name, x.shift_id]));
  const people = [];
  for (const [name, dept, designation, payType, salary, off, shift] of STAFF) {
    const e = await hr.saveEmployee(pool, tenant, null, { name, phone: `9${int(600000000, 999999999)}`, dept_id: depts.get(dept), designation, joined_on: addDaysISO(start, -int(40, 600)), pay_type: payType, salary_paise: rupees(salary), weekly_off: off, default_shift_id: shiftIds.get(shift) });
    people.push({ ...e, shift });
  }
  await pool.query(`UPDATE hr_employees SET user_id = (SELECT user_id FROM users WHERE email = 'hotel-housekeeping@flowxp.test') WHERE employee_id = $1`, [people.find((p) => p.name === 'Lakshmi Pillai').employee_id]);
  for (const [who, from, days, kind] of [['Salim Khan', addDaysISO(today, -12), 2, 'SICK'], ['Mary Joseph', addDaysISO(today, -20), 3, 'CASUAL'], ['Anita Roy', addDaysISO(today, -5), 1, 'PAID'], ['Vijay Anand', addDaysISO(today, -30), 2, 'UNPAID']]) {
    const p = people.find((x) => x.name === who);
    const l = await hr.requestLeave(pool, tenant, owner, { employee_id: p.employee_id, from_date: from, to_date: addDaysISO(from, days - 1), kind, reason: kind === 'SICK' ? 'Fever' : 'Family function' });
    await tx((c) => hr.decideLeave(c, tenant, owner, l.leave_id, { approve: true }));
  }
  await hr.requestLeave(pool, tenant, owner, { employee_id: people.find((x) => x.name === 'Rekha Kumari').employee_id, from_date: addDaysISO(today, 6), to_date: addDaysISO(today, 8), kind: 'CASUAL', reason: 'Going home for a wedding' });
  for (let d = start; d < today; d = addDaysISO(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    const entries = [];
    for (const p of people) {
      if (p.weekly_off === dow) continue;
      const r = rand();
      const status = r < 0.03 ? 'ABSENT' : r < 0.05 ? 'HALF_DAY' : 'PRESENT';
      entries.push({ employee_id: p.employee_id, status, overtime_minutes: status === 'PRESENT' && rand() < 0.08 ? pick([60, 90, 120, 180]) : 0 });
    }
    // a person on approved leave keeps the mark the leave made
    const onLeave = new Set((await pool.query(`SELECT employee_id FROM hr_attendance WHERE branch_id = $1 AND work_date = $2 AND status IN ('LEAVE','UNPAID_LEAVE')`, [branchId, d])).rows.map((x) => x.employee_id));
    await tx((c) => hr.markAttendance(c, tenant, staff.desk.userId, d, entries.filter((e) => !onLeave.has(e.employee_id))));
  }
  // the roster for this week and next: everyone on their usual shift, off on their weekly off
  const ws = addDaysISO(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const rosterEntries = [];
  for (let i = 0; i < 14; i++) { const d = addDaysISO(ws, i); const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); for (const p of people) rosterEntries.push({ employee_id: p.employee_id, work_date: d, shift_id: p.weekly_off === dow ? null : shiftIds.get(p.shift) }); }
  await tx((c) => hr.setRoster(c, tenant, rosterEntries));
  // payroll: the month just finished is final (with a bonus and an advance), this month is a draft
  const thisMonth = today.slice(0, 7); const lastMonth = addDaysISO(`${thisMonth}-01`, -1).slice(0, 7);
  await tx((c) => hr.generatePayroll(c, tenant, owner, lastMonth, { overtimeFactor: 1.5 }));
  const lastRun = await hr.getRun(pool, tenant, lastMonth);
  await tx((c) => hr.adjustSlip(c, tenant, lastRun.slips.find((x) => x.name === 'Chef Ramesh Babu').payslip_id, { allowances_paise: rupees(3000), note: 'Festival bonus' }));
  await tx((c) => hr.adjustSlip(c, tenant, lastRun.slips.find((x) => x.name === 'Anil Mondal').payslip_id, { deductions_paise: rupees(2000), note: 'Salary advance' }));
  await tx((c) => hr.finalizeRun(c, tenant, owner, lastMonth, { force: true }));
  await tx((c) => hr.generatePayroll(c, tenant, owner, thisMonth, { overtimeFactor: 1.5 }));

  // today: the front desk is mid-shift. A few rooms are still waiting to be cleaned, one is out of order, and the future is booked.
  const dirty = (await pool.query(`SELECT room_id FROM rooms WHERE branch_id = $1 AND hk_status = 'CLEAN' AND NOT EXISTS (SELECT 1 FROM hotel_booking_rooms x WHERE x.room_id = rooms.room_id AND x.status = 'IN_HOUSE') ORDER BY random() LIMIT 3`, [branchId])).rows;
  for (const r of dirty) await tx((c) => hk.setRoomStatus(c, tenant, staff.hk.userId, r.room_id, 'DIRTY'));
  const oo = (await pool.query(`SELECT room_id FROM rooms WHERE branch_id = $1 AND hk_status <> 'DIRTY' AND NOT EXISTS (SELECT 1 FROM hotel_booking_rooms x WHERE x.room_id = rooms.room_id AND x.status IN ('IN_HOUSE','RESERVED')) ORDER BY room_no DESC LIMIT 1`, [branchId])).rows[0];
  if (oo) await tx((c) => hk.setRoomStatus(c, tenant, staff.hk.userId, oo.room_id, 'OUT_OF_ORDER', 'Air conditioner being repaired'));
  for (let i = 0; i < 24; i++) await book(today, AHEAD);
  for (const st of ['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'TENTATIVE', 'TENTATIVE', 'ENQUIRY', 'ENQUIRY']) await makeEvent(today, { status: st, leadMin: 3, leadMax: 60 });

  const crew = (await pool.query(`SELECT COUNT(*)::int AS n FROM hr_employees WHERE branch_id = $1`, [branchId])).rows[0].n;
  const left = (await pool.query(`SELECT COUNT(*)::int AS n FROM hotel_bookings WHERE branch_id = $1 AND status = 'CHECKED_IN'`, [branchId])).rows[0].n;
  const ahead = (await pool.query(`SELECT COUNT(*)::int AS n FROM hotel_bookings WHERE branch_id = $1 AND status = 'CONFIRMED'`, [branchId])).rows[0].n;
  const audited = (await pool.query(`SELECT COUNT(*)::int AS n FROM hotel_night_audits WHERE branch_id = $1`, [branchId])).rows[0].n;
  const events = (await pool.query(`SELECT status, COUNT(*)::int AS n FROM banquet_events WHERE branch_id = $1 GROUP BY status`, [branchId])).rows.map((r) => `${r.n} ${r.status.toLowerCase()}`).join(', ');
  console.log(`seeded Sea Pearl Resort (${crew} staff; banquet events: ${events}): ${bookings} bookings, ${stays} check-ins, ${bills} restaurant bills over ${audited} closed days; ${left} guests in the hotel, ${ahead} bookings ahead. Sign in: hotel@flowxp.test / ${PASSWORD}`);
  await pool.end();
};

main().catch((error) => { console.error(error); process.exit(1); });
