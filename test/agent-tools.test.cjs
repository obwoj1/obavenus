const assert = require('node:assert/strict');
const test = require('node:test');
const { TOOL_DEFINITIONS, createAgentToolExecutor } = require('../electron/agent-tools.cjs');

test('career and code tools are available and GitHub inspection requires explicit profile sharing', async () => {
  assert.ok(TOOL_DEFINITIONS.some((tool) => tool.name === 'inspect_github_profile'));
  let requests = 0;
  const denied = createAgentToolExecutor({ getProfile: async () => ({ shareWithAI: false, githubUrl: 'https://github.com/ada' }), fetchImpl: async () => { requests++; } });
  assert.match((await denied('inspect_github_profile')).error, /not enabled/);
  assert.equal(requests, 0);

  const executor = createAgentToolExecutor({
    getProfile: async () => ({ shareWithAI: true, githubUrl: 'https://github.com/ada' }),
    fetchImpl: async (url) => ({ ok: true, json: async () => url.endsWith('/repos?per_page=100&sort=updated') ? [{ name: 'obavenus', language: 'JavaScript', stargazers_count: 2 }] : { name: 'Ada', public_repos: 1, followers: 3 } }),
  });
  const result = await executor('inspect_github_profile');
  assert.equal(result.name, 'Ada');
  assert.equal(result.repositories[0].language, 'JavaScript');
});
