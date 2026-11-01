const { createServer } = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { mkdir, readFile, unlink, writeFile, rename } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { searchStudySources } = require('./study-search.cjs');

const PROTOCOL_VERSION = '2025-11-25';
const ACCEPTED_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
const MAX_BODY_BYTES = 1024 * 1024;
const TOOL_LIST = [
  { name: 'study_list_courses', description: 'List the courses saved in the local Obavenus Study space.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'study_list_assignments', description: 'List assignment titles, due dates, status and course. Does not return student drafts or submit work.', inputSchema: { type: 'object', additionalProperties: false, properties: { courseId: { type: 'string', maxLength: 80 } } } },
  { name: 'study_get_assignment', description: 'Read one assignment prompt and checklist. The private editable draft is excluded.', inputSchema: { type: 'object', additionalProperties: false, properties: { assignmentId: { type: 'string', minLength: 16, maxLength: 80 } }, required: ['assignmentId'] } },
  { name: 'study_search_materials', description: 'Search imported local course files and return bounded excerpts with page or slide references.', inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', minLength: 1, maxLength: 300 }, courseId: { type: 'string', maxLength: 80 } }, required: ['query'] } },
  { name: 'study_list_flashcards', description: 'List a bounded set of review cards from the local Study space.', inputSchema: { type: 'object', additionalProperties: false, properties: { courseId: { type: 'string', maxLength: 80 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
].sort((a, b) => a.name.localeCompare(b.name)).map((tool) => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }));

function jsonResponse(id, result) { return { jsonrpc: '2.0', id, result }; }
function jsonError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function createStudyMcpServer({ filePath, safeStorage, loadStudy, port = 0 }) {
  let server = null;
  let savedConfig = null;
  let startPromise = null;

  async function readConfig() {
    if (savedConfig) return savedConfig;
    try {
      const envelope = JSON.parse(await readFile(filePath, 'utf8'));
      if (typeof envelope.encrypted !== 'string') throw new Error('Local Study MCP settings are invalid.');
      if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure MCP token storage is unavailable on this Mac.');
      savedConfig = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64')));
      if (!isObject(savedConfig) || typeof savedConfig.token !== 'string' || typeof savedConfig.enabled !== 'boolean') throw new Error('Local Study MCP settings are invalid.');
      return savedConfig;
    } catch (error) { if (error.code === 'ENOENT') return { enabled: false, token: '', port: 0 }; throw error; }
  }

  async function writeConfig(config) {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure MCP token storage is unavailable on this Mac.');
    await mkdir(path.dirname(filePath), { recursive: true });
    const target = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(target, JSON.stringify({ encrypted: safeStorage.encryptString(JSON.stringify(config)).toString('base64') }), { mode: 0o600 });
      await rename(target, filePath);
    } catch (error) {
      await unlink(target).catch(() => {});
      throw error;
    }
    savedConfig = config;
    return config;
  }

  function currentPort() { return server?.address()?.port || savedConfig?.port || port; }
  function endpoint() { return `http://127.0.0.1:${currentPort()}/mcp`; }

  function authorized(request) {
    const expectedHost = new Set([`127.0.0.1:${currentPort()}`, `localhost:${currentPort()}`]);
    if (!expectedHost.has(request.headers.host || '')) return false;
    const origin = request.headers.origin;
    if (origin) {
      let parsed;
      try { parsed = new URL(origin); } catch { return false; }
      if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== String(currentPort())) return false;
    }
    const header = request.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return false;
    const actual = Buffer.from(header.slice(7));
    const expected = Buffer.from(savedConfig?.token || '');
    return actual.length === expected.length && actual.length > 0 && timingSafeEqual(actual, expected);
  }

  async function readBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new RangeError('MCP request body exceeds the 1 MB limit.');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  async function callTool(name, args) {
    if (!isObject(args)) throw new TypeError('Tool arguments must be an object.');
    const data = await loadStudy();
    const courseName = new Map(data.courses.map((course) => [course.id, course.name]));
    let result;
    if (name === 'study_list_courses') {
      result = data.courses.map(({ id, name: title, term }) => ({ id, name: title, term }));
    } else if (name === 'study_list_assignments') {
      if (args.courseId !== undefined && typeof args.courseId !== 'string') throw new TypeError('courseId must be text.');
      result = data.assignments.filter((item) => !args.courseId || item.courseId === args.courseId).map(({ id, courseId, title, dueAt, status }) => ({ id, course: courseName.get(courseId) || 'Course', title, dueAt, status }));
    } else if (name === 'study_get_assignment') {
      if (typeof args.assignmentId !== 'string') throw new TypeError('assignmentId must be text.');
      const assignment = data.assignments.find((item) => item.id === args.assignmentId);
      if (!assignment) throw new Error('Assignment not found.');
      result = { course: courseName.get(assignment.courseId) || 'Course', title: assignment.title, instructions: assignment.instructions, dueAt: assignment.dueAt, status: assignment.status, checklist: assignment.steps.map(({ text, done }) => ({ text, done })) };
    } else if (name === 'study_search_materials') {
      if (typeof args.query !== 'string' || args.query.length > 300 || (args.courseId !== undefined && typeof args.courseId !== 'string')) throw new TypeError('Provide a search query of 1 to 300 characters and an optional course ID.');
      result = searchStudySources(data, args.query, args.courseId || '').slice(0, 8);
    } else if (name === 'study_list_flashcards') {
      if (args.courseId !== undefined && typeof args.courseId !== 'string') throw new TypeError('courseId must be text.');
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) throw new TypeError('limit must be an integer from 1 to 100.');
      const limit = args.limit || 50;
      result = data.decks.filter((deck) => !args.courseId || deck.courseId === args.courseId).flatMap((deck) => deck.cards.map(({ front, back, dueAt }) => ({ deck: deck.title, course: courseName.get(deck.courseId) || 'Personal deck', front, back, dueAt }))).slice(0, limit);
    } else throw new TypeError('Unknown Study tool.');
    return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false };
  }

  async function handleMessage(message) {
    if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return { status: 400, body: jsonError(message?.id ?? null, -32600, 'Invalid JSON-RPC request.') };
    const { id, method, params = {} } = message;
    if (!Object.hasOwn(message, 'id')) return { status: 202, body: null };
    if (typeof id !== 'string' && typeof id !== 'number') return { status: 400, body: jsonError(null, -32600, 'Request ID must be a string or number.') };
    if (!isObject(params)) return { status: 200, body: jsonError(id, -32602, 'Request params must be an object.') };
    try {
      if (method === 'initialize') {
        const requested = params.protocolVersion;
        return { status: 200, body: jsonResponse(id, { protocolVersion: ACCEPTED_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION, capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: { name: 'obavenus-study', version: '0.1.0' } }) };
      }
      if (method === 'ping') return { status: 200, body: jsonResponse(id, {}) };
      if (method === 'tools/list') return { status: 200, body: jsonResponse(id, { tools: TOOL_LIST }) };
      if (method === 'tools/call') {
        if (typeof params.name !== 'string' || !TOOL_LIST.some((tool) => tool.name === params.name)) return { status: 200, body: jsonError(id, -32602, 'Unknown Study tool.') };
        try { return { status: 200, body: jsonResponse(id, await callTool(params.name, params.arguments || {})) }; }
        catch (error) { return { status: 200, body: jsonResponse(id, { content: [{ type: 'text', text: error.message || 'Study tool failed.' }], isError: true }) }; }
      }
      if (method === 'resources/list') {
        const data = await loadStudy();
        return { status: 200, body: jsonResponse(id, { resources: data.sources.map((source) => ({ uri: `obavenus://study/source/${source.id}`, name: source.name, description: `${courseNameFor(data, source.courseId)} · local course material`, mimeType: 'text/plain', size: Buffer.byteLength(source.content) })).sort((a, b) => a.name.localeCompare(b.name)) }) };
      }
      if (method === 'resources/read') {
        const uri = params.uri;
        if (typeof uri !== 'string') return { status: 200, body: jsonError(id, -32602, 'A resource URI is required.') };
        const match = uri.match(/^obavenus:\/\/study\/source\/([a-f0-9-]{16,80})$/i);
        const source = match && (await loadStudy()).sources.find((item) => item.id === match[1]);
        if (!source) return { status: 200, body: jsonError(id, -32002, 'Study resource not found.') };
        return { status: 200, body: jsonResponse(id, { contents: [{ uri, mimeType: 'text/plain', text: source.content.slice(0, 50_000) }] }) };
      }
      return { status: 200, body: jsonError(id, -32601, 'Method not found.') };
    } catch (error) { return { status: 200, body: jsonError(id, -32603, error.message || 'Study MCP request failed.') }; }
  }

  function courseNameFor(data, courseId) { return data.courses.find((item) => item.id === courseId)?.name || 'Personal study file'; }

  async function handleHttp(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url !== '/mcp') { response.writeHead(404).end(); return; }
    if (!authorized(request)) { response.writeHead(403).end(); return; }
    if (request.method === 'GET') { response.writeHead(405, { Allow: 'POST, GET' }).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST, GET' }).end(); return; }
    if (!(request.headers['content-type'] || '').toLowerCase().includes('application/json')) { response.writeHead(415).end(); return; }
    const accept = request.headers.accept || '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) { response.writeHead(406).end(); return; }
    const version = request.headers['mcp-protocol-version'];
    if (version && !ACCEPTED_VERSIONS.has(version)) { response.writeHead(400).end(); return; }
    try {
      const result = await handleMessage(await readBody(request));
      if (result.body === null) { response.writeHead(result.status).end(); return; }
      const body = JSON.stringify(result.body);
      response.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...(version ? { 'MCP-Protocol-Version': version } : {}) }).end(body);
    } catch (error) {
      response.writeHead(error instanceof RangeError ? 413 : 400, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(jsonError(null, -32700, error instanceof SyntaxError ? 'Parse error.' : error.message)));
    }
  }

  async function listen(saved) {
    if (server?.listening) return;
    server = createServer((request, response) => { handleHttp(request, response).catch(() => { if (!response.headersSent) response.writeHead(500).end(); }); });
    server.on('clientError', (_error, socket) => socket.destroy());
    const tryPort = (value) => new Promise((resolve, reject) => {
      const onError = (error) => { server.removeListener('listening', onListening); reject(error); };
      const onListening = () => { server.removeListener('error', onError); resolve(); };
      server.once('error', onError); server.once('listening', onListening); server.listen(value, '127.0.0.1');
    });
    try { await tryPort(saved.port || port); }
    catch (error) {
      if (!saved.port || error.code !== 'EADDRINUSE') { server = null; throw error; }
      await tryPort(0);
    }
    saved.port = server.address().port;
    await writeConfig(saved);
  }

  return {
    async enable() {
      const config = await readConfig();
      config.token ||= randomBytes(32).toString('base64url');
      config.enabled = true;
      await writeConfig(config);
      await listen(config);
      return this.status();
    },
    async disable() {
      const config = await readConfig(); config.enabled = false; await writeConfig(config);
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      server = null;
      return this.status();
    },
    async startIfEnabled() {
      const config = await readConfig();
      if (!config.enabled) return this.status();
      if (startPromise) return startPromise;
      startPromise = listen(config).finally(() => { startPromise = null; });
      await startPromise;
      return this.status();
    },
    async rotateToken() {
      const config = await readConfig(); config.token = randomBytes(32).toString('base64url'); config.enabled = true;
      await writeConfig(config); await listen(config); return this.credentials();
    },
    async status() {
      const config = await readConfig();
      return { enabled: config.enabled, running: Boolean(server?.listening), endpoint: server?.listening ? endpoint() : '' };
    },
    async credentials() {
      const config = await readConfig();
      if (!config.enabled || !server?.listening) throw new Error('Start the local Study MCP server first.');
      return { endpoint: endpoint(), authorization: `Bearer ${config.token}` };
    },
    async close() { if (server?.listening) await new Promise((resolve) => server.close(resolve)); server = null; },
  };
}

module.exports = { ACCEPTED_VERSIONS, MAX_BODY_BYTES, PROTOCOL_VERSION, TOOL_LIST, createStudyMcpServer };
