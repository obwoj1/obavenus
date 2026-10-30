const assert = require('node:assert/strict');
const test = require('node:test');
const { SKILLS, applySkill, getSkill } = require('../electron/skills.cjs');

test('bundled reusable workflows are unique and apply only to the latest user message', () => {
  assert.equal(new Set(SKILLS.map((skill) => skill.id)).size, SKILLS.length);
  const messages = [{ role: 'user', text: 'Earlier' }, { role: 'assistant', text: 'Reply' }, { role: 'user', text: 'Review this' }];
  const result = applySkill(messages, 'review-changes');
  assert.match(result.at(-1).text, /actionable bugs, regressions/);
  assert.equal(result[0].text, 'Earlier');
  assert.equal(messages.at(-1).text, 'Review this');
  assert.equal(getSkill('missing'), null);
});

test('unknown workflows leave messages untouched', () => {
  const messages = [{ role: 'user', text: 'Hello' }];
  assert.deepEqual(applySkill(messages, 'not-a-skill'), messages);
});
