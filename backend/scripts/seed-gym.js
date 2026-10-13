/*
 * Demo gym: "Iron Works Fitness", Bengaluru, two branches, about 60 members and a month of real visits.
 *
 *   npm run seed:gym        (re-running replaces the demo gym)
 *
 * Plans (monthly, quarterly, annual, student, an off-peak plan for the second branch, a family plan), members in every state (running, ending soon, ended, frozen, on hold,
 * part-paid, unpaid), printed cards for some and the rest with phone passes. Nothing is typed into the tables: members are registered, memberships sold and billed, and every visit
 * goes through the same access engine the front desk uses, one day at a time, so the dashboard and reports are the real thing.
 *
 * Sign in: gym@flowxp.test / demo1234   (staff: gym-manager@, gym-desk@ (front desk) and gym-trainer@, same password)
 * Member page: /gym/ironworks. Members sign in with a code sent to their phone; with no messaging provider set up locally, run
 *   node scripts/gym-dev-login.js ironworks 9845000001      to put a code in the database for that demo member (never works in production).
 */
import './no-production.js'; // loads .env, and stops here in production
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import { attempt } from '../src/modules/gym/access.js';
import { issueCard } from '../src/modules/gym/credentials.js';
import { getBranchSettings, getSettings, localParts, inTx } from '../src/modules/gym/common.js';
import { createPlan } from '../src/modules/gym/plans.js';
import { registerMember } from '../src/modules/gym/members.js';
import { freeze, sellMembership } from '../src/modules/gym/memberships.js';
import * as rewards from '../src/modules/gym/rewards.js';
import * as classes from '../src/modules/gym/classes.js';
import * as devices from '../src/modules/gym/devices.js';
import * as training from '../src/modules/gym/training.js';
import { saveAutomation } from '../src/modules/gym/automation.js';

const PASSWORD = 'demo1234';
const mulberry32 = (seed) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry32(20261012);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ananya', 'Diya', 'Ishita', 'Rohan', 'Kavya', 'Arjun', 'Meera', 'Sanjay', 'Priya', 'Rahul', 'Neha', 'Vikram', 'Pooja', 'Karthik', 'Divya', 'Suresh', 'Lakshmi', 'Imran', 'Farah', 'Joseph', 'Mary', 'Tarun', 'Sneha', 'Gaurav', 'Nisha', 'Manoj', 'Rekha', 'Harsha', 'Deepak', 'Swati', 'Ritu', 'Naveen', 'Anjali'];
const LAST = ['Sharma', 'Iyer', 'Nair', 'Reddy', 'Menon', 'Patel', 'Gupta', 'Das', 'Bose', 'Singh', 'Kumar', 'Rao', 'Pillai', 'Joshi', 'Khan', 'Thomas', 'Naidu', 'Hegde', 'Shetty', 'Gowda'];

const PLANS = [
  { name: 'Monthly', duration_days: 30, price: 1500, grace_days: 2, max_freeze_days: 10 },
  { name: 'Quarterly', duration_days: 90, price: 4000, grace_days: 3, max_freeze_days: 20 },
  { name: 'Annual', duration_days: 365, price: 12000, grace_days: 5, max_freeze_days: 30 },
  { name: 'Student monthly', duration_days: 30, price: 1000, audience: 'STUDENT', payment_policy: 'ANY_PAYMENT' },
  { name: 'Off-peak quarterly', duration_days: 90, price: 2800, time_window: { days: [1, 2, 3, 4, 5], from: '10:00', to: '16:00' }, branch: 1 },
  { name: 'Family monthly (up to 4)', duration_days: 30, price: 4200, audience: 'FAMILY', max_members: 4 },
  { name: 'Pay-later monthly', duration_days: 30, price: 1500, payment_policy: 'PAY_LATER', pay_later_days: 5 },
  { name: 'Personal training: 10 sessions', kind: 'PT_PACK', sessions: 10, duration_days: 120, price: 12000 },
  { name: 'Masterclass: 5 sessions', kind: 'CLASS_PACK', sessions: 5, duration_days: 60, price: 2500 }
];

