/* node scripts/security/tenants-sweep.mjs scripts/security/routes.json cafe@flowxp.test demo@flowxp.test
   Wider cross-tenant sweep: every signed-in GET route with exactly one id in it. Business A's id (found from A's own list) is requested by business B, for the whole path. */
import fs from 'node:fs';
const [,, routesFile, emailA, emailB] = process.argv;
const base = 'http://localhost:5100';
const routes = JSON.parse(fs.readFileSync(routesFile, 'utf8'));
const login = async (email) => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email, password: 'demo1234' }) });
  const j = await r.json(); if (!j.data?.token) throw new Error('login failed ' + email);
  const me = await (await fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + j.data.token } })).json();
  const b = me.data.businesses[0];
  return { token: j.data.token, biz: b.business_id, branch: b.outlets[0].branch_id, type: b.business_type };
};
const A = await login(emailA); const B = await login(emailB);
console.log('A =', emailA, A.type, A.biz, '| B =', emailB, B.type, B.biz);
const call = async (who, method, path, body) => {
  const r = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + who.token, 'x-business-id': String(who.biz), 'x-branch-id': String(who.branch), 'x-requested-with': 'FlowXP', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const getRoutes = new Set(routes.filter((r) => r.method === 'GET' && r.auth).map((r) => r.path));
const singular = (s) => s.replace(/ies$/, 'y').replace(/s$/, '');
const pickId = (item, seg) => {
  if (!item || typeof item !== 'object') return null;
  for (const k of [singular(seg).replace(/-/g, '_') + '_id', 'id']) if (Number.isInteger(item[k])) return item[k];
  const k = Object.keys(item).find((x) => x.endsWith('_id') && x !== 'business_id' && x !== 'branch_id' && Number.isInteger(item[x]));
  return k ? item[k] : null;
};
const rows = (listed) => { const d = listed.json?.data; return Array.isArray(d) ? d : (d && typeof d === 'object' ? (Object.values(d).find((v) => Array.isArray(v) && v.length && typeof v[0] === 'object') ?? null) : null); };
const targets = routes.filter((r) => r.auth && r.method === 'GET' && (r.path.match(/:/g) || []).length === 1 && !/\/admin\//.test(r.path));
const stat = { tested: 0, noList: 0, listStatus: {}, empty: 0, noId: 0, ownFail: 0 };
const leaks = []; const checked = [];
const idCache = new Map();
for (const t of targets) {
  const baseCollection = t.path.split('/:')[0];
  let id = idCache.get(baseCollection);
  if (id === undefined) {
    id = null;
    if (!getRoutes.has(baseCollection)) stat.noList++;
    else {
      const listed = await call(A, 'GET', baseCollection);
      if (listed.status !== 200) stat.listStatus[listed.status] = (stat.listStatus[listed.status] || 0) + 1;
      else { const arr = rows(listed); if (!arr?.length) stat.empty++; else { id = pickId(arr[0], baseCollection.split('/').pop()); if (id == null) stat.noId++; } }
    }
    idCache.set(baseCollection, id);
  }
  if (id == null) continue;
  const path = t.path.replace(/:[a-zA-Z]+/, encodeURIComponent(id));
  const own = await call(A, 'GET', path);
  if (own.status !== 200) { stat.ownFail++; continue; }
  stat.tested++; checked.push(path);
  const other = await call(B, 'GET', path);
  if (other.status === 200 && other.json?.data != null && !(Array.isArray(other.json.data) && other.json.data.length === 0)) leaks.push(`GET ${path} -> B got 200: ${JSON.stringify(other.json.data).slice(0, 100)}`);
}
console.log(JSON.stringify(stat), 'of', targets.length, 'single-id GET routes');
console.log(leaks.length ? 'LEAKS (' + leaks.length + '):\n' + leaks.join('\n') : 'No record of A was readable by B.');
console.log('checked:', checked.slice(0, 80).join(' '));
