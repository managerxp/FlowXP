/*
 * The Gemini translation layer in modules/ai/provider.js: pure functions, no network, no DB — they turn
 * the same Anthropic-shaped request/response manager.js/tools.js/menuScan.js/reviewReply.js/onboarding.js
 * already speak into Gemini's actual wire format and back, so none of those files need to know Gemini
 * exists. Exercises the parts that are easy to get subtly wrong: role renaming, images, a tool call and
 * its result round-tripping through two different id schemes, and multi-tool-call ordering.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fromGeminiResponse, toGeminiBody, toGeminiContents } from '../src/modules/ai/provider.js';

test('a plain text turn becomes a single Gemini part, assistant renamed to model', () => {
  const contents = toGeminiContents([
    { role: 'user', content: 'How are sales today?' },
    { role: 'assistant', content: [{ type: 'text', text: 'Up 12% on yesterday.' }] }
  ]);
  assert.deepEqual(contents, [
    { role: 'user', parts: [{ text: 'How are sales today?' }] },
    { role: 'model', parts: [{ text: 'Up 12% on yesterday.' }] }
  ]);
});

test('an image block becomes Gemini inlineData', () => {
  const contents = toGeminiContents([
    { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }, { type: 'text', text: 'Record every item.' }] }
  ]);
  assert.deepEqual(contents[0].parts, [{ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }, { text: 'Record every item.' }]);
});

test('a tool call and its result round-trip by name, not by the id the model never sees', () => {
  // The exact shape manager.js builds: the assistant's tool_use pushed back, then a tool_result keyed by tool_use_id.
  const contents = toGeminiContents([
    { role: 'user', content: 'What is low on stock?' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call_0_stock_status', name: 'stock_status', input: { outlet: 'all' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_0_stock_status', content: '{"low":3}' }] }
  ]);
  assert.deepEqual(contents[1].parts, [{ functionCall: { name: 'stock_status', args: { outlet: 'all' } } }]);
  assert.deepEqual(contents[2].parts, [{ functionResponse: { name: 'stock_status', response: { result: '{"low":3}' } } }]);
});

test('a tool error result is marked as an error, not swallowed as a normal result', () => {
  const contents = toGeminiContents([
    { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'leakage_findings', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'That lookup failed.', is_error: true }] }
  ]);
  assert.deepEqual(contents[1].parts[0], { functionResponse: { name: 'leakage_findings', response: { error: 'That lookup failed.' } } });
});

test('tools translate input_schema to Gemini parameters, and a forced single tool to allowedFunctionNames', () => {
  const body = toGeminiBody({
    system: 'You read menus.',
    messages: [{ role: 'user', content: 'Scan this.' }],
    tools: [{ name: 'record_menu', description: 'Record items.', input_schema: { type: 'object', properties: { items: { type: 'array' } } } }],
    toolChoice: { type: 'tool', name: 'record_menu' },
    maxTokens: 8000
  });
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'You read menus.' }] });
  assert.deepEqual(body.tools, [{ functionDeclarations: [{ name: 'record_menu', description: 'Record items.', parameters: { type: 'object', properties: { items: { type: 'array' } } } }] }]);
  assert.deepEqual(body.toolConfig, { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['record_menu'] } });
  assert.equal(body.generationConfig.maxOutputTokens, 8000);
});

test('a Gemini reply with a function call maps to a tool_use block and stopReason "tool_use"', () => {
  const out = fromGeminiResponse({
    candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'stock_status', args: { outlet: 'all' } } }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 14 }
  });
  assert.equal(out.stopReason, 'tool_use');
  assert.deepEqual(out.content, [{ type: 'tool_use', id: 'call_0_stock_status', name: 'stock_status', input: { outlet: 'all' } }]);
  assert.deepEqual(out.usage, { input_tokens: 120, output_tokens: 14 });
});

test('two function calls in one reply get distinct ids, in order', () => {
  const out = fromGeminiResponse({
    candidates: [{ content: { parts: [{ functionCall: { name: 'sales_summary', args: {} } }, { functionCall: { name: 'stock_status', args: {} } }] } }]
  });
  assert.deepEqual(out.content.map((b) => b.id), ['call_0_sales_summary', 'call_1_stock_status']);
});

test('a plain text reply maps to stopReason "end_turn", not "tool_use"', () => {
  const out = fromGeminiResponse({ candidates: [{ content: { parts: [{ text: 'Sales are up 12%.' }] } }] });
  assert.equal(out.stopReason, 'end_turn');
  assert.deepEqual(out.content, [{ type: 'text', text: 'Sales are up 12%.' }]);
});

test('missing usageMetadata does not throw — zero usage, not a crash', () => {
  const out = fromGeminiResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  assert.deepEqual(out.usage, { input_tokens: 0, output_tokens: 0 });
});

test('a Gemini 3 thoughtSignature on a tool call survives the round trip, or the next round is refused', () => {
  const reply = fromGeminiResponse({ candidates: [{ content: { parts: [{ functionCall: { name: 'stock_status', args: {} }, thoughtSignature: 'sig-abc' }, { functionCall: { name: 'demand_forecast', args: {} } }] } }] });
  assert.equal(reply.content[0].thought_signature, 'sig-abc');
  assert.equal(reply.content[1].thought_signature, undefined);          // only the first call of a parallel set is signed
  // the assistant turn goes back to the model with the signature on the same part
  const parts = toGeminiContents([{ role: 'user', content: 'hi' }, { role: 'assistant', content: reply.content }]).at(-1).parts;
  assert.deepEqual(parts[0], { functionCall: { name: 'stock_status', args: {} }, thoughtSignature: 'sig-abc' });
  assert.equal('thoughtSignature' in parts[1], false);
});
