/* The app's logic, without a phone: money, the cart preview, the catalogue, the api client and the receipt. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { qty, rupees, toPaise } from '../src/lib/money.ts';
import { addProduct, emptyCart, saleBody, setQuantity, totals, upiLink } from '../src/lib/cart.ts';
import type { Product } from '../src/lib/catalog.ts';
import { ApiError, NetworkError, createApi, newKey, type Session } from '../src/lib/api.ts';
import { receiptText, type Invoice } from '../src/lib/receipt.ts';

const P = (id: number, name: string, price: number, extra: Partial<Product> = {}): Product => ({
  product_id: id, name, sku: `SKU${id}`, barcodes: [`890000000${id}`], unit: 'pc', selling_price: price, mrp: null, tax_rate: 5,
  track_inventory: false, current_stock: null, category_name: 'Snacks', is_available: true, modifier_group_ids: [], ...extra
});

test('rupees: Indian grouping, paise, negatives; toPaise rounds', () => {
  assert.equal(rupees(0), '₹0.00'); assert.equal(rupees(5), '₹0.05'); assert.equal(rupees(99900), '₹999.00');
  assert.equal(rupees(123456789), '₹12,34,567.89'); assert.equal(rupees(100000), '₹1,000.00'); assert.equal(rupees(-2550), '-₹25.50');
  assert.equal(toPaise(19.99), 1999); assert.equal(toPaise('0.1') + toPaise('0.2'), 30);
  assert.equal(qty(2), '2'); assert.equal(qty(0.25), '0.25'); assert.equal(qty(1.1 + 2.2), '3.3');
});

test('the cart adds, raises, lowers and removes lines, and previews price plus GST', () => {
  const a = P(1, 'Biscuit', 20); const b = P(2, 'Tea', 100.5, { tax_rate: 12 });
  let cart = addProduct(emptyCart(), a); cart = addProduct(cart, a); cart = addProduct(cart, b, 3);
  assert.deepEqual(cart.lines.map((l) => [l.product.product_id, l.quantity]), [[1, 2], [2, 3]]);
  // 2 x 20.00 = 4000 (+5% = 200);  3 x 100.50 = 30150 (+12% = 3618)
  assert.deepEqual(totals(cart), { itemCount: 5, subtotalPaise: 34150, offersPaise: 0, taxPaise: 3818, totalPaise: 37968 });
  cart = setQuantity(cart, '1:', 1); assert.equal(cart.lines[0].quantity, 1);
  cart = setQuantity(cart, '1:', 0); assert.deepEqual(cart.lines.map((l) => l.product.product_id), [2]);
  assert.deepEqual(totals(emptyCart()), { itemCount: 0, subtotalPaise: 0, offersPaise: 0, taxPaise: 0, totalPaise: 0 });
});

test('the sale body carries ids and quantities only; the server prices the lines', () => {
  const cart = addProduct(addProduct(emptyCart(), P(1, 'A', 20)), P(2, 'B', 30), 2);
  assert.deepEqual(saleBody(cart, { method: 'UPI', reference: 'T123' }), {
    items: [{ product_id: 1, quantity: 1 }, { product_id: 2, quantity: 2 }],
    payment: { method: 'UPI', amount: 'FULL', reference_number: 'T123' }, apply_promotions: true
  });
  assert.equal('reference_number' in saleBody(cart, { method: 'CASH' }).payment, false);
});

test('a UPI link names the payee, the exact amount and the bill', () => {
  assert.equal(upiLink('shop@upi', 'Brew & Bloom', 14750, 'Bill'), 'upi://pay?pa=shop%40upi&pn=Brew%20%26%20Bloom&am=147.50&cu=INR&tn=Bill');
});

test('a new key is unique per call and within the server\'s 128 characters', () => {
  const keys = new Set(Array.from({ length: 500 }, newKey));
  assert.equal(keys.size, 500); for (const k of keys) assert.ok(k.length <= 128);
});

/* ── the api client ─────────────────────────────────────────────────────── */

const session = (over: Partial<Session> = {}): Session => ({ token: 'tok', businessId: 7, branchId: 9, ...over });
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('every request carries the token, business, outlet and (for a sale) its key; the body is JSON', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const api = createApi({ baseUrl: 'http://x', getSession: () => session(), fetchImpl: (async (url: string, init: RequestInit) => { seen = { url, init }; return reply(200, { success: true, data: { ok: 1 } })(); }) as unknown as typeof fetch });
  assert.deepEqual(await api.post('/invoices', { a: 1 }, { idempotencyKey: 'k-1' }), { ok: 1 });
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(seen!.url, 'http://x/api/invoices'); assert.equal(seen!.init.method, 'POST'); assert.equal(seen!.init.body, '{"a":1}');
  assert.equal(h.Authorization, 'Bearer tok'); assert.equal(h['X-Business-Id'], '7'); assert.equal(h['X-Branch-Id'], '9'); assert.equal(h['Idempotency-Key'], 'k-1');
  const bare = createApi({ baseUrl: 'http://x', getSession: () => session({ token: null, businessId: null, branchId: null }), fetchImpl: (async (_u: string, init: RequestInit) => { seen = { url: _u, init }; return reply(200, { success: true, data: 1 })(); }) as unknown as typeof fetch });
  await bare.get('/x'); const h2 = seen!.init.headers as Record<string, string>;
  assert.equal(h2.Authorization, undefined); assert.equal(h2['X-Business-Id'], undefined); assert.equal(h2['Idempotency-Key'], undefined);
});

