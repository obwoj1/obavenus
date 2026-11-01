const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGroundedStudyQuestion } = require('../electron/study-question.cjs');

test('grounded study prompts cite bounded retrieved excerpts and flag unsupported claims', () => {
  const prompt = buildGroundedStudyQuestion('How does ATP synthase work?', [
    { fileName: 'Cell Biology.pdf', reference: 'Page 12', excerpt: 'ATP synthase uses a proton gradient to produce ATP.' },
  ]);
  assert.match(prompt, /How does ATP synthase work\?/);
  assert.match(prompt, /\[S1\] Cell Biology\.pdf · Page 12/);
  assert.match(prompt, /proton gradient/);
  assert.match(prompt, /say what is missing instead of guessing/);
  assert.match(prompt, /untrusted reference material/);
});

test('grounded study prompt rejects empty, oversized, and source-free questions', () => {
  assert.throws(() => buildGroundedStudyQuestion('', []), /study question/);
  assert.throws(() => buildGroundedStudyQuestion('x'.repeat(301), []), /study question/);
  assert.throws(() => buildGroundedStudyQuestion('Explain this', []), /No matching passages/);
});

test('grounded study prompts cap source count and excerpt bytes', () => {
  const prompt = buildGroundedStudyQuestion('Explain topic', Array.from({ length: 12 }, (_, index) => ({
    fileName: `file-${index}.pdf`, reference: `Page ${index}`, excerpt: 'x'.repeat(2000),
  })));
  assert.match(prompt, /\[S6\]/);
  assert.doesNotMatch(prompt, /\[S7\]/);
  assert.ok(Buffer.byteLength(prompt) < 14_000);
});
