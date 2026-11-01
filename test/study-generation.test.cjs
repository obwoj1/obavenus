const test = require('node:test');
const assert = require('node:assert/strict');
const { generateStudyAids } = require('../electron/study-generation.cjs');

test('local study generation creates a cited extractive outline and definition cards deterministically', () => {
  const source = {
    name: 'Cell biology.txt', courseId: 'course-id',
    content: '# Cell biology\nMitochondria are organelles that produce most of the chemical energy needed to power biochemical reactions in a cell. Photosynthesis is the process by which plants convert light energy into chemical energy stored in glucose molecules.',
  };
  let id = 0;
  const result = generateStudyAids(source, { now: () => 123, id: () => `generated-id-${++id}` });
  assert.match(result.note.body, /Generated locally from Cell biology\.txt/);
  assert.match(result.note.body, /Mitochondria are organelles/);
  assert.equal(result.note.courseId, 'course-id');
  assert.equal(result.deck.cards.length, 2);
  assert.equal(result.deck.cards[0].front, 'What is Mitochondria?');
  assert.match(result.deck.cards[0].back, /organelles that produce most/);
  assert.equal(result.deck.cards[0].dueAt, 123);
});

test('local study generation reports unreadable or oversized source text', () => {
  assert.throws(() => generateStudyAids({ name: 'Blank.txt', content: 'tiny' }), /not enough readable text/);
  assert.throws(() => generateStudyAids({ name: 'Large.txt', content: 'x'.repeat(200_001) }), /too large/);
});
