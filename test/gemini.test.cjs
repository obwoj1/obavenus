const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createGeminiConnector, SCOPES } = require('../electron/gemini.cjs');

test('Gemini Google OAuth uses PKCE, encrypts tokens, and generates content for the selected Cloud project', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-gemini-'));
  const filePath = path.join(root, 'gemini.json');
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`encrypted:${value}`),
    decryptStringAsync: async (value) => ({ result: value.toString().replace('encrypted:', '') }),
  };
  const calls = [];
  const connector = createGeminiConnector({ filePath, safeStorage, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url === 'https://oauth2.googleapis.com/token') return { ok: true, json: async () => ({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 }) };
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return { ok: true, json: async () => ({ email: 'gemini@example.com' }) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'OAuth Gemini reply' }] } }] }) };
  } });

  try {
    const connected = await connector.connect({
      clientId: 'test.apps.googleusercontent.com', clientSecret: 'client-secret', projectId: 'obavenus-test-123',
    }, async (rawUrl) => {
      const authorization = new URL(rawUrl);
      assert.equal(authorization.origin, 'https://accounts.google.com');
      assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
      assert.deepEqual(authorization.searchParams.get('scope').split(' '), SCOPES);
      const callback = new URL(authorization.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', authorization.searchParams.get('state'));
      callback.searchParams.set('code', 'test-auth-code');
      const response = await fetch(callback);
      assert.equal(response.status, 200);
    });
    assert.deepEqual(connected, { connected: true, email: 'gemini@example.com', projectId: 'obavenus-test-123' });
    const saved = await readFile(filePath, 'utf8');
    assert.equal(saved.includes('refresh-token'), false);
    assert.equal(saved.includes('client-secret'), false);
    assert.deepEqual(await connector.status(), { connected: true, email: 'gemini@example.com', projectId: 'obavenus-test-123' });

    assert.equal(await connector.generate({ model: 'gemini-3.8-flash', messages: [{ role: 'user', text: 'Say hello.' }] }), 'OAuth Gemini reply');
    const apiCall = calls.at(-1);
    assert.equal(apiCall.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    assert.equal(apiCall.options.headers.Authorization, 'Bearer access-token');
    assert.equal(apiCall.options.headers['x-goog-user-project'], 'obavenus-test-123');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Gemini OAuth rejects an invalid Cloud project ID before opening a browser', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-gemini-invalid-'));
  const connector = createGeminiConnector({ filePath: path.join(root, 'gemini.json'), safeStorage: {} });
  try {
    await assert.rejects(connector.connect({ clientId: 'test.apps.googleusercontent.com', clientSecret: 'client-secret', projectId: 'invalid project!' }, () => assert.fail('must not open browser')), /valid Google Cloud project ID/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
