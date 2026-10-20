/*
 * Converts screens to translatable form: plain English text in JSX, button/label/placeholder attributes, toasts, dialogs and error
 * setters becomes tr('English text'), each component gets `const tr = useT();`, and the English texts are added to
 * src/i18n/locales/en/screens.json (the keys every language must then have).
 *
 *   node scripts/i18n-extract.mjs            dry run on the files named below: prints what it would do
 *   node scripts/i18n-extract.mjs --write    changes the files
 *   node scripts/i18n-extract.mjs --write src/app/ProductsPage.jsx src/app/billing   (named files or folders; default: the list in CORE)
 *
 * It only touches text it can translate safely: a text mixed with {values} or inline elements in one sentence, a template literal with
 * values, and text outside a component are NOT changed and are listed in scripts/i18n-skipped.txt to be done by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import MagicString from 'magic-string';

const traverse = _traverse.default ?? _traverse;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'src');
const EN = path.join(SRC, 'i18n/locales/en/screens.json');
const WRITE = process.argv.includes('--write');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const CORE = [
  'src/app/Dashboard.jsx', 'src/app/billing', 'src/app/ProductsPage.jsx', 'src/app/InventoryPage.jsx', 'src/app/CustomersPage.jsx', 'src/app/OrdersPage.jsx',
  'src/app/PaymentsPage.jsx', 'src/app/ReportsPage.jsx', 'src/app/SecurityPage.jsx', 'src/app/StaffPage.jsx', 'src/app/BusinessSettings.jsx', 'src/app/OutletsPage.jsx',
  'src/app/ActivityPage.jsx', 'src/app/PurchasesPage.jsx', 'src/app/ReturnsPage.jsx', 'src/app/ExpensesPage.jsx', 'src/app/GstPage.jsx', 'src/app/NotificationsPage.jsx'
];
const SKIP_FILES = new Set(['src/app/AppShell.jsx', 'src/auth/AuthPages.jsx', 'src/site/SiteLayout.jsx']);   // already on the structured namespaces

const TEXT_ATTRS = new Set(['label', 'placeholder', 'title', 'aria-label', 'alt', 'hint', 'emptyLabel', 'lead', 'body', 'confirmLabel', 'cancelLabel', 'description', 'subtitle', 'tooltip', 'helper', 'caption', 'heading', 'message', 'actionLabel']);
const TOAST = new Set(['success', 'error', 'info', 'warning']);
const SETTER = /^set(Error|Msg|Message|Notice|Problem|Warning|Info|Hint|Feedback)$/;
const DIALOG_KEYS = new Set(['title', 'body', 'confirmLabel', 'cancelLabel', 'message', 'label']);
const LABEL_KEYS = new Set(['label', 'title', 'hint', 'description', 'placeholder', 'emptyLabel', 'subtitle', 'caption']);   // object properties that hold screen text
const SHOWN = new Set(['label', 'title', 'hint', 'description', 'text', 'placeholder', 'desc', 'caption', 'sub', 'blurb']);   // names of values that are shown as text
const NO_TEXT_PARENTS = new Set(['code', 'kbd', 'style', 'script', 'pre', 'svg', 'path', 'text', 'tspan']);

const isText = (s) => typeof s === 'string' && /[A-Za-z]{2}/.test(s) && !/^(true|false|null|undefined|none|auto|submit|button|text|number|email|password|tel|search|ghost|outline|secondary|primary|danger|sm|md|lg|xl)$/.test(s.trim()) && !/^[a-z][\w.-]*$/.test(s.trim().replace(/\s+/g, '')) || (typeof s === 'string' && /\s/.test(s.trim()) && /[A-Za-z]{2}/.test(s)) || (typeof s === 'string' && /^[A-Z][a-z]{2,}$/.test(s.trim()));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const lit = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const looksLikeCode = (s) => /[{}<>=;]|^\/|https?:|\$\{|^#|\.(js|jsx|png|webp|svg)$/.test(s);

/* React's own rule for the text between tags: each line trimmed (the first keeps its leading and the last its trailing space), blank lines dropped, lines joined by one space. */
const jsxText = (raw) => {
  const lines = raw.split(/\r\n|\n|\r/);
  let out = '';
  lines.forEach((line, i) => {
    let t = line.replace(/\t/g, ' ');
    if (i !== 0) t = t.replace(/^ +/, '');
    if (i !== lines.length - 1) t = t.replace(/ +$/, '');
    if (t) out += (out && i !== 0 && /\S$/.test(out) ? ' ' : '') + t;
  });
  return out;
};
const slugVar = (src, used) => {
  const t = src.trim();
  let base = 'v';
  if (/^[\w$]+(\.[\w$]+)*$/.test(t)) { const parts = t.split('.'); base = parts[parts.length - 1]; if (/^(length|size|name)$/.test(base) && parts.length > 1) base = parts[parts.length - 2] + '_' + base; }
  else if (/^[\w$]+\(/.test(t)) base = t.slice(0, t.indexOf('('));
  base = base.replace(/[^\w]/g, '') || 'v';
  let n = base; let i = 2;
  while (used.has(n)) n = `${base}${i++}`;
  used.add(n);
  return n;
};

const files = (list) => list.flatMap((p) => {
  const full = path.resolve(ROOT, p);
  if (!fs.existsSync(full)) return [];
  return fs.statSync(full).isDirectory() ? fs.readdirSync(full, { recursive: true }).filter((f) => /\.jsx$/.test(f)).map((f) => path.join(full, f)) : [full];
});

const compName = (fn) => {
  if (fn.node.id?.name) return fn.node.id.name;
  const p = fn.parentPath;
  if (p.isVariableDeclarator() && p.node.id.type === 'Identifier') return p.node.id.name;
  if (p.isCallExpression() && p.parentPath.isVariableDeclarator() && p.parentPath.node.id.type === 'Identifier') return p.parentPath.node.id.name;
  return '';
};
const enclosingComponent = (path_) => {
  let fn = path_.getFunctionParent();
  while (fn) { if (/^[A-Z]/.test(compName(fn))) return fn; fn = fn.getFunctionParent(); }
  return null;
};

const english = fs.existsSync(EN) ? JSON.parse(fs.readFileSync(EN, 'utf8')) : {};
const skipped = [];
let totalSites = 0; let totalFiles = 0;

for (const file of [...new Set(files(args.length ? args : CORE))]) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (SKIP_FILES.has(rel)) continue;
  const src = fs.readFileSync(file, 'utf8');
  let ast;
  try { ast = parse(src, { sourceType: 'module', plugins: ['jsx'] }); } catch (e) { skipped.push(`${rel}: cannot parse (${e.message})`); continue; }
  const ms = new MagicString(src);
  const done = [];   // ranges already rewritten: an edit inside one of them (a value inside a merged sentence) is dropped
  const overwrite = ms.overwrite.bind(ms);
  ms.overwrite = (a, b, text) => { if (done.some(([x, y]) => a < y && b > x)) return ms; done.push([a, b]); return overwrite(a, b, text); };
  const comps = new Map();   // function node -> count of sites
  const strings = [];
  const line = (n) => src.slice(0, n).split('\n').length;
  const site = (nodePath, node, text, edit) => {
    const comp = enclosingComponent(nodePath);
    if (!comp) { skipped.push(`${rel}:${line(node.start)}  outside a component: ${text.slice(0, 60)}`); return; }
    strings.push(text); edit(); comps.set(comp.node, (comps.get(comp.node) || 0) + 1);
  };
  const wrapString = (nodePath, node) => {   // a string literal node -> tr('...')
    const text = node.type === 'StringLiteral' ? node.value : node.quasis.map((q) => q.value.cooked).join('');
    const n = norm(text);
    if (!isText(n) || looksLikeCode(n)) return;
    site(nodePath, node, n, () => ms.overwrite(node.start, node.end, `tr(${lit(n)})`));
  };
  const branches = (nodePath) => {   // a ternary's string branches
    const node = nodePath.node;
    for (const k of ['consequent', 'alternate']) {
      const b = node[k]; const bp = nodePath.get(k);
      if (b.type === 'StringLiteral' || (b.type === 'TemplateLiteral' && b.expressions.length === 0)) wrapString(bp, b);
      else if (b.type === 'ConditionalExpression') branches(bp);
    }
  };

  const handled = new Set();
  let useMarker = false;
  /* {label} / {opt.label} / label={x.title} where the value is a translation key from the pass above */
  const shown = (p) => {
    const node = p.node;
    const name = node.type === 'Identifier' ? node.name : (node.property.type === 'Identifier' && !node.computed ? node.property.name : '');
    if (!SHOWN.has(name)) return;
    const parent = p.parentPath;
    const inText = parent.isJSXExpressionContainer() && (parent.parentPath.isJSXElement() || parent.parentPath.isJSXFragment() || (parent.parentPath.isJSXAttribute() && TEXT_ATTRS.has(parent.parentPath.node.name.name)));
    if (!inText || parent.node.expression !== node) return;
    const comp = enclosingComponent(p);
    if (!comp) return;
    ms.overwrite(node.start, node.end, `tr(${ms.original.slice(node.start, node.end)})`);
    comps.set(comp.node, (comps.get(comp.node) || 0) + 1);
  };
  /* text and {values} in one sentence -> tr('Showing {{shown}} of {{total}}.', { shown: shown, total: total }) */
  const mergeMixed = (p) => {
    const kids = p.node.children;
    if (!kids.length) return;
    if (p.node.type === 'JSXElement' && NO_TEXT_PARENTS.has(p.node.openingElement.name.name)) return;
    const texts = kids.filter((c) => c.type === 'JSXText' && /[A-Za-z]{2}/.test(c.value));
    const exprs = kids.filter((c) => c.type === 'JSXExpressionContainer' && c.expression.type !== 'JSXEmptyExpression');
    if (!texts.length || !exprs.length || kids.some((c) => c.type === 'JSXElement' || c.type === 'JSXFragment' || c.type === 'JSXSpreadChild')) return;
    // a value that is JSX, a ternary of words, or another translation cannot be merged into a sentence
    if (exprs.some((c) => /^(ConditionalExpression|JSXElement|JSXFragment|ArrowFunctionExpression|LogicalExpression)$/.test(c.expression.type) || c.expression.type === 'CallExpression' && c.expression.callee.name === 'tr')) {
      skipped.push(`${rel}:${line(kids[0].start)}  text with a conditional or element value: ${norm(texts[0].value).slice(0, 50)}`); handled.add(p.node); return;
    }
    const used = new Set(); const vars = [];
    let tpl = '';
    for (const c of kids) {
      if (c.type === 'JSXText') tpl += jsxText(c.value).replace(/\{\{/g, '{ {');
      else { const src = ms.original.slice(c.expression.start, c.expression.end); const name = slugVar(src, used); vars.push([name, src]); tpl += `{{${name}}}`; }
    }
    tpl = tpl.replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z]{2}/.test(tpl.replace(/\{\{\w+\}\}/g, '')) || looksLikeCode(tpl.replace(/\{\{\w+\}\}/g, ''))) return;
    const comp = enclosingComponent(p);
    if (!comp) { skipped.push(`${rel}:${line(kids[0].start)}  outside a component: ${tpl.slice(0, 60)}`); return; }
    kids.forEach((c) => handled.add(c));
    strings.push(tpl);
    ms.overwrite(kids[0].start, kids[kids.length - 1].end, `{tr(${lit(tpl)}, { ${vars.map(([n, v]) => (n === v ? n : `${n}: ${v}`)).join(', ')} })}`);
    comps.set(comp.node, (comps.get(comp.node) || 0) + 1);
  };
  /* `Foo ${x} bar` in a text position -> tr('Foo {{x}} bar', { x }) */
  const templateTr = (nodePath, node) => {
    if (node.type !== 'TemplateLiteral' || !node.expressions.length) return false;
    const used = new Set(); const vars = [];
    let tpl = ''; let ok = true;
    node.quasis.forEach((q, i) => {
      if (!ok) return;
      tpl += q.value.cooked.replace(/\{\{/g, '{ {');
      if (i < node.expressions.length) {
        const e = node.expressions[i];
        if (/^(ConditionalExpression|ArrowFunctionExpression|LogicalExpression|TemplateLiteral|AwaitExpression)$/.test(e.type)) { ok = false; return; }
        const src = ms.original.slice(e.start, e.end); const name = slugVar(src, used); vars.push([name, src]); tpl += `{{${name}}}`;
      }
    });
    if (!ok) return false;
    tpl = tpl.replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z]{3}/.test(tpl.replace(/\{\{\w+\}\}/g, '')) || looksLikeCode(tpl.replace(/\{\{\w+\}\}/g, ''))) return false;
    const comp = enclosingComponent(nodePath);
    if (!comp) return false;
    strings.push(tpl);
    ms.overwrite(node.start, node.end, `tr(${lit(tpl)}, { ${vars.map(([n, v]) => (n === v ? n : `${n}: ${v}`)).join(', ')} })`);
    comps.set(comp.node, (comps.get(comp.node) || 0) + 1);
    return true;
  };

  traverse(ast, {
    JSXElement(p) { mergeMixed(p); },
    JSXFragment(p) { mergeMixed(p); },
    JSXText(p) {
      if (handled.has(p.node)) return;
      const raw = p.node.value; const n = norm(raw);
      if (!n || !/[A-Za-z]{2}/.test(n)) return;
      const parent = p.parentPath.node;
      if (parent.type === 'JSXElement' && NO_TEXT_PARENTS.has(parent.openingElement.name.name)) return;
      if (handled.has(parent)) return;
      const sibs = parent.children.filter((c) => c !== p.node);
      const mixed = sibs.some((c) => (c.type === 'JSXExpressionContainer' && c.expression.type !== 'JSXEmptyExpression')
        || (c.type === 'JSXElement' && !c.openingElement.selfClosing && c.children.some((k) => k.type === 'JSXText' && k.value.trim())));
      if (mixed) { skipped.push(`${rel}:${line(p.node.start)}  text mixed with values or inline elements: ${n.slice(0, 60)}`); return; }
      const first = raw.search(/\S/); const last = raw.length - raw.match(/\s*$/)[0].length;
      if (looksLikeCode(n)) return;
      site(p, p.node, n, () => ms.overwrite(p.node.start + first, p.node.start + last, `{tr(${lit(n)})}`));
    },
    JSXAttribute(p) {
      const name = p.node.name.name; const v = p.node.value;
      if (!TEXT_ATTRS.has(name) || !v) return;
      if (v.type === 'StringLiteral') {
        const n = norm(v.value);
        if (!isText(n) || looksLikeCode(n)) return;
        site(p, v, n, () => ms.overwrite(v.start, v.end, `{tr(${lit(n)})}`));
      } else if (v.type === 'JSXExpressionContainer') {
        const e = v.expression; const ep = p.get('value').get('expression');
        if (e.type === 'StringLiteral' || (e.type === 'TemplateLiteral' && e.expressions.length === 0)) wrapString(ep, e);
        else if (e.type === 'ConditionalExpression') branches(ep);
        else if (e.type === 'TemplateLiteral') { if (!templateTr(ep, e)) skipped.push(`${rel}:${line(e.start)}  ${name}= template with values`); }
      }
    },
    JSXExpressionContainer(p) {   // {cond ? 'A' : 'B'} as a child
      if (p.parentPath.isJSXElement() || p.parentPath.isJSXFragment()) {
        const e = p.node.expression; const ep = p.get('expression');
        if (e.type === 'ConditionalExpression') branches(ep);
        else if (e.type === 'TemplateLiteral' && e.expressions.length > 0 && /[A-Za-z]{3}/.test(e.quasis.map((q) => q.value.cooked).join(''))) { if (!templateTr(ep, e)) skipped.push(`${rel}:${line(e.start)}  child template with values: ${src.slice(e.start, e.start + 60).replace(/\s+/g, ' ')}`); }
      }
    },
    /* a label written once (a menu of options, a table of columns): marked T('Text') so it is a translation key; shown through tr(label) */
    ObjectProperty(p) {
      const k = p.node.key; const v = p.node.value;
      if (k.type !== 'Identifier' || !LABEL_KEYS.has(k.name) || v.type !== 'StringLiteral') return;
      if (p.findParent((a) => a.isJSXAttribute() || a.isJSXExpressionContainer() || a.isCallExpression() && ['toast', 'dialog'].includes(a.node.callee.object?.name))) return;
      const n = norm(v.value);
      if (!isText(n) || looksLikeCode(n)) return;
      strings.push(n); useMarker = true;
      ms.overwrite(v.start, v.end, `T(${lit(n)})`);
    },
    ArrayExpression(p) {
      const el = p.node.elements;
      if (el.length < 2 || el.length > 3 || !el.every((e) => e && e.type === 'StringLiteral')) return;
      if (!/^[A-Z][A-Z0-9_]+$|^[a-z][A-Za-z0-9_-]*$/.test(el[0].value) || p.parentPath.type !== 'ArrayExpression') return;   // ['CODE', 'Text'] rows of a list of options
      const n = norm(el[1].value);
      if (!isText(n) || looksLikeCode(n) || n === el[0].value) return;
      strings.push(n); useMarker = true;
      ms.overwrite(el[1].start, el[1].end, `T(${lit(n)})`);
    },
    Identifier(p) { shown(p); },
    MemberExpression(p) { shown(p); },
    CallExpression(p) {
      const c = p.node.callee; const a0 = p.node.arguments[0];
      if (!a0) return;
      if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'toast' && TOAST.has(c.property.name)) {
        const ap = p.get('arguments.0');
        if (a0.type === 'StringLiteral' || (a0.type === 'TemplateLiteral' && a0.expressions.length === 0)) wrapString(ap, a0);
        else if (a0.type === 'ConditionalExpression') branches(ap);
        else if (a0.type === 'TemplateLiteral') { if (!templateTr(ap, a0)) skipped.push(`${rel}:${line(a0.start)}  toast with values`); }
      } else if (c.type === 'Identifier' && SETTER.test(c.name)) {
        const ap = p.get('arguments.0');
        if (a0.type === 'StringLiteral') wrapString(ap, a0);
        else if (a0.type === 'ConditionalExpression') branches(ap);
        else if (a0.type === 'TemplateLiteral') templateTr(ap, a0);
      } else if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'dialog' && a0.type === 'ObjectExpression') {
        a0.properties.forEach((prop, i) => {
          if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier' && DIALOG_KEYS.has(prop.key.name) && (prop.value.type === 'StringLiteral' || (prop.value.type === 'TemplateLiteral' && prop.value.expressions.length === 0))) wrapString(p.get(`arguments.0.properties.${i}.value`), prop.value);
        });
      }
    }
  });

  if (!strings.length && !comps.size) continue;
  totalFiles += 1; totalSites += strings.length;
  for (const s of strings) english[s] = s;

  // the hook in each component, and its import
  let lastImportEnd = 0;
  for (const n of ast.program.body) if (n.type === 'ImportDeclaration') lastImportEnd = n.end;
  for (const fnNode of comps.keys()) {
    const body = fnNode.body;
    if (body.type === 'BlockStatement') {
      if (src.slice(body.start, body.end).includes('const tr = useT()')) continue;
      ms.appendRight(body.start + 1, '\n  const tr = useT();');
    } else {
      const paren = body.extra?.parenthesized;
      const s = paren ? body.extra.parenStart : body.start;
      let e = body.end;
      if (paren) { while (/\s/.test(src[e])) e += 1; e += 1; }
      ms.appendLeft(s, '{\n  const tr = useT();\n  return ');
      ms.appendRight(e, ';\n}');
    }
  }
  const existing = /import \{ useT \} from '[^']*i18n\/useT\.js';/.exec(src);
  if (existing && useMarker) ms.overwrite(existing.index, existing.index + existing[0].length, existing[0].replace('{ useT }', '{ useT, T }'));
  if (!/from '[^']*i18n\/useT\.js'/.test(src)) {
    const depth = path.relative(path.dirname(file), SRC).replace(/\\/g, '/') || '.';
    ms.appendRight(lastImportEnd, `\nimport { ${useMarker ? 'useT, T' : 'useT'} } from '${depth}/i18n/useT.js';`);
  }
  if (WRITE) fs.writeFileSync(file, ms.toString());
  console.log(`${WRITE ? 'changed' : 'would change'} ${rel}: ${strings.length} texts in ${comps.size} component(s)`);
}

const sorted = Object.fromEntries(Object.entries(english).sort(([a], [b]) => a.localeCompare(b)));
if (WRITE) { fs.writeFileSync(EN, JSON.stringify(sorted, null, 2) + '\n'); fs.writeFileSync(path.join(ROOT, 'scripts/i18n-skipped.txt'), skipped.join('\n') + '\n'); }
console.log(`\n${totalSites} sites in ${totalFiles} files; ${Object.keys(sorted).length} distinct English texts; ${skipped.length} sites left for hand work${WRITE ? ' (scripts/i18n-skipped.txt)' : ''}`);
