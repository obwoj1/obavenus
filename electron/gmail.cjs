const { createHash, randomBytes } = require('node:crypto');
const http = require('node:http');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function createGmailConnector({ filePath, safeStorage, fetchImpl = globalThis.fetch }) {
  async function readSaved() {
    try { return JSON.parse(await readFile(filePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }

  async function saveSaved(value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(value), { mode: 0o600 });
  }

  async function encrypt(value) {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Secure key storage is unavailable on this device.');
    return (await safeStorage.encryptStringAsync(value)).toString('base64');
  }

  async function decrypt(value) {
    if (!value) return null;
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Secure key storage is unavailable on this device.');
    return (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result;
  }

  async function connect(clientId, clientSecret, openExternal) {
    if (typeof clientId !== 'string' || !clientId.endsWith('.apps.googleusercontent.com')) throw new TypeError('Enter a valid Google OAuth desktop client ID.');
    if (typeof clientSecret !== 'string' || clientSecret.trim().length < 8) throw new TypeError('Enter the OAuth client secret from your Google Cloud desktop credentials.');
    const state = randomBytes(24).toString('hex');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const server = http.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
    const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();

    try {
      const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Gmail sign-in timed out. Try connecting again.')), 180_000);
        server.on('request', (request, response) => {
          const callback = new URL(request.url, redirectUri);
          if (callback.pathname !== '/oauth2callback') { response.writeHead(404).end(); return; }
          if (callback.searchParams.get('state') !== state) {
            response.writeHead(400).end('Sign-in state did not match. You can close this tab.');
            clearTimeout(timer);
            reject(new Error('Gmail sign-in state did not match.'));
            return;
          }
          const error = callback.searchParams.get('error');
          const authCode = callback.searchParams.get('code');
          response.writeHead(error || !authCode ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end('<!doctype html><title>Obavenus Gmail</title><p>You can close this tab and return to Obavenus.</p>');
          clearTimeout(timer);
          if (error || !authCode) reject(new Error('Google sign-in was cancelled or denied.'));
          else resolve(authCode);
        });
        openExternal(authorizationUrl.toString()).catch((error) => { clearTimeout(timer); reject(error); });
      });
      const tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret || '', code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }),
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.refresh_token) throw new Error(tokens.error_description || 'Google did not return a refresh token. Reconnect and grant access.');
      const previous = await readSaved();
      await saveSaved({ clientId, encryptedClientSecret: await encrypt(clientSecret || ''), encryptedRefreshToken: await encrypt(tokens.refresh_token), encryptedAccessToken: await encrypt(tokens.access_token), expiresAt: Date.now() + tokens.expires_in * 1000, email: previous.email || '' });
      const profile = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const profileBody = await profile.json();
      if (profile.ok && profileBody.emailAddress) await saveSaved({ ...(await readSaved()), email: profileBody.emailAddress });
      return { connected: true };
    } finally {
      server.close();
    }
  }

  async function accessToken() {
    const saved = await readSaved();
    const access = await decrypt(saved.encryptedAccessToken);
    if (access && saved.expiresAt > Date.now() + 30_000) return access;
    const refreshToken = await decrypt(saved.encryptedRefreshToken);
    const clientSecret = await decrypt(saved.encryptedClientSecret);
    if (!refreshToken) throw new Error('Connect Gmail in Settings first.');
    const refreshed = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: saved.clientId, client_secret: clientSecret || '', refresh_token: refreshToken, grant_type: 'refresh_token' }),
    });
    const tokens = await refreshed.json();
    if (!refreshed.ok) throw new Error(tokens.error_description || 'Could not refresh Gmail authorization. Reconnect Gmail.');
    await saveSaved({ ...saved, encryptedAccessToken: await encrypt(tokens.access_token), expiresAt: Date.now() + tokens.expires_in * 1000 });
    return tokens.access_token;
  }

  return {
    async status() { const saved = await readSaved(); return { connected: Boolean(saved.encryptedRefreshToken), email: saved.email || '' }; },
    connect,
    async disconnect() { await saveSaved({}); return true; },
    async search(query = '') {
      const token = await accessToken();
      const params = new URLSearchParams({ maxResults: '20', q: query || 'in:inbox' });
      const list = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const listed = await list.json();
      if (!list.ok) throw new Error(listed.error?.message || 'Could not load Gmail messages.');
      return Promise.all((listed.messages || []).slice(0, 20).map(async ({ id }) => {
        const response = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${token}` } });
        const message = await response.json();
        if (!response.ok) throw new Error(message.error?.message || 'Could not load an email.');
        const headers = Object.fromEntries((message.payload?.headers || []).map((header) => [header.name.toLowerCase(), header.value]));
        return { id, from: headers.from || '', subject: headers.subject || '(no subject)', date: headers.date || '', snippet: message.snippet || '' };
      }));
    },
  };
}

module.exports = { SCOPE, createGmailConnector };
