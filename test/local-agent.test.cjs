const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { COMMANDS, createLocalAgent } = require('../electron/local-agent.cjs');

function fakeSpawn(calls, { output = 'answer', code = 0 } = {}) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    process.nextTick(() => {
      child.stdout.end(output);
      child.stderr.end();
      child.emit('close', code);
    });
    return child;
  };
}

test('local agent runs signed-in CLIs with shell disabled and read-only safety flags', async () => {
  const calls = [];
  const agent = createLocalAgent({ env: { PATH: '/fake' }, findExecutableImpl: (bin) => `/fake/${bin}`, spawnImpl: fakeSpawn(calls), timeoutMs: 1000 });
  const result = await agent.run({ provider: 'claude', projectPath: '/project', messages: [{ role: 'user', text: 'Review this' }] });
  assert.equal(result, 'answer');
  assert.equal(calls[0].command, '/fake/claude');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.cwd, '/project');
  assert.ok(calls[0].args.includes('--permission-mode'));
  assert.ok(calls[0].args.includes('plan'));
  assert.ok(!calls[0].args.includes('--dangerously-skip-permissions'));
});

test('signed-in Claude Code can use the selected model in safe one-response mode', async () => {
  const calls = [];
  const agent = createLocalAgent({ env: { PATH: '/fake' }, findExecutableImpl: (bin) => `/fake/${bin}`, spawnImpl: fakeSpawn(calls) });
  await agent.run({ provider: 'claude', model: 'claude-sonnet-4-6', messages: [{ role: 'user', text: 'Explain this.' }] });
  assert.ok(calls[0].args.includes('--model'));
  assert.ok(calls[0].args.includes('claude-sonnet-4-6'));
  assert.ok(calls[0].args.includes('--permission-mode'));
  assert.throws(() => agent.run({ provider: 'claude', model: '--dangerously-skip-permissions', messages: [{ role: 'user', text: 'No.' }] }), /valid local Claude model ID/);
});

test('Claude account sign-in uses the supported Claude Code auth command and returns only safe status', async () => {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
    process.nextTick(() => {
      child.stdout.end(args.at(-1) === '--json' ? JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'private@example.com', accessToken: 'do-not-return' }) : 'login complete');
      child.stderr.end(); child.emit('close', 0);
    });
    return child;
  };
  const agent = createLocalAgent({ env: { PATH: '/fake' }, findExecutableImpl: (bin) => `/fake/${bin}`, spawnImpl });
  const status = await agent.signInClaude();
  assert.deepEqual(status, { installed: true, loggedIn: true, authMethod: 'claude.ai' });
  assert.deepEqual(calls[0].args, ['auth', 'login', '--claudeai']);
  assert.deepEqual(calls[1].args, ['auth', 'status', '--json']);
  assert.equal(calls.every((call) => call.options.shell === false), true);
  assert.equal(JSON.stringify(status).includes('do-not-return'), false);
});

test('Claude account controls report an absent CLI without attempting auth commands', async () => {
  let spawned = false;
  const agent = createLocalAgent({ env: { PATH: '' }, findExecutableImpl: () => null, spawnImpl: () => { spawned = true; } });
  assert.deepEqual(await agent.claudeAuthStatus(), { installed: false, loggedIn: false, authMethod: '', error: 'Claude Code CLI was not found. Install Claude Code before connecting your Claude account.' });
  await assert.rejects(agent.signInClaude(), /Claude Code CLI was not found/);
  assert.equal(spawned, false);
});

test('Codex uses read-only sandbox and feeds the prompt over stdin', async () => {
  const calls = [];
  const agent = createLocalAgent({ env: { PATH: '/fake' }, findExecutableImpl: (bin) => `/fake/${bin}`, spawnImpl: fakeSpawn(calls), timeoutMs: 1000 });
  await agent.run({ provider: 'codex', messages: [{ role: 'user', text: 'Inspect' }] });
  assert.deepEqual(calls[0].args.slice(0, 5), ['exec', '--sandbox', 'read-only', '--ask-for-approval', 'never']);
  assert.equal(calls[0].args.at(-1), '-');
});

test('local agent stops the active CLI process when its run is cancelled', async () => {
  let killedWith = null;
  const agent = createLocalAgent({
    env: { PATH: '/fake' }, findExecutableImpl: (bin) => `/fake/${bin}`, timeoutMs: 1000,
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
      child.kill = (signal) => { killedWith = signal; process.nextTick(() => child.emit('close', null, signal)); return true; };
      return child;
    },
  });
  const controller = new AbortController();
  const pending = agent.run({ provider: 'claude', messages: [{ role: 'user', text: 'Long task' }], signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError' && /stopped/.test(error.message));
  assert.equal(killedWith, 'SIGTERM');
});

test('an already-cancelled local run never starts its CLI', async () => {
  let spawned = false;
  const agent = createLocalAgent({ env: { PATH: '/fake' }, findExecutableImpl: (bin) => `/fake/${bin}`, spawnImpl: () => { spawned = true; } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(agent.run({ provider: 'codex', messages: [{ role: 'user', text: 'Do not run' }], signal: controller.signal }), { name: 'AbortError' });
  assert.equal(spawned, false);
});

test('project-edit mode uses provider-specific edit controls and requires a selected folder', async () => {
  assert.ok(COMMANDS.claude.args('prompt', true).includes('acceptEdits'));
  assert.ok(COMMANDS.claude.args('prompt', true).includes('Bash'));
  assert.ok(COMMANDS.codex.args('prompt', true).includes('workspace-write'));
  assert.ok(COMMANDS.gemini.args('prompt', true).includes('auto_edit'));
  const agent = createLocalAgent({ env: { PATH: '/fake' }, findExecutableImpl: (bin) => `/fake/${bin}`, spawnImpl: fakeSpawn([]) });
  assert.throws(() => agent.run({ provider: 'codex', messages: [{ role: 'user', text: 'Edit' }], writeAccess: true }), /Choose a project folder/);
});

test('local CLI errors are useful and attachment paths are validated', async () => {
  const missing = createLocalAgent({ env: { PATH: '' }, findExecutableImpl: () => null, spawnImpl: fakeSpawn([]) });
  assert.throws(() => missing.run({ provider: 'gemini', messages: [{ role: 'user', text: 'Hi' }] }), /not found/);
  const configured = createLocalAgent({ env: { PATH: '/fake' }, findExecutableImpl: (bin) => `/fake/${bin}`, spawnImpl: fakeSpawn([]) });
  assert.throws(() => configured.run({ provider: 'claude', messages: [{ role: 'user', text: 'Hi', context: [{ name: '../secret', content: 'x' }] }] }), /invalid/);
});
