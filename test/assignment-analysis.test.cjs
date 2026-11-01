const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeAssignment } = require('../electron/assignment-analysis.cjs');

test('assignment requirement scan extracts deliverable, quantity, format, citation, evidence, and due date', () => {
  const result = analyzeAssignment({
    title: 'Research essay', dueAt: 2000,
    instructions: 'Submit a 1,500-word essay as a PDF. Cite at least 5 sources in APA style. Include a clear thesis and compare two studies.',
  });
  assert.deepEqual(result.deliverables, ['essay']);
  assert.deepEqual(result.quantityRequirements, ['1,500-word', 'at least 5 sources']);
  assert.deepEqual(result.formatRequirements, ['PDF']);
  assert.deepEqual(result.citations, ['APA']);
  assert.match(result.evidence.join(' '), /Cite at least 5 sources/);
  assert.equal(result.dueDate, new Date(2000).toISOString());
  assert.equal(result.analyzedLocally, true);
});

test('assignment requirement scan stays transparent on absent or oversized input', () => {
  const result = analyzeAssignment({ title: 'Reading', instructions: 'Complete the assignment.' });
  assert.deepEqual(result.deliverables, []);
  assert.deepEqual(result.evidence, []);
  assert.throws(() => analyzeAssignment({ instructions: 'x'.repeat(20_001) }), /local analysis limit/);
});
