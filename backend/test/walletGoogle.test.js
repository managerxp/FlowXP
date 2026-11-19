/* Google Wallet: the signed "Add to Google Wallet" link and the card page's switch. Signed with a key made here, so this proves our side only: not that Google accepts it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);
const { runMigrations } = await import('../src/config/migrate.js');
const engine = await import('../src/modules/loyaltyEngine.js');
const { withTransaction } = await import('../src/modules/wholesale/common.js');
const ctl = await import('../src/controllers/loyaltyEngine.controller.js');
const pub = await import('../src/controllers/loyaltyCard.controller.js');
const google = await import('../src/modules/walletGoogle.js');

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const pcall = async (fn, extra) => { const res = fakeRes(); await fn({ params: {}, body: {}, query: {}, ...extra }, res); return res; };
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
let token; let membershipId; let bizId;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('w','w@wg.test','x') RETURNING user_id`)).rows[0];
  bizId = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code) VALUES ('Wallet Cafe',$1,'RESTAURANT',(SELECT plan_code FROM plans ORDER BY sort_order LIMIT 1)) RETURNING business_id`, [user.user_id])).rows[0].business_id;
  await pool.query(`INSERT INTO business_feature_overrides (business_id, feature_key, enabled) VALUES ($1,'loyalty_programmes',TRUE),($1,'loyalty_wallet',TRUE)`, [bizId]);
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [bizId])).rows[0].branch_id;
  const tenant = { businessId: bizId, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {} };
  const made = fakeRes();
  await ctl.createProgramme({ tenant, auth: { userId: user.user_id }, params: {}, body: { name: 'Stamps', kind: 'STAMPS', earn_points: 1, redeem_points: 5, card: { bg: '#112233', message: 'Thanks' } }, query: {}, headers: {}, get: () => undefined, ip: '1' }, made);
  const cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Wanda','9000000099') RETURNING customer_id`, [bizId])).rows[0].customer_id;
  const m = (await withTransaction((c) => engine.enrol(c, { businessId: bizId, programmeId: made.body.data.programme_id, customerId: cust }))).membership;
  membershipId = m.membership_id; token = m.token;
  await withTransaction((c) => engine.earn(c, { businessId: bizId, membershipId, amountPaise: 0, key: 'w1' }));
});

test('without server credentials the card says no wallet and the link is refused', { skip }, async () => {
  delete process.env.GOOGLE_WALLET_ISSUER_ID; delete process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON; google.resetForTests();
  assert.equal(google.configured(), false);
  assert.equal((await pcall(pub.card, { params: { token } })).body.data.wallet.google, false);
  assert.equal((await pcall(pub.googleWallet, { params: { token } })).code, 404);
});

test('with credentials the link is signed, carries this member\'s pass, and the card offers it', { skip }, async () => {
  process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000000000001';
  process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'wallet@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  google.resetForTests();
  assert.equal(google.configured(), true);
  assert.equal((await pcall(pub.card, { params: { token } })).body.data.wallet.google, true);
  const r = await pcall(pub.googleWallet, { params: { token } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const jwt = r.body.data.url.replace('https://pay.google.com/gp/v/save/', '');
  const [h, p, sig] = jwt.split('.');
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, 'base64url')));   // signed with the service account's key
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(claims.iss, 'wallet@test.iam.gserviceaccount.com'); assert.equal(claims.typ, 'savetowallet'); assert.equal(claims.aud, 'google');
  const obj = claims.payload.loyaltyObjects[0]; const cls = claims.payload.loyaltyClasses[0];
  assert.equal(obj.id, `3388000000000000001.fx_member_${membershipId}`); assert.equal(obj.classId, cls.id);
  assert.equal(obj.loyaltyPoints.balance.int, 1); assert.equal(obj.loyaltyPoints.label, 'Stamps');
  assert.match(obj.barcode.value, new RegExp(`/card/${token}$`));
  assert.equal(cls.hexBackgroundColor, '#112233'); assert.equal(cls.issuerName, 'Wallet Cafe'); assert.equal(cls.countryCode, 'IN');
  assert.match(cls.programLogo.sourceUri.uri, /^https?:\/\/.+icon-512\.png$/);
  assert.equal(obj.textModulesData[0].body, 'Thanks');
  assert.equal(obj.locations, undefined);   // no outlet location set: no location nudge
  assert.equal((await pcall(pub.googleWallet, { params: { token: 'x'.repeat(40) } })).code, 404);
});

test('the plan can switch the wallet off', { skip }, async () => {
  await pool.query(`UPDATE business_feature_overrides SET enabled = FALSE WHERE business_id = $1 AND feature_key = 'loyalty_wallet'`, [bizId]);
  assert.equal((await pcall(pub.card, { params: { token } })).body.data.wallet.google, false);
  assert.equal((await pcall(pub.googleWallet, { params: { token } })).code, 404);
});

test('a balance push with no credentials does nothing and never throws', { skip }, async () => {
  delete process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON; google.resetForTests();
  await google.pushBalance([membershipId]); google.pushForCustomer(1);
});

test('an outlet with a location puts it on the pass (up to the ten Google allows); one without adds nothing', { skip }, async () => {
  process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000000000001';
  process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'wallet@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  google.resetForTests();
  const tenant = { businessId: bizId };
  const call = async (fn, extra) => { const res = fakeRes(); await fn({ tenant, auth: { userId: 1 }, params: {}, body: {}, query: {}, headers: {}, get: () => undefined, ip: '1', ...extra }, res); return res; };
  const branch = (await pool.query(`SELECT branch_id FROM branches WHERE business_id = $1`, [bizId])).rows[0].branch_id;
  assert.equal((await call(ctl.setLocation, { params: { branchId: String(branch) }, body: { latitude: 120, longitude: 77 } })).code, 400);
  assert.equal((await call(ctl.setLocation, { params: { branchId: '999999' }, body: { latitude: 12.97, longitude: 77.59 } })).code, 404);
  assert.equal((await call(ctl.setLocation, { params: { branchId: String(branch) }, body: { latitude: 12.9716, longitude: 77.5946 } })).code, 200);
  const row = (await google.loadMembership(pool, 'm.membership_id = $1', [membershipId]))[0];
  assert.deepEqual(google.passFor(row).loyaltyObject.locations, [{ latitude: 12.9716, longitude: 77.5946 }]);
  assert.equal((await call(ctl.listLocations)).body.data[0].latitude, 12.9716);
  await call(ctl.setLocation, { params: { branchId: String(branch) }, body: { latitude: null, longitude: null } });
  assert.equal(google.passFor((await google.loadMembership(pool, 'm.membership_id = $1', [membershipId]))[0]).loyaltyObject.locations, undefined);
});
