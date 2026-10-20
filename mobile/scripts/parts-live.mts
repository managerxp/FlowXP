/* Drives the spare parts screens on a running server with the app's own paths and request builders: find by OEM number, part detail, vehicle search, look in a bin, put away, move, receive.
   node --experimental-strip-types --no-warnings scripts/parts-live.mts   (API on :5100, seeded with `npm run seed:autoparts` in backend/) */
import { createApi, type Session } from '../src/lib/api.ts';
import {
  addRecvLine, binByCode, lookupPath, moveBody, moveProblem, pickOrder, placePath, putAwayBody, putAwayProblem, recvBody, recvProblem, storingBins, vehiclePartsPath,
  type PartDetail, type PartLocations, type PartRow, type Place, type RecvLine, type StorePlace, type VehicleMake, type VehiclePart, type Waiting
} from '../src/lib/parts.ts';

const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: 'http://localhost:5100', getSession: () => session, onToken: (t) => { session.token = t; } });
const RUN = Date.now();
let step = 0;
const ok = (what: string, extra = '') => console.log(`ok ${++step}. ${what}${extra ? ` (${extra})` : ''}`);
const must = (cond: unknown, what: string) => { if (!cond) throw new Error(`FAILED: ${what}`); };

const login = await api.post<{ token: string }>('/auth/login', { email: 'autoparts@flowxp.test', password: 'demo1234' }, { signIn: true });
session.token = login.token;
const me = await api.get<{ businesses: { business_id: number; outlets: { branch_id: number }[] }[] }>('/auth/me');
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
ok('signed in');

// find by an OEM number typed without dashes or in lower case
const byOem = await api.get<PartRow[]>(lookupPath('5551168k00') as string);
must(byOem.length >= 1 && byOem[0].oem_part_no === '5551168K00', 'OEM number found');
ok('found by OEM number', `${byOem[0].name}, matched on ${byOem[0].matched_on}`);
const byWords = await api.get<PartRow[]>(lookupPath('brake pad') as string);
must(byWords.length >= 2, 'found by words');
ok('found by words', `${byWords.length} parts`);

// the part, where it is, what it fits
const part = await api.get<PartDetail>(`/autoparts/parts/${byOem[0].product_id}`);
must(part.numbers.length >= 1 && part.fitment.length >= 1, 'numbers and fitment');
const where = await api.get<PartLocations>(`/autoparts/parts/${part.product_id}/locations`);
ok('part detail', `${part.numbers.length} numbers, ${part.fitment.length} vehicles, ${where.bins.length} bins, ${where.unassigned} waiting`);

// parts for a vehicle: every row is labelled, none is "does not fit"
const tree = await api.get<VehicleMake[]>('/autoparts/vehicles');
const swift = tree.flatMap((m) => m.models).find((m) => m.name === 'Swift');
must(swift, 'Swift in the vehicle list');
const forSwift = await api.get<VehiclePart[]>(vehiclePartsPath(swift!.model_id, '2019', ''));
must(forSwift.length > 0 && forSwift.every((p) => p.fitment === 'VERIFIED' || p.fitment === 'UNVERIFIED'), 'labelled fitment');
ok('parts for a Swift', `${forSwift.length} parts, ${forSwift.filter((p) => p.fitment === 'UNVERIFIED').length} not verified`);

// the storeroom
const places = await api.get<StorePlace[]>('/autoparts/locations');
const bins = storingBins(places);
must(bins.length >= 2, 'bins');
const typed = binByCode(bins, ` ${bins[0].code.toLowerCase()} `);
must(typed?.location_id === bins[0].location_id, 'bin found by typed code');
const inside = await api.get<Place | null>(placePath(bins[0].code));
must(inside && inside.code === bins[0].code, 'bin contents');
ok('looked in a bin', `${inside!.code}: ${inside!.parts.length} parts`);
const miss = await api.get<Place | null>(placePath('NO-SUCH-BIN'));
must(miss === null, 'unknown bin is empty');
ok('an unknown bin code finds nothing');

