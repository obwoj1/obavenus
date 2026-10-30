const assert = require('node:assert/strict');
const test = require('node:test');
const { BASE_URL, listOllamaModels, makeMessages, requestOllamaResponse } = require('../electron/ollama.cjs');

test('Ollama chat uses the fixed local endpoint and returns normal assistant text', async () => {
  let request;
  const result = await requestOllamaResponse({
    model: 'qwen3:8b', messages: [{ role: 'user', text: 'Hello' }],
    fetchImpl: async (url, options) => { request = { url, options, body: JSON.parse(options.body) }; return { ok: true, json: async () => ({ message: { role: 'assistant', content: 'Hi there.' } }) }; },
  });
  assert.equal(BASE_URL, 'http://127.0.0.1:11434');
  assert.equal(request.url, `${BASE_URL}/api/chat`);
  assert.equal(request.body.model, 'qwen3:8b');
  assert.equal(request.body.stream, false);
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(result, 'Hi there.');
});

test('Ollama exposes native tools and normalizes tool calls for Obavenus agent loops', async () => {
  let body;
  const result = await requestOllamaResponse({
    model: 'llama3.2', messages: [{ role: 'user', text: 'List files.' }],
    tools: [{ name: 'list_project_files', description: 'List files', parameters: { type: 'object', properties: {} } }],
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({ message: { content: '', tool_calls: [{ function: { name: 'list_project_files', arguments: {} } }] } }) }; },
  });
  assert.equal(body.tools[0].type, 'function');
  assert.equal(body.tools[0].function.name, 'list_project_files');
  assert.equal(result.toolCalls[0].name, 'list_project_files');
  assert.deepEqual(result.toolCalls[0].arguments, {});
});

test('Ollama local model discovery reports installed tags and offline status', async () => {
  assert.deepEqual(await listOllamaModels({ fetchImpl: async () => ({ ok: true, json: async () => ({ models: [{ name: 'qwen3:8b' }, { name: 'gemma3:4b' }] }) }) }), { connected: true, models: ['qwen3:8b', 'gemma3:4b'] });
  const offline = await listOllamaModels({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(offline.connected, false);
  assert.match(offline.error, /Start the Ollama app/);
});

test('Ollama conversations reject unsafe message roles, paths and oversized attached context', async () => {
  assert.throws(() => makeMessages([{ role: 'tool', text: 'bad' }]), /unsupported message/);
  assert.throws(() => makeMessages([{ role: 'user', text: 'x', context: [{ name: '../secret', content: 'x' }] }]), /invalid/);
  assert.throws(() => makeMessages([{ role: 'user', text: 'x', context: [{ name: 'data.txt', content: 'x'.repeat(60_001) }] }]), /60,000/);
  await assert.rejects(requestOllamaResponse({ model: 'http://example.com', messages: [{ role: 'user', text: 'x' }] }), /valid Ollama model tag/);
});
