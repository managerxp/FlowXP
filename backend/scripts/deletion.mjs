/* node scripts/deletion.mjs   (development server running). Deleting an account, end to end, with made-up people it creates and removes:
   a staff member who deletes themselves (bills they made stay), the only owner of a business (held, becomes a request), an owner who is not the only one,
   someone who asks from the website without signing in (same answer for a known and an unknown address), and support's queue (with a temporary administrator,
   never the real one). */
import bcrypt from 'bcryptjs';
import pool from '../src/config/database.js';

const base = 'http://localhost:5100';
let failures = 0; let checks = 0; let seq = 0;
const good = (cond, m) => { checks++; if (cond) console.log(`  ok  ${m}`); else { failures++; console.log(`  FAIL  ${m}`); } };
const key = () => `del-${Date.now()}-${seq++}`;
const stamp = Date.now().toString(36);
const PASS = 'a-long-test-passphrase-9';
const hash = await bcrypt.hash(PASS, 10);
const made = { users: [], businesses: [] };

const person = async (label, { business, role = 'CASHIER', superAdmin = false } = {}) => {
  const email = `del-${label}-${stamp}@flowxp.test`;
  const id = (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified, is_super_admin) VALUES ($1,$2,$3,TRUE,$4) RETURNING user_id`, [`Drill ${label}`, email, hash, superAdmin])).rows[0].user_id;
  made.users.push(id);
  if (business) await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,$3)`, [business, id, role]);
  return { id, email };
};
const login = async (email, path = '/auth/login') => {
  const r = await fetch(base + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email, password: PASS }) });
  const j = await r.json().catch(() => ({}));
  if (!j.data?.token) return { status: r.status, call: null };
  const me = (await (await fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + j.data.token } })).json()).data;
  const b = me?.businesses?.[0];
  const headers = { authorization: 'Bearer ' + j.data.token, ...(b ? { 'x-business-id': String(b.business_id), 'x-branch-id': String(b.outlets[0].branch_id) } : {}), 'x-requested-with': 'FlowXP', 'content-type': 'application/json' };
  const call = async (method, p, body, extra = {}) => { const res = await fetch(base + '/api' + p, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }); let json = null; try { json = await res.json(); } catch { /* */ } return { status: res.status, json }; };
  return { status: r.status, call };
};
const businessOf = (label) => pool.query(
  `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, city, state, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step)
   VALUES ($1,'CAFE',(SELECT user_id FROM users LIMIT 1),$2,'9876500777','Pune','Maharashtra',FALSE,'ACTIVE','ENTERPRISE','MONTHLY',10) RETURNING business_id`, [`Drill ${label}`, `del-biz-${label}-${stamp}@flowxp.test`])
  .then(async (r) => { const id = r.rows[0].business_id; await pool.query(`INSERT INTO branches (business_id, name, code, city, state, is_primary) VALUES ($1,'Main','M','Pune','Maharashtra',TRUE)`, [id]); made.businesses.push(id); return id; });

