/* Drives the lounge board on a running server with the app's own paths and request builders: board, start (a retry starts once), pause, resume, frame count, stop, undo, cancel a mistake.
   node --experimental-strip-types --no-warnings scripts/gaming-live.mts   (API on :5100, seeded with `npm run seed:gaming` in backend/) */
import { createApi, type Session } from '../src/lib/api.ts';
import { clock, countBy, liveCharge, liveElapsed, startBody, startProblem, stations, stopBody, type Board, type Bundle, type Station } from '../src/lib/gaming.ts';

const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: 'http://localhost:5100', getSession: () => session, onToken: (t) => { session.token = t; } });
const RUN = Date.now();
let step = 0;
const ok = (what: string, extra = '') => console.log(`ok ${++step}. ${what}${extra ? ` (${extra})` : ''}`);
const must = (cond: unknown, what: string) => { if (!cond) throw new Error(`FAILED: ${what}`); };

const login = await api.post<{ token: string }>('/auth/login', { email: 'gaming@flowxp.test', password: 'demo1234' }, { signIn: true });
session.token = login.token;
const me = await api.get<{ businesses: { business_id: number; outlets: { branch_id: number }[] }[] }>('/auth/me');
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
ok('signed in');

const load = async () => stations(await api.get<Board>('/gaming/board'));
let all = await load();
ok('board', `${all.length} stations: ${countBy(all, 'RUNNING')} playing, ${countBy(all, 'PAUSED')} paused, ${countBy(all, 'AVAILABLE')} free, ${countBy(all, 'TO_BILL')} to bill`);
const get = (id: number): Station => all.find((s) => s.station_id === id) as Station;

const free = all.filter((s) => s.state === 'AVAILABLE');
must(free.length >= 2, 'two free stations');
const [a, b] = free;
const bundles = await api.get<Bundle[]>('/gaming/bundles?kind=SESSION');
ok('offers for the lounge', `${bundles.length}`);

must(startProblem(a, { players: a.max_players + 1, how: 'OPEN', bundleId: null, alarm: '' }) !== '', 'too many players refused before sending');
const form = { players: 2, how: 'OPEN' as const, bundleId: null, alarm: '60' };
must(startProblem(a, form) === '', 'form valid');
const key = `gs-${RUN}`;
const s1 = await api.post<{ session_id: number }>('/gaming/sessions', startBody(a, form), { idempotencyKey: key });
const s1again = await api.post<{ session_id: number }>('/gaming/sessions', startBody(a, form), { idempotencyKey: key });
must(s1.session_id === s1again.session_id, 'a retried start is one session');
all = await load();
must(get(a.station_id).state === 'RUNNING' && get(a.station_id).session, 'running');
ok('started with an alarm; a retry did not start a second', `${a.name}, session ${s1.session_id}`);
const sv = get(a.station_id).session!;
must(sv.remaining_seconds != null && sv.remaining_seconds > 3000 && sv.remaining_seconds <= 3600, 'time left from the alarm');
ok('the clock', `${clock(sv.remaining_seconds as number)} left, ${clock(liveElapsed(sv, 5))} played after 5 s, charge so far ${liveCharge(sv, 600).toFixed(2)}`);

await api.call(`/gaming/sessions/${s1.session_id}/pause`, { method: 'POST', body: {} });
all = await load(); must(get(a.station_id).state === 'PAUSED', 'paused');
ok('paused');
await api.call(`/gaming/sessions/${s1.session_id}/resume`, { method: 'POST', body: {} });
all = await load(); must(get(a.station_id).state === 'RUNNING', 'resumed');
ok('resumed');

// stop and bill
await api.post(`/gaming/sessions/${s1.session_id}/stop`, stopBody(false, ''), { idempotencyKey: `st-${RUN}` });
all = await load();
const stoppedState = get(a.station_id).state;
// a session stopped within seconds has nothing to charge, so the station is simply free again; one that has run longer waits to be paid
must(stoppedState === 'AVAILABLE' || (stoppedState === 'TO_BILL' && get(a.station_id).order_id), 'stopped: free again, or to bill with a tab');
ok('stopped', stoppedState === 'AVAILABLE' ? 'under the grace time, nothing to charge' : 'the time is on the tab, ready to pay');
const waiting = all.find((x) => x.state === 'TO_BILL' && x.station_id !== a.station_id);
must(!waiting || (waiting.order_id && (waiting.tab?.total_paise ?? 0) > 0 && waiting.session), 'a station waiting to be paid has its tab and a total');
ok('a station waiting to be paid has its tab', waiting ? `${waiting.name}: ${(waiting.tab?.total_paise ?? 0) / 100} to collect, order ${waiting.order_id}` : 'none today');
if (stoppedState === 'TO_BILL') {
  await api.call(`/gaming/sessions/${s1.session_id}/reopen`, { method: 'POST', body: {} });
  all = await load(); must(get(a.station_id).state === 'RUNNING', 'undo stop');
  ok('stop taken back, the timer runs again');
  await api.post(`/gaming/sessions/${s1.session_id}/stop`, stopBody(false, ''), { idempotencyKey: `st2-${RUN}` });
  ok('stopped again');
}

// a mistaken start is cancelled with a reason and charges nothing
const s2 = await api.post<{ session_id: number }>('/gaming/sessions', startBody(b, { players: 1, how: 'OPEN', bundleId: null, alarm: '' }), { idempotencyKey: `gs2-${RUN}` });
let refused = '';
try { await api.post(`/gaming/sessions/${s2.session_id}/stop`, { void: true, reason: '' }, { idempotencyKey: `v0-${RUN}` }); } catch (e) { refused = (e as Error).message; }
must(refused, 'a cancel without a reason is refused by the server too');
await api.post(`/gaming/sessions/${s2.session_id}/stop`, stopBody(true, 'Wrong station'), { idempotencyKey: `v1-${RUN}` });
all = await load(); must(get(b.station_id).state === 'AVAILABLE', 'cancelled station is free again');
ok('started by mistake: cancelled with a reason, the station is free again');

// leave the demo tidy: the first station is paid for on the web; free it by cancelling nothing more here
console.log('ALL STEPS PASSED');
