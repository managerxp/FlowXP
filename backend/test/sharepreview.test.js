/* The link preview a booking page sends to WhatsApp and LinkedIn: the business's own name and picture, safely written into the page. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.DATABASE_URL ||= 'postgres://nobody@127.0.0.1:1/none';   // nothing here asks the database
process.env.JWT_SECRET ||= 'test-secret-that-is-long-enough-123456';
const { withPreview } = await import('../src/controllers/sharePreview.controller.js');
const index = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');

test('the business replaces FlowXP in the preview', () => {
  const html = withPreview(index, { title: 'Reserve a table at Ali\'s "$& Co" <b>', description: 'Pick a time.', url: 'https://flowxp.in/reserve/alis', site: 'Ali\'s', image: 'https://flowxp.in/reserve/alis/image.jpg?v=1' });
  assert.match(html, /<title>Reserve a table at Ali&#39;s &quot;\$&amp; Co&quot; &lt;b&gt;<\/title>/);
  assert.equal(html.match(/property="og:title"/g).length, 1);
  assert.equal(html.match(/property="og:image"/g).length, 1);
  assert.doesNotMatch(html, /product\/pos\.webp|rel="canonical"/);
  assert.match(html, /src="\/src\/main\.jsx"/, 'the app itself is untouched');
});

test('no logo means no picture, not FlowXP\'s', () => {
  const html = withPreview(index, { title: 'T', description: 'D', url: 'u', site: 'S', image: null });
  assert.doesNotMatch(html, /og:image/);
});
