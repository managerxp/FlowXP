/* Removes texts from every language's screens.json that no screen asks for any more (left behind when a text is reworded or merged). Run after scripts/i18n-extract.mjs.
   node scripts/i18n-prune.mjs */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../src');
const LOC = path.join(SRC, 'i18n/locales');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'locales' ? [] : walk(path.join(dir, e.name))) : /\.jsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
const used = new Set();
for (const file of walk(SRC)) for (const m of fs.readFileSync(file, 'utf8').matchAll(/\b(?:tr|T)\(\s*'((?:[^'\\\n]|\\.)*)'/g)) used.add(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
let removed = 0;
for (const code of fs.readdirSync(LOC)) {
  const f = path.join(LOC, code, 'screens.json');
  if (!fs.existsSync(f)) continue;
  const all = JSON.parse(fs.readFileSync(f, 'utf8'));
  const kept = Object.fromEntries(Object.entries(all).filter(([k]) => used.has(k)));
  if (code === 'en') removed = Object.keys(all).length - Object.keys(kept).length;
  fs.writeFileSync(f, JSON.stringify(kept, null, 2) + '\n');
}
console.log(`removed ${removed} unused texts; ${used.size} texts in use`);
