const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStudyDigest } = require('../electron/study-digest.cjs');

test('study digest groups overdue and upcoming work and counts local review items', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const digest = buildStudyDigest({
    courses: [{ id: 'course', name: 'Biology' }],
    assignments: [
      { id: 'late', courseId: 'course', title: 'Late lab', dueAt: now - 60_000, status: 'todo', steps: [{ done: false }, { done: true }] },
      { id: 'soon', courseId: 'course', title: 'Reading response', dueAt: now + 2 * 24 * 60 * 60 * 1000, status: 'in-progress', steps: [{ done: false }] },
      { id: 'done', courseId: 'course', title: 'Finished', dueAt: now + 1000, status: 'done', steps: [] },
      { id: 'later', courseId: 'course', title: 'Later', dueAt: now + 9 * 24 * 60 * 60 * 1000, status: 'todo', steps: [] },
    ],
    decks: [{ cards: [{ dueAt: now - 1 }, { dueAt: now + 1 }] }],
  }, { now: () => now });
  assert.match(digest.subject, /2026-11-01/);
  assert.match(digest.body, /Overdue assignments: 1/);
  assert.match(digest.body, /Late lab \(Biology\)/);
  assert.match(digest.body, /Due in the next 7 days: 1/);
  assert.match(digest.body, /Reading response/);
  assert.match(digest.body, /Unfinished checklist steps: 2/);
  assert.match(digest.body, /Flashcards ready to review: 1/);
  assert.doesNotMatch(digest.body, /Finished|Later/);
});

test('study digest bounds malformed local study input', () => {
  assert.throws(() => buildStudyDigest({}), /invalid/);
});