test('no connection is a NetworkError; a refusal is an ApiError with the server\'s words; a 401 signs out, except at sign-in', async () => {
  let signedOut = 0;
  const down = createApi({ baseUrl: 'http://x', getSession: () => session(), fetchImpl: (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch });
  await assert.rejects(down.get('/x'), (e) => e instanceof NetworkError && e instanceof TypeError);

  const refuse = createApi({ baseUrl: 'http://x', getSession: () => session(), onUnauthorized: () => { signedOut++; }, fetchImpl: reply(409, { success: false, message: 'Not enough stock for Tin', code: 'STOCK' }) as unknown as typeof fetch });
  await assert.rejects(refuse.post('/invoices', {}), (e) => e instanceof ApiError && e.status === 409 && e.message === 'Not enough stock for Tin' && e.code === 'STOCK');
  assert.equal(signedOut, 0);

  const expired = createApi({ baseUrl: 'http://x', getSession: () => session(), onUnauthorized: () => { signedOut++; }, fetchImpl: reply(401, { success: false, message: 'Sign in to continue' }) as unknown as typeof fetch });
  await assert.rejects(expired.get('/x')); assert.equal(signedOut, 1);
  await assert.rejects(expired.post('/auth/login', {}, { signIn: true }), /Sign in/); assert.equal(signedOut, 1, 'a wrong password is not a sign-out');

  const html = createApi({ baseUrl: 'http://x', getSession: () => session(), fetchImpl: (async () => new Response('<html>bad gateway</html>', { status: 502 })) as unknown as typeof fetch });
  await assert.rejects(html.get('/x'), (e) => e instanceof ApiError && e.status === 502);
});

test('refreshSession keeps the fresh token the server hands back', async () => {
  const got: string[] = [];
  const api = createApi({ baseUrl: 'http://x', getSession: () => session(), onToken: (t) => got.push(t), fetchImpl: reply(200, { success: true, data: { token: 'fresh', user: {} } }) as unknown as typeof fetch });
  await api.refreshSession(); assert.deepEqual(got, ['fresh']);
  const none = createApi({ baseUrl: 'http://x', getSession: () => session(), onToken: (t) => got.push(t), fetchImpl: reply(200, { success: true, data: { user: {} } }) as unknown as typeof fetch });
  await none.refreshSession(); assert.deepEqual(got, ['fresh']);
});

/* ── the receipt ────────────────────────────────────────────────────────── */

test('the receipt is built from the server\'s invoice: lines, GST, round-off, payments', () => {
  const inv: Invoice = {
    invoice_id: 1, invoice_number: 'INV-0042', invoice_date: '2026-10-07T09:30:00.000Z', customer_name: 'Asha', cashier: 'Ravi',
    subtotal: 200, discount: 10, tax: 9.5, round_off: 0.5, total: 200, amount_paid: 200, balance_due: 0,
    outlet: { name: 'MG Road', address: '12 MG Road', city: 'Bengaluru', gstin: '29ABCDE1234F1Z5' },
    items: [{ description: 'Parle-G Biscuit', quantity: 2, unit_price: 10, discount: 0, tax_rate: 5, line_total: 21 }, { description: 'Tata Tea Gold 500g economy pack', quantity: 1.5, unit_price: 120, discount: 0, tax_rate: 5, line_total: 189 }],
    payments: [{ method: 'CASH', amount: 200 }]
  };
  const text = receiptText(inv, 'Shop');
  for (const want of ['Shop', 'MG Road', '12 MG Road, Bengaluru', 'GSTIN 29ABCDE1234F1Z5', 'INV-0042', '2026-10-07', 'Asha', 'Parle-G Biscuit', '2 x ₹10.00', '1.5 x ₹120.00', 'Discount', '-₹10.00', 'GST', '₹9.50', 'Round off', 'TOTAL', '₹200.00', 'CASH', 'Thank you']) assert.ok(text.includes(want), `missing ${want}`);
  assert.equal(text.includes('Balance due'), false);
  for (const line of text.split('\n')) if (!line.includes('Tata Tea')) assert.ok(line.length <= 32, `too wide: ${line}`);
  assert.ok(receiptText({ ...inv, balance_due: 50 }, 'Shop').includes('Balance due'));
});
