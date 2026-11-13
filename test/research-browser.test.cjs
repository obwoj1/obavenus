const assert = require('node:assert/strict');
const test = require('node:test');
const { createResearchBrowser, validateHttpUrl } = require('../electron/research-browser.cjs');

test('research browser accepts public web URLs and rejects unsafe schemes and embedded credentials', () => {
  assert.equal(validateHttpUrl('https://example.com/path').hostname, 'example.com');
  assert.throws(() => validateHttpUrl('file:///etc/passwd'), /http and https/);
  assert.throws(() => validateHttpUrl('javascript:alert(1)'), /only opens http and https/);
  assert.throws(() => validateHttpUrl('https://user:password@example.com'), /embedded credentials/);
});

test('browser control is only activated after the native approval callback approves it', async () => {
  let approved = false;
  let pageScripts = 0;
  class FakeBrowserWindow {
    constructor() {
      this.destroyed = false;
      this.webContents = {
        isLoading: () => false,
        setWindowOpenHandler: () => {},
        on: () => {},
        executeJavaScript: async (script) => {
          pageScripts += 1;
          return script.includes('item.click()') ? true : { label: 'Send message', url: 'https://mail.example.com', kind: 'button' };
        },
      };
    }
    isDestroyed() { return this.destroyed; }
    async loadURL() {}
    close() { this.destroyed = true; }
  }
  const browser = createResearchBrowser({ BrowserWindow: FakeBrowserWindow, confirmAction: async () => approved });
  await browser.open('https://mail.example.com');
  assert.deepEqual(await browser.clickControl('Send'), { approved: false, label: 'Send message', url: 'https://mail.example.com' });
  assert.equal(pageScripts, 1);
  approved = true;
  assert.deepEqual(await browser.clickControl('Send'), { approved: true, label: 'Send message', url: 'https://mail.example.com' });
  assert.equal(pageScripts, 3);
});

test('research browser exposes a bounded local JPEG capture for OCR', async () => {
  class FakeBrowserWindow {
    constructor() { this.destroyed = false; this.webContents = { isLoading: () => false, setWindowOpenHandler: () => {}, on: () => {}, capturePage: async () => ({ toJPEG: (quality) => { assert.equal(quality, 68); return Buffer.from([0xff, 0xd8, 0xff, 0xd9]); } }) }; }
    isDestroyed() { return this.destroyed; }
    async loadURL() {}
  }
  const browser = createResearchBrowser({ BrowserWindow: FakeBrowserWindow });
  await browser.open('https://example.com');
  const capture = await browser.captureVisibleTab();
  assert.equal(capture.mimeType, 'image/jpeg');
  assert.equal(capture.bytes.subarray(0, 2).toString('hex'), 'ffd8');
});

test('research browser scrolls to visible page text without activating controls', async () => {
  let script = '';
  class FakeBrowserWindow {
    constructor() { this.destroyed = false; this.webContents = { isLoading: () => false, setWindowOpenHandler: () => {}, on: () => {}, executeJavaScript: async (value) => { script = value; return { found: true, text: 'Assignment due date', url: 'https://school.example/course' }; } }; }
    isDestroyed() { return this.destroyed; }
    async loadURL() {}
  }
  const browser = createResearchBrowser({ BrowserWindow: FakeBrowserWindow });
  await browser.open('https://school.example/course');
  assert.deepEqual(await browser.scrollToText('due date'), { found: true, text: 'Assignment due date', url: 'https://school.example/course' });
  assert.match(script, /scrollIntoView/);
  await assert.rejects(browser.scrollToText(''), /page text/);
});

test('research browser reads page text in bounded chunks and rejects invalid offsets', async () => {
  let script = '';
  class FakeBrowserWindow {
    constructor() { this.destroyed = false; this.webContents = { isLoading: () => false, setWindowOpenHandler: () => {}, on: () => {}, executeJavaScript: async (value) => { script = value; return { text: 'page chunk', offset: 20_000, nextOffset: 40_000, totalCharacters: 50_000 }; } }; }
    isDestroyed() { return this.destroyed; }
    async loadURL() {}
  }
  const browser = createResearchBrowser({ BrowserWindow: FakeBrowserWindow });
  await browser.open('https://school.example/course');
  assert.deepEqual(await browser.readPage(20_000), { text: 'page chunk', offset: 20_000, nextOffset: 40_000, totalCharacters: 50_000 });
  assert.match(script, /slice\(offset, nextOffset\)/);
  await assert.rejects(browser.readPage(200_001), /offset/);
});

test('research browser preserves its isolated login session and can explicitly clear it', async () => {
  let options;
  const cleared = [];
  class FakeBrowserWindow {
    constructor(value) { options = value; this.destroyed = false; this.webContents = { isLoading: () => false, setWindowOpenHandler: () => {}, on: () => {} }; }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; }
    async loadURL() {}
  }
  const browser = createResearchBrowser({
    BrowserWindow: FakeBrowserWindow,
    session: { clearStorageData: async (settings) => cleared.push(settings), clearCache: async () => cleared.push('cache') },
  });
  await browser.open('https://example.com');
  assert.equal(options.webPreferences.partition, 'persist:obavenus-research');
  assert.deepEqual(await browser.clearSession(), { cleared: true });
  assert.deepEqual(cleared, [{ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] }, 'cache']);
});
