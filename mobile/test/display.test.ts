/* Display settings (theme, date format, decimals) and the backup request. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_DEFAULTS, cleanDisplay, formatDate, formatDateLong, getDisplay, loadDisplay, resolveTheme, setDisplay, type KvStore } from '../src/lib/display.ts';
import { rupees, rupeesExact } from '../src/lib/money.ts';
import { DARK, LIGHT, applyPalette, color } from '../src/lib/theme.ts';
import { backupRequest, canBackUp } from '../src/lib/backup.ts';
import { receiptLines, type Invoice } from '../src/lib/receipt.ts';
import { defOf } from '../src/lib/bizReports.ts';

const memory = (start: Record<string, string> = {}): KvStore & { data: Record<string, string> } => {
  const data = { ...start };
  return { data, get: async (k) => data[k] ?? null, set: async (k, v) => { data[k] = v; } };
};

test('anything unreadable becomes the default for that one setting, and nothing changes until someone chooses', () => {
  assert.deepEqual(DISPLAY_DEFAULTS, { theme: 'light', date: 'auto', decimals: 2 });
  assert.deepEqual(cleanDisplay(null), DISPLAY_DEFAULTS);
  assert.deepEqual(cleanDisplay({ theme: 'dark', date: 'yy', decimals: 7 }), { theme: 'dark', date: 'auto', decimals: 2 });
  assert.deepEqual(cleanDisplay('garbage'), DISPLAY_DEFAULTS);
});

test('a choice is kept on the phone and read back at the next start; a damaged copy starts fresh', async () => {
  const kv = memory();
  await setDisplay({ theme: 'dark', date: 'dmy', decimals: 0 }, kv);
  assert.deepEqual(JSON.parse(kv.data.display), { theme: 'dark', date: 'dmy', decimals: 0 });
  await setDisplay({ decimals: 2 }, kv);   // one change keeps the others
  assert.deepEqual(getDisplay(), { theme: 'dark', date: 'dmy', decimals: 2 });
  await loadDisplay(memory({ display: JSON.stringify({ theme: 'system', date: 'ymd', decimals: 1 }) }));
  assert.deepEqual(getDisplay(), { theme: 'system', date: 'ymd', decimals: 1 });
  await loadDisplay(memory({ display: '{not json' }));
  assert.deepEqual(getDisplay(), DISPLAY_DEFAULTS);
});

test('"same as the phone" follows the phone; light and dark do not', () => {
  assert.equal(resolveTheme('system', 'dark'), 'dark'); assert.equal(resolveTheme('system', 'light'), 'light'); assert.equal(resolveTheme('system', null), 'light');
  assert.equal(resolveTheme('dark', 'light'), 'dark'); assert.equal(resolveTheme('light', 'dark'), 'light');
});

test('dates: the app\'s own ISO day by default, or the chosen order; anything that is not a date is left alone', () => {
  assert.equal(formatDate('2026-10-15'), '2026-10-15'); assert.equal(formatDate('2026-10-15T08:30:00.000Z'), '2026-10-15');
  assert.equal(formatDate('2026-10-15', 'dmy'), '15/10/2026'); assert.equal(formatDate('2026-10-15', 'mdy'), '10/15/2026'); assert.equal(formatDate('2026-10-15', 'ymd'), '2026-10-15');
  assert.equal(formatDate('never'), 'never'); assert.equal(formatDate(null), ''); assert.equal(formatDateLong('2026-10-05', 'dmy'), '5 Oct 2026'); assert.equal(formatDateLong('2026-10-05', 'mdy'), 'Oct 5, 2026');
});

test('amounts follow the decimals setting on screen, and a receipt always shows the exact amount', async () => {
  const kv = memory();
  await setDisplay({ decimals: 2 }, kv); assert.equal(rupees(123450), '₹1,234.50'); assert.equal(rupees(-5), '-₹0.05');
  await setDisplay({ decimals: 0 }, kv); assert.equal(rupees(123450), '₹1,235'); assert.equal(rupees(123449), '₹1,234'); assert.equal(rupees(0), '₹0'); assert.equal(rupees(1234567890), '₹1,23,45,679');
  await setDisplay({ decimals: 1 }, kv); assert.equal(rupees(123450), '₹1,234.5'); assert.equal(rupees(123456), '₹1,234.6');
  assert.equal(rupeesExact(123450), '₹1,234.50');
  const inv = { invoice_id: 1, invoice_number: 'INV-1', invoice_date: '2026-10-15', subtotal: 1234.5, discount: 0, tax: 0, round_off: 0, total: 1234.5, amount_paid: 1234.5, balance_due: 0, items: [], payments: [] } as Invoice;
  assert.match(receiptLines(inv, 'Shop').join('\n'), /₹1,234\.50/, 'a receipt does not round');
  await setDisplay({ decimals: 2 }, kv);
});

test('a report date follows the date format', async () => {
  const kv = memory();
  await setDisplay({ date: 'dmy' }, kv);
  const v = defOf('discounts')!.build({ totals: { discount: 10, pct: 5, bills: 1 }, rows: [{ number: 'INV-1', party: 'A', date: '2026-10-15', discount: 10, gross: 200, pct: 5 }] }, (n) => String(n));
  assert.match(v.sections[0].rows[0].sub!, /^15\/10\/2026/);
  await setDisplay({ date: 'auto' }, kv);
});

test('dark and light have the same colours, and switching changes the one shared object in place', () => {
  assert.deepEqual(Object.keys(DARK).sort(), Object.keys(LIGHT).sort());
  const same = color;
  applyPalette('dark'); assert.equal(color.bg, DARK.bg); assert.equal(color.ink, DARK.ink); assert.equal(same, color);
  applyPalette('light'); assert.equal(color.bg, LIGHT.bg);
  assert.notEqual(DARK.bg, DARK.ink, 'text is not the colour of its background');
});

test('the backup request: the server address, the headers the app sends, and a dated file name; only the owner sees it', () => {
  const r = backupRequest('https://api.flowxp.in/', { token: 'tok', businessId: 4, branchId: 9 }, '2026-10-15');
  assert.equal(r.url, 'https://api.flowxp.in/api/businesses/current/backup'); assert.equal(r.fileName, 'flowxp-backup-2026-10-15.zip');
  assert.deepEqual(r.headers, { 'X-Requested-With': 'FlowXP', Authorization: 'Bearer tok', 'X-Business-Id': '4', 'X-Branch-Id': '9' });
  assert.deepEqual(backupRequest('http://x', { token: null, businessId: null, branchId: null }, '2026-01-01').headers, { 'X-Requested-With': 'FlowXP' });
  assert.equal(canBackUp('OWNER'), true); assert.equal(canBackUp('MANAGER'), false); assert.equal(canBackUp(undefined), false);
});
