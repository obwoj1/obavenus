const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { buildSpreadsheet } = require('../electron/artifacts.cjs');
const { TOOL_DEFINITIONS, GIT_TOOLS, createAgentToolExecutor, runToolAgent } = require('../electron/agent-tools.cjs');

test('team agents get read-only Git status, diffs, and scoped commit history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-git-tools-'));
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'Obavenus Test']);
    git(['config', 'user.email', 'test@example.invalid']);
    await writeFile(path.join(root, 'tracked.txt'), 'original\n');
    git(['add', 'tracked.txt']);
    git(['commit', '-qm', 'initial']);
    await writeFile(path.join(root, 'tracked.txt'), 'staged version\n');
    git(['add', 'tracked.txt']);
    await writeFile(path.join(root, 'tracked.txt'), 'unstaged version\n');
    await writeFile(path.join(root, 'untracked.txt'), 'new file\n');

    const executor = createAgentToolExecutor({ projectPath: root });
    const status = await executor('get_project_git_status');
    assert.equal(status.isRepository, true);
    assert.match(status.status, /tracked\.txt/);
    assert.match(status.status, /untracked\.txt/);
    const diff = await executor('read_project_git_diff');
    assert.equal(diff.isRepository, true);
    assert.match(diff.stagedDiff, /staged version/);
    assert.match(diff.unstagedDiff, /unstaged version/);
    assert.doesNotMatch(diff.stagedDiff + diff.unstagedDiff, /new file/);
    const history = await executor('read_project_git_history');
    assert.equal(history.isRepository, true);
    assert.match(history.commits, /initial/);
    assert.deepEqual(GIT_TOOLS.map((tool) => tool.name), ['get_project_git_status', 'read_project_git_diff', 'read_project_git_history']);

    const nested = path.join(root, 'nested');
    await mkdir(nested);
    await writeFile(path.join(nested, 'nested-only.txt'), 'nested file\n');
    const nestedStatus = await createAgentToolExecutor({ projectPath: nested })('get_project_git_status');
    assert.match(nestedStatus.status, /nested-only\.txt/);
    assert.doesNotMatch(nestedStatus.status, /tracked\.txt|untracked\.txt/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Git tools are available to read-only team agent calls', async () => {
  let tools;
  await runToolAgent({
    messages: [{ role: 'user', text: 'Review my changes' }],
    executeTool: async () => ({}),
    dispatch: async (_messages, options) => { tools = options.tools; return 'Reviewed.'; },
  });
  assert.ok(tools.some((tool) => tool.name === 'get_project_git_status'));
  assert.ok(tools.some((tool) => tool.name === 'read_project_git_diff'));
  assert.ok(tools.some((tool) => tool.name === 'read_project_git_history'));
  assert.ok(!tools.some((tool) => /git.*write|commit/i.test(tool.name)));
});

