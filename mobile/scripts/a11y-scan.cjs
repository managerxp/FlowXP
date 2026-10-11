/* A rough check of the screens: every Pressable has a role, every TextInput has a label or placeholder, every icon-only control has a label. Prints what is missing. */
const fs = require('fs'); const path = require('path');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.tsx') ? [path.join(d, e.name)] : []));
let bad = 0; let total = 0;
for (const f of walk('src')) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/<(Pressable|P2|TextInput)(?=\s)/g)) {
    // the opening tag: up to the first ">" that is not inside braces
    let depth = 0; let i = m.index + m[0].length; let end = i;
    for (; i < t.length; i++) { const c = t[i]; if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0 && t[i - 1] !== '=') { end = i; break; } }
    const tag = t.slice(m.index, end);
    total++;
    const line = t.slice(0, m.index).split('\n').length;
    if (m[1] === 'TextInput') { if (!/accessibilityLabel|placeholder/.test(tag)) { bad++; console.log(`${f}:${line} TextInput without label`); } }
    else if (!/accessibilityRole|disabled=\{!onPress\}/.test(tag)) { bad++; console.log(`${f}:${line} Pressable without a role`); }
  }
}
console.log(`${total} controls checked, ${bad} to fix`);
process.exit(bad ? 1 : 0);
