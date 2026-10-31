const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { WebSocket, WebSocketServer } = require('ws');
const { EXTENSION_ORIGIN, safeUrl, createChromeBridge } = require('../electron/chrome-bridge.cjs');

test('Chrome bridge only navigates safe public web URLs', () => {
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com']) assert.throws(() => safeUrl(value));
});

test('the packaged extension key is pinned to the bridge origin', () => {
  const manifest = JSON.parse(fs.readFileSync(require.resolve('../electron/chrome-extension/manifest.json'), 'utf8'));
  const id = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16).toString('hex').replace(/[0-9a-f]/g, (digit) => 'abcdefghijklmnop'[parseInt(digit, 16)]);
  assert.equal(EXTENSION_ORIGIN, `chrome-extension://${id}`);
});

test('Chrome bridge pairs with the pinned extension and requires approval before a control click', async () => {
  const commands = [];
  let allowAction = false;
  let allowFill = false;
  const confirmations = [];
  const bridge = createChromeBridge({
    WebSocketServer,
    port: 0,
    confirmPairing: async () => true,
    confirmAction: async (action) => { confirmations.push(action); return action.action === 'fill' ? allowFill : allowAction; },
  });
  try {
    const status = await bridge.start();
    assert.equal(status.extensionOrigin, EXTENSION_ORIGIN);
    const untrusted = new WebSocket(`ws://127.0.0.1:${status.port}/bridge`, { origin: 'https://example.com' });
    await new Promise((resolve) => { untrusted.once('error', resolve); untrusted.once('open', () => resolve(new Error('Unexpected origin was accepted.'))); });
    const client = new WebSocket(`ws://127.0.0.1:${status.port}/bridge`, { origin: EXTENSION_ORIGIN });
    await new Promise((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
    client.send(JSON.stringify({ type: 'pair' }));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Pairing timed out')), 1000);
      client.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'paired') { clearTimeout(timer); assert.equal(message.accepted, true); resolve(); }
        else {
          commands.push(message.command);
          const result = message.command === 'findControl'
            ? { found: true, label: 'Continue', pageUrl: 'https://example.com/form' }
            : message.command === 'findField'
              ? { found: true, label: 'Email', fieldType: 'email', pageUrl: 'https://example.com/form' }
              : message.command === 'fillField'
                ? { filled: true, label: 'Email', pageUrl: 'https://example.com/form', submitted: false }
                : { clicked: true, label: 'Continue' };
          client.send(JSON.stringify({ id: message.id, result }));
        }
      });
    });
    assert.equal((await bridge.status()).connected, true);
    const result = await bridge.clickControl('Continue');
    assert.equal(result.approved, false);
    assert.deepEqual(commands, ['findControl']);
    allowAction = true;
    assert.deepEqual(await bridge.clickControl('Continue'), { clicked: true, label: 'Continue' });
    assert.deepEqual(commands, ['findControl', 'findControl', 'clickControl']);
    assert.deepEqual(await bridge.fillField('Email', 'person@example.com'), { approved: false, message: 'The user declined to fill the Chrome field.' });
    assert.deepEqual(commands.at(-1), 'findField');
    allowFill = true;
    assert.deepEqual(await bridge.fillField('Email', 'person@example.com'), { filled: true, label: 'Email', pageUrl: 'https://example.com/form', submitted: false });
    assert.deepEqual(commands.slice(-3), ['findField', 'findField', 'fillField']);
    assert.deepEqual(confirmations.at(-1), { found: true, label: 'Email', fieldType: 'email', pageUrl: 'https://example.com/form', action: 'fill', value: 'person@example.com' });
    await assert.rejects(bridge.fillField('Email', 'x'.repeat(2001)), /2,000/);
    client.close();
  } finally { await bridge.close(); }
});
