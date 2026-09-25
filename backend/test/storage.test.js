/*
 * File storage: the S3 request signer is checked against AWS's own published
 * examples, and both drivers (local disk, S3-compatible bucket) are exercised,
 * including through the product photo upload.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { default: config } = await import('../src/config/env.js');
const storage = await import('../src/modules/storage.js');
const products = await import('../src/controllers/products.controller.js');

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowxp-store-'));
const originalCwd = process.cwd();
process.chdir(workdir);
test.after(async () => { process.chdir(originalCwd); fs.rmSync(workdir, { recursive: true, force: true }); await cleanup(); });

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

/* ── the signer, against AWS's documented examples ──────────────────────── */

const KEYS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' };
const at = new Date('2013-05-24T00:00:00Z');

test('the signer reproduces AWS’s published GET example', () => {
  const signed = storage.signV4({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { range: 'bytes=0-9' }, now: at, ...KEYS });
  assert.match(signed.Authorization, /Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request/);
  assert.match(signed.Authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/);
  assert.match(signed.Authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
  assert.equal(signed['x-amz-content-sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'the hash of an empty body');
});

test('the signer reproduces AWS’s published PUT example, with a key that needs escaping', () => {
  const signed = storage.signV4({
    method: 'PUT', url: 'https://examplebucket.s3.amazonaws.com/test$file.text', payload: 'Welcome to Amazon S3.', now: at, ...KEYS,
    headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' }
  });
  assert.match(signed.Authorization, /SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,/);
  assert.match(signed.Authorization, /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
});

test('a different secret, date or body gives a different signature', () => {
  const sig = (over) => storage.signV4({ method: 'PUT', url: 'https://b.example.com/a.jpg', payload: 'x', now: at, ...KEYS, ...over }).Authorization;
  const base = sig({});
  assert.notEqual(base, sig({ secretAccessKey: 'other' }));
  assert.notEqual(base, sig({ now: new Date('2013-05-25T00:00:00Z') }));
  assert.notEqual(base, sig({ payload: 'y' }));
  assert.equal(base, sig({}), 'deterministic');
});

/* ── local disk ─────────────────────────────────────────────────────────── */

test('the local driver stores a file under uploads/ and returns a /uploads URL', async () => {
  config.storage.driver = 'local';
  const url = await storage.putFile({ key: 'products/7/1-100.png', buffer: Buffer.from('png-bytes'), contentType: 'image/png' });
  assert.equal(url, '/uploads/products/7/1-100.png');
  assert.equal(fs.readFileSync(path.join(workdir, 'uploads', 'products', '7', '1-100.png'), 'utf8'), 'png-bytes');
  await storage.removeFile(url);
  assert.equal(fs.existsSync(path.join(workdir, 'uploads', 'products', '7', '1-100.png')), false);
});

test('removing never leaves the uploads folder, and a bad value is ignored', async () => {
  fs.writeFileSync(path.join(workdir, 'precious.txt'), 'keep me');
  await storage.removeFile('/uploads/../precious.txt');
  await storage.removeFile('/uploads/../../precious.txt');
  await storage.removeFile('https://elsewhere.example.com/x.png');
  await storage.removeFile(null);
  assert.equal(fs.readFileSync(path.join(workdir, 'precious.txt'), 'utf8'), 'keep me');
});

/* ── an S3-compatible bucket (a local stand-in) ─────────────────────────── */

const bucket = new Map(); const seen = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    if (!/^AWS4-HMAC-SHA256 Credential=TESTKEY\//.test(req.headers.authorization || '')) { res.statusCode = 403; return res.end(); }
    if (req.method === 'PUT') { bucket.set(req.url, Buffer.concat(chunks)); res.statusCode = 200; return res.end(); }
    if (req.method === 'DELETE') { res.statusCode = bucket.delete(req.url) ? 204 : 404; return res.end(); }
    res.statusCode = 405; res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
test.after(() => server.close());

const useBucket = () => Object.assign(config.storage, { driver: 's3', endpoint: `http://127.0.0.1:${server.address().port}`, bucket: 'flowxp-files', region: 'auto', accessKeyId: 'TESTKEY', secretAccessKey: 'testsecret', publicUrl: 'https://cdn.example.com/flowxp-files' });

test('the s3 driver signs and PUTs the file, and returns its public URL', async () => {
  useBucket(); seen.length = 0;
  const url = await storage.putFile({ key: 'products/3/9-1700.webp', buffer: Buffer.from('webp-bytes'), contentType: 'image/webp' });
  assert.equal(url, 'https://cdn.example.com/flowxp-files/products/3/9-1700.webp');
  const put = seen[0];
  assert.deepEqual([put.method, put.url], ['PUT', '/flowxp-files/products/3/9-1700.webp']);
  assert.equal(put.headers['content-type'], 'image/webp');
  assert.match(put.headers.authorization, /^AWS4-HMAC-SHA256 Credential=TESTKEY\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(put.body.toString(), 'webp-bytes');
  assert.match(put.headers['x-amz-date'], /^\d{8}T\d{6}Z$/);
  assert.equal(bucket.get('/flowxp-files/products/3/9-1700.webp').toString(), 'webp-bytes');
});

test('the s3 driver deletes by public URL, ignores other hosts, and survives a missing file', async () => {
  useBucket(); seen.length = 0;
  await storage.removeFile('https://cdn.example.com/flowxp-files/products/3/9-1700.webp');
  assert.equal(seen[0].method, 'DELETE');
  assert.equal(bucket.has('/flowxp-files/products/3/9-1700.webp'), false);
  await storage.removeFile('https://cdn.example.com/flowxp-files/products/3/gone.webp');   // 404 is fine
  const before = seen.length;
  await storage.removeFile('https://other.example.com/x.png');
  await storage.removeFile('/uploads/products/1/old.png');
  assert.equal(seen.length, before, 'files that are not this bucket’s are never touched');
});

test('a rejected or unreachable bucket raises an error the caller can handle', async () => {
  useBucket();
  config.storage.accessKeyId = 'WRONG';
  await assert.rejects(storage.putFile({ key: 'a.png', buffer: Buffer.from('x'), contentType: 'image/png' }), /storage PUT failed \(403\)/);
  useBucket(); config.storage.endpoint = 'http://127.0.0.1:1';
  await assert.rejects(storage.putFile({ key: 'a.png', buffer: Buffer.from('x'), contentType: 'image/png' }));
});

/* ── through the product photo upload ───────────────────────────────────── */

let biz; let user; let product;
const upload = async (file, id = product, businessId = biz) => { const res = fakeRes(); await products.uploadImage({ tenant: { businessId }, auth: { userId: user }, params: { id }, file, headers: {}, ip: '127.0.0.1' }, res); return res; };
const photo = (type = 'image/jpeg') => ({ mimetype: type, buffer: Buffer.from(`bytes-${Math.random()}`) });

test('setup', { skip }, async () => {
  await runMigrations(pool);
  user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@st.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id) VALUES ('Cafe',$1) RETURNING business_id`, [user])).rows[0].business_id;
  product = (await pool.query(`INSERT INTO products (business_id, name) VALUES ($1,'Naan') RETURNING product_id`, [biz])).rows[0].product_id;
});

test('a product photo is stored under its business, and replacing it removes the old file', { skip }, async () => {
  config.storage.driver = 'local';
  const first = await upload(photo('image/png'));
  assert.equal(first.code, 200);
  const url1 = first.body.data.image_url;
  assert.match(url1, new RegExp(`^/uploads/products/${biz}/${product}-\\d+\\.png$`));
  assert.ok(fs.existsSync(path.join(workdir, url1.replace(/^\//, ''))));

  await new Promise((r) => setTimeout(r, 5));
  const second = await upload(photo('image/jpeg'));
  const url2 = second.body.data.image_url;
  assert.notEqual(url1, url2);
  for (let i = 0; i < 20 && fs.existsSync(path.join(workdir, url1.replace(/^\//, ''))); i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(fs.existsSync(path.join(workdir, url1.replace(/^\//, ''))), false, 'the replaced photo is gone');
  assert.ok(fs.existsSync(path.join(workdir, url2.replace(/^\//, ''))));
});

test('the same upload works against a bucket, and a failed save changes nothing', { skip }, async () => {
  useBucket(); bucket.clear();
  const ok = await upload(photo('image/webp'));
  assert.equal(ok.code, 200);
  assert.match(ok.body.data.image_url, new RegExp(`^https://cdn\\.example\\.com/flowxp-files/products/${biz}/${product}-\\d+\\.webp$`));
  assert.equal(bucket.size, 1);
  const good = ok.body.data.image_url;

  config.storage.accessKeyId = 'WRONG';
  const failed = await upload(photo('image/webp'));
  assert.equal(failed.code, 502);
  assert.match(failed.body.message, /Could not save the photo/);
  const stored = (await pool.query(`SELECT image_url FROM products WHERE product_id = $1`, [product])).rows[0].image_url;
  assert.equal(stored, good, 'the product keeps its working photo');
});

test('uploads are scoped to the business and need a file', { skip }, async () => {
  config.storage.driver = 'local';
  assert.equal((await upload(undefined)).code, 400);
  assert.equal((await upload(photo(), product, biz + 999)).code, 404, 'another business’s product');
  assert.equal((await upload(photo(), 999999)).code, 404);
});
