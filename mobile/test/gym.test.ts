import test from 'node:test';
import assert from 'node:assert/strict';
import { addRecent, deniedTotal, firstName, manualBody, memberSub, membersPath, needsConfirm, reasonOf, recentOf, scanBody, type AccessResult } from '../src/lib/gym.ts';

const result = (over: Partial<AccessResult> = {}): AccessResult => ({ decision: 'APPROVED', reason: 'APPROVED', action: 'IN', member: { member_id: 1, member_code: 'IW-0001', name: 'Aditya Kapoor', photo_url: null, status: 'ACTIVE' }, membership: { plan_name: 'Monthly', end_date: '2026-11-01', days_left: 18 }, ...over });

test('every answer the server can give has words for the desk; an unknown one is made readable', () => {
  assert.equal(reasonOf('APPROVED').tone, 'ok');
  assert.equal(reasonOf('MEMBERSHIP_EXPIRED').title, 'Membership ended');
  assert.equal(reasonOf('PAYMENT_REQUIRES_ATTENTION').tone, 'warn');
  assert.equal(reasonOf('SERVICE_UNAVAILABLE').tone, 'bad');
  assert.equal(reasonOf('SOMETHING_NEW').title, 'something new');
});

test('a lookup check-in must be confirmed; only a verification request on a known member asks the desk to look', () => {
  assert.equal(needsConfirm(result({ decision: 'DENIED', reason: 'VERIFICATION_REQUIRED' })), true);
  assert.equal(needsConfirm(result({ decision: 'DENIED', reason: 'VERIFICATION_REQUIRED', member: null })), false);
  assert.equal(needsConfirm(result()), false);
});

test('a scan and a lookup are sent with a key, so a retry is one entry; a lookup always says the desk has seen who it is', () => {
  assert.deepEqual(scanBody(' FXM:abc ', 'k1'), { code: 'FXM:abc', action: 'IN', idempotency_key: 'k1' });
  assert.deepEqual(scanBody('FXM:abc', 'k1', 'OUT', true), { code: 'FXM:abc', action: 'OUT', idempotency_key: 'k1', confirm: true });
  assert.deepEqual(manualBody(5, 'k2'), { member_id: 5, action: 'IN', confirm: true, idempotency_key: 'k2' });
});

test('member search needs two characters and is encoded', () => {
  assert.equal(membersPath('a'), null);
  assert.equal(membersPath(' Aditya K '), '/gym/members?search=Aditya%20K&limit=12');
});

test('the strip of recent entries shows first names only, newest first, and keeps eight', () => {
  assert.equal(firstName('Aditya Kapoor'), 'Aditya');
  assert.deepEqual(recentOf(result(), 'a pass', 5), { at: 5, ok: true, who: 'Aditya', what: 'in' });
  assert.deepEqual(recentOf(result({ decision: 'DENIED', reason: 'MEMBERSHIP_EXPIRED' }), 'a pass', 6), { at: 6, ok: false, who: 'Aditya', what: 'Membership ended' });
  assert.equal(recentOf(result({ member: null, decision: 'DENIED', reason: 'INVALID_CREDENTIAL' }), 'a pass', 7).who, 'a pass');
  let list = [] as ReturnType<typeof recentOf>[];
  for (let i = 0; i < 10; i++) list = addRecent(list, recentOf(result(), 'x', i));
  assert.equal(list.length, 8); assert.equal(list[0].at, 9);
});

test('a member is described by code, phone and plan; turned-away totals add up', () => {
  assert.equal(memberSub({ member_code: 'IW-0001', phone: '9845000001', plan_name: 'Monthly' }), 'IW-0001 · 9845000001 · Monthly');
  assert.equal(memberSub({ member_code: 'IW-0002', phone: null, plan_name: null }), 'IW-0002');
  assert.equal(deniedTotal({ denied_today: [{ reason_code: 'A', n: 2 }, { reason_code: 'B', n: 3 }] }), 5);
  assert.equal(deniedTotal(null), 0);
});
