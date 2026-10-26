const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createGmailConnector, SCOPE } = require('../electron/gmail.cjs');

test('Gmail connector is read-only and lists only message metadata and snippets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-gmail-'));
  const filePath = path.join(root, 'gmail.json');
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`enc:${value}`),
    decryptStringAsync: async (value) => ({ result: value.toString().replace('enc:', '') }),
  };
  await writeFile(filePath, JSON.stringify({
    clientId: 'client.apps.googleusercontent.com',
    encryptedClientSecret: Buffer.from('enc:secret').toString('base64'),
    encryptedRefreshToken: Buffer.from('enc:refresh').toString('base64'),
    encryptedAccessToken: Buffer.from('enc:access').toString('base64'),
    expiresAt: Date.now() + 60_000,
    email: 'user@example.com',
  }));
  const calls = [];
  const connector = createGmailConnector({
    filePath,
    safeStorage,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes('/messages?')) return { ok: true, json: async () => ({ messages: [{ id: 'message-id' }] }) };
      return { ok: true, json: async () => ({ snippet: 'Preview only', payload: { headers: [
        { name: 'From', value: 'sender@example.com' }, { name: 'Subject', value: 'Hello' }, { name: 'Date', value: 'Today' },
      ] } }) };
    },
  });

  try {
    assert.deepEqual(await connector.status(), { connected: true, email: 'user@example.com' });
    assert.equal(SCOPE, 'https://www.googleapis.com/auth/gmail.readonly');
    const messages = await connector.search('from:sender@example.com');
    assert.deepEqual(messages, [{ id: 'message-id', from: 'sender@example.com', subject: 'Hello', date: 'Today', snippet: 'Preview only' }]);
    assert.match(calls[0].url, /q=from%3Asender/);
    assert.match(calls[1].url, /format=metadata/);
    assert.equal(calls[1].options.headers.Authorization, 'Bearer access');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Gmail OAuth asks for read-only access and validates its loopback state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-gmail-oauth-'));
  const filePath = path.join(root, 'gmail.json');
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`enc:${value}`),
    decryptStringAsync: async (value) => ({ result: value.toString().replace('enc:', '') }),
  };
  let tokenBody;
  const connector = createGmailConnector({ filePath, safeStorage, fetchImpl: async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenBody = new URLSearchParams(options.body);
      return { ok: true, json: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }) };
    }
    return { ok: true, json: async () => ({ emailAddress: 'test@example.com' }) };
  } });
  try {
    await connector.connect('test.apps.googleusercontent.com', 'client-secret', async (rawUrl) => {
      const authorization = new URL(rawUrl);
      assert.equal(authorization.searchParams.get('scope'), SCOPE);
      assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
      const callback = new URL(authorization.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', authorization.searchParams.get('state'));
      callback.searchParams.set('code', 'test-auth-code');
      const response = await fetch(callback);
      assert.equal(response.status, 200);
    });
    assert.equal(tokenBody.get('code'), 'test-auth-code');
    assert.ok(tokenBody.get('code_verifier'));
    assert.equal((await connector.status()).email, 'test@example.com');
    assert.deepEqual(await connector.getOAuthClientCredentials(), { clientId: 'test.apps.googleusercontent.com', clientSecret: 'client-secret' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
