const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestAssignmentSteps } = require('../electron/assignment-planner.cjs');

test('assignment checklist extracts explicit actions, removes duplicate lines, and bounds output', () => {
  const result = suggestAssignmentSteps('1. Compare the two models using the data in Table 2.\n2. Explain how the results support your claim.\n3. Compare the two models using the data in Table 2.');
  assert.equal(result.source, 'instructions');
  assert.deepEqual(result.steps, ['Compare the two models using the data in Table 2', 'Explain how the results support your claim']);
});

test('assignment checklist uses transparent starter steps when instructions have no detected actions', () => {
  const result = suggestAssignmentSteps('Due Friday. Worth 15 points.');
  assert.equal(result.source, 'general');
  assert.equal(result.steps.length, 5);
  assert.match(result.steps[0], /rubric/);
});

test('assignment checklist rejects oversized or non-text instructions', () => {
  assert.throws(() => suggestAssignmentSteps('x'.repeat(20_001)), /20,000/);
  assert.throws(() => suggestAssignmentSteps(null), /must be text/);
});
