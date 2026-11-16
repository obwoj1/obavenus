const test = require('node:test');
const assert = require('node:assert/strict');
const { isObavenusOpenUrl, parseObavenusOpenUrl } = require('../electron/deep-link.cjs');

test('accepts the registered app-open link', () => {
  assert.equal(isObavenusOpenUrl('obavenus://open'), true);
});

test('rejects unregistered protocols and unexpected link targets', () => {
  assert.equal(isObavenusOpenUrl('https://example.com/open'), false);
  assert.equal(isObavenusOpenUrl('obavenus://settings'), false);
  assert.equal(isObavenusOpenUrl('obavenus://open/anything'), false);
  assert.equal(isObavenusOpenUrl('not a url'), false);
});

test('accepts a bounded Nexus prompt as a draft handoff only', () => {
  const link = `obavenus://open?source=nexus&prompt=${encodeURIComponent('Review my study plan')}`;
  assert.deepEqual(parseObavenusOpenUrl(link), { prompt: 'Review my study plan' });
  assert.equal(isObavenusOpenUrl(`obavenus://open?source=nexus&prompt=${encodeURIComponent('x'.repeat(2001))}`), false);
  assert.equal(isObavenusOpenUrl('obavenus://open?source=unknown&prompt=hello'), false);
  assert.equal(isObavenusOpenUrl('obavenus://open?token=secret'), false);
});
