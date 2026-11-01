const test = require('node:test');
const assert = require('node:assert/strict');
const { searchStudySources } = require('../electron/study-search.cjs');

test('study search returns deterministic page references and relevant excerpts', () => {
  const data = {
    courses: [{ id: 'course-1', name: 'Biology' }, { id: 'course-2', name: 'History' }],
    sources: [
      { id: 'file-1', courseId: 'course-1', name: 'Cell biology.pdf', content: 'Page 1\nIntroductory cells.\n\nPage 2\nMitochondria produce ATP through cellular respiration.' },
      { id: 'file-2', courseId: 'course-2', name: 'History.pdf', content: 'Page 4\nThe mitochondria example is only an analogy.' },
    ],
  };
  const results = searchStudySources(data, 'mitochondria ATP');
  assert.equal(results[0].fileName, 'Cell biology.pdf');
  assert.equal(results[0].reference, 'Page 2');
  assert.match(results[0].excerpt, /produce ATP/);
  assert.equal(searchStudySources(data, 'mitochondria', 'course-1').length, 1);
  assert.deepEqual(searchStudySources(data, 'the and'), []);
});

test('study search rejects oversized queries and caps matching passages', () => {
  const sources = Array.from({ length: 20 }, (_, index) => ({ id: `file-${index}`, courseId: '', name: `File ${index}`, content: `Page 1\ncommon topic ${index}\nPage 2\ncommon topic again ${index}` }));
  assert.equal(searchStudySources({ courses: [], sources }, 'common topic').length, 12);
  assert.throws(() => searchStudySources({ courses: [], sources }, 'x'.repeat(301)), /300 characters/);
});
