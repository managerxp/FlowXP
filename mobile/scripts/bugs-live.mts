/* The bug-report path end to end on a running server: a signed-in person's report (with the app's own builders), a crash report, then the admin side reading, filtering and handling them.
   node --experimental-strip-types --no-warnings scripts/bugs-live.mts   (API on :5100, demo shop seeded with `npm run seed:autoparts`; makes a dev admin account "bugs-admin@flowxp.test")
   The admin is created straight in the dev database (the same way the seeds create users); the console's own sign-in and two-step rules are the server's. */
import { execFileSync } from 'node:child_process';
import { createApi, ApiError, type Session } from '../src/lib/api.ts';
import { reportBody, reportProblem } from '../src/lib/bugreport.ts';

const app: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: 'http://localhost:5100', getSession: () => app, onToken: (t) => { app.token = t; } });
const admin: Session = { token: null, businessId: null, branchId: null };
const adminApi = createApi({ baseUrl: 'http://localhost:5100', getSession: () => admin, onToken: (t) => { admin.token = t; } });
const RUN = Date.now();
let step = 0;
const ok = (what: string, extra = '') => console.log(`ok ${++step}. ${what}${extra ? ` (${extra})` : ''}`);
const must = (cond: unknown, what: string) => { if (!cond) throw new Error(`FAILED: ${what}`); };
const refused = async (p: Promise<unknown>): Promise<ApiError | null> => { try { await p; return null; } catch (e) { return e instanceof ApiError ? e : null; } };

// a dev admin account
execFileSync('node', ['-e', `
  import('./src/config/database.js').then(async ({ default: pool }) => {
    const bcrypt = (await import('bcryptjs')).default;
    const hash = await bcrypt.hash('demo-admin-1234', 10);
    await pool.query("INSERT INTO users (name, email, password_hash, email_verified, is_super_admin) VALUES ('Bug Admin','bugs-admin@flowxp.test',$1,TRUE,TRUE) ON CONFLICT (email) DO UPDATE SET password_hash = $1, is_super_admin = TRUE", [hash]);
    await pool.end();
  });`], { cwd: 'D:/ManagerXp/flowxp/backend', stdio: 'pipe' });

// the person in the app
const login = await api.post<{ token: string }>('/auth/login', { email: 'autoparts@flowxp.test', password: 'demo1234' }, { signIn: true });
app.token = login.token;
const me = await api.get<{ businesses: { business_id: number; name: string; outlets: { branch_id: number }[] }[] }>('/auth/me');
app.businessId = me.businesses[0].business_id; app.branchId = me.businesses[0].outlets[0].branch_id;
ok('signed in as a shop owner in the app');

must(reportProblem('short') !== '', 'a too-short report is stopped on the phone');
const none = await refused(createApi({ baseUrl: 'http://localhost:5100', getSession: () => ({ token: null, businessId: null, branchId: null }) }).post('/app-reports', reportBody({ category: 'BROKE', description: 'Not signed in so this cannot be filed.' })));
must(none && none.status === 401, 'a report needs a sign-in');
const tooShort = await refused(api.post('/app-reports', { category: 'BROKE', description: 'short' }));
must(tooShort && tooShort.status === 400, 'the server refuses a too-short report too');
ok('a report needs a sign-in and a few words, on the phone and on the server');

const text = `Live check ${RUN}: the put-away list did not refresh after I shelved a part.`;
const filed = await api.post<{ report_id: number }>('/app-reports', reportBody({ category: 'BROKE', description: text, screen: '/parts-warehouse', version: '1.0.0 (1)', platform: 'android', os_version: '14', device: 'abc' }));
must(filed.report_id, 'a report id');
ok('a report was filed from the app', `#${filed.report_id}`);

const crashMsg = `Live check crash ${RUN}: Cannot read properties of undefined (reading 'name')`;
for (let i = 0; i < 2; i++) await api.post('/app-errors', { message: crashMsg, stack: 'at PartsScreen (parts.tsx:42)', screen: '/parts', fatal: true, version: '1.0.0 (1)', platform: 'android', os_version: '14', device: `ph${i}` }, { signIn: true });
ok('the app reported a crash twice, from two phones');

// the admin side
const a = await adminApi.post<{ token?: string; requires_2fa?: boolean }>('/admin/login', { email: 'bugs-admin@flowxp.test', password: 'demo-admin-1234' }, { signIn: true });
if (!a.token) { console.log('the console wants two-step verification here:', JSON.stringify(a)); process.exit(1); }
admin.token = a.token;
ok('signed in to the admin console');
const notAdmin = await refused(api.get('/admin/bug-reports'));
must(notAdmin && (notAdmin.status === 403 || notAdmin.status === 401), 'a shop owner cannot read the bug list');
ok('a shop owner cannot read the bug reports', `${notAdmin?.status}`);

const reports = await adminApi.get<{ report_id: number; description: string; user_email: string; business_name: string; status: string; category: string }[]>('/admin/bug-reports?status=NEW&limit=100');
const mine = reports.find((r) => r.report_id === filed.report_id);
must(mine && mine.description === text && mine.user_email === 'autoparts@flowxp.test' && mine.business_name === 'Sharma Auto Parts', 'the report shows who sent it');
ok('the admin sees the report with who sent it and which business', `${mine?.user_email}, ${mine?.business_name}`);
const crashes = await adminApi.get<{ message: string; times: number; devices: number; status: string; fatal: boolean }[]>('/admin/app-errors?status=NEW');
const crash = crashes.find((c) => c.message === crashMsg);
must(crash && crash.times === 2 && crash.devices === 2 && crash.fatal, 'the crash is grouped');
ok('the crash is grouped: 2 times on 2 phones', `fatal ${crash?.fatal}`);

const sum = await adminApi.get<{ new_reports: number; new_crashes: number }>('/admin/bug-summary');
must(sum.new_reports >= 1 && sum.new_crashes >= 1, 'the badge counts');
ok('the badge counts what is new', `${sum.new_reports} reports, ${sum.new_crashes} crashes`);

await adminApi.call(`/admin/bug-reports/${filed.report_id}`, { method: 'PATCH', body: { status: 'SEEN', note: 'Looking into it' } });
const seen = await adminApi.get<{ report_id: number; note: string }[]>('/admin/bug-reports?status=SEEN&limit=100');
must(seen.some((r) => r.report_id === filed.report_id && r.note === 'Looking into it'), 'moved to seen with a note');
ok('the report was moved to Seen with a note');
await adminApi.call('/admin/app-errors/status', { method: 'PATCH', body: { message: crashMsg, status: 'FIXED', note: 'fixed in 1.0.1' } });
must(!(await adminApi.get<{ message: string }[]>('/admin/app-errors?status=NEW')).some((c) => c.message === crashMsg), 'gone from New');
await api.post('/app-errors', { message: crashMsg, screen: '/parts', version: '1.0.0 (1)', platform: 'android', device: 'ph9' }, { signIn: true });
must((await adminApi.get<{ message: string }[]>('/admin/app-errors?status=NEW')).some((c) => c.message === crashMsg), 'back to New after it happened again');
ok('a crash marked Fixed that happens again comes back as New');
console.log('ALL STEPS PASSED');
