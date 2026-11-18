/* The printed job card: workshop copy on top, a cut line, the customer's copy underneath. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { jobCardHtml } from '../src/lib/jobCardPrint.ts';
import { splitPlan } from '../src/lib/billing.ts';
import { saleBody } from '../src/lib/cart.ts';
import type { JobFull } from '../src/lib/jobCards.ts';

const job = { job_id: 1, job_no: 'JC-7', status: 'OPEN', customer_id: 2, customer_name: 'Ravi <b>', customer_phone: '9876543210', vehicle_reg: 'KA01AB1234', vehicle_type: 'CAR', make: 'Maruti', model: 'Swift', mechanic_name: 'Anil', promised_on: '2026-11-20', total_paise: 0, parts: 1,
  model_id: null, vehicle_year: 2021, odometer_km: 41000, complaint: 'Brake noise', mechanic_id: null, next_service_on: null, invoice_id: null, earlier_visits: 0,
  lines: [{ line_id: 1, kind: 'PART', product_id: 5, description: 'Brake pad', sku: 'BP-1', quantity: 2, unit_price_paise: 50000, tax_rate: 18, held: true, fitment: null, amount_paise: 100000 }],
  estimate: { parts_paise: 100000, labour_paise: 0, tax_paise: 18000, total_paise: 118000 } } as unknown as JobFull;

test('the sheet has a workshop copy, a cut line and a customer copy, in that order', () => {
  const h = jobCardHtml(job, { name: 'Sri Garage' }, new Date('2026-11-18'));
  const w = h.indexOf('WORKSHOP COPY'), c = h.indexOf('cut here'), u = h.indexOf('CUSTOMER COPY');
  assert.ok(w > 0 && c > w && u > c);
  assert.match(h, /size: A4/);
  assert.match(h, /KA01AB1234/);
  assert.match(h, /Brake noise/);
});

test('the workshop copy has no prices; the customer copy has the estimate; customer text is escaped', () => {
  const h = jobCardHtml(job, { name: 'Sri Garage' });
  const [shop, cust] = [h.slice(h.indexOf('WORKSHOP COPY'), h.indexOf('cut here')), h.slice(h.indexOf('CUSTOMER COPY'))];
  assert.ok(!/Amount/.test(shop));
  assert.match(cust, /Estimate \(with GST\)/);
  assert.ok(!h.includes('Ravi <b>'));
  assert.match(h, /Ravi &lt;b&gt;/);
});

test('a split: every part but the last needs an amount, the last takes the rest, and it must not cover the bill already', () => {
  const ok = splitPlan([{ method: 'CASH', amount: '300' }, { method: 'UPI', amount: '' }], 100000);
  assert.deepEqual(ok, { ok: true, problem: '', parts: [{ method: 'CASH', amountPaise: 30000 }, { method: 'UPI', amountPaise: null }] });
  assert.equal(splitPlan([{ method: 'CASH', amount: '' }, { method: 'UPI', amount: '' }], 100000).ok, false);
  assert.equal(splitPlan([{ method: 'CASH', amount: '1000' }, { method: 'UPI', amount: '' }], 100000).ok, false);
  assert.equal(splitPlan([{ method: 'CASH', amount: '10' }], 100000).ok, false);
});

test('a split sale sends a payments list with the last part as REST, and no single payment', () => {
  const body = saleBody({ lines: [] } as never, { method: 'CASH', parts: [{ method: 'CASH', amountPaise: 30000 }, { method: 'UPI', amountPaise: null }] }) as Record<string, unknown>;
  assert.deepEqual(body.payments, [{ method: 'CASH', amount: 300 }, { method: 'UPI', amount: 'REST' }]);
  assert.equal(body.payment, undefined);
});
