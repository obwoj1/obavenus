const { mkdir, readFile, rename, writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const MCP_VERSION = '2026-07-28';
const MAX_SERVERS = 12;
const MAX_TOOLS_PER_SERVER = 40;
const MAX_RESOURCES_PER_SERVER = 40;
const MAX_RESOURCE_TEMPLATES_PER_SERVER = 20;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RESOURCE_OUTPUT_BYTES = 60_000;

function cleanMcpUrl(value) {
  if (typeof value !== 'string' || value.length > 1500) throw new TypeError('Enter the MCP server URL.');
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new TypeError('MCP servers must use an HTTPS URL without embedded credentials, query parameters, or fragments.');
  return url.toString();
}

function validTool(tool) {
  if (!tool || typeof tool.name !== 'string' || !/^[a-zA-Z0-9_.-]{1,80}$/.test(tool.name)) return false;
  if (!tool.inputSchema || tool.inputSchema.type !== 'object' || (tool.inputSchema.properties !== undefined && (typeof tool.inputSchema.properties !== 'object' || Array.isArray(tool.inputSchema.properties)))) return false;
  return Buffer.byteLength(JSON.stringify(tool.inputSchema)) <= 24_000;
}

function readOnlyTool(tool) {
  return validTool(tool) && tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint !== true;
}

function cleanResource(resource) {
  if (!resource || typeof resource.uri !== 'string' || resource.uri.length > 1200 || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(resource.uri)) return null;
  return {
    uri: resource.uri,
    name: String(resource.name || resource.uri).slice(0, 160),
    title: typeof resource.title === 'string' ? resource.title.slice(0, 160) : '',
    description: typeof resource.description === 'string' ? resource.description.slice(0, 500) : '',
    mimeType: typeof resource.mimeType === 'string' ? resource.mimeType.slice(0, 120) : '',
  };
}

function cleanResourceTemplate(template) {
  if (!template || typeof template.uriTemplate !== 'string' || template.uriTemplate.length > 1200 || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(template.uriTemplate)) return null;
  return {
    uriTemplate: template.uriTemplate,
    name: String(template.name || template.uriTemplate).slice(0, 160),
    title: typeof template.title === 'string' ? template.title.slice(0, 160) : '',
    description: typeof template.description === 'string' ? template.description.slice(0, 500) : '',
    mimeType: typeof template.mimeType === 'string' ? template.mimeType.slice(0, 120) : '',
  };
}

function resourceUriAllowed(uri, resources, templates) {
  if (typeof uri !== 'string' || uri.length > 1200) return false;
  if (resources.some((resource) => resource.uri === uri)) return true;
  return templates.some(({ uriTemplate }) => {
    const parts = uriTemplate.split(/(\{[a-zA-Z_][a-zA-Z0-9_]*\})/g);
    if (parts.some((part) => (part.includes('{') || part.includes('}')) && !/^\{[a-zA-Z_][a-zA-Z0-9_]*\}$/.test(part))) return false;
    const pattern = parts.map((part) => /^\{[a-zA-Z_][a-zA-Z0-9_]*\}$/.test(part) ? '[^/?#]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
    return new RegExp(`^${pattern}$`).test(uri);
  });
}

function unsupportedMethod(error) {
  return [400, 404, 405, 406, 415, 501].includes(error.status) || [-32601, -32002].includes(error.rpcCode);
}

function decodeResponse(body, contentType) {
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new RangeError('The MCP server response is larger than 2 MB.');
  if (contentType.includes('text/event-stream')) {
    const payloads = [...body.matchAll(/^data:\s*(.+)$/gm)].map((match) => match[1]).filter((line) => line !== '[DONE]');
    if (!payloads.length) throw new Error('The MCP server returned an empty event stream.');
    return JSON.parse(payloads.at(-1));
  }
  return JSON.parse(body);
}

async function readResponseBody(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return response.text();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new RangeError('The MCP server response is larger than 2 MB.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

function createMcpConnector({ filePath, safeStorage, fetchImpl = globalThis.fetch, confirmWriteAction = async () => false }) {
  let cachedConfig;
  async function readConfig() {
    if (cachedConfig) return cachedConfig;
    try {
      const envelope = JSON.parse(await readFile(filePath, 'utf8'));
      if (typeof envelope.encrypted !== 'string' || !safeStorage?.isEncryptionAvailable()) throw new Error('Secure MCP credential storage is unavailable on this Mac.');
      cachedConfig = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64')));
      return cachedConfig;
    } catch (error) {
      if (error.code === 'ENOENT') return { servers: [] };
      throw error;
    }
  }

  async function writeConfig(config) {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure MCP credential storage is unavailable on this Mac.');
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(config)).toString('base64');
      const servers = config.servers.map(({ id, name, url, tools = [], writeTools = [], resources = [], resourceTemplates = [] }) => ({ id, name, url, tools, writeTools, resources, resourceTemplates }));
      await writeFile(temporary, JSON.stringify({ version: 1, servers, encrypted }), { mode: 0o600 });
      await rename(temporary, filePath);
      cachedConfig = config;
    } catch (error) {
      await require('node:fs/promises').unlink(temporary).catch(() => {});
      throw error;
    }
  }

  async function post(config, method, params, { version = MCP_VERSION, sessionId = '', toolName = '' } = {}) {
    const id = randomUUID();
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': version,
      'Mcp-Method': method,
      'Mcp-Name': toolName || method,
    };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    const response = await fetchImpl(config.url, {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'Obavenus', version: '0.1.50' } } } }),
    });
    if (!response.ok) throw Object.assign(new Error(`MCP server returned HTTP ${response.status}.`), { status: response.status });
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_RESPONSE_BYTES) throw new RangeError('The MCP server response is larger than 2 MB.');
    const message = decodeResponse(await readResponseBody(response), response.headers.get('content-type') || 'application/json');
    if (message?.error) throw Object.assign(new Error(`MCP ${method} failed: ${String(message.error.message || 'server error').slice(0, 300)}`), { rpcCode: message.error.code });
    if (!message || message.jsonrpc !== '2.0' || message.id !== id || !('result' in message)) throw new Error('The MCP server returned an invalid response.');
    return { result: message.result, sessionId: response.headers.get('Mcp-Session-Id') || sessionId };
  }

  async function connect(config) {
    try {
      const listed = await post(config, 'tools/list', {});
      return { ...listed, version: MCP_VERSION };
    } catch (modernError) {
      if (![400, 404, 405, 406, 415, 501].includes(modernError.status) && ![-32601, -32002].includes(modernError.rpcCode)) throw modernError;
      const initialized = await post(config, 'initialize', {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Obavenus', version: '0.1.50' },
      }, { version: '2025-11-25' });
      if (!initialized.result?.protocolVersion) throw new Error('The MCP server did not complete its initialization handshake.');
      const sessionId = initialized.sessionId;
      const notified = await fetchImpl(config.url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': initialized.result.protocolVersion, ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}), ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      });
      if (!notified.ok && notified.status !== 202) throw new Error(`MCP initialization notification failed (${notified.status}).`);
      const listed = await post(config, 'tools/list', {}, { version: initialized.result.protocolVersion, sessionId });
      return { ...listed, sessionId: listed.sessionId || sessionId, version: initialized.result.protocolVersion };
    }
  }

  async function listTools(config) {
    let connection = await connect(config);
    const tools = [];
    let cursor;
    for (let page = 0; page < 5; page += 1) {
      const pageResult = connection.result;
      if (!Array.isArray(pageResult?.tools)) throw new Error('The MCP server did not return a tool list.');
      tools.push(...pageResult.tools);
      cursor = pageResult.nextCursor;
      if (!cursor || tools.length >= MAX_TOOLS_PER_SERVER) break;
      const next = await post(config, 'tools/list', { cursor }, { version: connection.version, sessionId: connection.sessionId });
      connection = { ...next, version: connection.version, sessionId: next.sessionId || connection.sessionId };
    }
    return { connection, tools: tools.slice(0, MAX_TOOLS_PER_SERVER) };
  }

  async function listCatalog(config, connection, method, key, limit, cleaner) {
    const items = [];
    let cursor;
    for (let page = 0; page < 5; page += 1) {
      let response;
      try {
        response = await post(config, method, cursor ? { cursor } : {}, { version: connection.version, sessionId: connection.sessionId });
      } catch (error) {
        if (unsupportedMethod(error)) return [];
        throw error;
      }
      const result = response.result;
      if (!Array.isArray(result?.[key])) return [];
      items.push(...result[key].map(cleaner).filter(Boolean));
      cursor = result.nextCursor;
      if (!cursor || items.length >= limit) break;
    }
    return items.slice(0, limit);
  }

  async function discoverCatalog(config, connection) {
    const [resources, resourceTemplates] = await Promise.all([
      listCatalog(config, connection, 'resources/list', 'resources', MAX_RESOURCES_PER_SERVER, cleanResource),
      listCatalog(config, connection, 'resources/templates/list', 'resourceTemplates', MAX_RESOURCE_TEMPLATES_PER_SERVER, cleanResourceTemplate),
    ]);
    return { resources, resourceTemplates };
  }

  async function readRemoteResource(server, connection, resources, resourceTemplates, uri) {
    if (!resourceUriAllowed(uri, resources, resourceTemplates)) throw new Error('That resource URI was not advertised by this MCP server.');
    const response = await post(server, 'resources/read', { uri }, { version: connection.version, sessionId: connection.sessionId });
    const contents = Array.isArray(response.result?.contents) ? response.result.contents : [];
    const output = contents.slice(0, 40).map((item) => {
      if (typeof item.text === 'string') return `[${String(item.uri || uri).slice(0, 1200)}${item.mimeType ? ` · ${String(item.mimeType).slice(0, 120)}` : ''}]\n${item.text}`;
      if (typeof item.blob === 'string') return `[${String(item.uri || uri).slice(0, 1200)} · binary content omitted]`;
      return '';
    }).filter(Boolean).join('\n\n');
    if (Buffer.byteLength(output) > MAX_RESOURCE_OUTPUT_BYTES) throw new RangeError('MCP resource output is over 60 KB and was not passed to the assistant.');
    return { text: output, isError: false };
  }

  async function callRemote(config, connection, name, args) {
    const response = await post(config, 'tools/call', { name, arguments: args }, { version: connection.version, sessionId: connection.sessionId, toolName: name });
    const content = Array.isArray(response.result?.content) ? response.result.content : [];
    const output = content.map((item) => item.type === 'text' ? item.text : item.type === 'image' ? '[Image result omitted]' : '').filter(Boolean).join('\n');
    if (Buffer.byteLength(output) > 60_000) throw new RangeError('MCP tool output is over 60 KB and was not passed to the assistant.');
    const structuredContent = response.result?.structuredContent ?? null;
    if (structuredContent !== null && Buffer.byteLength(JSON.stringify(structuredContent)) > 60_000) throw new RangeError('MCP structured output is over 60 KB and was not passed to the assistant.');
    return { text: output.slice(0, 60_000), structuredContent, isError: response.result?.isError === true };
  }

  return {
    async listServers() {
      try {
        const envelope = JSON.parse(await readFile(filePath, 'utf8'));
        return Array.isArray(envelope.servers) ? envelope.servers.map(({ id, name, url, tools = [], writeTools = [], resources = [], resourceTemplates = [] }) => ({ id, name, url, readOnlyTools: tools, writeTools, resources, resourceTemplates })) : [];
      } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    },
    async addServer({ name, url, token = '' }) {
      const config = { id: randomUUID(), name: String(name || '').trim().slice(0, 80), url: cleanMcpUrl(url), token: String(token || '').trim() };
      if (!config.name) throw new TypeError('Give this MCP connection a name.');
      if (config.token.length > 4096 || /[\r\n]/.test(config.token)) throw new TypeError('MCP bearer tokens must be at most 4,096 characters and single-line.');
      const current = await readConfig();
      if (current.servers.length >= MAX_SERVERS) throw new RangeError(`Obavenus supports up to ${MAX_SERVERS} MCP servers.`);
      if (current.servers.some((server) => server.url === config.url)) throw new Error('That MCP server URL is already connected.');
      const { connection, tools } = await listTools(config);
      config.tools = tools.filter(readOnlyTool).map((tool) => tool.name);
      config.writeTools = tools.filter((tool) => validTool(tool) && !readOnlyTool(tool)).map((tool) => tool.name);
      try { Object.assign(config, await discoverCatalog(config, connection)); }
      catch { config.resources = []; config.resourceTemplates = []; }
      current.servers.push(config);
      await writeConfig(current);
      return { id: config.id, name: config.name, url: config.url, readOnlyTools: config.tools, writeTools: config.writeTools, resources: config.resources, resourceTemplates: config.resourceTemplates };
    },
    async removeServer(id) {
      const current = await readConfig();
      const before = current.servers.length;
      current.servers = current.servers.filter((server) => server.id !== id);
      if (current.servers.length === before) throw new Error('MCP server connection was not found.');
      await writeConfig(current);
      return this.listServers();
    },
    async getAgentTools() {
      const current = await readConfig();
      const definitions = [];
      const mapping = new Map();
      const failures = [];
      for (const server of current.servers) {
        try {
          const { connection, tools } = await listTools(server);
          let catalog = { resources: [], resourceTemplates: [] };
          try { catalog = await discoverCatalog(server, connection); }
          catch (error) { failures.push(`${server.name} resources: ${error.message || 'discovery failed'}`); }
          for (const tool of tools.filter(validTool)) {
            const readOnly = readOnlyTool(tool);
            const exposedName = `mcp_${server.id.replace(/-/g, '').slice(0, 12)}_${tool.name}`.slice(0, 64);
            const actionLabel = readOnly ? '' : 'WRITE ACTION · Requires your approval for every call. ';
            definitions.push({ name: exposedName, description: `${actionLabel}[${server.name}] ${String(tool.description || tool.title || tool.name).slice(0, 700)}`, parameters: { ...tool.inputSchema, properties: tool.inputSchema.properties || {} } });
            mapping.set(exposedName, { server, connection, tool, readOnly });
          }
          if (catalog.resources.length || catalog.resourceTemplates.length) {
            const exposedName = `mcp_${server.id.replace(/-/g, '').slice(0, 12)}_read_resource`;
            const candidates = [...catalog.resources.map((item) => item.uri), ...catalog.resourceTemplates.map((item) => item.uriTemplate)];
            definitions.push({
              name: exposedName,
              description: `[${server.name}] Read a resource advertised by this MCP server. Available URIs/templates: ${candidates.join(', ').slice(0, 1800)}`,
              parameters: { type: 'object', properties: { uri: { type: 'string', maxLength: 1200, description: 'Exact advertised resource URI or URI matching one of the listed templates.' } }, required: ['uri'], additionalProperties: false },
            });
            mapping.set(exposedName, { server, connection, resources: catalog.resources, resourceTemplates: catalog.resourceTemplates });
          }
        } catch (error) { failures.push(`${server.name}: ${error.message || 'connection failed'}`); }
      }
      return { definitions, failures, execute: async (name, args) => {
        const entry = mapping.get(name);
        if (!entry) throw new Error('This MCP tool is no longer available. Refresh the connection and try again.');
        if (!entry.tool) return readRemoteResource(entry.server, entry.connection, entry.resources, entry.resourceTemplates, args?.uri);
        if (!entry.readOnly) {
          const serializedArgs = JSON.stringify(args);
          if (Buffer.byteLength(serializedArgs) > 4_000) throw new RangeError('MCP write arguments exceed the 4 KB approval dialog limit.');
          const approved = await confirmWriteAction({ serverName: entry.server.name, serverUrl: entry.server.url, toolName: entry.tool.name, description: String(entry.tool.description || entry.tool.title || '').slice(0, 500), arguments: serializedArgs });
          if (approved !== true) return { text: 'The user declined this MCP write action. No server call was made.', isError: true };
        }
        return callRemote(entry.server, entry.connection, entry.tool.name, args);
      } };
    },
  };
}

module.exports = { MCP_VERSION, cleanMcpUrl, validTool, readOnlyTool, createMcpConnector };
