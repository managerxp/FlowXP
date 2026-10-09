/* Lists every route the API has (method, full path, whether it needs sign-in) and writes it as JSON for the other scripts.
   node scripts/security/routes.mjs scripts/security/routes.json */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
import fs from 'node:fs';
const { default: routes } = await import(pathToFileURL(path.join(root, 'src/routes/index.js')).href);
const { requireAuth } = await import(pathToFileURL(path.join(root, 'src/middleware/auth.js')).href);
const mountOf = (layer) => {
  const src = layer.regexp?.source ?? '';
  if (src === '^\\/?(?=\\/|$)') return '';
  return src.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\\\//g, '/');
};
const out = [];
const walk = (stack, base, inherited) => {
  let local = [...inherited];
  for (const layer of stack) {
    if (layer.route) {
      const chain = [...local, ...layer.route.stack.map((l) => l.handle)];
      for (const m of Object.keys(layer.route.methods)) out.push({ method: m.toUpperCase(), path: base + layer.route.path, auth: chain.includes(requireAuth) });
    } else if (layer.name === 'router' && layer.handle?.stack) walk(layer.handle.stack, base + mountOf(layer), local);
    else if (layer.handle === requireAuth) local = [...local, requireAuth];
  }
};
walk(routes.stack, '/api', []);
fs.writeFileSync(process.argv[2], JSON.stringify(out));
console.log(out.length, 'routes,', out.filter((r) => !r.auth).length, 'public');
console.log(out.filter((r) => !r.auth).map((r) => r.method + ' ' + r.path).join('\n'));
process.exit(0);
