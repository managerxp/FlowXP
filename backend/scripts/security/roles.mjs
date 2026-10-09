/* node scripts/security/roles.mjs scripts/security/routes.json demo-kitchen@flowxp.test
   Broken access control sweep: a person with the weakest role calls every signed-in route, aimed at ids that do not exist (so nothing can change). Only 401/403 are good answers. */
import fs from 'node:fs';
const [,, routesFile, email, ...skipPrefixes] = process.argv;
const base = 'http://localhost:5100';
const routes = JSON.parse(fs.readFileSync(routesFile, 'utf8')).filter((r) => r.auth);
const r0 = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email, password: 'demo1234' }) });
const j0 = await r0.json(); const token = j0.data.token;
const me = (await (await fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + token } })).json()).data;
const b = me.businesses[0];
console.log('signed in as', email, '| role', b.role, '| allowed:', Object.entries(b.effective_permissions).filter(([, v]) => v).map(([k]) => k).join(',') || 'nothing');
const headers = { authorization: 'Bearer ' + token, 'x-business-id': String(b.business_id), 'x-branch-id': String(b.outlets[0].branch_id), 'x-requested-with': 'FlowXP', 'content-type': 'application/json' };
const tally = {}; const flagged = [];
for (const r of routes) {
  if (skipPrefixes.some((p) => r.path.startsWith(p))) continue;
  if (/\/admin\//.test(r.path) || r.path.startsWith('/api/auth/')) continue;
  const path = r.path.replace(/:[a-zA-Z]+/g, '999999999');
  const res = await fetch(base + path, { method: r.method, headers, body: ['GET', 'HEAD'].includes(r.method) ? undefined : '{}' }).catch(() => null);
  const status = res?.status ?? 0; tally[status] = (tally[status] || 0) + 1;
  if (![401, 403].includes(status)) { let msg = ''; try { msg = (await res.json()).message ?? ''; } catch { /* */ } flagged.push({ m: r.method, p: r.path, s: status, msg: String(msg).slice(0, 70) }); }
}
console.log('answers:', JSON.stringify(tally));
fs.writeFileSync(routesFile.replace('routes.json', 'bac-' + email.split('@')[0] + '.json'), JSON.stringify(flagged));
console.log('not forbidden:', flagged.length);
for (const f of flagged) console.log(`${String(f.s).padEnd(4)}${f.m.padEnd(7)}${f.p}  ${f.msg}`);
