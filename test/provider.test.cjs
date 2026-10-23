const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProviderStore, requestOpenAIResponse, DEFAULT_MODEL } = require('../electron/provider.cjs');

test('provider store encrypts the key and exposes only safe settings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-provider-'));
  const filePath = path.join(root, 'provider.json');
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async () => Buffer.from('mock-ciphertext'),
    decryptStringAsync: async () => ({ result: 'sk-test-secret' }),
  };
  const store = createProviderStore({ filePath, safeStorage });

  try {
    assert.deepEqual(await store.getPublicSettings(), { model: DEFAULT_MODEL, configured: false });
    await store.save({ model: 'gpt-5.5', apiKey: 'sk-test-secret' });
    assert.equal(await store.getApiKey(), 'sk-test-secret');
    assert.deepEqual(await store.getPublicSettings(), { model: 'gpt-5.5', configured: true });
    assert.equal((await readFile(filePath, 'utf8')).includes('sk-test-secret'), false);

    await store.save({ model: 'gpt-5.5-2026-04-23', apiKey: '' });
    assert.equal(await store.getApiKey(), 'sk-test-secret');
    await store.clearKey();
    assert.deepEqual(await store.getPublicSettings(), { model: 'gpt-5.5-2026-04-23', configured: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('OpenAI Responses request is stateless and extracts generated text', async () => {
  let requestUrl;
  let requestOptions;
  const answer = await requestOpenAIResponse({
    apiKey: 'sk-test-secret',
    model: 'gpt-5.5',
    messages: [{ role: 'user', text: 'Say hello.' }],
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello back.' }] }],
        }),
      };
    },
  });

  assert.equal(answer, 'Hello back.');
  assert.equal(requestUrl, 'https://api.openai.com/v1/responses');
  assert.equal(requestOptions.headers.Authorization, 'Bearer sk-test-secret');
  assert.deepEqual(JSON.parse(requestOptions.body), {
    model: 'gpt-5.5',
    input: [{ role: 'user', content: 'Say hello.' }],
    store: false,
  });
});

test('OpenAI request rejects invalid models and oversized conversation context', async () => {
  await assert.rejects(requestOpenAIResponse({
    apiKey: 'key', model: 'bad model', messages: [{ role: 'user', text: 'Hi' }],
  }), /valid model ID/);
  await assert.rejects(requestOpenAIResponse({
    apiKey: 'key', model: 'gpt-5.5', messages: [{ role: 'user', text: 'x'.repeat(100_001) }],
  }), /too long/);
});
