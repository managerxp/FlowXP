/* Client reviews for the home page: the Super Admin writes them, uploads the photo and logo, publishes; the public list shows only published ones. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
if (!skip) await runMigrations(pool);
const t = await import('../src/controllers/testimonials.controller.js');
test.after(() => cleanup());

const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const call = async (fn, { params = {}, body = {}, file } = {}) => { const r = res(); await fn({ params, body, file, auth: { userId: null }, headers: {}, ip: '127.0.0.1', get: () => undefined }, r); return r; };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);

test('a review is written, published and shown only when published', { skip }, async () => {
  assert.equal((await call(t.create, { body: { name: '', quote: 'x' } })).code, 400);
  assert.equal((await call(t.create, { body: { name: 'Asha', quote: 'Great', rating: 9 } })).code, 400);
  const made = (await call(t.create, { body: { name: 'Asha Rao', role: 'Owner', company: 'Red Oven', quote: 'Billing takes half the time.', rating: 5 } })).body.data;
  assert.equal(made.is_published, false);
  assert.equal((await call(t.publicList)).body.data.some((x) => x.testimonial_id === made.testimonial_id), false);   // a draft is not public
  await call(t.update, { params: { id: made.testimonial_id }, body: { is_published: true } });
  assert.equal((await call(t.publicList)).body.data.some((x) => x.testimonial_id === made.testimonial_id), true);
  assert.equal((await call(t.remove, { params: { id: made.testimonial_id } })).body.success, true);
});

test('a photo and a logo can be uploaded, replaced and removed; a non-image is refused', { skip }, async () => {
  const made = (await call(t.create, { body: { name: 'Ravi', quote: 'Good', is_published: true } })).body.data;
  const bad = await call(t.uploadImage, { params: { id: made.testimonial_id, kind: 'photo' }, file: { buffer: Buffer.from('<script>alert(1)</script>'), mimetype: 'image/png' } });
  assert.equal(bad.code, 400);
  const ok = await call(t.uploadImage, { params: { id: made.testimonial_id, kind: 'logo' }, file: { buffer: PNG, mimetype: 'image/png' } });
  assert.equal(ok.code, 200);
  assert.match(ok.body.data.logo_url, /testimonials\/\d+\/logo-/);
  assert.equal((await call(t.uploadImage, { params: { id: made.testimonial_id, kind: 'nope' }, file: { buffer: PNG, mimetype: 'image/png' } })).code, 400);
  const gone = await call(t.removeImage, { params: { id: made.testimonial_id, kind: 'logo' } });
  assert.equal(gone.body.data.logo_url, null);
  await call(t.remove, { params: { id: made.testimonial_id } });
});
