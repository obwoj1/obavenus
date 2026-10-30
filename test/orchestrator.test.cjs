const test = require('node:test');
const assert = require('node:assert/strict');
const { runTeamWorkflow } = require('../electron/orchestrator.cjs');
const { runToolAgent } = require('../electron/agent-tools.cjs');

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

test('selected custom specialist profile is applied to the analysis agent', async () => {
  const prompts = [];
  await runTeamWorkflow({
    messages: [{ role: 'user', text: 'Compare roles.' }],
    specialist: { name: 'Federal hiring analyst', instructions: 'Prioritize official agency postings and clearance requirements.' },
    dispatch: async (messages) => {
      const prompt = messages[0].text;
      prompts.push(prompt);
      if (prompt.includes('You are the lead agent.')) return 'Plan.';
      if (prompt.includes('You are an independent specialist agent.')) return 'Analysis.';
      if (prompt.includes('You are an independent reviewer.')) return 'Review.';
      return 'Answer.';
    },
  });
  const analysisPrompt = prompts.find((prompt) => prompt.includes('You are an independent specialist agent.'));
  assert.match(analysisPrompt, /Act as the Federal hiring analyst/);
  assert.match(analysisPrompt, /official agency postings and clearance requirements/);
  assert.ok(prompts.filter((prompt) => prompt.includes('Federal hiring analyst')).length === 1);
});

test('write mode exposes the write tool only to the implementation specialist and reports file changes', async () => {
  const toolAvailability = [];
  const executeTool = async () => ({ saved: true });
  executeTool.getChanges = () => [{ path: 'notes.md', bytes: 5, created: true }];
  const result = await runTeamWorkflow({
    messages: [{ role: 'user', text: 'Write a note.' }],
    writeAccess: true,
    executeTool,
    dispatch: async (messages, { tools }) => {
      const role = messages[0].text;
      toolAvailability.push({ role, canWrite: tools.some((tool) => tool.name === 'write_project_file') });
      if (role.includes('You are the lead agent.')) return 'Plan.';
      if (role.includes('You are an independent specialist agent.')) return 'Analysis.';
      if (role.includes('You are an independent reviewer.')) return 'Review.';
      return 'Done.';
    },
  });
  assert.equal(toolAvailability.find((item) => item.role.includes('You are an independent specialist agent.')).canWrite, true);
  assert.equal(toolAvailability.find((item) => item.role.includes('You are the lead agent.')).canWrite, false);
  assert.equal(toolAvailability.find((item) => item.role.includes('You are an independent reviewer.')).canWrite, false);
  assert.equal(toolAvailability.find((item) => item.role.includes('You are the lead agent finishing')).canWrite, false);
  assert.deepEqual(result.changes, [{ path: 'notes.md', bytes: 5, created: true }]);
});

test('tool agent executes structured model tool calls and returns the follow-up answer', async () => {
  const transcript = [];
  let round = 0;
  const answer = await runToolAgent({
    messages: [{ role: 'user', text: 'Inspect src/app.js.' }],
    dispatch: async (messages, options) => {
      transcript.push(messages);
      if (round++ === 0) {
        assert.equal(options.tools[0].name, 'list_project_files');
        return { text: '', toolCalls: [{ name: 'read_project_file', arguments: { path: 'src/app.js' } }] };
      }
      assert.match(messages.at(-1).text, /local-only preview/);
      return { text: 'The file renders a local-only preview.', toolCalls: [] };
    },
    executeTool: async (name, args) => {
      assert.equal(name, 'read_project_file');
      assert.equal(args.path, 'src/app.js');
      return { content: 'local-only preview' };
    },
  });
  assert.equal(answer, 'The file renders a local-only preview.');
  assert.equal(transcript.length, 2);
});
