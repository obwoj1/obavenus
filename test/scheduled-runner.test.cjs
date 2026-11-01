const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduledTaskRunner } = require('../electron/scheduled-runner.cjs');

test('configured-provider schedules use the read-only team with project, saved memory, and mail tools', async () => {
  const calls = {};
  const runner = createScheduledTaskRunner({
    localAgent: { run: async () => 'local' },
    dispatchProviderMessages: async () => 'dispatch',
    runTeamWorkflow: async (options) => { calls.team = options; return { text: 'Finished research.' }; },
    createAgentToolExecutor: (options) => { calls.tools = options; return async () => {}; },
    getProfile: async () => ({ shareWithAI: false }),
    searchGmail: async () => [],
    collectProjectContext: async (folder, prompt) => [{ name: 'notes.md', content: `${folder}:${prompt}` }],
    collectProjectInstructions: async () => [{ name: 'AGENTS.md', content: 'Use the project conventions.', truncated: false }],
    appendProjectInstructions: (messages, instructions) => messages.map((message) => ({ ...message, text: `${message.text}\n${instructions.map((item) => item.content).join('\n')}` })),
    readProjectMemory: async () => 'Use the current project conventions.',
    userDataPath: '/app-data',
  });
  const result = await runner.run({ provider: 'configured-ai', prompt: 'Review this project', projectPath: '/project' });
  assert.equal(result, 'Finished research.');
  assert.equal(calls.team.writeAccess, false);
  assert.equal(calls.team.browserAccess, false);
  assert.match(calls.team.messages[0].text, /current project conventions/);
  assert.match(calls.team.messages[0].text, /Use the project conventions/);
  assert.deepEqual(calls.team.messages[0].context, [{ name: 'notes.md', content: '/project:Review this project' }]);
  assert.equal(calls.tools.projectPath, '/project');
  assert.equal(typeof calls.tools.searchGmail, 'function');
});

test('local scheduled jobs stay on the selected CLI and read-only scheduled agent', async () => {
  let options;
  const runner = createScheduledTaskRunner({
    localAgent: { run: async (value) => { options = value; return 'done'; } },
    userDataPath: '/app-data',
    collectProjectInstructions: async () => [{ name: 'AGENTS.md', content: 'Keep edits scoped.', truncated: false }],
    appendProjectInstructions: (messages, instructions) => messages.map((message) => ({ ...message, text: `${message.text}\n${instructions[0].content}` })),
  });
  assert.equal(await runner.run({ provider: 'codex', prompt: 'Inspect', projectPath: '/repo' }), 'done');
  assert.deepEqual(options, { provider: 'codex', projectPath: '/repo', messages: [{ role: 'user', text: 'Inspect\nKeep edits scoped.' }] });
});

test('always-on workflows are injected when queued scheduled runs execute', async () => {
  const captured = [];
  const runner = createScheduledTaskRunner({
    localAgent: { run: async ({ messages }) => { captured.push(messages[0].text); return 'local'; } },
    dispatchProviderMessages: async () => 'response',
    runTeamWorkflow: async ({ messages }) => { captured.push(messages[0].text); return { text: 'team' }; },
    createAgentToolExecutor: () => async () => ({}),
    getProfile: async () => ({ shareWithAI: false }),
    searchGmail: async () => [],
    userDataPath: '/app-data',
    getAlwaysOnWorkflows: async () => [{ name: 'Cite evidence', instructions: 'Link sources.', alwaysOn: true }],
  });
  await runner.run({ provider: 'codex', prompt: 'Inspect this.' });
  await runner.run({ provider: 'configured-ai', prompt: 'Research this.' });
  assert.match(captured[0], /Cite evidence: Link sources/);
  assert.match(captured[1], /Cite evidence: Link sources/);
});
