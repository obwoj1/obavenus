const assert = require('node:assert/strict');
const test = require('node:test');
const { validateHttpUrl } = require('../electron/research-browser.cjs');

test('research browser accepts public web URLs and rejects unsafe schemes and embedded credentials', () => {
  assert.equal(validateHttpUrl('https://example.com/path').hostname, 'example.com');
  assert.throws(() => validateHttpUrl('file:///etc/passwd'), /http and https/);
  assert.throws(() => validateHttpUrl('javascript:alert(1)'), /only opens http and https/);
  assert.throws(() => validateHttpUrl('https://user:password@example.com'), /embedded credentials/);
});
