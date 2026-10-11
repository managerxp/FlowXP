/*
 * Flow AI against a running FlowXP server and the demo café, with the app's own code: its status, and either one real question and a briefing (when the server has an AI key)
 * or the plain "not set up yet" message the screen shows (when it does not).
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:flowai
 */
import { createApi, type Session } from '../src/lib/api.ts';
import { blocks, friendlyError, questionsFor, unavailable, type AiChat, type AiStatus } from '../src/lib/flowai.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); console.log(`  ok  ${m}`); };
session.token = (await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'cafe@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;

const st = await api.get<AiStatus>('/ai/status');
ok(questionsFor(st).length > 0, `status read; offering: ${questionsFor(st).slice(0, 2).join(' / ')}`);
if (st.can_ask) {
  const r = await api.call<AiChat>('/ai/chat', { method: 'POST', body: { message: 'How much did I sell today?' }, timeoutMs: 90000 });
  ok(r.data.answer.length > 0 && blocks(r.data.answer).length > 0, `answered: ${r.data.answer.slice(0, 90).replace(/\n/g, ' ')}…`);
  const b = await api.call<AiChat>('/ai/briefing', { method: 'POST', body: {}, timeoutMs: 90000 });
  ok(b.data.answer.length > 0, 'the daily briefing works');
} else {
  const why = unavailable(st);
  ok(why !== null, `cannot be asked, and the screen says why: "${why?.title}": ${why?.body}`);
  let message = '';
  try { await api.call('/ai/chat', { method: 'POST', body: { message: 'hi' } }); } catch (e) { message = friendlyError(e); }
  ok(message !== '' && !/AI_|HTTP|server answered/.test(message), `asking anyway gives: "${message}"`);
}
console.log('All good.');
