const crypto = require('node:crypto');

const EXTENSION_ORIGIN = 'chrome-extension://cpogkkipbbelalhaiabnjgamgbamnngl';

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
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        resolve(message.result);
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
      pending.set(id, (value) => { clearTimeout(timer); resolve(value); });
      socket.send(JSON.stringify({ id, command, args }));
    });
    if (!result || result.error) throw new Error(result?.error || 'Chrome could not complete that request.');
    return result;
  }
  return {
    start, status,
    open: async (rawUrl) => { const url = safeUrl(rawUrl); return request('navigate', { url }); },
    readPage: async () => request('readPage'),
    followLink: async (text) => request('followLink', { text: String(text || '').slice(0, 200) }),
    clickControl: async (text) => {
      const control = await request('findControl', { text: String(text || '').slice(0, 200) });
      if (!control.found) return control;
      if (!await confirmAction(control)) return { approved: false, message: 'The user declined the Chrome page action.' };
      return request('clickControl', { text: String(text || '').slice(0, 200), pageUrl: control.pageUrl, label: control.label });
    },
    close: async () => {
      for (const resolve of pending.values()) resolve({ error: 'Obavenus is closing.' });
      pending.clear(); socket?.close(); socket = null; paired = false;
      if (server) await new Promise((resolve) => server.close(resolve));
      server = null;
    },
  };
}

module.exports = { EXTENSION_ORIGIN, safeUrl, createChromeBridge };