// put away something that is waiting
const waiting = await api.get<Waiting[]>('/autoparts/warehouse/unassigned');
must(waiting.length > 0, 'something waiting for a bin');
const w = waiting[0];
const target = bins.find((b) => !b.capacity_units || b.capacity_units > 0)!;
must(putAwayProblem('0', w.unassigned, target.location_id) !== '', 'zero refused before sending');
must(putAwayProblem(String(w.unassigned + 5), w.unassigned, target.location_id) !== '', 'more than waiting refused before sending');
const qty = String(Math.min(2, w.unassigned));
const key = `pa-${RUN}`;
const put = await api.post<{ replayed: boolean; unassigned: number }>('/autoparts/warehouse/put-away', putAwayBody(w.product_id, target.location_id, qty, key), { idempotencyKey: key });
const again = await api.post<{ replayed: boolean }>('/autoparts/warehouse/put-away', putAwayBody(w.product_id, target.location_id, qty, key), { idempotencyKey: key });
void again;
const after = await api.get<PartLocations>(`/autoparts/parts/${w.product_id}/locations`);
must(after.unassigned === w.unassigned - Number(qty), 'put away once, not twice');
ok('put away, a retry did nothing more', `${w.name}: ${qty} into ${target.code}, ${after.unassigned} still waiting`);

// move between bins
const from = pickOrder(after.bins)[0];
const other = bins.find((b) => b.location_id !== from.location_id)!;
must(moveProblem(from.location_id, from.location_id, '1', from.available) !== '', 'same bin refused before sending');
const mv = String(Math.min(1, from.available));
const mkey = `mv-${RUN}`;
await api.post('/autoparts/warehouse/move', moveBody(w.product_id, from.location_id, other.location_id, mv, mkey), { idempotencyKey: mkey });
const moved = await api.get<PartLocations>(`/autoparts/parts/${w.product_id}/locations`);
must(moved.on_hand === after.on_hand && moved.binned === after.binned, 'a move changes where, not how many');
ok('moved between bins, the totals did not change', `${from.code} to ${other.code}`);

// receive: arrived, damaged, rejected; one straight into a bin
const suppliers = await api.get<{ supplier_id: number; name: string }[]>('/suppliers');
const pick = byWords.slice(0, 2);
let lines: RecvLine[] = [];
for (const p of pick) lines = addRecvLine(lines, p);
lines = lines.map((l, i) => ({ ...l, received: '10', damaged: i === 0 ? '2' : '', rejected: i === 0 ? '1' : '', binId: i === 1 ? bins[0].location_id : null, binCode: null }));
must(recvProblem(null, lines) !== '', 'no supplier refused before sending');
must(recvProblem(suppliers[0].supplier_id, lines) === '', 'receipt valid');
const before = await api.get<PartDetail>(`/autoparts/parts/${pick[0].product_id}`);
const inv = `LIVE-${RUN}`;
const rkey = `rc-${RUN}`;
const rec = await api.post<{ grn_number: string; putaway_tasks: number[] }>('/autoparts/grns', recvBody(suppliers[0].supplier_id, inv, lines), { idempotencyKey: rkey });
const rec2 = await api.post<{ grn_number: string }>('/autoparts/grns', recvBody(suppliers[0].supplier_id, inv, lines), { idempotencyKey: rkey });
must(rec2.grn_number === rec.grn_number, 'a retried receipt is the same receipt');
const stockAfter = await api.get<PartDetail>(`/autoparts/parts/${pick[0].product_id}`);
must((stockAfter.stock ?? 0) - (before.stock ?? 0) === 7, 'only the accepted 7 became stock');
ok('received: 10 arrived = 7 accepted + 2 damaged + 1 rejected', `${rec.grn_number}, ${rec.putaway_tasks.length} wait for a bin`);
let refused = '';
try { await api.post('/autoparts/grns', recvBody(suppliers[0].supplier_id, inv, lines), { idempotencyKey: `rc2-${RUN}` }); } catch (e) { refused = (e as Error).message; }
must(refused, 'the same supplier invoice is refused');
ok('the same supplier invoice cannot be booked twice', refused);

const rec3 = await api.get<{ ok: boolean }>('/autoparts/warehouse/reconcile');
must(rec3.ok === true, 'shelf quantities agree with stock');
ok('the shelf agrees with the stock');
console.log('ALL STEPS PASSED');
