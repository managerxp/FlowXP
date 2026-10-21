import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_TYPES, cleanCode, codeProblem, deleteBody, deleteProblem, emailLooksRight, emptySignup, passwordProblem, phoneProblem, resendWait, resetBody, resetProblem, signupBody, signupProblem, suggestEmail, verifyBody } from '../src/lib/account.ts';

const good = { ...emptySignup(), name: ' Asha Rao ', email: ' asha@example.com ', phone: '9845000001', password: 'longenough1', businessName: ' Sharma Auto Parts ', businessType: 'AUTO_PARTS', agreed: true };

test('every business type the server lets sign up is offered, with the same names as the website', () => {
  assert.deepEqual(BUSINESS_TYPES.map(([v]) => v), ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'HOTEL', 'RETAIL', 'SUPERMARKET', 'PHARMACY', 'SALON', 'GYM', 'GAMING_CAFE', 'AUTO_PARTS', 'WHOLESALE']);
});

test('the form says what is wrong, one thing at a time, before anything is sent', () => {
  assert.equal(signupProblem(good), '');
  assert.match(signupProblem({ ...good, name: ' ' }), /your name/);
  assert.match(signupProblem({ ...good, email: 'asha@' }), /email/);
  assert.match(signupProblem({ ...good, phone: '12' }), /mobile/);
  assert.equal(signupProblem({ ...good, phone: '' }), '', 'the mobile number is optional');
  assert.match(signupProblem({ ...good, password: 'short' }), /10 characters/);
  assert.match(signupProblem({ ...good, businessName: '' }), /business/);
  assert.match(signupProblem({ ...good, businessType: '' }), /kind of business/);
  assert.match(signupProblem({ ...good, businessType: 'BANK' }), /kind of business/);
  assert.match(signupProblem({ ...good, agreed: false }), /Terms/);
});

test('signup sends trimmed values, leaves out an empty mobile number, and says the terms were agreed', () => {
  assert.deepEqual(signupBody(good), { name: 'Asha Rao', email: 'asha@example.com', phone: '9845000001', password: 'longenough1', business_name: 'Sharma Auto Parts', business_type: 'AUTO_PARTS', accepted_terms: true });
  assert.equal('phone' in signupBody({ ...good, phone: ' ' }), false);
});

test('a spare parts shop that also services vehicles says so at signup; nobody else sends it', () => {
  assert.equal('workshop_mode' in signupBody(good), false);
  assert.equal(signupBody({ ...good, alsoService: true }).workshop_mode, true);
  assert.equal('workshop_mode' in signupBody({ ...good, alsoService: true, businessType: 'RETAIL' }), false, 'only a parts shop');
});

test('common email slips are caught and mended', () => {
  assert.equal(suggestEmail('asha@gmial.com'), 'asha@gmail.com');
  assert.equal(suggestEmail('asha@gmail.con'), 'asha@gmail.com');
  assert.equal(suggestEmail('asha@hotmial.com'), 'asha@hotmail.com');
  assert.equal(suggestEmail('asha@example.com'), null);
  assert.equal(suggestEmail('not an email'), null);
  assert.equal(emailLooksRight('a@b.co'), true); assert.equal(emailLooksRight('a@b'), false);
  assert.equal(passwordProblem('1234567890'), ''); assert.notEqual(passwordProblem('123456789'), '');
  assert.equal(phoneProblem('+91 98450 00001'), '');
});

test('the code from the email: six digits, spaces and dashes forgiven', () => {
  assert.equal(cleanCode(' 123 456 '), '123456'); assert.equal(cleanCode('123-456'), '123456');
  assert.match(codeProblem('12345'), /6-digit/); assert.match(codeProblem('12345a'), /6-digit/); assert.equal(codeProblem('123 456'), '');
  assert.deepEqual(verifyBody('ch', '123 456'), { challenge: 'ch', code: '123456' });
});

test('another code can be asked for after thirty seconds', () => {
  assert.equal(resendWait(1000, 1000), 30); assert.equal(resendWait(1000, 11000), 20); assert.equal(resendWait(1000, 40000), 0);
});

test('a new password needs the email, the code, ten characters and the same password twice', () => {
  assert.equal(resetProblem('a@example.com', '123456', 'longenough1', 'longenough1'), '');
  assert.match(resetProblem('a', '123456', 'longenough1', 'longenough1'), /email/);
  assert.match(resetProblem('a@example.com', '1', 'longenough1', 'longenough1'), /6-digit/);
  assert.match(resetProblem('a@example.com', '123456', 'short', 'short'), /10 characters/);
  assert.match(resetProblem('a@example.com', '123456', 'longenough1', 'longenough2'), /not the same/);
  assert.deepEqual(resetBody(' a@example.com ', '123 456', 'longenough1'), { email: 'a@example.com', code: '123456', password: 'longenough1' });
});

test('deleting the account needs the password, and the code when there is two-step sign-in', () => {
  assert.match(deleteProblem('', false, ''), /password/);
  assert.match(deleteProblem('pw', true, ''), /authenticator/);
  assert.equal(deleteProblem('pw', true, '123456'), ''); assert.equal(deleteProblem('pw', false, ''), '');
  assert.deepEqual(deleteBody('pw', ''), { password: 'pw' });
  assert.deepEqual(deleteBody('pw', '123456'), { password: 'pw', code: '123456' });
  assert.deepEqual(deleteBody('pw', 'ABCD-EFGH'), { password: 'pw', recovery_code: 'ABCD-EFGH' });
});
