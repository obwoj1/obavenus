const crypto = require('node:crypto');

const EXTENSION_ORIGIN = 'chrome-extension://cpogkkipbbelalhaiabnjgamgbamnngl';
const MAX_SCREENSHOT_CHUNKS = 128;
const SCREENSHOT_CHUNK_CHARS = 40 * 1024;

function safeUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Chrome bridge only opens http and https pages without embedded credentials.');
  return url.toString();
}

function createChromeBridge({ WebSocketServer, confirmPairing, confirmAction, port = 43137, host = '127.0.0.1', timeoutMs = 20_000 }) {
  let server;
  let socket;
  let paired = false;
  let pending = new Map();

  function status() { return { running: Boolean(server), connected: Boolean(socket && socket.readyState === 1 && paired), extensionOrigin: EXTENSION_ORIGIN, port: server?.address()?.port || port }; }
  async function start() {
    if (server) return status();
    server = new WebSocketServer({ host, port, maxPayload: 64 * 1024, verifyClient: ({ origin, req }, done) => done(origin === EXTENSION_ORIGIN && req.url === '/bridge') });
    server.on('connection', (client) => {
      socket = client;
      paired = false;
      client.on('message', async (raw) => {
        if (raw.length > 64 * 1024) return client.close(1009, 'Message too large');
        let message;
        try { message = JSON.parse(raw.toString()); } catch { return; }
        if (message.type === 'pair') {
          paired = await confirmPairing();
          client.send(JSON.stringify({ type: 'paired', accepted: paired }));
          if (!paired) client.close(1008, 'Pairing declined');
          return;
        }
        if (!paired || typeof message.id !== 'string' || !pending.has(message.id)) return;
        const entry = pending.get(message.id);
        if (message.chunkIndex !== undefined) {
          if (entry.command !== 'captureVisibleTab' || !Number.isInteger(message.chunkIndex) || !Number.isInteger(message.chunkCount) || message.chunkCount < 1 || message.chunkCount > MAX_SCREENSHOT_CHUNKS || message.chunkIndex < 0 || message.chunkIndex >= message.chunkCount || typeof message.data !== 'string' || message.data.length > SCREENSHOT_CHUNK_CHARS) return;
          if (!entry.chunks) { entry.chunks = Array(message.chunkCount); entry.chunkCount = message.chunkCount; }
          if (entry.chunkCount !== message.chunkCount || entry.chunks[message.chunkIndex] !== undefined) return;
          entry.chunks[message.chunkIndex] = message.data;
          if (entry.chunks.filter((chunk) => typeof chunk === 'string').length === entry.chunkCount) {
            pending.delete(message.id);
            entry.resolve({ mimeType: 'image/jpeg', data: entry.chunks.join('') });
          }
          return;
        }
        pending.delete(message.id);
        entry.resolve(message.result);
      });
      client.on('close', () => { if (socket === client) { socket = null; paired = false; } });
      client.on('error', () => {});
    });
    server.on('error', () => {});
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    return status();
  }
  async function request(command, args = {}) {
    if (!socket || socket.readyState !== 1 || !paired) throw new Error('Connect the Obavenus Chrome extension first.');
    const id = crypto.randomUUID();
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Chrome did not respond in time.')); }, timeoutMs);
      pending.set(id, { command, resolve: (value) => { clearTimeout(timer); resolve(value); }, chunks: null, chunkCount: 0 });
      socket.send(JSON.stringify({ id, command, args }));
    });
    if (!result || result.error) throw new Error(result?.error || 'Chrome could not complete that request.');
    return result;
  }
  return {
    start, status,
    open: async (rawUrl) => { const url = safeUrl(rawUrl); return request('navigate', { url }); },
    listTabs: async () => request('listTabs'),
    captureVisibleTab: async () => {
      const result = await request('captureVisibleTab');
      if (result.mimeType !== 'image/jpeg' || typeof result.data !== 'string' || result.data.length > 5 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.data)) throw new Error('Chrome returned an invalid or oversized screenshot.');
      const bytes = Buffer.from(result.data, 'base64');
      if (bytes.length < 4 || bytes.length > 4 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Chrome screenshot is not a bounded JPEG image.');
      return { mimeType: result.mimeType, bytes };
    },
    selectTab: async (rawUrl) => {
      if (typeof rawUrl !== 'string' || rawUrl.length > 2_000) throw new TypeError('Provide the exact URL of an open Chrome tab.');
      const url = safeUrl(rawUrl);
      return request('selectTab', { url });
    },
    readPage: async () => request('readPage'),
    followLink: async (text) => request('followLink', { text: String(text || '').slice(0, 200) }),
    clickControl: async (text) => {
      const control = await request('findControl', { text: String(text || '').slice(0, 200) });
      if (!control.found) return control;
      if (!await confirmAction({ ...control, action: 'click' })) return { approved: false, message: 'The user declined the Chrome page action.' };
      return request('clickControl', { text: String(text || '').slice(0, 200), pageUrl: control.pageUrl, label: control.label });
    },
    fillField: async (label, rawValue) => {
      const text = String(label || '').trim().slice(0, 200);
      if (!text) throw new TypeError('Describe the visible browser field to fill.');
      if (typeof rawValue !== 'string' || rawValue.length > 2_000 || rawValue.includes('\0')) throw new TypeError('Browser field text must be at most 2,000 characters.');
      const field = await request('findField', { label: text });
      if (!field.found) return field;
      const action = { ...field, action: 'fill', value: rawValue };
      if (!await confirmAction(action)) return { approved: false, message: 'The user declined to fill the Chrome field.' };
      return request('fillField', { label: text, pageUrl: field.pageUrl, fieldLabel: field.label, fieldType: field.fieldType, value: rawValue });
    },
    selectOption: async (label, optionLabel) => {
      const fieldLabel = String(label || '').trim();
      const selectedOption = String(optionLabel || '').trim();
      if (!fieldLabel || !selectedOption) throw new TypeError('Provide a select label and option text.');
      if (fieldLabel.length > 200 || selectedOption.length > 200) throw new TypeError('Dropdown labels and option text must be at most 200 characters.');
      const field = await request('findSelect', { label: fieldLabel });
      if (!field.found) return field;
      if (!field.options.includes(selectedOption)) return { found: false, message: 'That exact enabled option is not available in the selected field.' };
      if (!await confirmAction({ ...field, action: 'select', optionLabel: selectedOption })) return { approved: false, message: 'The user declined to change the Chrome selection.' };
      return request('selectOption', { pageUrl: field.pageUrl, fieldLabel: field.label, optionLabel: selectedOption });
    },
    setChecked: async (label, checked) => {
      const fieldLabel = String(label || '').trim();
      if (!fieldLabel || fieldLabel.length > 200 || typeof checked !== 'boolean') throw new TypeError('Provide a labelled checkbox or radio choice and a checked state.');
      const field = await request('findChoice', { label: fieldLabel });
      if (!field.found) return field;
      if (field.type === 'radio' && !checked) return { found: false, message: 'A radio option can be selected but not cleared.' };
      if (field.checked === checked) return { changed: false, checked, label: field.label, pageUrl: field.pageUrl };
      if (!await confirmAction({ ...field, action: 'check', currentChecked: field.checked, checked })) return { approved: false, message: 'The user declined to change the Chrome choice.' };
      return request('setChoice', { pageUrl: field.pageUrl, fieldLabel: field.label, type: field.type, checked });
    },
    close: async () => {
      for (const entry of pending.values()) entry.resolve({ error: 'Obavenus is closing.' });
      pending.clear(); socket?.close(); socket = null; paired = false;
      if (server) await new Promise((resolve) => server.close(resolve));
      server = null;
    },
  };
}

module.exports = { EXTENSION_ORIGIN, safeUrl, createChromeBridge };
