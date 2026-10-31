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
    readProjectMemory: async () => 'Use the current project conventions.',
    userDataPath: '/app-data',
  });
  const result = await runner.run({ provider: 'configured-ai', prompt: 'Review this project', projectPath: '/project' });
  assert.equal(result, 'Finished research.');
  assert.equal(calls.team.writeAccess, false);
  assert.equal(calls.team.browserAccess, false);
  assert.match(calls.team.messages[0].text, /current project conventions/);
  assert.deepEqual(calls.team.messages[0].context, [{ name: 'notes.md', content: '/project:Review this project' }]);
  assert.equal(calls.tools.projectPath, '/project');
  assert.equal(typeof calls.tools.searchGmail, 'function');
});

test('local scheduled jobs stay on the selected CLI and read-only scheduled agent', async () => {
  let options;
  const runner = createScheduledTaskRunner({
    localAgent: { run: async (value) => { options = value; return 'done'; } },
    userDataPath: '/app-data',
  });
  assert.equal(await runner.run({ provider: 'codex', prompt: 'Inspect', projectPath: '/repo' }), 'done');
  assert.deepEqual(options, { provider: 'codex', projectPath: '/repo', messages: [{ role: 'user', text: 'Inspect' }] });
});
