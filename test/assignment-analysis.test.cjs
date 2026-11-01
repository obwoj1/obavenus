const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeAssignment, buildAssignmentReviewChecklist } = require('../electron/assignment-analysis.cjs');

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
  assert.deepEqual(result.gradingCriteria, []);
  assert.deepEqual(result.skills, []);
  assert.ok(result.instructorQuestions.length > 0);
  assert.throws(() => analyzeAssignment({ instructions: 'x'.repeat(20_001) }), /local analysis limit/);
});

test('assignment scan separates explicitly named grading criteria, skills, and suggested questions', () => {
  const result = analyzeAssignment({ title: 'Data report', instructions: 'Use data analysis and critical thinking. The rubric awards 20 points for evidence quality. Cite sources.' });
  assert.deepEqual(result.skills, ['Critical thinking', 'Data analysis']);
  assert.deepEqual(result.gradingCriteria, ['The rubric awards 20 points for evidence quality.']);
  assert.ok(result.instructorQuestions.some((question) => question.includes('citation style')));
  assert.ok(result.instructorQuestions.some((question) => question.includes('format')));
});

test('assignment review checklist keeps explicit findings traceable and includes a final student review', () => {
  const analysis = analyzeAssignment({ title: 'Research essay', instructions: 'Write a 1,000-word essay as a PDF. Cite sources in MLA. The rubric awards 5 points for evidence.' });
  const checklist = buildAssignmentReviewChecklist(analysis);
  assert.ok(checklist.some((item) => item.includes('1,000-word')));
  assert.ok(checklist.some((item) => item.includes('PDF')));
  assert.ok(checklist.some((item) => item.includes('MLA')));
  assert.ok(checklist.some((item) => item.includes('rubric awards 5 points')));
  assert.match(checklist.at(-1), /original assignment before submitting/);
  assert.throws(() => buildAssignmentReviewChecklist({}), /local assignment review/);
});
