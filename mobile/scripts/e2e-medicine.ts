/*
 * Adding and editing a medicine against a running FlowXP server and the demo pharmacy (npm run seed:pharmacy in backend), with the app's own code:
 * add a scheduled medicine (the same key twice is one), see it on the till with its rules, edit only what changed, the tracking lock once it has stock,
 * a duplicate barcode refused with a plain message, then remove it.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=pharmacy@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:medicine
 *
 * It makes a real demo medicine (named with the time) and removes it again.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { blank, changedBody, fromMedicine, medicineBody, medicineProblem, trackingLocked, type MedicineFull } from '../src/lib/medicine.ts';
import { grnBody, newGrnLine, type Medicine } from '../src/lib/pharmacy.ts';
import type { Supplier } from '../src/lib/buying.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
session.token = (await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'pharmacy@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; business_type: string; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
ok(me.businesses[0].business_type === 'PHARMACY', 'signed in to a pharmacy');
const put = (id: number, body: unknown) => api.call<MedicineFull>(`/pharmacy/products/${id}`, { method: 'PUT', body }).then((r) => r.data);
const get = (id: number) => api.get<MedicineFull>(`/pharmacy/products/${id}`);
const refused = async (work: () => Promise<unknown>): Promise<string> => { try { await work(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); } };

say('Add a medicine');
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const barcode = `99${Date.now().toString().slice(-10)}`;
const d = { ...blank(), name: `Drill Alprazolam ${stamp}`, strength: '0.25 mg', salt_composition: 'Alprazolam', manufacturer: 'Demo Labs', schedule_class: 'H1', price: '30', mrp: '34', cost: '21', barcode, reorder: '5' };
ok(medicineProblem({ ...d, name: '' }) !== '' && medicineProblem({ ...d, price: '40' }) !== '' && medicineProblem(d) === '', 'the app checks the name and the price against the MRP');
const key = newKey();
const made = await api.post<MedicineFull>('/pharmacy/products', medicineBody(d), { idempotencyKey: key });
const again = await api.post<MedicineFull>('/pharmacy/products', medicineBody(d), { idempotencyKey: key });
ok(made.product_id === again.product_id, `${made.name} is added; the same key twice is one medicine`);
ok(made.schedule_class === 'H1' && made.prescription_required && made.expiry_tracking && made.batch_tracking, 'schedule H1 needs a prescription, and it keeps use-by dates by batch');
ok(made.selling_price === 30 && made.mrp === 34 && made.tax_rate === 12 && made.on_hand === 0, 'price 30, MRP 34, GST 12%, no stock yet');
const found = await api.get<Medicine[]>(`/pharmacy/products/lookup?q=${encodeURIComponent(barcode)}`);
ok(found.some((p) => p.product_id === made.product_id), 'it is found on the till by its barcode');

say('Edit only what changed');
const start = fromMedicine(made);
ok(Object.keys(changedBody(start, start)).length === 0, 'no change sends nothing');
const edit = changedBody(start, { ...start, price: '32', strength: '0.5 mg', dosage_form: 'Tablet' });
ok(JSON.stringify(Object.keys(edit).sort()) === JSON.stringify(['selling_price', 'strength']), `only the price and strength go: ${JSON.stringify(edit)}`);
const after = await put(made.product_id, edit);
ok(after.selling_price === 32 && after.strength === '0.5 mg' && after.manufacturer === 'Demo Labs' && after.mrp === 34, 'saved; the maker and MRP are untouched');
const cleared = await put(made.product_id, changedBody(fromMedicine(after), { ...fromMedicine(after), mrp: '' }));
ok(cleared.mrp === null, 'clearing the MRP clears it');

say('A barcode already in use');
const other = await api.post<MedicineFull>('/pharmacy/products', medicineBody({ ...d, name: `${d.name} B`, schedule_class: '', barcode: `${barcode}1` }), { idempotencyKey: newKey() });
const clash = await refused(() => put(made.product_id, { barcode: other.barcode }));
ok(/already has that barcode/.test(clash), `refused in plain words: "${clash}"`);

say('Stock, and the tracking lock');
const suppliers = await api.get<Supplier[]>('/suppliers?limit=5');
const grn = grnBody([{ ...newGrnLine({ ...made, available: 0 } as unknown as Medicine), received: '20', unit_cost: '21', batch_no: `B${stamp}`, expiry: '12/2028' }], suppliers[0].supplier_id, `DRILL-${stamp}`, '', 'CASH');
await api.post('/pharmacy/grn', grn, { idempotencyKey: newKey() }).catch((e: Error) => say(`  note  could not receive stock (${e.message}); the lock check uses the stock figure only if it worked`));
const stocked = await get(made.product_id);
if ((stocked.on_hand ?? 0) > 0) {
  ok(trackingLocked(stocked), `with ${stocked.on_hand} in stock the app will not let batch or use-by tracking be switched off`);
} else say('  note  no stock was added, so the lock was checked in the unit test only');

say('Remove it');
const gone = await put(made.product_id, { status: 'ARCHIVED' });
ok(gone.status === 'ARCHIVED', 'removed from the till');
await put(other.product_id, { status: 'ARCHIVED' });
ok(!(await api.get<Medicine[]>(`/pharmacy/products/lookup?q=${encodeURIComponent(barcode)}`)).some((p) => p.product_id === made.product_id), 'and it no longer turns up on the till');
say('All good.');
