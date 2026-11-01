const test = require('node:test');
const assert = require('node:assert/strict');
const { isWithinQuietHours } = require('../electron/study-reminders.cjs');

test('quiet-hour window supports periods that cross midnight', () => {
  const settings = { quietHoursEnabled: true, quietStart: '22:00', quietEnd: '08:00' };
  const atNight = new Date(2026, 10, 1, 23, 30);
  const beforeEnd = new Date(2026, 10, 1, 7, 59);
  const atEnd = new Date(2026, 10, 1, 8, 0);
  assert.equal(isWithinQuietHours(settings, atNight), true);
  assert.equal(isWithinQuietHours(settings, beforeEnd), true);
  assert.equal(isWithinQuietHours(settings, atEnd), false);
  assert.equal(isWithinQuietHours({ ...settings, quietHoursEnabled: false }, atNight), false);
});

test('quiet-hour inputs reject invalid or identical times', () => {
  assert.throws(() => isWithinQuietHours({ quietHoursEnabled: true, quietStart: '25:00', quietEnd: '08:00' }), /valid 24-hour/);
  assert.throws(() => isWithinQuietHours({ quietHoursEnabled: true, quietStart: '08:00', quietEnd: '08:00' }), /different/);
});
