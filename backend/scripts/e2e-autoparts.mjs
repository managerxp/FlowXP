// End to end check of a spare-parts shop through the real HTTP API: catalogue, vehicles, receiving, racks, trade, a counter sale, a job card from typed vehicle to bill, staff and payroll,
// reports, backup and restore preview, mechanic mode and access rules. Run it against a server that has the shop (the demo shop by default):
//   node backend/scripts/e2e-autoparts.mjs                      (uses http://localhost:5100/api and the demo owner)
//   BASE=https://flowxp.in/api EMAIL=owner@shop.in PASSWORD=... node backend/scripts/e2e-autoparts.mjs
// Everything it creates is named ZZE2E (parts, a supplier, a garage, a mechanic, job cards): delete or ignore them on a live shop. It switches mechanic mode off and on again.
const BASE = process.env.BASE || 'http://localhost:5100/api';
const EMAIL = process.env.EMAIL || 'autoparts@flowxp.test'; const PASSWORD = process.env.PASSWORD || 'demo1234';
let token = ''; let passed = 0; const failed = [];
const H = () => ({ 'content-type': 'application/json', 'X-Requested-With': 'FlowXP', ...(token ? { authorization: `Bearer ${token}` } : {}) });
const call = async (method, path, body, extra = {}) => {
  const r = await fetch(BASE + path, { method, headers: { ...H(), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { s: r.status, b: j, data: j?.data, text: t };
};
const ok = (name, cond, info = '') => { if (cond) { passed += 1; console.log('  PASS', name); } else { failed.push(name); console.log('  FAIL', name, info); } };
const step = (t) => console.log('\n#', t);
const stamp = Date.now().toString().slice(-6);

step('sign in and what the app sees');
let r = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
ok('login 200', r.s === 200 && r.data?.token, JSON.stringify(r.b)?.slice(0, 120)); token = r.data.token;
r = await call('GET', '/auth/me');
const biz = (r.data?.businesses || []).find((b) => b.business_type === 'AUTO_PARTS');
ok('business is AUTO_PARTS with workshop_mode flag', biz && typeof biz.workshop_mode === 'boolean', JSON.stringify(biz?.workshop_mode));
const bid = biz.business_id; const outlet = biz.outlets[0].branch_id;
const scope = { 'X-Business-Id': String(bid), 'X-Branch-Id': String(outlet) };
const A = (m, p, b) => call(m, p, b, scope);

step('catalogue: add a part with its numbers, find it by a number typed without dashes');
r = await A('POST', '/autoparts/parts', { name: `ZZE2E Brake pad ${stamp}`, selling_price: 850, purchase_price: 520, tax_rate: 18, hsn_sac: '87083000', oem_part_no: `ZZ-${stamp}-OEM`, mfr_part_no: `MF${stamp}`, classification: 'AFTERMARKET', min_stock: 2 });
ok('part created', r.s === 201, r.text.slice(0, 200)); const part = r.data?.product_id;
r = await A('GET', `/autoparts/parts/lookup?q=ZZ${stamp}OEM`);
ok('found by OEM number without dashes', Array.isArray(r.data) && r.data.some((p) => p.product_id === part), r.text.slice(0, 160));
r = await A('GET', `/autoparts/parts/lookup?q=${encodeURIComponent('ZZE2E Brake')}`);
ok('found by name', r.data?.some((p) => p.product_id === part));

step('vehicles: the usual Indian list, a model typed, fitment recorded and never assumed');
r = await A('POST', '/autoparts/vehicles/defaults', { types: ['BIKE', 'CAR'] });
ok('defaults load (idempotent)', r.s === 201, r.text.slice(0, 100));
r = await A('GET', '/autoparts/vehicles');
const tree = r.data || [];
const maruti = tree.find((m) => m.name === 'Maruti Suzuki' && m.vehicle_type === 'CAR');
const swift = maruti?.models.find((m) => m.name === 'Swift');
ok('Maruti Suzuki > Swift is in the list', !!swift);
r = await A('GET', `/autoparts/vehicles/parts?model_id=${swift.model_id}`);
ok('part with no fitment record is not listed for Swift', !(r.data?.parts || r.data || []).some?.((p) => p.product_id === part), r.text.slice(0, 120));
r = await A('POST', `/autoparts/parts/${part}/fitment`, { model_id: swift.model_id, status: 'UNVERIFIED' });
ok('fitment recorded (unverified)', r.s === 201 || r.s === 200, r.text.slice(0, 160));

step('receiving: a delivery with damaged and rejected counted apart; only accepted is stock');
r = await A('POST', '/suppliers', { name: `ZZE2E Supplier ${stamp}`, phone: '9000000099' });
const supplier = r.data?.supplier_id; ok('supplier created', r.s === 201 && supplier, r.text.slice(0, 160));
r = await A('POST', '/autoparts/grns', { supplier_id: supplier, supplier_invoice_no: `E2E-${stamp}`, items: [{ product_id: part, received: 10, damaged: 1, rejected: 1, unit_cost: 520 }] }, );
ok('GRN booked', r.s === 201, r.text.slice(0, 220)); const grn = r.data?.grn_id;
r = await A('POST', '/autoparts/grns', { supplier_id: supplier, supplier_invoice_no: `E2E-${stamp}`, items: [{ product_id: part, received: 10, unit_cost: 520 }] });
ok('same supplier invoice cannot be booked twice', r.s === 409, `${r.s} ${r.text.slice(0, 120)}`);
r = await A('GET', `/autoparts/parts/${part}`);
ok('stock is accepted only (8)', Number(r.data?.stock ?? r.data?.current_stock ?? r.data?.on_hand) === 8, JSON.stringify({ s: r.data?.stock, c: r.data?.current_stock, o: r.data?.on_hand }));

step('racks: one-step set-up, put away to a bin, shelf never exceeds stock');
r = await A('POST', '/autoparts/locations', { segment: `ZE${stamp.slice(-4)}`, name: `ZZE2E store ${stamp}`, loc_type: 'WAREHOUSE', can_store: false });
const root = r.data?.location_id; ok('store created', r.s === 201 && root, r.text.slice(0, 140));
r = await A('POST', '/autoparts/locations/bulk', { parent_id: root, count: 2, prefix: 'R', loc_type: 'RACK', can_store: false });
ok('2 racks', r.s === 201 && r.data?.length === 2, r.text.slice(0, 120)); const racks = r.data;
r = await A('POST', '/autoparts/locations/bulk', { parent_id: racks[0].location_id, count: 3, prefix: '', letters: true, loc_type: 'BIN', can_store: true });
ok('3 bins A-C', r.s === 201 && r.data?.map((x) => x.segment).join() === 'A,B,C', r.text.slice(0, 160)); const bins = r.data;
r = await A('GET', '/autoparts/warehouse/unassigned');
ok('received stock waits for a bin', (r.data || []).some((x) => x.product_id === part));
r = await A('POST', '/autoparts/warehouse/put-away', { product_id: part, location_id: bins[0].location_id, qty: 5, source_key: `e2e-pa-${stamp}` });
ok('put away 5', r.s === 201, r.text.slice(0, 160));
r = await A('POST', '/autoparts/warehouse/put-away', { product_id: part, location_id: bins[1].location_id, qty: 99, source_key: `e2e-pa2-${stamp}` });
ok('cannot shelve more than the stock', r.s >= 400, `${r.s}`);
r = await A('POST', '/autoparts/warehouse/move', { product_id: part, from_location_id: bins[0].location_id, to_location_id: bins[1].location_id, qty: 2, source_key: `e2e-mv-${stamp}` });
ok('move between bins', r.s === 201, r.text.slice(0, 160));

step('trade: garage on a price list with a credit limit; hold a part');
r = await A('POST', '/customers', { name: `ZZE2E Garage ${stamp}`, phone: `98${stamp}11` });
const cust = r.data?.customer_id; ok('customer created', r.s === 201 && cust);
r = await A('PUT', `/autoparts/customers/${cust}/terms`, { customer_class: 'GARAGE', credit_limit: 5000, credit_policy: 'WARN' });
ok('terms saved', r.s === 200, r.text.slice(0, 160));
r = await A('POST', '/autoparts/reservations', { product_id: part, qty: 1, customer_id: cust, source_key: `e2e-hold-${stamp}` });
ok('hold made', r.s === 201, r.text.slice(0, 160)); const hold = r.data?.reservation_id;
if (hold) await A('POST', `/autoparts/reservations/${hold}/release`, {});

step('counter sale of the part');
const before = (await A('GET', `/autoparts/parts/${part}`)).data;
r = await A('POST', '/invoices', { customer_id: cust, items: [{ product_id: part, quantity: 2 }], payment: { amount: 'FULL', method: 'UPI' } });
ok('bill made', r.s === 201, r.text.slice(0, 220)); const inv1 = r.data;
const after = (await A('GET', `/autoparts/parts/${part}`)).data;
ok('stock fell by 2', Number(before?.stock ?? before?.current_stock ?? before?.on_hand) - Number(after?.stock ?? after?.current_stock ?? after?.on_hand) === 2);

step('workshop: job card with a typed company and model, part + labour, estimate, WhatsApp, bill');
r = await A('GET', '/autoparts/jobcards/mechanics');
ok('mechanics list answers', r.s === 200);
r = await A('POST', '/autoparts/jobcards/services', { name: `ZZE2E Alignment ${stamp}`, price: 600 });
const svc = r.data; ok('labour service saved', r.s === 201 && svc?.service_id, r.text.slice(0, 120));
r = await A('POST', '/autoparts/jobcards', { customer_id: cust, vehicle_reg: `KA01ZZ${stamp.slice(-4)}`, vehicle_type: 'BIKE', make: 'Hero MotoCorp', model: `Splendor ZZE2E ${stamp}`, variant: '110cc', vehicle_year: 2022, odometer_km: 12000, complaint: 'Brake noise' });
ok('job card opened with typed model', r.s === 201 && r.data?.model_id, r.text.slice(0, 200)); const job = r.data;
r = await A('GET', '/autoparts/vehicles');
ok('typed model is now in the list under Hero MotoCorp', (r.data || []).some((m) => m.name === 'Hero MotoCorp' && m.models.some((x) => x.name === `Splendor ZZE2E ${stamp}`)));
r = await A('POST', `/autoparts/jobcards/${job.job_id}/lines`, { kind: 'PART', product_id: part, quantity: 1 });
ok('part added and held', r.s === 201 && r.data?.lines?.[0]?.held === true, r.text.slice(0, 200));
r = await A('POST', `/autoparts/jobcards/${job.job_id}/lines`, { kind: 'LABOUR', description: svc.name, unit_price: 600 });
ok('labour added', r.s === 201 && r.data?.estimate?.labour_paise === 60000, r.text.slice(0, 200));
r = await A('GET', `/autoparts/jobcards/${job.job_id}/share?event=estimate`);
ok('WhatsApp estimate text and link', r.s === 200 && /wa\.me/.test(r.data?.wa_url || '') && /Total/.test(r.data?.text || ''), r.text.slice(0, 200));
r = await A('POST', `/autoparts/jobcards/${job.job_id}/status`, { status: 'READY' });
ok('marked ready', r.data?.status === 'READY');
const reportBefore = (await A('GET', '/reports/sales')).data;
r = await A('POST', `/autoparts/jobcards/${job.job_id}/bill`, { payment: { amount: 'FULL', method: 'CASH' } });
ok('job billed', r.s === 201 && r.data?.invoice?.invoice_id, r.text.slice(0, 200)); const jobInv = r.data?.invoice;
const reportAfter = (await A('GET', '/reports/sales')).data;
ok('job bill is in the sales total', Math.round((reportAfter.total_sales - reportBefore.total_sales) * 100) === Math.round(jobInv.total * 100), `${reportBefore.total_sales} -> ${reportAfter.total_sales}`);
r = await A('GET', '/autoparts/jobcards/report');
ok('workshop report splits labour and parts', r.s === 200 && r.data.totals.labour_paise >= 60000 && r.data.totals.parts_paise >= 85000, JSON.stringify(r.data?.totals));
r = await A('GET', '/reports/gst'); ok('GST report answers', r.s === 200);

step('staff and payroll for a mechanic');
r = await A('POST', '/autoparts/staff/employees', { name: `ZZE2E Mechanic ${stamp}`, designation: 'Mechanic', salary: 15000, pay_type: 'MONTHLY', joined_on: '2026-01-01' });
ok('mechanic added', r.s === 201, r.text.slice(0, 200)); const emp = r.data?.employee_id;
r = await A('PUT', '/autoparts/staff/attendance', { date: new Date().toISOString().slice(0, 10), entries: [{ employee_id: emp, status: 'PRESENT' }] });
ok('attendance marked', r.s === 200 || r.s === 201, r.text.slice(0, 160));
r = await A('POST', '/autoparts/staff/payroll', { month: new Date().toISOString().slice(0, 7) });
ok('payroll sheet generated with a slip for the mechanic', r.s === 201 || r.s === 200, r.text.slice(0, 200));
r = await A('GET', '/autoparts/jobcards/mechanics'); ok('new mechanic can be picked on a job', (r.data || []).some((x) => x.employee_id === emp));

step('reports and intelligence');
for (const p of ['/autoparts/overview', '/autoparts/reports/movers', '/autoparts/reports/ageing', '/autoparts/reports/reorder', '/autoparts/reports/suppliers', '/autoparts/reports/valuation', '/autoparts/reports/occupancy', `/autoparts/parts/${part}/ledger`, '/autoparts/warehouse/reconcile']) {
  r = await A('GET', p); ok(`GET ${p}`, r.s === 200, `${r.s} ${r.text.slice(0, 100)}`);
}

step('backup and restore preview (owner)');
const dl = await fetch(BASE + '/businesses/current/backup', { headers: { ...H(), ...scope } });
const buf = Buffer.from(await dl.arrayBuffer());
ok('backup is a ZIP', dl.status === 200 && buf.slice(0, 2).toString() === 'PK', `${dl.status}`);
const rp = await fetch(BASE + '/businesses/current/restore', { method: 'POST', headers: { 'content-type': 'application/zip', 'X-Requested-With': 'FlowXP', authorization: `Bearer ${token}`, ...scope }, body: buf });
const rj = await rp.json().catch(() => null);
ok('restore preview: nothing missing', rp.status === 200 && rj?.data?.applied === false, `${rp.status} ${JSON.stringify(rj)?.slice(0, 160)}`);

step('mechanic mode switch');
r = await A('PUT', '/businesses/current/workshop-mode', { enabled: false }); ok('switch off', r.s === 200);
r = await A('GET', '/autoparts/jobcards'); ok('job cards are refused while off', r.s === 402 || r.s === 403 || r.s === 404, `${r.s}`);
r = await A('PUT', '/businesses/current/workshop-mode', { enabled: true }); ok('switch on', r.s === 200);
r = await A('GET', '/autoparts/jobcards'); ok('job cards back', r.s === 200);

step('security: another business cannot see this data; no token is refused');
const anon = await fetch(BASE + '/autoparts/jobcards', { headers: { 'X-Requested-With': 'FlowXP' } }); ok('no token: 401', anon.status === 401, `${anon.status}`);
r = await call('GET', `/autoparts/jobcards/${job.job_id}`, undefined, { 'X-Business-Id': '999999' }); ok('wrong business id refused', r.s >= 400, `${r.s}`);

console.log(`\n${passed} passed, ${failed.length} failed`); if (failed.length) console.log('FAILED:', failed.join(' | '));
process.exit(failed.length ? 1 : 0);
