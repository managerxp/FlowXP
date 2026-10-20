/* Drives the gym front desk on a running server with the app's own paths and request builders: the desk's numbers, finding a member, a lookup check-in, a repeat, a refused member, a scan of a pass that is not valid.
   node --experimental-strip-types --no-warnings scripts/gym-live.mts   (API on :5100, seeded with `npm run seed:gym` in backend/) */
import { createApi, type Session } from '../src/lib/api.ts';
import { deniedTotal, manualBody, membersPath, memberSub, needsConfirm, reasonOf, scanBody, type AccessResult, type GymDash, type Member } from '../src/lib/gym.ts';

const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: 'http://localhost:5100', getSession: () => session, onToken: (t) => { session.token = t; } });
const RUN = Date.now();
let step = 0;
const ok = (what: string, extra = '') => console.log(`ok ${++step}. ${what}${extra ? ` (${extra})` : ''}`);
const must = (cond: unknown, what: string) => { if (!cond) throw new Error(`FAILED: ${what}`); };

const login = await api.post<{ token: string }>('/auth/login', { email: 'gym@flowxp.test', password: 'demo1234' }, { signIn: true });
session.token = login.token;
const me = await api.get<{ businesses: { business_id: number; outlets: { branch_id: number }[] }[] }>('/auth/me');
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
ok('signed in');

const dash = await api.get<GymDash>('/gym/dashboard');
ok('desk numbers', `${dash.visits.open_now} in the gym, ${dash.visits.today} visits today, ${deniedTotal(dash)} turned away`);

must(membersPath('a') === null, 'one character is not a search');
const active = await api.get<Member[]>('/gym/members?state=ACTIVE&limit=5');
const expired = await api.get<Member[]>('/gym/members?state=EXPIRED&limit=5');
must(active.length > 0 && expired.length > 0, 'demo members');
const found = await api.get<Member[]>(membersPath(active[0].name.split(' ')[0]) as string);
must(found.some((m) => m.member_id === active[0].member_id), 'found by name');
ok('found a member by name', memberSub(found.find((m) => m.member_id === active[0].member_id) as Member));

const first = await api.post<AccessResult>('/gym/access/manual', manualBody(active[0].member_id, `gm-${RUN}`), { idempotencyKey: `gm-${RUN}` });
must((first.decision === 'APPROVED' || first.reason === 'DUPLICATE_SCAN') && first.member?.member_id === active[0].member_id, 'approved (or already in from an earlier run)');
ok('checked in by lookup', `${first.member?.name}, ${first.membership?.plan_name}, ${first.membership?.days_left} days left, ${first.decision}`);
const retry = await api.post<AccessResult>('/gym/access/manual', manualBody(active[0].member_id, `gm-${RUN}`), { idempotencyKey: `gm-${RUN}` });
must(retry.decision === first.decision, 'a retry of the same entry gives the same answer');
const second = await api.post<AccessResult>('/gym/access/manual', manualBody(active[0].member_id, `gm2-${RUN}`), { idempotencyKey: `gm2-${RUN}` });
ok('checking the same member in again', `${second.decision} ${reasonOf(second.reason).title}`);

// members whose plan has ended: refused, unless they are inside the gym's grace days (then let in, and the desk is told)
let refusedOne = false; let graceOne = false;
for (const m of expired.slice(0, 5)) {
  const r = await api.post<AccessResult>('/gym/access/manual', manualBody(m.member_id, `gx-${m.member_id}-${RUN}`), { idempotencyKey: `gx-${m.member_id}-${RUN}` });
  if (r.decision === 'DENIED') { refusedOne = true; ok('a member whose plan has ended is turned away with a reason', `${reasonOf(r.reason).title}: ${reasonOf(r.reason).next}`); must(!needsConfirm(r), 'no confirm for a plain refusal'); break; }
  if (r.in_grace) graceOne = true;
}
must(refusedOne || graceOne, 'an ended member is refused, or let in with the grace warning');
if (!refusedOne) ok('ended members were inside the grace days: let in with the grace warning');

const bad = await api.post<AccessResult>('/gym/access/scan', scanBody('NOT-A-PASS', `gs-${RUN}`), { idempotencyKey: `gs-${RUN}` });
must(bad.decision === 'DENIED' && bad.member === null, 'a pass that is not valid is refused without naming anyone');
ok('a pass that is not valid is refused', reasonOf(bad.reason).title);

const after = await api.get<GymDash>('/gym/dashboard');
must(after.visits.today >= dash.visits.today, 'visits did not go down');
must(deniedTotal(after) >= deniedTotal(dash) + 1, 'the refusals counted');
ok('the desk numbers moved', `visits ${dash.visits.today} to ${after.visits.today}, turned away ${deniedTotal(dash)} to ${deniedTotal(after)}`);
console.log('ALL STEPS PASSED');
