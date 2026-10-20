/* "Ask your reports" on the phone: the question that is sent, the question about the report on screen, and that every text is translated. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ASK_TEXTS, MAX_ASK, REPORT_EXAMPLES, aboutReport, cleanQuestion } from '../src/lib/askReports.ts';
import { HI, setLangValue, t } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('the question is trimmed and capped, and an empty one sends nothing', () => {
  assert.equal(cleanQuestion('  What was my profit?  '), 'What was my profit?'); assert.equal(cleanQuestion('   '), ''); assert.equal(cleanQuestion('x'.repeat(900)).length, MAX_ASK);
  assert.equal(REPORT_EXAMPLES.length, 4);
});

test('a question about the report on screen names the report and the period, in the words the person sees', () => {
  assert.equal(aboutReport('Explain my {report} report from {from} to {to}.', 'Profit & Loss', '2026-10-01', '2026-10-15'), 'Explain my Profit & Loss report from 2026-10-01 to 2026-10-15.');
  assert.equal(aboutReport('Explain my {report} report.', 'Low stock'), 'Explain my Low stock report.');
  setLangValue('hi');
  assert.equal(aboutReport(t('Explain my {report} report.'), t('Day Book')), 'मेरी डे बुक रिपोर्ट समझाइए।');
  assert.equal(t('Looked at {tools}', { tools: 'Profit and loss' }), 'देखा: Profit and loss'); setLangValue('en');
});

test('every text of the question box is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(ASK_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
