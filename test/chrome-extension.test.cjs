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

function makeSelect({ label, options }) {
  const events = [];
  const items = options.map((text, index) => typeof text === 'string' ? { textContent: text, value: text.toLowerCase().replace(/\s+/g, '-'), disabled: false } : text);
  return {
    tagName: 'SELECT',
    name: label.toLowerCase(),
    value: items[0]?.value || '',
    disabled: false,
    multiple: false,
    labels: [{ innerText: label }],
    options: items,
    get selectedOptions() { return items.filter((item) => item.value === this.value); },
    getAttribute: (key) => key === 'aria-label' ? label : null,
    getClientRects: () => [{}],
    dispatchEvent: (event) => { events.push(event.type); return true; },
    events,
  };
}

function makeChoice({ label, type = 'checkbox', checked = false }) {
  const events = [];
  return {
    name: label.toLowerCase(),
    value: label,
    checked,
    disabled: false,
    labels: [{ innerText: label }],
    getAttribute: (key) => key === 'type' ? type : key === 'aria-label' ? label : null,
    getClientRects: () => [{}],
    dispatchEvent: (event) => { events.push(event.type); return true; },
    events,
  };
}

function makeBridge(fields, selects = [], choices = [], openTabs = null) {
  let onMessage;
  let socket;
  const responses = [];
  const tab = { id: 7, url: 'https://example.com/apply' };
  const tabs = openTabs || [{ ...tab, title: 'Application', active: true }];
  const location = { href: tab.url, assign: () => {} };
  const chrome = {
    runtime: { onMessage: { addListener: (fn) => { onMessage = fn; } } },
    storage: { local: { set: () => {} } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    tabs: {
      query: async () => tabs,
      get: async (id) => tabs.find((item) => item.id === id),
      update: async (id, changes) => {
        for (const item of tabs) item.active = item.id === id && changes.active === true;
        const selected = tabs.find((item) => item.id === id);
        tab.id = selected.id; tab.url = selected.url; location.href = selected.url;
        return selected;
      },
    },
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
      querySelectorAll: (selector) => selector === 'input,textarea' ? fields : selector === 'select' ? selects : selector === 'input[type=checkbox],input[type=radio]' ? choices : [],
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
    setUrl(url) {
      tab.url = url; location.href = url;
      const active = tabs.find((item) => item.active);
      if (active) active.url = url;
    },
  };
}

test('Chrome extension lists ordinary web tabs and selects one exact URL', async () => {
  const tabs = [
    { id: 7, url: 'https://example.com/apply', title: 'Application', active: true },
    { id: 8, url: 'https://school.example/course', title: 'Course home', active: false },
    { id: 9, url: 'chrome://extensions', title: 'Extensions', active: false },
    { id: 10, url: 'https://school.example/course', title: 'Duplicate course', active: false },
  ];
  const bridge = makeBridge([], [], [], tabs);
  await bridge.connect();
  assert.deepEqual(await bridge.send({ id: 'tabs', command: 'listTabs' }), { tabs: [
    { url: 'https://example.com/apply', title: 'Application', active: true },
    { url: 'https://school.example/course', title: 'Course home', active: false },
    { url: 'https://school.example/course', title: 'Duplicate course', active: false },
  ] });
  assert.match((await bridge.send({ id: 'duplicate', command: 'selectTab', args: { url: 'https://school.example/course' } })).error, /More than one open tab/);
  tabs.splice(3, 1);
  assert.deepEqual(await bridge.send({ id: 'selected', command: 'selectTab', args: { url: 'https://school.example/course' } }), { selected: true, url: 'https://school.example/course', title: 'Course home' });
  assert.equal(tabs[1].active, true);
  assert.equal(tabs[0].active, false);
  assert.match((await bridge.send({ id: 'unsafe', command: 'selectTab', args: { url: 'javascript:alert(1)' } })).error, /Only ordinary/);
});

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

test('Chrome extension selects one exact enabled dropdown option after confirmation', async () => {
  const department = makeSelect({ label: 'Department', options: ['Engineering', 'Research'] });
  const bridge = makeBridge([], [department]);
  await bridge.connect();
  assert.deepEqual(await bridge.send({ id: 'select-find', command: 'findSelect', args: { label: 'Department' } }), {
    found: true, pageUrl: 'https://example.com/apply', label: 'Department', selected: 'Engineering', options: ['Engineering', 'Research'],
  });
  assert.deepEqual(await bridge.send({
    id: 'select-apply', command: 'selectOption',
    args: { pageUrl: 'https://example.com/apply', fieldLabel: 'Department', optionLabel: 'Research' },
  }), { selected: 'Research', label: 'Department', pageUrl: 'https://example.com/apply' });
  assert.equal(department.value, 'research');
  assert.deepEqual(department.events, ['input', 'change']);
});

test('Chrome extension excludes duplicate option labels and rejects changed pages', async () => {
  const department = makeSelect({ label: 'Department', options: ['Engineering', 'Engineering', 'Research'] });
  const bridge = makeBridge([], [department]);
  await bridge.connect();
  const found = await bridge.send({ id: 'select-ambiguous-find', command: 'findSelect', args: { label: 'Department' } });
  assert.deepEqual(found.options, ['Research']);
  bridge.setUrl('https://example.com/changed');
  assert.deepEqual(await bridge.send({
    id: 'select-stale', command: 'selectOption',
    args: { pageUrl: 'https://example.com/apply', fieldLabel: 'Department', optionLabel: 'Research' },
  }), { error: 'The approved Chrome page has changed.' });
});

test('Chrome extension changes a labelled checkbox only to the approved state', async () => {
  const updates = makeChoice({ label: 'Email updates' });
  const bridge = makeBridge([], [], [updates]);
  await bridge.connect();
  assert.deepEqual(await bridge.send({ id: 'choice-find', command: 'findChoice', args: { label: 'Email updates' } }), {
    found: true, pageUrl: 'https://example.com/apply', label: 'Email updates', type: 'checkbox', checked: false,
  });
  assert.deepEqual(await bridge.send({
    id: 'choice-set', command: 'setChoice',
    args: { pageUrl: 'https://example.com/apply', fieldLabel: 'Email updates', type: 'checkbox', checked: true },
  }), { checked: true, label: 'Email updates', type: 'checkbox', pageUrl: 'https://example.com/apply' });
  assert.deepEqual(updates.events, ['input', 'change']);
});

test('Chrome extension rejects ambiguous and hidden checkboxes and cannot clear radio options', async () => {
  const hidden = makeChoice({ label: 'Hidden' });
  hidden.getClientRects = () => [];
  const choices = [makeChoice({ label: 'Terms' }), makeChoice({ label: 'Terms' }), makeChoice({ label: 'Plan A', type: 'radio', checked: true }), hidden];
  const bridge = makeBridge([], [], choices);
  await bridge.connect();
  assert.deepEqual(await bridge.send({ id: 'choice-ambiguous', command: 'findChoice', args: { label: 'Terms' } }), {
    found: false, message: 'More than one visible checkbox or radio option has that exact label.',
  });
  assert.equal((await bridge.send({ id: 'choice-hidden', command: 'findChoice', args: { label: 'Hidden' } })).found, false);
  assert.equal((await bridge.send({ id: 'radio-find', command: 'findChoice', args: { label: 'Plan A' } })).found, true);
  assert.deepEqual(await bridge.send({
    id: 'radio-clear', command: 'setChoice',
    args: { pageUrl: 'https://example.com/apply', fieldLabel: 'Plan A', type: 'radio', checked: false },
  }), { error: 'A radio option can be selected but not cleared.' });
});