const main = async () => {
  await initializeDatabase();
  for (const { business_id } of (await pool.query(`SELECT business_id FROM businesses WHERE name = 'Iron Works Fitness'`)).rows) await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]);
  await pool.query(`DELETE FROM users WHERE email LIKE 'gym%@flowxp.test'`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = {};
  for (const [key, email, name, role] of [['owner', 'gym@flowxp.test', 'Kiran Rao', 'OWNER'], ['manager', 'gym-manager@flowxp.test', 'Anita Shetty', 'MANAGER'], ['desk', 'gym-desk@flowxp.test', 'Rahul Naik', 'GYM_RECEPTIONIST'], ['trainer', 'gym-trainer@flowxp.test', 'Coach Dev', 'TRAINER']]) {
    staff[key] = { userId: (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1,$2,$3,TRUE) RETURNING user_id`, [name, email, hash])).rows[0].user_id, role };
  }
  const businessId = (await pool.query(
    `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, address, city, state, gstin, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step, upi_vpa, round_off_enabled)
     VALUES ('Iron Works Fitness','GYM',$1,'gym@flowxp.test','9845000000','12 Residency Road','Bengaluru','Karnataka','29AABCI1234F1Z5',TRUE,'ACTIVE','ENTERPRISE','MONTHLY',10,'ironworks@okhdfcbank',TRUE) RETURNING business_id`,
    [staff.owner.userId])).rows[0].business_id;
  const branchIds = [];
  for (const [name, primary, city] of [['Indiranagar', true, 'Bengaluru'], ['Koramangala', false, 'Bengaluru']]) {
    branchIds.push((await pool.query(`INSERT INTO branches (business_id, name, is_primary, city, state) VALUES ($1,$2,$3,$4,'Karnataka') RETURNING branch_id`, [businessId, name, primary, city])).rows[0].branch_id);
  }
  for (const [key, { userId, role }] of Object.entries(staff)) {
    await pool.query(`INSERT INTO business_users (business_id, user_id, role, status, branch_id) VALUES ($1,$2,$3,'ACTIVE',$4)`, [businessId, userId, role, ['owner', 'manager'].includes(key) ? null : branchIds[0]]);
  }

  await getSettings(pool, businessId);
  await pool.query(`UPDATE gym_settings SET public_slug = 'ironworks', member_prefix = 'IRON', self_checkin_enabled = TRUE, self_checkin_daily_code = TRUE, checkout_enabled = TRUE, grace_days = 2 WHERE business_id = $1`, [businessId]);
  for (const id of branchIds) await getBranchSettings(pool, businessId, id);
  const hours = Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [d, { open: '05:30', close: '22:30' }]).concat([[0, { open: '07:00', close: '20:00' }]]));
  await pool.query(`UPDATE gym_branch_settings SET hours = $2::jsonb WHERE business_id = $1`, [businessId, JSON.stringify(hours)]);

  const plans = {};
  for (const p of PLANS) {
    plans[p.name] = (await createPlan(pool, businessId, { tax_rate: 18, ...p, allowed_branch_ids: p.branch != null ? [branchIds[p.branch]] : undefined })).plan_id;
  }
  // rewards on from the start, so the month of visits below earns points as it happens
  await inTx((db) => rewards.saveRules(db, businessId, { is_enabled: true, visit_points: 10, renewal_points_per_100: 1, referral_points: 200, referee_points: 100, birthday_points: 100, milestones: [{ visits: 10, points: 100 }, { visits: 25, points: 300 }], expiry_days: 365, min_redeem_points: 100, point_value: 0.5 }));
  for (const r of [['Protein shake', 200, 'ITEM', 0], ['Gym towel', 350, 'ITEM', 0], ['Water bottle', 500, 'ITEM', 0], ['7 free days', 700, 'FREE_DAYS', 7], ['Rs 200 off the next bill', 300, 'DISCOUNT', 200]]) {
    await pool.query(`INSERT INTO gym_rewards (business_id, name, points_cost, kind, value) VALUES ($1,$2,$3,$4,$5)`, [businessId, ...r]);
  }
  await saveAutomation(pool, businessId, 'EXPIRY_REMINDER', { is_enabled: true, config: { days_before: 7 } });
  await saveAutomation(pool, businessId, 'PAYMENT_DUE', { is_enabled: true, config: {} });
  const tenant = (branchId = branchIds[0], role = 'MANAGER') => ({ businessId, branchId, scopeBranchId: branchId, userId: staff.manager.userId, role, permissions: {}, businessType: 'GYM' });
  const t = tenant();
  const { date: today } = await localParts(pool, businessId);

  // members: name, phone, plan, how many days ago the membership started, how it is paid, and what is special about them
  const made = [];
  const kinds = [
    ...Array.from({ length: 22 }, () => ({ plan: 'Monthly', back: int(0, 25), pay: 'FULL', kind: 'running' })),
    ...Array.from({ length: 8 }, () => ({ plan: 'Quarterly', back: int(5, 30), pay: 'FULL', kind: 'running' })),
    ...Array.from({ length: 6 }, () => ({ plan: 'Annual', back: int(10, 30), pay: 'FULL', kind: 'running' })),
    ...Array.from({ length: 5 }, () => ({ plan: 'Student monthly', back: int(2, 20), pay: 'PART', kind: 'student' })),
    ...Array.from({ length: 4 }, () => ({ plan: 'Off-peak quarterly', back: int(2, 25), pay: 'FULL', kind: 'offpeak' })),
    ...Array.from({ length: 4 }, () => ({ plan: 'Monthly', back: 27, pay: 'FULL', kind: 'ending' })),
    ...Array.from({ length: 5 }, () => ({ plan: 'Monthly', back: 31, pay: 'FULL', kind: 'ended' })),
    ...Array.from({ length: 2 }, () => ({ plan: 'Monthly', back: 6, pay: 'FULL', kind: 'frozen' })),
    ...Array.from({ length: 2 }, () => ({ plan: 'Monthly', back: 3, pay: 'NONE', kind: 'unpaid' })),
    ...Array.from({ length: 2 }, () => ({ plan: 'Pay-later monthly', back: 2, pay: 'NONE', kind: 'later' })),
    ...Array.from({ length: 2 }, () => ({ plan: 'Monthly', back: 10, pay: 'FULL', kind: 'hold' })),
    ...Array.from({ length: 3 }, () => ({ plan: null, back: 0, pay: 'NONE', kind: 'new' }))
  ];
  let n = 0;
  for (const k of kinds) {
    n += 1;
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const phone = `98450${String(n).padStart(5, '0')}`;
    const m = await inTx((db) => registerMember(db, t, staff.manager.userId, { name, phone, email: `${name.split(' ')[0].toLowerCase()}${n}@example.com`, gender: pick(['FEMALE', 'MALE']), consent_data: true, consent_marketing: rand() > 0.3, branch_id: k.kind === 'offpeak' ? branchIds[1] : branchIds[0], joined_on: addDays(today, -Math.max(k.back, 1)) }, { allowHealth: false }));
    const row = { ...k, ...m, name, phone };
    if (k.plan) {
      const payment = k.pay === 'FULL' ? { method: pick(['CASH', 'UPI', 'UPI', 'CARD']), amount: 'FULL' } : k.pay === 'PART' ? { method: 'CASH', amount: 400 } : undefined;
      const sold = await inTx((db) => sellMembership(db, t, staff.manager.userId, m.member_id, { plan_id: plans[k.plan], start_date: addDays(today, -k.back), payment }, { allowDiscount: true }));
      row.membership_id = sold.membership_id;
    }
    if (k.kind === 'frozen') await inTx((db) => freeze(db, t, staff.manager.userId, row.membership_id, { from: today, to: addDays(today, 6), reason: 'Travelling' }));
    if (k.kind === 'hold') await pool.query(`UPDATE gym_members SET status = 'SUSPENDED', status_reason = 'Fees under discussion' WHERE member_id = $1`, [m.member_id]);
    if (n % 3 === 0 && k.plan) await inTx((db) => issueCard(db, { businessId, memberId: m.member_id, userId: staff.desk.userId }));
    made.push(row);
  }

  // a family
  const head = await inTx((db) => registerMember(db, t, staff.manager.userId, { name: 'Suresh Hegde', phone: '9845099001', consent_data: true }, {}));
  const fam = [];
  for (const d of ['Lata Hegde', 'Arav Hegde']) fam.push(await inTx((db) => registerMember(db, t, staff.manager.userId, { name: d, head_member_id: head.member_id, consent_data: true }, {})));
  await inTx((db) => sellMembership(db, t, staff.manager.userId, head.member_id, { plan_id: plans['Family monthly (up to 4)'], start_date: addDays(today, -8), payment: { method: 'UPI', amount: 'FULL' } }, {}));
  made.push({ ...head, kind: 'running', back: 8, name: 'Suresh Hegde' }, ...fam.map((f, i) => ({ ...f, kind: 'running', back: 8, name: ['Lata Hegde', 'Arav Hegde'][i] })));

  // a month of visits, day by day, through the same engine as the front desk
  const hourPick = () => pick([6, 6, 7, 7, 8, 9, 10, 12, 13, 17, 18, 18, 19, 19, 20, 21]);
  const at = (date, hour, minute) => new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`);
  let visits = 0;
  for (let back = 30; back >= 0; back -= 1) {
    const date = addDays(today, -back);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const m of made) {
      if (!m.plan && m.kind !== 'running') continue;
      const starts = addDays(today, -m.back);
      if (date < starts || m.kind === 'hold' || m.kind === 'unpaid') continue;
      const keen = m.kind === 'ended' || m.kind === 'ending' ? 0.4 : 0.6;
      if (rand() > keen * (dow === 0 ? 0.5 : 1)) continue;
      let hour = hourPick();
      if (m.kind === 'offpeak') hour = int(10, 15);
      const now = at(date, hour, int(0, 59));
      if (now > new Date()) continue;
      const where = m.kind === 'offpeak' ? branchIds[1] : (rand() > 0.85 ? branchIds[1] : branchIds[0]);
      const r = await attempt({ businessId, branchId: where, source: pick(['RECEPTION', 'RECEPTION', 'SELF']), memberId: m.member_id, confirm: true, freshOtpAt: now, dailyCodeOk: true, now, actorUserId: staff.desk.userId });
      if (r.decision === 'APPROVED') {
        visits += 1;
        if (rand() > 0.3) await attempt({ businessId, branchId: where, source: 'RECEPTION', memberId: m.member_id, action: 'OUT', confirm: true, now: new Date(now.getTime() + int(35, 95) * 60000), actorUserId: staff.desk.userId });
      }
    }
  }

  // trainers, classes for the coming week with bookings, packs, a workout plan and a gate device
  const coach = await inTx((db) => classes.saveTrainer(db, businessId, null, { name: 'Coach Dev', specialties: 'Strength, mobility', user_id: staff.trainer.userId }));
  const anita = await inTx((db) => classes.saveTrainer(db, businessId, null, { name: 'Anita Shetty', specialties: 'Yoga, pilates' }));
  const rahul = await inTx((db) => classes.saveTrainer(db, businessId, null, { name: 'Rahul Naik', specialties: 'HIIT, spin' }));
  const types = {};
  for (const [name, mins, cap, pack] of [['Yoga', 60, 20, false], ['Spin', 45, 15, false], ['HIIT', 45, 18, false], ['Masterclass', 90, 12, true]]) types[name] = await inTx((db) => classes.saveClassType(db, businessId, null, { name, duration_min: mins, default_capacity: cap, requires_pack: pack }));
  const week = [];
  for (let d = 1; d <= 7; d += 1) {
    const date = addDays(today, d);
    const plan = [['Yoga', '07:00', anita], ['HIIT', '18:30', rahul], [d % 2 ? 'Spin' : 'Yoga', '19:30', d % 2 ? rahul : anita]];
    for (const [name, start, trainer] of plan) {
      week.push(...await inTx((db) => classes.createSessions(db, businessId, branchIds[0], { class_type_id: types[name].class_type_id, date, start, trainer_id: trainer.trainer_id })));
    }
  }
  const running = made.filter((m) => ['running', 'ending'].includes(m.kind) && m.membership_id);
  let seat = 0;
  for (const s of week) {
    for (let i = 0; i < int(2, 9); i += 1) {
      const m = running[(seat += 1) % running.length];
      try { await inTx((db) => classes.bookClass(db, { businessId, sessionId: s.session_id, memberId: m.member_id, source: 'STAFF', userId: staff.desk.userId })); } catch { /* a clash or a full class: skip */ }
    }
  }
  const packPlans = (await pool.query(`SELECT plan_id, kind FROM gym_plans WHERE business_id = $1 AND kind <> 'MEMBERSHIP'`, [businessId])).rows;
  for (const [i, m] of running.slice(0, 6).entries()) {
    const pp = packPlans[i % 2];
    await inTx((db) => classes.sellPack(db, t, staff.manager.userId, m.member_id, { plan_id: pp.plan_id, payment: { method: 'UPI', amount: 'FULL' } }, {}));
    await pool.query(`UPDATE gym_members SET assigned_trainer_id = $2 WHERE member_id = $1`, [m.member_id, [coach, anita, rahul][i % 3].trainer_id]);
  }
  const ex = await inTx((db) => training.saveExercise(db, businessId, null, { name: 'Back squat', muscle_group: 'Legs', equipment: 'Barbell' }));
  await inTx((db) => training.createWorkout(db, { businessId, memberId: running[0].member_id, trainerId: coach.trainer_id, userId: staff.trainer.userId, b: { name: 'Strength block A', goal: 'Build a base', items: [{ exercise_id: ex.exercise_id, day_no: 1, sets: 5, reps: '5', weight_kg: 40 }, { exercise_name: 'Bench press', day_no: 1, sets: 4, reps: '8', weight_kg: 30 }, { exercise_name: 'Plank', day_no: 2, sets: 3, reps: '60s' }] } }));
  await inTx((db) => training.addMeasurement(db, { businessId, memberId: running[0].member_id, userId: staff.trainer.userId, b: { measured_on: addDays(today, -28), weight_kg: 82, waist_cm: 96 } }));
  await inTx((db) => training.addMeasurement(db, { businessId, memberId: running[0].member_id, userId: staff.trainer.userId, b: { measured_on: today, weight_kg: 79.5, waist_cm: 93 } }));
  const gate = await inTx((db) => devices.registerDevice(db, { businessId, branchId: branchIds[0], name: 'Front door reader', kind: 'QR_READER', userId: staff.manager.userId }));

  const entrance = (await getBranchSettings(pool, businessId, branchIds[0])).checkin_token;
  console.log(`
Demo gym ready: Iron Works Fitness (business ${businessId}), ${made.length} members, ${visits} visits.

  Owner     gym@flowxp.test / ${PASSWORD}
  Staff     gym-manager@ · gym-desk@ (front desk) · gym-trainer@  (flowxp.test, same password)
  Member page   /gym/ironworks     Entrance QR page   /gym/in/${entrance}
  Demo gate device (the secret is shown only here):  key ${gate.key_id}   secret ${gate.secret}
  First demo member phone: 98450${'1'.padStart(5, '0')}   (sign-in code for local use: node scripts/gym-dev-login.js ironworks 9845000001)
`);
  await pool.end();
};

main().catch((error) => { console.error('[seed-gym] failed:', error); process.exit(1); });
