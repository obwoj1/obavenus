const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { cleanMcpUrl, createMcpConnector, validTool, readOnlyTool } = require('../electron/mcp-connector.cjs');

function secureStorage() {
  return { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => Buffer.from(value).toString() };
}

function jsonRpcResponse(request, result, headers = {}) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
}

test('MCP server URLs require HTTPS and cannot contain user credentials', () => {
  assert.equal(cleanMcpUrl('https://school.example.edu/mcp'), 'https://school.example.edu/mcp');
  assert.throws(() => cleanMcpUrl('http://school.example.edu/mcp'), /HTTPS/);
  assert.throws(() => cleanMcpUrl('https://name:secret@school.example.edu/mcp'), /HTTPS/);
});

test('read-only MCP annotation is required while no-argument tools remain usable', () => {
  assert.equal(readOnlyTool({ name: 'list_courses', annotations: { readOnlyHint: true, openWorldHint: true }, inputSchema: { type: 'object' } }), true);
  assert.equal(readOnlyTool({ name: 'submit_work', annotations: { readOnlyHint: false }, inputSchema: { type: 'object', properties: {} } }), false);
  assert.equal(readOnlyTool({ name: 'delete_file', annotations: { readOnlyHint: true, destructiveHint: true }, inputSchema: { type: 'object' } }), false);
  assert.equal(validTool({ name: 'submit_work', annotations: { readOnlyHint: false }, inputSchema: { type: 'object', properties: {} } }), true);
  assert.equal(validTool({ name: 'bad', inputSchema: { type: 'array' } }), false);
});

test('MCP tools reach the assistant and every non-read-only call requires exact native approval', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-mcp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'mcp.enc');
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body); calls.push({ request, headers: options.headers });
    if (request.method === 'tools/list') return jsonRpcResponse(request, { tools: [
      { name: 'search_course', description: 'Search synced course material', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'submit_assignment', annotations: { readOnlyHint: false }, inputSchema: { type: 'object', properties: {} } },
    ] });
    return jsonRpcResponse(request, { content: [{ type: 'text', text: 'Page 3: enzyme activity.' }] });
  };
  const approvals = [];
  const connector = createMcpConnector({ filePath, safeStorage: secureStorage(), fetchImpl, confirmWriteAction: async (action) => { approvals.push(action); return false; } });
  const saved = await connector.addServer({ name: 'Courseware', url: 'https://school.example.edu/mcp', token: 'secret-mcp-token' });
  assert.equal(saved.readOnlyTools.length, 1);
  assert.deepEqual(saved.writeTools, ['submit_assignment']);
  assert.equal((await readFile(filePath, 'utf8')).includes('secret-mcp-token'), false);
  assert.deepEqual((await connector.listServers())[0].readOnlyTools, ['search_course']);
  assert.deepEqual((await connector.listServers())[0].writeTools, ['submit_assignment']);
  const exposed = await connector.getAgentTools();
  assert.equal(exposed.definitions.length, 2);
  assert.match(exposed.definitions[0].name, /^mcp_[a-f0-9]+_search_course$/);
  assert.match(exposed.definitions[1].description, /WRITE ACTION.*approval for every call/);
  const output = await exposed.execute(exposed.definitions[0].name, { query: 'enzyme' });
  assert.match(output.text, /Page 3/);
  const beforeDeclinedAction = calls.length;
  const declined = await exposed.execute(exposed.definitions[1].name, { assignment_id: 'A7', answer: 'review me' });
  assert.equal(declined.isError, true);
  assert.equal(calls.length, beforeDeclinedAction);
  assert.deepEqual(approvals, [{ serverName: 'Courseware', serverUrl: 'https://school.example.edu/mcp', toolName: 'submit_assignment', description: '', arguments: '{"assignment_id":"A7","answer":"review me"}' }]);
  const approvedConnector = createMcpConnector({ filePath, safeStorage: secureStorage(), fetchImpl, confirmWriteAction: async () => true });
  const approvedTools = await approvedConnector.getAgentTools();
  const approved = await approvedTools.execute(approvedTools.definitions[1].name, { assignment_id: 'A7', answer: 'review me' });
  assert.equal(approved.isError, false);
  assert.equal(calls.at(-1).request.method, 'tools/call');
  assert.ok(calls.every(({ headers }) => headers.Authorization === 'Bearer secret-mcp-token'));
  assert.equal(calls.at(-1).headers['MCP-Protocol-Version'], '2026-07-28');
  const beforeOversizedAction = calls.length;
  await assert.rejects(exposed.execute(exposed.definitions[1].name, { payload: 'x'.repeat(4_100) }), /4 KB approval dialog limit/);
  assert.equal(calls.length, beforeOversizedAction);
  assert.equal((await connector.removeServer(saved.id)).length, 0);
});

