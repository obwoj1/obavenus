const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { cleanMcpUrl, createMcpConnector, readOnlyTool } = require('../electron/mcp-connector.cjs');

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
});

test('remote MCP credentials stay encrypted and only read-only tools reach the assistant', async (t) => {
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
  const connector = createMcpConnector({ filePath, safeStorage: secureStorage(), fetchImpl });
  const saved = await connector.addServer({ name: 'Courseware', url: 'https://school.example.edu/mcp', token: 'secret-mcp-token' });
  assert.equal(saved.readOnlyTools.length, 1);
  assert.equal((await readFile(filePath, 'utf8')).includes('secret-mcp-token'), false);
  assert.deepEqual((await connector.listServers())[0].readOnlyTools, ['search_course']);
  const exposed = await connector.getAgentTools();
  assert.equal(exposed.definitions.length, 1);
  assert.match(exposed.definitions[0].name, /^mcp_[a-f0-9]+_search_course$/);
  const output = await exposed.execute(exposed.definitions[0].name, { query: 'enzyme' });
  assert.match(output.text, /Page 3/);
  assert.ok(calls.every(({ headers }) => headers.Authorization === 'Bearer secret-mcp-token'));
  assert.equal(calls.at(-1).headers['MCP-Protocol-Version'], '2026-07-28');
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