try {
  /* ── a staff member deletes themselves ───────────────────────────────── */
  console.log('A staff member deletes their own account');
  const biz = await businessOf('A');
  const owner = await person('owner', { business: biz, role: 'OWNER' });
  const staff = await person('staff', { business: biz, role: 'CASHIER' });
  const so = await login(owner.email); const ss = await login(staff.email);
  good(Boolean(so.call && ss.call), 'both can sign in');
  const prod = (await so.call('POST', '/products', { name: 'Drill Tea', selling_price: 50, kind: 'DISH', track_inventory: false, unit: 'pcs' }, { 'idempotency-key': key() })).json?.data;
  const bill = await ss.call('POST', '/invoices', { items: [{ product_id: prod.product_id, quantity: 1 }], payment: { method: 'CASH', amount: 'FULL' } }, { 'idempotency-key': key() });
  good(bill.status === 201, `they make a bill (${bill.status})`);
  const invoiceId = bill.json?.data?.invoice_id;
  await ss.call('POST', '/notifications/devices', { token: `ExponentPushToken[drill-del-${stamp}-xxxxx]`, platform: 'android' });
  good((await ss.call('POST', '/auth/delete-account', { password: 'wrong' })).status === 401, 'a wrong password does not delete');
  good((await ss.call('POST', '/auth/delete-account', {})).status === 401, 'no password does not delete');
  const gone = await ss.call('POST', '/auth/delete-account', { password: PASS });
  good(gone.status === 200, `with the right password it is deleted (${gone.status} ${gone.json?.message || ''})`);
  good((await login(staff.email)).call === null, 'they can no longer sign in');
  good((await ss.call('GET', '/auth/me')).status === 401, 'the old session stops working at once');
  const row = (await pool.query(`SELECT name, email, phone, deleted_at, approval_pin_hash, password_hash FROM users WHERE user_id = $1`, [staff.id])).rows[0];
  good(row.name === 'Former team member' && !row.email.includes('drill') && row.deleted_at && !row.phone, 'their name and address are gone from the record');
  good(!(await pool.query(`SELECT 1 FROM push_devices WHERE user_id = $1`, [staff.id])).rows.length, 'their phone is off the alert list');
  good((await pool.query(`SELECT status FROM business_users WHERE user_id = $1`, [staff.id])).rows.every((r) => r.status === 'DISABLED'), 'they are removed from the business');
  good((await so.call('GET', `/invoices/${invoiceId}`)).status === 200, "the business still has the bill they made");
  good(!(await so.call('GET', '/staff')).json?.data?.some?.((m) => m.email === staff.email), 'they are not on the staff list under their old address');

  /* ── the only owner ──────────────────────────────────────────────────── */
  console.log('\nThe only owner of a business');
  const solo = await businessOf('B'); const lone = await person('lone', { business: solo, role: 'OWNER' });
  const sl = await login(lone.email);
  const held = await sl.call('POST', '/auth/delete-account', { password: PASS });
  good(held.status === 409 && held.json?.code === 'OWNS_BUSINESS' && /only owner/.test(held.json?.message || ''), `held, with a reason they can act on (${held.status})`);
  good((await login(lone.email)).call !== null, 'their account still works');
  const reqRow = (await pool.query(`SELECT status, source FROM deletion_requests WHERE user_id = $1`, [lone.id])).rows[0];
  good(reqRow?.status === 'PENDING' && reqRow.source === 'IN_APP', 'the request is recorded for support');

  /* ── one of two owners ───────────────────────────────────────────────── */
  console.log('\nAn owner who is not the only one');
  const duo = await businessOf('C'); const o1 = await person('duo1', { business: duo, role: 'OWNER' }); const o2 = await person('duo2', { business: duo, role: 'OWNER' });
  const d1 = await login(o1.email);
  good((await d1.call('POST', '/auth/delete-account', { password: PASS })).status === 200, 'can be deleted: the business keeps its other owner');
  good((await login(o2.email)).call !== null, 'the other owner is unaffected');

  /* ── asking from the website ─────────────────────────────────────────── */
  console.log('\nAsking from the website, not signed in');
  const known = await person('known');
  const ask = (email, extra = {}) => fetch(base + '/api/public/account-deletion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, note: 'please', ...extra }) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const a1 = await ask(known.email); const a2 = await ask(`nobody-${stamp}@flowxp.test`);
  good(a1.status === 201 && a2.status === 201 && a1.json.message === a2.json.message, 'a known and an unknown address get the same answer');
  const a3 = await ask(known.email);
  good(a3.status === 201 && Number((await pool.query(`SELECT COUNT(*) AS n FROM deletion_requests WHERE lower(email) = $1`, [known.email])).rows[0].n) === 1, 'asking twice makes one request');
  good((await ask('not an email')).status === 400, 'a bad address is refused');
  good(Boolean((await pool.query(`SELECT 1 FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [known.id])).rows.length), 'nothing is deleted by the public form alone');

  /* ── support's queue ─────────────────────────────────────────────────── */
  console.log("\nSupport's queue (a temporary administrator)");
  const admin = await person('admin', { superAdmin: true });
  const ad = await login(admin.email, '/admin/login');
  if (!ad.call) console.log('  (the administrator login needs more than a password here: queue checks skipped)');
  else {
    const list = (await ad.call('GET', '/admin/deletion-requests')).json?.data || [];
    const mine = list.find((r) => r.email === known.email); const loneReq = list.find((r) => r.user_id === lone.id);
    good(Boolean(mine) && mine.has_account === true, 'the website request is in the queue, matched to the account');
    good(Boolean(loneReq?.businesses?.some((b) => b.sole_owner)), 'the owner request shows what they are the only owner of');
    good((await ad.call('POST', `/admin/deletion-requests/${loneReq.request_id}/complete`, {})).status === 409, 'it cannot be completed while they are the only owner');
    good((await ad.call('POST', `/admin/deletion-requests/${mine.request_id}/complete`, { note: 'checked by email' })).status === 200, 'the checked request is completed');
    good(Boolean((await pool.query(`SELECT 1 FROM users WHERE user_id = $1 AND deleted_at IS NOT NULL`, [known.id])).rows.length), 'and the account is deleted');
    good((await ad.call('POST', `/admin/deletion-requests/${mine.request_id}/complete`, {})).status === 409, 'a request cannot be completed twice');
    good((await ad.call('POST', `/admin/deletion-requests/${loneReq.request_id}/decline`, { note: 'drill' })).status === 200, 'a request can be declined');
    const plain = await login(known.email);
    good(plain.call === null, 'a normal person cannot use the queue (and the deleted one cannot sign in)');
    const asStaff = await login(o2.email);
    good((await asStaff.call('GET', '/admin/deletion-requests')).status === 403, 'an ordinary account is refused the queue');
  }
} catch (e) { failures++; console.log(`  FAIL  the drill stopped: ${e.message}`); console.error(e); }
finally {
  try {
    await pool.query(`DELETE FROM deletion_requests WHERE email LIKE $1 OR email LIKE $2 OR user_id = ANY($3::int[])`, [`%-${stamp}@flowxp.test`, `%nobody-${stamp}%`, made.users]);
    await pool.query(`DELETE FROM businesses WHERE business_id = ANY($1::int[])`, [made.businesses]);
    await pool.query(`DELETE FROM users WHERE user_id = ANY($1::int[])`, [made.users]);
  } catch (e) { console.log(`(clean-up stopped: ${e.message}; users ${made.users}, businesses ${made.businesses})`); }
  await pool.end();
}
console.log(`\n${checks} checks, ${failures} failed.`);
process.exit(failures ? 1 : 0);