test('legacy MCP server falls back to initialization and keeps its session for the read call', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-mcp-'));
  const filePath = path.join(directory, 'mcp.enc');
  const seenSessions = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.method === 'tools/list' && options.headers['MCP-Protocol-Version'] === '2026-07-28') return new Response('unsupported', { status: 400 });
    if (request.method === 'initialize') return jsonRpcResponse(request, { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'Legacy', version: '1' } }, { 'Mcp-Session-Id': 'session-1' });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    seenSessions.push(options.headers['Mcp-Session-Id']);
    if (request.method === 'tools/list') return jsonRpcResponse(request, { tools: [{ name: 'lookup', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: {} } }] });
    return jsonRpcResponse(request, { content: [{ type: 'text', text: 'read result' }] });
  };
  const connector = createMcpConnector({ filePath, safeStorage: secureStorage(), fetchImpl });
  try {
    const server = await connector.addServer({ name: 'Legacy', url: 'https://legacy.example.edu/mcp' });
    const tools = await connector.getAgentTools();
    assert.equal((await tools.execute(tools.definitions[0].name, {})).text, 'read result');
    assert.ok(seenSessions.length > 0 && seenSessions.every((id) => id === 'session-1'));
    assert.equal(server.readOnlyTools[0], 'lookup');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('advertised MCP resources and simple URI templates are readable and scoped to their server', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-mcp-resources-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'mcp.enc');
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body); calls.push({ request, headers: options.headers });
    if (request.method === 'tools/list') return jsonRpcResponse(request, { tools: [] });
    if (request.method === 'resources/list') return jsonRpcResponse(request, { resources: [{ uri: 'canvas://course/biology', name: 'Biology course', mimeType: 'text/plain' }] });
    if (request.method === 'resources/templates/list') return jsonRpcResponse(request, { resourceTemplates: [{ uriTemplate: 'canvas://course/{courseId}/assignments', name: 'Assignments' }] });
    if (request.method === 'resources/read') return jsonRpcResponse(request, { contents: [{ uri: request.params.uri, mimeType: 'text/plain', text: 'Course assignments and due dates.' }] });
    throw new Error(`Unexpected method ${request.method}`);
  };
  const connector = createMcpConnector({ filePath, safeStorage: secureStorage(), fetchImpl });
  const server = await connector.addServer({ name: 'Canvas', url: 'https://canvas.example.edu/mcp', token: 'canvas-token' });
  assert.equal(server.resources.length, 1);
  assert.equal(server.resourceTemplates.length, 1);
  assert.equal((await connector.listServers())[0].resources[0].uri, 'canvas://course/biology');
  const agent = await connector.getAgentTools();
  assert.equal(agent.definitions.length, 1);
  const name = agent.definitions[0].name;
  assert.match((await agent.execute(name, { uri: 'canvas://course/biology' })).text, /assignments and due dates/);
  assert.match((await agent.execute(name, { uri: 'canvas://course/123/assignments' })).text, /assignments and due dates/);
  await assert.rejects(agent.execute(name, { uri: 'https://attacker.example/steal' }), /not advertised/);
  assert.equal(calls.filter(({ request }) => request.method === 'resources/read').length, 2);
  assert.ok(calls.every(({ headers }) => headers.Authorization === 'Bearer canvas-token'));
});

test('MCP resources remain optional for servers that do not implement resource methods', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-mcp-no-resources-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.method === 'tools/list') return jsonRpcResponse(request, { tools: [] });
    return jsonRpcResponse(request, null, { error: 'method unavailable' });
  };
  const connector = createMcpConnector({ filePath: path.join(directory, 'mcp.enc'), safeStorage: secureStorage(), fetchImpl });
  const server = await connector.addServer({ name: 'Tools only', url: 'https://tools.example.edu/mcp' });
  assert.deepEqual(server.resources, []);
  assert.deepEqual(server.resourceTemplates, []);
  assert.deepEqual((await connector.getAgentTools()).definitions, []);
});
