/* The activity log and security on the phone: what is asked of the server, how codes and passwords are checked before sending, and that every text is translated. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTCOME, SECURITY_TEXTS, activityCsvRequest, activityQuery, canSeeTeamSecurity, capProblem, changePasswordBody, cleanCode, codesLow, deviceName, disableBody, enableBody, isRecoveryCode, lastDays, looksLikeCode,
  passwordProblem, pinProblem, recoveryText, roleText, whenText, type ActivityFilters
} from '../src/lib/security.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const f: ActivityFilters = { user_id: '', category: '', outlet: '', q: '', from: '2026-10-09', to: '2026-10-15' };

test('the activity query carries only the filters that are set, and the page marker for older entries', () => {
  assert.equal(activityQuery(f), 'from=2026-10-09&to=2026-10-15');
  assert.equal(activityQuery({ ...f, user_id: '7', category: 'sales', q: 'brake pad' }), 'user_id=7&category=sales&q=brake+pad&from=2026-10-09&to=2026-10-15');
  assert.equal(activityQuery(f, { before: 120 }), 'from=2026-10-09&to=2026-10-15&before=120');
  assert.equal(activityQuery(f, { before: null }), 'from=2026-10-09&to=2026-10-15');
});

test('the CSV export asks for the same filters (without the search words), with the app headers and a dated file name', () => {
  const r = activityCsvRequest('https://api.flowxp.in/', { token: 'tok', businessId: 4, branchId: null }, { ...f, user_id: '7', q: 'ignored' });
  assert.equal(r.url, 'https://api.flowxp.in/api/audit?user_id=7&from=2026-10-09&to=2026-10-15&format=csv'); assert.equal(r.fileName, 'activity-2026-10-09-to-2026-10-15.csv');
  assert.equal(r.headers.Authorization, 'Bearer tok'); assert.equal(r.headers['X-Business-Id'], '4');
});

test('the date range, the time and the role read plainly', () => {
  assert.deepEqual(lastDays(7, new Date(2026, 9, 15)), { from: '2026-10-09', to: '2026-10-15' }); assert.deepEqual(lastDays(1, new Date(2026, 9, 15)), { from: '2026-10-15', to: '2026-10-15' });
  assert.deepEqual(lastDays(30, new Date(2026, 9, 15)), { from: '2026-09-16', to: '2026-10-15' });
  assert.equal(whenText(new Date(2026, 9, 5, 14, 5).toISOString()), '5 Oct, 14:05'); assert.equal(whenText('garbage'), '');
  assert.equal(roleText('PARTS_COUNTER'), 'parts counter'); assert.equal(roleText(null), '');
});

test('sign-in events: every outcome has a label, failures are marked, and a device is named from its user agent', () => {
  for (const k of ['SUCCESS', 'BAD_PASSWORD', 'UNKNOWN_USER', 'LOCKED', 'TWO_FACTOR_FAILED']) assert.ok(OUTCOME[k].label);
  assert.equal(OUTCOME.SUCCESS.bad, false); assert.equal(OUTCOME.BAD_PASSWORD.bad, true); assert.equal(OUTCOME.LOCKED.bad, true);
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'), 'Chrome on Windows'); assert.equal(deviceName('Mozilla/5.0 (Linux; Android 14) Chrome/120'), 'Chrome on Android');
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604'), 'Safari on iPhone/iPad'); assert.equal(deviceName(null), 'Unknown device'); assert.equal(deviceName('okhttp/4.12'), 'FlowXP app');
});

test('two-step codes: six digits (spaces allowed) or a recovery code with a dash; the right field is sent for each', () => {
  assert.equal(cleanCode(' 123 456 '), '123456'); assert.equal(looksLikeCode('123 456'), true); assert.equal(looksLikeCode('12345'), false); assert.equal(looksLikeCode('abcd-efgh'), true); assert.equal(looksLikeCode(''), false);
  assert.equal(isRecoveryCode('abcd-efgh'), true); assert.equal(isRecoveryCode('123456'), false);
  assert.deepEqual(enableBody('123 456'), { code: '123456' });
  assert.deepEqual(disableBody('pw', '123456'), { password: 'pw', code: '123456' }); assert.deepEqual(disableBody('pw', ' abcd-efgh '), { password: 'pw', recovery_code: 'abcd-efgh' });
  assert.equal(codesLow(2), true); assert.equal(codesLow(3), false);
  assert.match(recoveryText(['a-1', 'b-2']), /each works once[\s\S]*a-1\nb-2$/);
});

test('a new password is checked before sending; the server has the last word', () => {
  assert.equal(passwordProblem('', 'longenoughpass'), 'Enter your current password.'); assert.match(passwordProblem('old', 'short'), /at least 10/); assert.match(passwordProblem('samepassword1', 'samepassword1'), /different/);
  assert.equal(passwordProblem('oldpassword', 'brandnewpass1'), ''); assert.deepEqual(changePasswordBody('a', 'b'), { current_password: 'a', new_password: 'b' });
});

test('the approval PIN is 4 to 8 digits and the discount limit is 0 to 100', () => {
  assert.equal(pinProblem('4821'), ''); assert.equal(pinProblem('12345678'), ''); assert.notEqual(pinProblem('123'), ''); assert.notEqual(pinProblem('123456789'), ''); assert.notEqual(pinProblem('12a4'), '');
  assert.equal(capProblem('0'), ''); assert.equal(capProblem('100'), ''); assert.equal(capProblem('7.5'), ''); assert.notEqual(capProblem('101'), ''); assert.notEqual(capProblem('-1'), ''); assert.notEqual(capProblem(''), ''); assert.notEqual(capProblem('x'), '');
  assert.equal(canSeeTeamSecurity('OWNER'), true); assert.equal(canSeeTeamSecurity('ADMIN'), true); assert.equal(canSeeTeamSecurity('MANAGER'), false);
});

test('every text on the activity log and security screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(SECURITY_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
