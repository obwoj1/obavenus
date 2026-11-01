const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { cleanCanvasBaseUrl, createCanvasConnector } = require('../electron/canvas-connector.cjs');

function encryptedStorage() {
  return { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => Buffer.from(value).toString() };
}

test('Canvas URLs are restricted to HTTPS origins without embedded secrets', () => {
  assert.equal(cleanCanvasBaseUrl('https://school.example.edu/courses/1'), 'https://school.example.edu');
  assert.throws(() => cleanCanvasBaseUrl('http://school.example.edu'), /HTTPS/);
  assert.throws(() => cleanCanvasBaseUrl('https://student:secret@school.example.edu'), /HTTPS/);
});

test('Canvas credentials are encrypted, hidden from status, and sync idempotently', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-canvas-'));
  const filePath = path.join(directory, 'canvas.enc');
  const requests = [];
  let decryptCalls = 0;
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.Authorization });
    if (String(url).endsWith('/users/self/profile')) return { ok: true, status: 200, json: async () => ({ name: 'Student' }), headers: { get: () => '' } };
    if (String(url).includes('/courses?')) return { ok: true, status: 200, json: async () => [{ id: 17, name: 'Biology', term: { name: 'Fall' } }], headers: { get: () => '' } };
    return { ok: true, status: 200, json: async () => [{ id: 29, name: 'Lab report', description: '<p>Use <b>course data</b>.</p>', due_at: '2026-11-15T23:59:00Z' }], headers: { get: () => '' } };
  };
  const secureStorage = encryptedStorage();
  secureStorage.decryptString = (value) => { decryptCalls += 1; return Buffer.from(value).toString(); };
  const connector = createCanvasConnector({ filePath, safeStorage: secureStorage, fetchImpl, now: () => 100 });
  const study = {
    data: { version: 1, courses: [], assignments: [], notes: [], decks: [] },
    async load() { return structuredClone(this.data); },
    async save(value) { this.data = structuredClone(value); return this.data; },
  };
  try {
    const result = await connector.connect({ baseUrl: 'https://school.example.edu', token: 'secret-token' });
    assert.equal(result.connected, true);
    assert.deepEqual(await connector.status(), { connected: true, baseUrl: 'https://school.example.edu' });
    assert.equal(decryptCalls, 0, 'opening Study status must not unlock the Canvas token');
    const envelope = await readFile(filePath, 'utf8');
    assert.equal(envelope.includes('secret-token'), false);
    assert.deepEqual(await connector.sync(study), { courses: 1, assignments: 1, syncedAt: 100 });
    assert.equal(study.data.courses[0].name, 'Biology');
    assert.equal(study.data.assignments[0].instructions, 'Use course data.');
    assert.deepEqual(await connector.sync(study), { courses: 0, assignments: 0, syncedAt: 100 });
    assert.equal(study.data.assignments.length, 1);
    assert.ok(requests.every((request) => request.authorization === 'Bearer secret-token'));
    await connector.disconnect();
    assert.deepEqual(await connector.status(), { connected: false, baseUrl: '' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Canvas surfaces authorization errors without returning credential data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-canvas-'));
  try {
    const connector = createCanvasConnector({ filePath: path.join(directory, 'canvas.enc'), safeStorage: encryptedStorage(), fetchImpl: async () => ({ ok: false, status: 401 }) });
    await assert.rejects(connector.connect({ baseUrl: 'https://school.example.edu', token: 'private' }), /rejected this access token/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
