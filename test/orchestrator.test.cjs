const test = require('node:test');
const assert = require('node:assert/strict');
const { runTeamWorkflow } = require('../electron/orchestrator.cjs');

test('team workflow plans, runs independent specialists in parallel, then synthesizes', async () => {
  const calls = [];
  const progress = [];
  let releaseSpecialists;
  const specialistsStarted = new Promise((resolve) => { releaseSpecialists = resolve; });
  const specialistResponses = [];
  const dispatch = async (messages) => {
    const text = messages[0].text;
    calls.push(text);
    if (text.includes('You are the lead agent.')) return 'Plan: inspect the request, then compare options.';
    if (text.includes('You are an independent specialist agent.')) {
      specialistResponses.push('analysis');
      if (specialistResponses.length === 2) releaseSpecialists();
      await specialistsStarted;
      return 'Analysis: option A is strongest.';
    }
    if (text.includes('You are an independent reviewer.')) {
      specialistResponses.push('review');
      if (specialistResponses.length === 2) releaseSpecialists();
      await specialistsStarted;
      return 'Review: option A needs a caveat.';
    }
    assert.match(text, /Specialist analysis:[\s\S]*Analysis: option A is strongest\./);
    assert.match(text, /Independent review:[\s\S]*Review: option A needs a caveat\./);
    return 'Final: choose A with the caveat.';
  };

  const result = await runTeamWorkflow({
    messages: [{ role: 'user', text: 'Compare the options.', context: [{ name: 'notes.txt', content: 'Option A and B' }] }],
    dispatch,
    onProgress: (event) => progress.push(event.stage),
  });

  assert.equal(calls.length, 4);
  assert.deepEqual(specialistResponses.sort(), ['analysis', 'review']);
  assert.deepEqual(progress, ['planner', 'specialists', 'synthesis']);
  assert.equal(result.text, 'Final: choose A with the caveat.');
  assert.equal(result.agents.length, 3);
  assert.ok(calls.slice(1, 3).every((call) => call.includes('Lead plan:')));
});

test('team workflow rejects a conversation without a user message', async () => {
  await assert.rejects(runTeamWorkflow({ messages: [{ role: 'assistant', text: 'hello' }], dispatch: async () => '' }), /needs a user request/);
});
