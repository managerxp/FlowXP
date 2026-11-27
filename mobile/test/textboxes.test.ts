import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const src = join(import.meta.dirname, '..', 'src');

test('every screen takes its text box from ui.tsx, so hint text can always be read', () => {
  const wrong = (readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith('.tsx') && !f.endsWith('ui.tsx'))
    .filter((f) => /import\s*\{[^}]*\bTextInput\b[^}]*\}\s*from 'react-native'/.test(readFileSync(join(src, f), 'utf8')));
  assert.deepEqual(wrong, []);
});
