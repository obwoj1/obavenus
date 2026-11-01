const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStudyMcpServer } = require('../electron/study-mcp-server.cjs');

const ids = { course: '1111111111111111', assignment: '2222222222222222', source: '3333333333333333', deck: '4444444444444444' };
const fixture = {
  courses: [{ id: ids.course, name: 'Biology', term: 'Fall' }],
  assignments: [{ id: ids.assignment, courseId: ids.course, title: 'Cell report', instructions: 'Explain cellular respiration.', draft: 'PRIVATE DRAFT', dueAt: 123, status: 'todo', steps: [{ id: '5555555555555555', text: 'Read chapter', done: false }] }],
  sources: [{ id: ids.source, courseId: ids.course, name: 'Cells.pdf', content: 'Page 2\nMitochondria produce ATP through cellular respiration.' }],
  decks: [{ id: ids.deck, courseId: ids.course, title: 'Cells', cards: [{ id: '6666666666666666', front: 'What produces ATP?', back: 'Mitochondria', dueAt: 0 }] }],
};

function storage() {
  return { isEncryptionAvailable: () => true, encryptString: (text) => Buffer.from(text), decryptString: (buffer) => buffer.toString() };
}

test('local Study MCP is authenticated, read-only, and serves bounded local study data', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-study-mcp-'));
  const server = createStudyMcpServer({ filePath: path.join(directory, 'settings.enc'), safeStorage: storage(), loadStudy: async () => fixture });
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });

  assert.equal((await server.status()).running, false);
  const status = await server.enable();
  assert.equal(status.running, true);
  assert.match(status.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.equal(JSON.stringify(status).includes('Bearer'), false);

  const credentials = await server.credentials();
  const headers = { authorization: credentials.authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const request = async (message, extraHeaders = {}) => fetch(credentials.endpoint, { method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(message) });
  const rpc = async (method, params = {}, id = 1) => {
    const response = await request({ jsonrpc: '2.0', id, method, params });
    return { status: response.status, body: await response.json() };
  };

  const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(initialized.body.result.protocolVersion, '2025-11-25');
  assert.equal((await rpc('tools/list')).body.result.tools.length, 5);
  assert.ok((await rpc('tools/list')).body.result.tools.every((tool) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));

  const assignment = await rpc('tools/call', { name: 'study_get_assignment', arguments: { assignmentId: ids.assignment } });
  assert.match(assignment.body.result.content[0].text, /cellular respiration/);
  assert.doesNotMatch(assignment.body.result.content[0].text, /PRIVATE DRAFT/);
  const search = await rpc('tools/call', { name: 'study_search_materials', arguments: { query: 'mitochondria ATP' } });
  assert.match(search.body.result.content[0].text, /Page 2/);
  assert.equal((await rpc('resources/list')).body.result.resources[0].name, 'Cells.pdf');
  const read = await rpc('resources/read', { uri: `obavenus://study/source/${ids.source}` });
  assert.match(read.body.result.contents[0].text, /cellular respiration/);

  const denied = await request({ jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer invalid' });
  assert.equal(denied.status, 403);
  const badOrigin = await request({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' });
  assert.equal(badOrigin.status, 403);
  const badVersion = await request({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '1900-01-01' });
  assert.equal(badVersion.status, 400);
  assert.equal((await fetch(credentials.endpoint, { headers })).status, 405);

  const oldToken = credentials.authorization;
  const rotated = await server.rotateToken();
  assert.notEqual(rotated.authorization, oldToken);
  const oldAuthResponse = await fetch(rotated.endpoint, { method: 'POST', headers: { ...headers, authorization: oldToken }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
  assert.equal(oldAuthResponse.status, 403);
  const newAuthResponse = await fetch(rotated.endpoint, { method: 'POST', headers: { ...headers, authorization: rotated.authorization }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
  assert.equal(newAuthResponse.status, 200);
  assert.deepEqual((await newAuthResponse.json()).result, {});

  assert.equal((await server.disable()).running, false);
});
