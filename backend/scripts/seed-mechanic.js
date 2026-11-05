/*
 * Demo garage: "Shree Garage", Bengaluru, a bike and car mechanic. A few customers, vehicles from the vehicle master in different stages (waiting, being worked on, waiting for parts, ready)
 * and a payment taken today, so the garage home screen has something to show.
 *
 *   npm run seed:mechanic        (re-running replaces the demo garage)
 *
 * Sign in: mechanic@flowxp.test / demo1234
 */
import './no-production.js'; // loads .env, and stops here in production
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import { addLine, approveEstimate, createJob, setStatus, updateJob } from '../src/modules/autoparts/jobcards.js';

const PASSWORD = 'demo1234';

const main = async () => {
  await initializeDatabase();
  for (const { business_id } of (await pool.query(`SELECT business_id FROM businesses WHERE name = 'Shree Garage'`)).rows) await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]);
  await pool.query(`DELETE FROM users WHERE email = 'mechanic@flowxp.test'`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ('Raju Gowda',$1,$2,TRUE) RETURNING user_id`, ['mechanic@flowxp.test', hash])).rows[0].user_id;
  const businessId = (await pool.query(
    `INSERT INTO businesses (name, business_type, garage_kind, workshop_mode, owner_user_id, email, phone, address, city, state, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step)
     VALUES ('Shree Garage','MECHANIC','BOTH',TRUE,$1,'mechanic@flowxp.test','9845022222','12, Service Road','Bengaluru','Karnataka',FALSE,'ACTIVE','ENTERPRISE','MONTHLY',10) RETURNING business_id`, [owner])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary, city, state) VALUES ($1,'Main',TRUE,'Bengaluru','Karnataka') RETURNING branch_id`, [businessId])).rows[0].branch_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status, branch_id) VALUES ($1,$2,'OWNER','ACTIVE',NULL)`, [businessId, owner]);
  const tenant = { businessId, branchId: branch, scopeBranchId: branch, userId: owner, role: 'OWNER', permissions: {}, businessType: 'MECHANIC', garageKind: 'BOTH', planFeatures: {} };

  const customers = {};
  for (const [name, phone] of [['Rahul', '9845100001'], ['Abdul', '9845100002'], ['Sita', '9845100003'], ['Manjunath', '9845100004'], ['Farhan', '9845100005']]) {
    customers[name] = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [businessId, name, phone])).rows[0].customer_id;
  }
  // [customer, registration, type, make, model, complaint, status, [work done: description, price]]
  const jobs = [
    ['Rahul', 'KA03AB1234', 'BIKE', 'Honda', 'Activa 6G', 'General service', 'CHECKING', [['General service', 600], ['Chain lubrication', 150]]],
    ['Abdul', 'KA01MC5678', 'CAR', 'Maruti Suzuki', 'Swift', 'Brake noise', 'IN_PROGRESS', [['Front brake pad fitting', 800], ['Brake bleeding', 300]]],
    ['Sita', 'KA05EF4321', 'BIKE', 'Royal Enfield', 'Classic 350', 'Chain and clutch', 'WAITING_PARTS', [['Clutch adjustment', 250]]],
    ['Manjunath', 'KA02GH9876', 'CAR', 'Hyundai', 'Creta', 'AC not cooling', 'READY', [['AC gas refill', 1800], ['AC filter cleaning', 500]]],
    ['Farhan', 'KA04JK1357', 'BIKE', 'Hero MotoCorp', 'Splendor Plus', 'Engine oil change', 'READY', [['Engine oil change', 350]]]
  ];
  for (const [who, reg, type, make, model, complaint, status, work] of jobs) {
    const j = await createJob(pool, tenant, owner, { customer_id: customers[who], vehicle_reg: reg, vehicle_type: type, make, model, complaint, odometer_km: 12000 + Math.round(Math.random() * 30000) });
    for (const [description, price] of work) await addLine(pool, tenant, owner, j.job_id, { kind: 'LABOUR', description, unit_price: price });
    if (status !== 'CHECKING' || who === 'Rahul') await setStatus(pool, tenant, j.job_id, status);
    if (status !== 'CHECKING') await approveEstimate(pool, tenant, j.job_id, { how: 'Said yes on the phone' });
    await updateJob(pool, tenant, j.job_id, { fuel_level: 'HALF', belongings: 'Helmet, documents' });
  }
  await pool.query(`INSERT INTO expenses (business_id, branch_id, category, amount_paise, payment_method, description) VALUES ($1,$2,'Tea and food',12000,'CASH',NULL),($1,$2,'Spare parts bought',80000,'UPI','Brake pads from Parts House'),($1,$2,'Tools',45000,'CASH','Torque wrench')`, [businessId, branch]);
  await pool.query(`INSERT INTO other_income (business_id, branch_id, category, amount_paise, payment_method) VALUES ($1,$2,'Scrap sale',60000,'CASH')`, [businessId, branch]);
  await pool.query(`INSERT INTO payments (business_id, branch_id, customer_id, payment_method, amount_paise, notes) VALUES ($1,$2,$3,'CASH',85000,'Service'),($1,$2,$4,'UPI',45000,'Oil change')`, [businessId, branch, customers.Rahul, customers.Farhan]);
  console.log(`Shree Garage ready (business ${businessId}). Sign in: mechanic@flowxp.test / ${PASSWORD}`);
  await pool.end();
};
main().catch((e) => { console.error(e); process.exit(1); });