test('team agents can call deterministic line-numbered project text search', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-search-tool-'));
  await mkdir(path.join(root, 'src'));
  try {
    await writeFile(path.join(root, 'src', 'entry.js'), 'start\nregisterWorkflow("review")\nend');
    const executor = createAgentToolExecutor({ projectPath: root });
    const result = await executor('search_project_text', { query: 'registerWorkflow' });
    assert.deepEqual(result.matches.map(({ path: name, line }) => [name, line]), [['src/entry.js', 2]]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
    assert.match((await denied('create_diagram', { path: 'architecture.svg' })).error, /disabled/);
    const allowed = createAgentToolExecutor({ projectPath: root, writeAccess: true });
    const result = await allowed('write_project_file', { path: 'docs/plan.md', content: '# approved for this run' });
    assert.equal(result.saved, true);
    assert.equal(await readFile(path.join(root, 'docs', 'plan.md'), 'utf8'), '# approved for this run');
    const diagram = await allowed('create_diagram', {
      path: 'architecture.svg', title: 'Research & delivery',
      nodes: [{ id: 'search', label: 'Read <source>' }, { id: 'deliver', label: 'Write report' }],
      edges: [{ from: 'search', to: 'deliver', label: 'verified' }],
    });
    assert.equal(diagram.format, 'offline SVG diagram');
    assert.match(await readFile(path.join(root, 'architecture.svg'), 'utf8'), /Read &lt;source&gt;/);
    assert.deepEqual(allowed.getChanges(), [
      { path: path.join('docs', 'plan.md'), bytes: 23, created: true },
      { path: 'architecture.svg', bytes: (await readFile(path.join(root, 'architecture.svg'))).length, created: true },
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('exact project text replacement is unique, write-gated, and undoable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-text-replace-'));
  try {
    const target = path.join(root, 'src.js');
    await writeFile(target, 'const mode = "safe";\nstart();\n');
    const denied = createAgentToolExecutor({ projectPath: root });
    assert.match((await denied('replace_project_text', { path: 'src.js', oldText: 'safe', newText: 'reviewed' })).error, /disabled/);
    let undoSnapshot;
    const allowed = createAgentToolExecutor({ projectPath: root, writeAccess: true, projectUndo: { record: async (entry) => { undoSnapshot = entry; return 'undo-token'; } } });
    const result = await allowed('replace_project_text', { path: 'src.js', oldText: '"safe"', newText: '"reviewed"' });
    assert.equal(result.replacements, 1);
    assert.equal(result.undoToken, 'undo-token');
    assert.equal(await readFile(target, 'utf8'), 'const mode = "reviewed";\nstart();\n');
    assert.equal(undoSnapshot.beforeBytes.toString(), 'const mode = "safe";\nstart();\n');
    await assert.rejects(allowed('replace_project_text', { path: 'src.js', oldText: 'absent', newText: 'stop' }), /not found/);
    await writeFile(target, 'same same');
    await assert.rejects(allowed('replace_project_text', { path: 'src.js', oldText: 'same', newText: 'unique' }), /more than once/);
    assert.equal(await readFile(target, 'utf8'), 'same same');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('updating an existing workbook is gated, undoable, and returns saved cell values', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-spreadsheet-edit-'));
  try {
    const target = path.join(root, 'budget.xlsx');
    await writeFile(target, await buildSpreadsheet({ sheets: [{ name: 'Budget', headers: ['Item', 'Amount'], rows: [['Transit', 25]] }] }));
    const denied = createAgentToolExecutor({ projectPath: root });
    assert.match((await denied('update_spreadsheet', { path: 'budget.xlsx', sheet: 'Budget', cells: [{ address: 'B2', value: 50 }] })).error, /disabled/);
    let snapshot;
    const allowed = createAgentToolExecutor({ projectPath: root, writeAccess: true, projectUndo: { record: async (entry) => { snapshot = entry; return 'undo-token'; } } });
    const result = await allowed('update_spreadsheet', { path: 'budget.xlsx', sheet: 'Budget', cells: [{ address: 'B2', value: 340 }] });
    assert.equal(result.saved, true);
    assert.deepEqual(result.updated, [{ address: 'B2', value: 340 }]);
    assert.equal(result.undoToken, 'undo-token');
    assert.equal(snapshot.created, false);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(target);
    assert.equal(workbook.getWorksheet('Budget').getCell('B2').value, 340);
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
    listTabs: async () => ({ tabs: [{ title: 'Course', url: 'https://school.example/course', active: false }] }),
    selectTab: async (url) => ({ selected: true, url }),
    captureVisibleTab: async () => ({ mimeType: 'image/jpeg', bytes: Buffer.from('image') }),
    open: async (url) => { visited.push(url); return { url }; },
    readPage: async () => ({ url: 'https://example.com', text: 'Public page text' }),
    followLink: async (text) => ({ text, url: 'https://example.com/about' }),
    clickControl: async (text) => ({ approved: true, label: text }),
    selectOption: async (label, option) => ({ approved: true, label, option }),
    setChecked: async (label, checked) => ({ approved: true, label, checked }),
  };
  const allowed = createAgentToolExecutor({ browserAccess: true, browser });
  assert.deepEqual(await allowed('browser_list_tabs'), { tabs: [{ title: 'Course', url: 'https://school.example/course', active: false }] });
  assert.deepEqual(await allowed('browser_select_tab', { url: 'https://school.example/course' }), { selected: true, url: 'https://school.example/course' });
  assert.match((await allowed('browser_read_screenshot_text')).error, /paired Chrome/);
  await assert.rejects(allowed('browser_select_tab', { url: 'x'.repeat(2_001) }), /2,000/);
  assert.deepEqual(await allowed('browser_open_page', { url: 'https://example.com' }), { url: 'https://example.com' });
  assert.equal((await allowed('browser_read_page')).text, 'Public page text');
  assert.equal((await allowed('browser_follow_link', { text: 'About' })).url, 'https://example.com/about');
  assert.deepEqual(await allowed('browser_click_control', { text: 'Search' }), { approved: true, label: 'Search' });
  assert.deepEqual(visited, ['https://example.com']);
});

test('tab list and tab switching tools are exposed only to paired Chrome runs', async () => {
  const isolatedTools = [];
  await runToolAgent({ messages: [{ role: 'user', text: 'research' }], executeTool: async () => {}, browserAccess: true, dispatch: async (_messages, options) => { isolatedTools.push(...options.tools); return 'Done'; } });
  assert.equal(isolatedTools.some((tool) => tool.name === 'browser_list_tabs' || tool.name === 'browser_select_tab'), false);
  const pairedTools = [];
  await runToolAgent({ messages: [{ role: 'user', text: 'research' }], executeTool: async () => {}, browserAccess: true, browserFillAccess: true, dispatch: async (_messages, options) => { pairedTools.push(...options.tools); return 'Done'; } });
  assert.equal(pairedTools.some((tool) => tool.name === 'browser_list_tabs'), true);
  assert.equal(pairedTools.some((tool) => tool.name === 'browser_select_tab'), true);
  assert.equal(pairedTools.some((tool) => tool.name === 'browser_read_screenshot_text'), true);
});

test('paired Chrome screenshot OCR stays local and returns bounded recognized text', async () => {
  let received;
  const executor = createAgentToolExecutor({
    browserAccess: true,
    browserFillAccess: true,
    browser: { captureVisibleTab: async () => ({ mimeType: 'image/jpeg', bytes: Buffer.from('jpeg') }) },
    ocrImage: async (bytes) => { received = bytes; return 'Canvas-rendered course instructions'; },
  });
  assert.deepEqual(await executor('browser_read_screenshot_text'), {
    text: 'Canvas-rendered course instructions', extractedLocally: true, source: 'visible Chrome tab screenshot OCR',
  });
  assert.equal(received.toString(), 'jpeg');
});

test('browser form entry and choices are exposed only for paired Chrome and enforce bounds', async () => {
  const browser = {
    fillField: async (label, value) => ({ approved: true, label, value, submitted: false }),
    selectOption: async (label, option) => ({ approved: true, label, option }),
    setChecked: async (label, checked) => ({ approved: true, label, checked }),
  };
  const researchTools = [];
  await runToolAgent({ messages: [{ role: 'user', text: 'research' }], executeTool: async () => {}, browserAccess: true, dispatch: async (_messages, options) => { researchTools.push(...options.tools); return 'Done'; } });
  assert.equal(researchTools.some((tool) => tool.name === 'browser_fill_field'), false);
  assert.equal(researchTools.some((tool) => tool.name === 'browser_read_screenshot_text'), false);
  assert.equal(researchTools.some((tool) => tool.name === 'browser_select_option'), false);
  assert.equal(researchTools.some((tool) => tool.name === 'browser_set_checked'), false);
  const chromeTools = [];
  await runToolAgent({ messages: [{ role: 'user', text: 'research' }], executeTool: async () => {}, browserAccess: true, browserFillAccess: true, dispatch: async (_messages, options) => { chromeTools.push(...options.tools); return 'Done'; } });
  assert.equal(chromeTools.some((tool) => tool.name === 'browser_fill_field'), true);
  assert.equal(chromeTools.some((tool) => tool.name === 'browser_select_option'), true);
  assert.equal(chromeTools.some((tool) => tool.name === 'browser_set_checked'), true);

  const denied = createAgentToolExecutor({ browserAccess: true, browser, browserFillAccess: false });
  assert.match((await denied('browser_fill_field', { label: 'Email', value: 'a@example.com' })).error, /paired Chrome/);
  const allowed = createAgentToolExecutor({ browserAccess: true, browserFillAccess: true, browser });
  assert.deepEqual(await allowed('browser_fill_field', { label: 'Email', value: 'a@example.com' }), { approved: true, label: 'Email', value: 'a@example.com', submitted: false });
  await assert.rejects(allowed('browser_fill_field', { label: 'Email', value: 'x'.repeat(2001) }), /2,000/);
  assert.match((await denied('browser_select_option', { label: 'Department', option: 'Engineering' })).error, /paired Chrome/);
  assert.deepEqual(await allowed('browser_select_option', { label: 'Department', option: 'Engineering' }), { approved: true, label: 'Department', option: 'Engineering' });
  await assert.rejects(allowed('browser_select_option', { label: 'x'.repeat(201), option: 'Engineering' }), /200 characters/);
  assert.match((await denied('browser_set_checked', { label: 'Email updates', checked: true })).error, /paired Chrome/);
  assert.deepEqual(await allowed('browser_set_checked', { label: 'Email updates', checked: true }), { approved: true, label: 'Email updates', checked: true });
  await assert.rejects(allowed('browser_set_checked', { label: 'Email updates', checked: 'yes' }), /checked state/);
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
