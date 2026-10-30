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
