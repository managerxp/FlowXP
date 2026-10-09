/* Flow AI on the phone: plain-words errors, what to offer, and drawing an answer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, NetworkError } from '../src/lib/api.ts';
import { askProblem, blocks, FALLBACK_QUESTIONS, friendlyError, questionsFor, unavailable, type AiStatus } from '../src/lib/flowai.ts';

const ready: AiStatus = { configured: true, enabled: true, can_ask: true, remaining: 10, limit: 50, suggestions: [] };

test('what to offer: the server\'s suggestions, else the usual four', () => {
  assert.deepEqual(questionsFor(null), FALLBACK_QUESTIONS);
  assert.deepEqual(questionsFor({ suggestions: ['A?', 'B?'] }), ['A?', 'B?']);
});

test('when it cannot be asked, why, in plain words', () => {
  assert.equal(unavailable(ready), null);
  assert.equal(unavailable({ ...ready, configured: false })?.title, 'Flow AI is not set up yet');
  assert.equal(unavailable({ ...ready, enabled: false })?.title, 'Flow AI is switched off');
  assert.match(unavailable({ ...ready, remaining: 0 })!.body, /all 50 questions/);
});

test('errors never show codes or server words', () => {
  assert.match(friendlyError(new ApiError('x', 503, 'AI_NOT_CONFIGURED')), /not set up/);
  assert.match(friendlyError(new ApiError('x', 402, 'AI_LIMIT')), /questions this month/);
  assert.match(friendlyError(new ApiError('Slow down a little', 429)), /Wait a minute/);
  assert.match(friendlyError(new NetworkError()), /Could not connect/);
  assert.equal(friendlyError(new ApiError('The server answered 500', 500)), 'Flow AI could not answer just now. Please try again.');
});

test('a question is only checked for being too long', () => {
  assert.equal(askProblem(''), '');
  assert.equal(askProblem('x'.repeat(1001)), 'Keep the question a little shorter');
});

test('an answer is drawn as paragraphs, bullets, numbers and bold', () => {
  const b = blocks('## Today\nYou sold **₹1,942** today.\n- Cold Coffee\n- Latte\n1. First\n2) Second');
  assert.deepEqual(b.map((x) => x.kind), ['p', 'p', 'bullet', 'bullet', 'number', 'number']);
  assert.deepEqual(b[1].spans, [{ text: 'You sold ', bold: false }, { text: '₹1,942', bold: true }, { text: ' today.', bold: false }]);
  assert.deepEqual(b.filter((x) => x.kind === 'number').map((x) => x.n), [1, 2]);
});
