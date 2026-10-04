/*
 * Each industry starts with only the features that make sense for it (modules/planFeatures.js INDUSTRY_OFF): the
 * business-type switch can turn one back on with an explicit true, a per-business override beats both, and a type
 * with no defaults (OTHER) keeps everything. Pure functions: no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveFeatureFlags, industryDefaults, INDUSTRY_OFF, PLAN_FEATURE_KEYS } from '../src/modules/planFeatures.js';

const flags = (type, { plan = {}, typeRow = {}, overrides = {} } = {}) => effectiveFeatureFlags([plan, typeRow], overrides, type);
const on = (f, key) => f[key] !== false;

test('every default names a real feature', () => {
  for (const [type, keys] of Object.entries(INDUSTRY_OFF)) for (const key of keys) assert.ok(PLAN_FEATURE_KEYS.includes(key), `${type}: ${key}`);
});

test('a restaurant keeps its floor and kitchen features and loses salon and wholesale ones', () => {
  const f = flags('RESTAURANT');
  for (const key of ['tables', 'kitchen', 'reservations', 'qr_ordering', 'integrations', 'multi_brand', 'delivery_fleet', 'loyalty', 'ai']) assert.ok(on(f, key), key);
  for (const key of ['salon_appointments', 'salon_gift_cards', 'wholesale_orders', 'wholesale_batches']) assert.ok(!on(f, key), key);
});

test('a cloud kitchen has a kitchen but no dining room', () => {
  const f = flags('CLOUD_KITCHEN');
  assert.ok(on(f, 'kitchen') && on(f, 'integrations') && on(f, 'multi_brand') && on(f, 'delivery_fleet'));
  for (const key of ['tables', 'reservations', 'qr_ordering']) assert.ok(!on(f, key), key);
});

test('a salon has appointments and memberships, not table bookings, the kitchen or delivery', () => {
  const f = flags('SALON');
  for (const key of ['salon_appointments', 'salon_memberships', 'salon_packages', 'salon_gift_cards', 'salon_commission', 'salon_automation', 'loyalty', 'messaging']) assert.ok(on(f, key), key);
  for (const key of ['reservations', 'tables', 'kitchen', 'qr_ordering', 'integrations', 'multi_brand', 'delivery_fleet', 'wholesale_orders']) assert.ok(!on(f, key), key);
});

test('a pharmacy and a supermarket keep batches and expiry; electronics does not', () => {
  assert.ok(on(flags('PHARMACY'), 'wholesale_batches') && on(flags('SUPERMARKET'), 'wholesale_batches'));
  assert.ok(!on(flags('ELECTRONICS'), 'wholesale_batches'));
  for (const type of ['PHARMACY', 'SUPERMARKET', 'RETAIL']) {
    const f = flags(type);
    for (const key of ['kitchen', 'tables', 'reservations', 'salon_appointments', 'wholesale_orders']) assert.ok(!on(f, key), `${type}: ${key}`);
    assert.ok(on(f, 'purchases') && on(f, 'auto_sku') && on(f, 'ai'));
  }
});

test('wholesale keeps its own features and drops loyalty, the restaurant set and the salon set', () => {
  for (const type of ['WHOLESALE', 'DISTRIBUTOR']) {
    const f = flags(type);
    for (const key of ['wholesale_orders', 'wholesale_fulfilment', 'wholesale_pricing', 'wholesale_batches', 'purchases', 'ai']) assert.ok(on(f, key), `${type}: ${key}`);
    for (const key of ['loyalty', 'kitchen', 'tables', 'salon_gift_cards']) assert.ok(!on(f, key), `${type}: ${key}`);
  }
});

test('OTHER and an unknown type have no defaults, so everything is on', () => {
  assert.deepEqual(flags('OTHER'), {});
  assert.deepEqual(flags(undefined), {});
  assert.deepEqual(industryDefaults('NOPE'), {});
});

test('the business-type switch turns a default back on with true; a plan or business switch still turns things off', () => {
  assert.ok(on(flags('SALON', { typeRow: { reservations: true } }), 'reservations'));
  assert.ok(!on(flags('SALON', { plan: { reservations: true } }), 'reservations'), 'a plan saying yes does not make an industry apply');
  assert.ok(!on(flags('RESTAURANT', { typeRow: { kitchen: false } }), 'kitchen'));
  assert.ok(!on(flags('RESTAURANT', { plan: { ai: false } }), 'ai'));
});

test('a per-business override beats the industry default in both directions', () => {
  assert.ok(on(flags('SALON', { overrides: { kitchen: true } }), 'kitchen'));
  assert.ok(!on(flags('RESTAURANT', { overrides: { kitchen: false } }), 'kitchen'));
  assert.ok(on(flags('SALON', { typeRow: { kitchen: false }, overrides: { kitchen: true } }), 'kitchen'));
});
