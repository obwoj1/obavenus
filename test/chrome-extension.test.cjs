const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');

function makeField({ label, type = 'text', name = label.toLowerCase(), tagName = 'INPUT' }) {
  const events = [];
  return {
    tagName,
    name,
    id: '',
    value: '',
    disabled: false,
    readOnly: false,
    labels: [],
    getAttribute: (key) => key === 'type' ? type : key === 'aria-label' ? label : key === 'placeholder' ? label : null,
    getClientRects: () => [{}],
    focus: () => {},
    dispatchEvent: (event) => { events.push(event.type); return true; },
    events,
  };
}

function makeBridge(fields) {
  let onMessage;
  let socket;
  const responses = [];
  const tab = { id: 7, url: 'https://example.com/apply' };
  const location = { href: tab.url, assign: () => {} };
  const chrome = {
    runtime: { onMessage: { addListener: (fn) => { onMessage = fn; } } },
    storage: { local: { set: () => {} } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    tabs: { query: async () => [tab], get: async () => tab },
    scripting: { executeScript: async ({ func, args }) => [{ result: func(...args) }] },
  };
  class FakeWebSocket {
    static OPEN = 1;
    constructor() { this.readyState = 1; socket = this; }
    send(raw) { responses.push(JSON.parse(raw)); }
    close() { this.readyState = 3; }
  }
  const document = {
    title: 'Application',
    body: { innerText: 'Application form' },
    querySelectorAll: (selector) => selector === 'input,textarea' ? fields : [],
  };
  const context = vm.createContext({
    chrome,
    WebSocket: FakeWebSocket,
    URL,
    document,
    location,
    InputEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    Event: class { constructor(type) { this.type = type; } },
    setTimeout,
    clearTimeout,
  });
  const source = readFileSync(path.join(__dirname, '../electron/chrome-extension/background.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'background.js' });
  async function send(message) {
    await socket.onmessage({ data: JSON.stringify(message) });
    return responses.at(-1)?.result;
  }
  return {
    async connect() {
      onMessage({ type: 'connect' }, {}, () => {});
      socket.onopen();
      await socket.onmessage({ data: JSON.stringify({ type: 'paired', accepted: true }) });
    },
    send,
    setUrl(url) { tab.url = url; location.href = url; },
  };
}

test('Chrome extension fills one approved ordinary labelled field without submitting', async () => {
  const email = makeField({ label: 'Email', type: 'email' });
  const password = makeField({ label: 'Password', type: 'password', name: 'password' });
  const bridge = makeBridge([email, password]);
  await bridge.connect();
  assert.deepEqual(await bridge.send({ id: 'find-1', command: 'findField', args: { label: 'Email' } }), {
    found: true, pageUrl: 'https://example.com/apply', label: 'Email', fieldType: 'email',
  });
  assert.deepEqual(await bridge.send({
    id: 'fill-1', command: 'fillField',
    args: { pageUrl: 'https://example.com/apply', fieldLabel: 'Email', fieldType: 'email', value: 'person@example.com' },
  }), { filled: true, label: 'Email', pageUrl: 'https://example.com/apply', submitted: false });
  assert.equal(email.value, 'person@example.com');
  assert.deepEqual(email.events, ['input', 'change']);
  assert.deepEqual(await bridge.send({ id: 'find-2', command: 'findField', args: { label: 'Password' } }), {
    found: false,
    message: 'No normal visible text field has that exact label. Password, verification-code, and credential fields are not supported.',
  });
  assert.equal(password.value, '');
});

test('Chrome extension refuses an ambiguous labelled field', async () => {
  const bridge = makeBridge([makeField({ label: 'Name' }), makeField({ label: 'Name' })]);
  await bridge.connect();
  assert.deepEqual(await bridge.send({ id: 'find-ambiguous', command: 'findField', args: { label: 'Name' } }), {
    found: false, message: 'More than one visible field has that exact label.',
  });
});

test('Chrome extension refuses to fill after the approved page changes', async () => {
  const bridge = makeBridge([makeField({ label: 'Email', type: 'email' })]);
  await bridge.connect();
  await bridge.send({ id: 'find-before-navigation', command: 'findField', args: { label: 'Email' } });
  bridge.setUrl('https://example.com/changed');
  assert.deepEqual(await bridge.send({
    id: 'fill-after-navigation', command: 'fillField',
    args: { pageUrl: 'https://example.com/apply', fieldLabel: 'Email', fieldType: 'email', value: 'person@example.com' },
  }), { error: 'The approved Chrome page has changed.' });
});
