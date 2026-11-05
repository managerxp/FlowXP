import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_TEXTS, averageRating, replyBody, replyProblem, reviewsUrl, stars, type Review } from '../src/lib/reviews.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const R = (rating: number): Review => ({ feedback_id: rating, rating, comment: null, reply_text: null, reply_sent_at: null, created_at: '2026-10-01T10:00:00Z', invoice_number: 'INV-1', customer_name: null });

test('stars, average, filter address and the reply check', () => {
  assert.equal(stars(4), '★★★★☆'); assert.equal(stars(9), '★★★★★'); assert.equal(stars(-1), '☆☆☆☆☆');
  assert.equal(averageRating([R(5), R(4), R(2)]), '3.7'); assert.equal(averageRating([]), null);
  assert.equal(reviewsUrl(''), '/reviews'); assert.equal(reviewsUrl('2'), '/reviews?rating=2');
  assert.equal(replyProblem('  '), 'Write a reply first'); assert.equal(replyProblem('x'.repeat(1001)), 'Keep the reply under 1000 characters'); assert.equal(replyProblem('Sorry about that'), '');
  assert.deepEqual(replyBody(' Sorry '), { text: 'Sorry' });
});

test('every text of the Reviews screen is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const missing: string[] = [];
  for (const [name, dict] of Object.entries({ HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>)) for (const k of new Set(REVIEW_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
