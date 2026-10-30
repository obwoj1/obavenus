const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, mkdir, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
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

test('project file writes require per-run authorization and report the exact file change', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-tool-write-'));
  await mkdir(path.join(root, 'docs'));
  try {
    const denied = createAgentToolExecutor({ projectPath: root });
    assert.match((await denied('write_project_file', { path: 'docs/plan.md', content: '# no' })).error, /disabled/);
    const allowed = createAgentToolExecutor({ projectPath: root, writeAccess: true });
    const result = await allowed('write_project_file', { path: 'docs/plan.md', content: '# approved for this run' });
    assert.equal(result.saved, true);
    assert.equal(await readFile(path.join(root, 'docs', 'plan.md'), 'utf8'), '# approved for this run');
    assert.deepEqual(allowed.getChanges(), [{ path: path.join('docs', 'plan.md'), bytes: 23, created: true }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('browser tools are unavailable outside browser mode and only navigate when explicitly enabled', async () => {
  const denied = createAgentToolExecutor({ browser: {} });
  assert.match((await denied('browser_open_page', { url: 'https://example.com' })).error, /disabled/);
  const visited = [];
  const browser = {
    open: async (url) => { visited.push(url); return { url }; },
    readPage: async () => ({ url: 'https://example.com', text: 'Public page text' }),
    followLink: async (text) => ({ text, url: 'https://example.com/about' }),
  };
  const allowed = createAgentToolExecutor({ browserAccess: true, browser });
  assert.deepEqual(await allowed('browser_open_page', { url: 'https://example.com' }), { url: 'https://example.com' });
  assert.equal((await allowed('browser_read_page')).text, 'Public page text');
  assert.equal((await allowed('browser_follow_link', { text: 'About' })).url, 'https://example.com/about');
  assert.deepEqual(visited, ['https://example.com']);
});

test('native spreadsheet tool is gated behind project-write mode and reports its project artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-office-tool-'));
  try {
    const args = { path: 'reports/roles.xlsx', sheets: [{ name: 'Roles', headers: ['Title', 'Salary'], rows: [['Software Engineer', 172000]] }] };
    const denied = createAgentToolExecutor({ projectPath: root });
    assert.match((await denied('create_spreadsheet', args)).error, /disabled/);
    const allowed = createAgentToolExecutor({ projectPath: root, writeAccess: true });
    const result = await allowed('create_spreadsheet', args);
    assert.equal(result.saved, true);
    assert.equal(result.format, 'spreadsheet');
    assert.deepEqual(allowed.getChanges(), [{ path: path.join('reports', 'roles.xlsx'), bytes: result.bytes, created: true }]);
    assert.equal((await readFile(path.join(root, 'reports/roles.xlsx'))).subarray(0, 2).toString(), 'PK');
  } finally { await rm(root, { recursive: true, force: true }); }
});
