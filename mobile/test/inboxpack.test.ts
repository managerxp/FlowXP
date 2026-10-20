/* Notifications and the accountant pack on the phone: paging, where a tap goes, the periods an accountant asks for, and that every text is translated. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { INBOX_TEXTS, PAGE, hasMore, noticesQuery, phoneRoute, timeAgo, withChange, type Notice, type Preference } from '../src/lib/inbox.ts';
import { PACK_TEXTS, SPAN_LIMIT_DAYS, emailBody, emailProblem, packFileName, packPeriods, packRequest, spanDays } from '../src/lib/accountantPack.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('a page of notifications: unread only, and the oldest id for the next older page; a full page may have more', () => {
  assert.equal(noticesQuery(false), `limit=${PAGE}`); assert.equal(noticesQuery(true), `limit=${PAGE}&unread=true`); assert.equal(noticesQuery(true, 88), `limit=${PAGE}&unread=true&before=88`); assert.equal(noticesQuery(false, null), `limit=${PAGE}`);
  const one = (id: number) => ({ notification_id: id }) as Notice;
  assert.equal(hasMore(Array.from({ length: PAGE }, (_, i) => one(i))), true); assert.equal(hasMore([one(1)]), false);
});

test('how long ago, in plain words', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  assert.equal(timeAgo('2026-10-15T11:59:40Z', now), 'just now'); assert.equal(timeAgo('2026-10-15T11:55:00Z', now), '5 min ago'); assert.equal(timeAgo('2026-10-15T09:00:00Z', now), '3 h ago');
  assert.equal(timeAgo('2026-10-14T11:00:00Z', now), 'yesterday'); assert.equal(timeAgo('2026-10-12T12:00:00Z', now), '3 days ago'); assert.equal(timeAgo('2026-09-01T12:00:00Z', now), '2026-09-01'); assert.equal(timeAgo('garbage', now), '');
});

test('a tap goes to the phone screen that matches, or nowhere; the weekly summary opens the reports', () => {
  const to = (link: string | null, category = 'stock') => phoneRoute({ link, category });
  assert.equal(to('/app/reports', 'weekly'), '/biz-reports'); assert.equal(to(null, 'weekly'), '/biz-reports'); assert.equal(to('/app/reports?tab=gst', 'unusual'), '/biz-reports');
  assert.equal(to('/app/stock'), '/stock'); assert.equal(to('/app/forecast?tab=stock'), '/stock'); assert.equal(to('/app/kitchen', 'kitchen'), '/kitchen'); assert.equal(to('/app/purchases'), '/purchasing');
  assert.equal(to('/app/settings/subscription', 'account'), null); assert.equal(to(null, 'account'), null); assert.equal(to('/app/leakage', 'leakage'), null);
});

test('changing one box changes only that box, and the whole list goes back', () => {
  const prefs: Preference[] = [{ category: 'stock', label: 'Stock & purchasing', description: '', in_app: true, email: false, push: true }, { category: 'weekly', label: 'Weekly summary', description: '', in_app: true, email: false, push: false }];
  const next = withChange(prefs, 'weekly', 'email', true);
  assert.deepEqual(next[1], { ...prefs[1], email: true }); assert.deepEqual(next[0], prefs[0]); assert.equal(prefs[1].email, false, 'the original is not changed');
});

test('accountant periods: this month so far, last month whole, this quarter so far, and the financial year from its start month', () => {
  const p = (now: Date, fy = 4) => Object.fromEntries(packPeriods(now, fy).map((x) => [x.id, `${x.from}..${x.to}`]));
  const oct = p(new Date(2026, 9, 15));
  assert.deepEqual(oct, { month: '2026-10-01..2026-10-15', 'last-month': '2026-09-01..2026-09-30', quarter: '2026-10-01..2026-10-15', fy: '2026-04-01..2026-10-15', 'last-fy': '2025-04-01..2026-03-31' });
  const feb = p(new Date(2026, 1, 10));   // before April: the financial year began last April
  assert.equal(feb['last-month'], '2026-01-01..2026-01-31'); assert.equal(feb.fy, '2025-04-01..2026-02-10'); assert.equal(feb['last-fy'], '2024-04-01..2025-03-31'); assert.equal(feb.quarter, '2026-01-01..2026-02-10');
  const jan = p(new Date(2026, 0, 5)); assert.equal(jan['last-month'], '2025-12-01..2025-12-31');
  const calendar = p(new Date(2026, 9, 15), 1); assert.equal(calendar.fy, '2026-01-01..2026-10-15'); assert.equal(calendar['last-fy'], '2025-01-01..2025-12-31');
  const leap = p(new Date(2024, 2, 20)); assert.equal(leap['last-month'], '2024-02-01..2024-02-29');
  for (const x of packPeriods(new Date(2026, 9, 15))) assert.ok(spanDays(x) <= SPAN_LIMIT_DAYS && spanDays(x) >= 0, x.id);
});

test('the pack request, its file name, and the e-mail checks', () => {
  const r = packRequest('https://api.flowxp.in/', { token: 't', businessId: 4, branchId: null }, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(r.url, 'https://api.flowxp.in/api/reports/accountant-pack?from=2026-09-01&to=2026-09-30'); assert.equal(r.fileName, 'accountant-pack-2026-09-01-to-2026-09-30.zip'); assert.equal(r.headers.Authorization, 'Bearer t');
  assert.equal(packFileName({ from: 'a', to: 'b' }), 'accountant-pack-a-to-b.zip');
  assert.deepEqual(emailBody(' ca@firm.test ', { from: '2026-09-01', to: '2026-09-30' }), { email: 'ca@firm.test', from: '2026-09-01', to: '2026-09-30' });
  assert.equal(emailProblem('ca@firm.test'), ''); assert.notEqual(emailProblem('ca@firm'), ''); assert.notEqual(emailProblem(''), '');
  assert.equal(spanDays({ from: '2026-01-01', to: '2026-01-31' }), 30);
});

test('every text of the notifications and accountant pack screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set([...INBOX_TEXTS, ...PACK_TEXTS])) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
