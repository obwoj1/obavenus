const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, mkdir, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { TOOL_DEFINITIONS, createAgentToolExecutor, runToolAgent } = require('../electron/agent-tools.cjs');

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

test('project memory can be read across runs but saving requires project-write authorization', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-tool-memory-'));
  let note = '';
  const projectMemory = { read: async () => note, save: async (_project, value) => { note = value; return { saved: true, characters: value.length }; } };
  try {
    const readOnly = createAgentToolExecutor({ projectPath: root, projectMemory });
    assert.equal((await readOnly('read_project_memory')).memory, '');
    assert.match((await readOnly('save_project_memory', { memory: 'Use the existing component library.' })).error, /project-write mode/);
    const writer = createAgentToolExecutor({ projectPath: root, projectMemory, writeAccess: true });
    assert.deepEqual(await writer('save_project_memory', { memory: 'Use the existing component library.' }), { saved: true, characters: 35 });
    assert.equal((await readOnly('read_project_memory')).memory, 'Use the existing component library.');
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
    clickControl: async (text) => ({ approved: true, label: text }),
  };
  const allowed = createAgentToolExecutor({ browserAccess: true, browser });
  assert.deepEqual(await allowed('browser_open_page', { url: 'https://example.com' }), { url: 'https://example.com' });
  assert.equal((await allowed('browser_read_page')).text, 'Public page text');
  assert.equal((await allowed('browser_follow_link', { text: 'About' })).url, 'https://example.com/about');
  assert.deepEqual(await allowed('browser_click_control', { text: 'Search' }), { approved: true, label: 'Search' });
  assert.deepEqual(visited, ['https://example.com']);
});

test('browser form filling is exposed only for paired Chrome and enforces text bounds', async () => {
  const browser = { fillField: async (label, value) => ({ approved: true, label, value, submitted: false }) };
  const researchTools = [];
  await runToolAgent({ messages: [{ role: 'user', text: 'research' }], executeTool: async () => {}, browserAccess: true, dispatch: async (_messages, options) => { researchTools.push(...options.tools); return 'Done'; } });
  assert.equal(researchTools.some((tool) => tool.name === 'browser_fill_field'), false);
  const chromeTools = [];
  await runToolAgent({ messages: [{ role: 'user', text: 'research' }], executeTool: async () => {}, browserAccess: true, browserFillAccess: true, dispatch: async (_messages, options) => { chromeTools.push(...options.tools); return 'Done'; } });
  assert.equal(chromeTools.some((tool) => tool.name === 'browser_fill_field'), true);

  const denied = createAgentToolExecutor({ browserAccess: true, browser, browserFillAccess: false });
  assert.match((await denied('browser_fill_field', { label: 'Email', value: 'a@example.com' })).error, /paired Chrome/);
  const allowed = createAgentToolExecutor({ browserAccess: true, browserFillAccess: true, browser });
  assert.deepEqual(await allowed('browser_fill_field', { label: 'Email', value: 'a@example.com' }), { approved: true, label: 'Email', value: 'a@example.com', submitted: false });
  await assert.rejects(allowed('browser_fill_field', { label: 'Email', value: 'x'.repeat(2001) }), /2,000/);
});

test('connected MCP read-only tools join the agent tool list and dispatch to their connector', async () => {
  const externalTool = { name: 'mcp_course_search_materials', description: '[Courseware] Search material', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } };
  let listed = false;
  let executed;
  let turn = 0;
  const answer = await runToolAgent({
    messages: [{ role: 'user', text: 'Find enzymes in my course' }],
    externalTools: [externalTool],
    executeTool: async (name, args) => { executed = { name, args }; return { text: 'Page 3 describes enzymes.' }; },
    dispatch: async (_messages, { tools }) => {
      listed ||= tools.some((tool) => tool.name === externalTool.name);
      turn += 1;
      return turn === 1 ? { toolCalls: [{ name: externalTool.name, arguments: { query: 'enzymes' } }] } : { text: 'The result is on page 3.' };
    },
  });
  assert.equal(listed, true);
  assert.deepEqual(executed, { name: externalTool.name, args: { query: 'enzymes' } });
  assert.equal(answer, 'The result is on page 3.');
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
