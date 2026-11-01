const test = require('node:test');
const assert = require('node:assert/strict');
const { DAY_MS, dueCards, scheduleReview } = require('../electron/study-review.cjs');

test('new cards schedule Good and Easy at sensible spaced intervals', () => {
  const first = scheduleReview({}, 2, 1_000);
  const easy = scheduleReview({}, 3, 1_000);
  assert.equal(first.intervalDays, 1);
  assert.equal(first.dueAt, 1_000 + DAY_MS);
  assert.equal(easy.intervalDays, 4);
  assert.equal(easy.dueAt, 1_000 + 4 * DAY_MS);
});

test('Again schedules a short retry and resets the learning streak', () => {
  const result = scheduleReview({ repetitions: 5, intervalDays: 20, ease: 2.2, lapses: 1 }, 0, 50_000);
  assert.equal(result.repetitions, 0);
  assert.equal(result.intervalDays, 0);
  assert.equal(result.lapses, 2);
  assert.equal(result.dueAt, 50_000 + 10 * 60 * 1000);
});

test('due-card queue includes only due cards and orders them by due time', () => {
  const decks = [{ id: 'deck', title: 'Basics', courseId: 'course', cards: [
    { id: 'later', dueAt: 20 }, { id: 'due', dueAt: 10 }, { id: 'future', dueAt: 30 },
  ] }];
  assert.deepEqual(dueCards(decks, 20).map((card) => card.id), ['due', 'later']);
});

test('review ratings and timestamps are validated', () => {
  assert.throws(() => scheduleReview({}, 4), /Again, Hard, Good, or Easy/);
  assert.throws(() => scheduleReview({}, 2, Number.NaN), /timestamp/);
});
