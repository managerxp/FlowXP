/*
 * Is this address one a person can receive mail at: typos of the big providers, domains that do not exist, resolver
 * trouble (must not block a real signup), and the dev-only reserved names. DNS is a stand-in, so no network is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { emailProblem, suggestDomain } from '../src/utils/emailCheck.js';

const dnsErr = (code) => Object.assign(new Error(code), { code });
/** A pretend resolver: domains with MX, domains with only an A record, and everything else does not exist. */
const resolver = ({ mx = [], a = [], broken = false } = {}) => ({
  resolveMx: async (d) => { if (broken) throw dnsErr('ESERVFAIL'); if (mx.includes(d)) return [{ exchange: `mail.${d}`, priority: 10 }]; throw dnsErr('ENOTFOUND'); },
  resolve4: async (d) => { if (broken) throw dnsErr('ESERVFAIL'); if (a.includes(d)) return ['203.0.113.7']; throw dnsErr('ENOTFOUND'); }
});

test('typos of well-known providers get a "did you mean" with the corrected address', () => {
  for (const [typo, fix] of [['gmial.com', 'gmail.com'], ['gmail.con', 'gmail.com'], ['gnail.com', 'gmail.com'], ['gmaill.com', 'gmail.com'], ['yaho.com', 'yahoo.com'], ['hotmial.com', 'hotmail.com'], ['outlok.com', 'outlook.com'], ['gmail.co', 'gmail.com']]) {
    assert.equal(suggestDomain(typo), fix, typo);
  }
  for (const fine of ['gmail.com', 'yahoo.co.in', 'outlook.com', 'managerxp.com', 'abc.com', 'flowxp.in', 'mycompany.co.in', 'sharma-traders.com']) {
    assert.equal(suggestDomain(fine), null, fine);
  }
});

test('the message names the corrected address', async () => {
  const r = resolver({ mx: ['gmial.com'] });          // the typo domain exists and even accepts mail: only a name check catches it
  assert.equal(await emailProblem('priya@gmial.com', { lookup: r }), 'Did you mean priya@gmail.com? "gmial.com" does not look like a real email provider.');
});

test('a domain that does not exist is refused, with the part to fix', async () => {
  const msg = await emailProblem('owner@sharma-traders-xyz.com', { lookup: resolver() });
  assert.match(msg, /We could not find "sharma-traders-xyz\.com"/);
});

test('a domain with mail records, or with only an address record, is accepted', async () => {
  assert.equal(await emailProblem('a@shop.in', { lookup: resolver({ mx: ['shop.in'] }) }), null);
  assert.equal(await emailProblem('a@tiny.example.org', { lookup: resolver({ a: ['tiny.example.org'] }) }), null);
});

test('a resolver that is down or slow never blocks a signup', async () => {
  assert.equal(await emailProblem('a@shop.in', { lookup: resolver({ broken: true }) }), null);
  const slow = { resolveMx: () => new Promise(() => {}), resolve4: () => new Promise(() => {}) };
  const t0 = Date.now();
  assert.equal(await emailProblem('a@shop.in', { lookup: slow }), null);
  assert.ok(Date.now() - t0 < 8000, 'gives up after a few seconds');
});

test('malformed addresses are refused before any lookup', async () => {
  let looked = false;
  const spy = { resolveMx: async () => { looked = true; return []; }, resolve4: async () => { looked = true; return []; } };
  for (const bad of ['', 'plain', '@shop.in', 'a@', 'a@shop', 'a..b@shop.in', '.a@shop.in', 'a.@shop.in', 'a@-shop.in', 'a@sh op.in', 'a@shop..in']) {
    assert.ok(await emailProblem(bad, { lookup: spy }), JSON.stringify(bad));
  }
  assert.equal(looked, false);
});

test('development and tests: the reserved .test/.local/.example names pass unchecked', async () => {
  const none = resolver();
  for (const ok of ['demo@flowxp.test', 'x@sec.test', 'a@host.local', 'a@thing.example', 'a@x.invalid']) assert.equal(await emailProblem(ok, { lookup: none }), null, ok);
});
