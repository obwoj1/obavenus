const assert = require('node:assert/strict');
const test = require('node:test');
const { Readable } = require('node:stream');
const { BASE_URL, getOllamaVisionStatus, listOllamaModels, makeMessages, requestOllamaResponse } = require('../electron/ollama.cjs');

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

test('Ollama vision sends a bounded screenshot as local base64 image input', async () => {
  const screenshot = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  let body;
  const answer = await requestOllamaResponse({
    model: 'gemma4', messages: [{ role: 'user', text: 'Read the diagram labels.', images: [screenshot] }],
    fetchImpl: async (url, options) => { body = JSON.parse(options.body); assert.equal(url, `${BASE_URL}/api/chat`); return { ok: true, json: async () => ({ message: { content: 'A points to B.' } }) }; },
  });
  assert.equal(body.messages[1].content, 'Read the diagram labels.');
  assert.deepEqual(body.messages[1].images, [screenshot.toString('base64')]);
  assert.equal(answer, 'A points to B.');
  assert.throws(() => makeMessages([{ role: 'user', text: 'image', images: [Buffer.from('not an image')] }]), /JPEG or PNG/);
  assert.throws(() => makeMessages([{ role: 'user', text: 'image', images: [Buffer.concat([screenshot, Buffer.alloc(4 * 1024 * 1024)])] }]), /4 MB/);
  assert.throws(() => makeMessages([{ role: 'assistant', text: 'image', images: [screenshot] }]), /user image/);
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

test('Ollama vision is enabled only for installed local models that advertise vision', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: options?.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'gemma4' }] }) };
    return { ok: true, json: async () => ({ capabilities: ['completion', 'vision'] }) };
  };
  assert.deepEqual(await getOllamaVisionStatus('gemma4', { fetchImpl }), { available: true });
  assert.deepEqual(requests.map((request) => request.url), [`${BASE_URL}/api/tags`, `${BASE_URL}/api/show`]);
  assert.deepEqual(requests[1].body, { model: 'gemma4' });
  assert.deepEqual(await getOllamaVisionStatus('gemma4:cloud', { fetchImpl: async () => ({ ok: true, json: async () => ({ models: [{ name: 'gemma4:cloud', remote_host: 'https://ollama.example' }] }) }) }), { available: false, reason: 'Screenshot analysis is disabled for Ollama cloud or remote models; choose a local vision model to keep screenshots on this Mac.' });
  assert.deepEqual(await getOllamaVisionStatus('text-model', { fetchImpl: async (url) => url.endsWith('/api/tags') ? { ok: true, json: async () => ({ models: [{ name: 'text-model' }] }) } : { ok: true, json: async () => ({ capabilities: ['completion'] }) } }), { available: false, reason: 'The selected Ollama model does not advertise vision support.' });
  assert.deepEqual(await getOllamaVisionStatus('remote-model', { fetchImpl: async () => ({ ok: true, json: async () => ({ models: [{ name: 'remote-model', remote_host: 'https://ollama.example' }] }) }) }), { available: false, reason: 'Screenshot analysis is disabled for Ollama cloud or remote models; choose a local vision model to keep screenshots on this Mac.' });
  assert.equal((await getOllamaVisionStatus('', { fetchImpl: async () => { throw new Error('should not request'); } })).available, false);
});

test('Ollama propagates Stop as a user cancellation', async () => {
  const controller = new AbortController();
  const pending = requestOllamaResponse({
    model: 'qwen3:8b', messages: [{ role: 'user', text: 'Wait' }], signal: controller.signal,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      setImmediate(() => controller.abort());
    }),
  });
  await assert.rejects(pending, (error) => error.name === 'AbortError' && /stopped/.test(error.message));
});

test('Ollama streams local model text into the response callback', async () => {
  let body;
  const deltas = [];
  const result = await requestOllamaResponse({
    model: 'qwen3:8b', messages: [{ role: 'user', text: 'Say hello' }], onDelta: (delta) => deltas.push(delta),
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, body: Readable.from(['{"message":{"content":"Hello"},"done":false}\n', '{"message":{"content":" there"},"done":true}\n']) };
    },
  });
  assert.equal(body.stream, true);
  assert.equal(result, 'Hello there');
  assert.equal(deltas.join(''), result);
});

test('Ollama conversations reject unsafe message roles, paths and oversized attached context', async () => {
  assert.throws(() => makeMessages([{ role: 'tool', text: 'bad' }]), /unsupported message/);
  assert.throws(() => makeMessages([{ role: 'user', text: 'x', context: [{ name: '../secret', content: 'x' }] }]), /invalid/);
  assert.throws(() => makeMessages([{ role: 'user', text: 'x', context: [{ name: 'data.txt', content: 'x'.repeat(60_001) }] }]), /60,000/);
  await assert.rejects(requestOllamaResponse({ model: 'http://example.com', messages: [{ role: 'user', text: 'x' }] }), /valid Ollama model tag/);
});
