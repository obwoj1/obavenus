const test = require('node:test');
const assert = require('node:assert/strict');
const { isObavenusOpenUrl } = require('../electron/deep-link.cjs');

test('accepts the registered app-open link', () => {
  assert.equal(isObavenusOpenUrl('obavenus://open'), true);
});

test('rejects unregistered protocols and unexpected link targets', () => {
  assert.equal(isObavenusOpenUrl('https://example.com/open'), false);
  assert.equal(isObavenusOpenUrl('obavenus://settings'), false);
  assert.equal(isObavenusOpenUrl('obavenus://open/anything'), false);
  assert.equal(isObavenusOpenUrl('not a url'), false);
});
