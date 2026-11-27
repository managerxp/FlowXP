import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');

/* Spaces between two tags (or a tag and a {comment}) on ONE line are text to React. Inside anything but <Text> the phone reports
   "Text strings must be rendered within a <Text> component". */
test('no screen has stray same-line spaces outside <Text>', () => {
  const root = new URL('../src/', import.meta.url);
  const found: string[] = [];
  for (const name of readdirSync(root, { recursive: true }) as string[]) {
    if (!name.endsWith('.tsx')) continue;
    const file = ts.createSourceFile(name, readFileSync(new URL(name.replaceAll(String.fromCharCode(92), '/'), root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const walk = (n: any) => {
      if ((ts.isJsxElement(n) || ts.isJsxFragment(n)) && !(ts.isJsxElement(n) && /^(Text|T2|TSpan|SvgText|Soft|Title|SectionTitle|Empty|ErrorText|Heading)$/.test(n.openingElement.tagName.getText()))) {
        for (const c of n.children) if (ts.isJsxText(c) && !c.text.trim() && c.text && !c.text.includes('\n')) found.push(`${name}:${file.getLineAndCharacterOfPosition(c.pos).line + 1}`);
      }
      ts.forEachChild(n, walk);
    };
    walk(file);
  }
  assert.deepEqual(found, []);
});
