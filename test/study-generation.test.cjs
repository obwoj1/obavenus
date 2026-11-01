const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPracticeQuiz, generateStudyAids } = require('../electron/study-generation.cjs');

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

test('practice quiz has deterministic distinct answer choices and requires enough cards', () => {
  const deck = { cards: [
    { id: 'a', front: 'What is ATP?', back: 'Adenosine triphosphate' },
    { id: 'b', front: 'What is DNA?', back: 'Deoxyribonucleic acid' },
    { id: 'c', front: 'What is RNA?', back: 'Ribonucleic acid' },
  ] };
  const quiz = buildPracticeQuiz(deck);
  assert.equal(quiz.length, 3);
  assert.equal(quiz[0].options[quiz[0].correctIndex], deck.cards[0].back);
  assert.notEqual(quiz[1].correctIndex, 0);
  assert.equal(new Set(quiz[0].options).size, quiz[0].options.length);
  assert.throws(() => buildPracticeQuiz({ cards: [deck.cards[0]] }), /at least two cards/);
});
