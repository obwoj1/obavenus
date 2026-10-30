const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createLocalAgent } = require('../electron/local-agent.cjs');

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

test('Codex uses read-only sandbox and feeds the prompt over stdin', async () => {
  const calls = [];
  const agent = createLocalAgent({ env: { PATH: '/fake' }, findExecutableImpl: (bin) => `/fake/${bin}`, spawnImpl: fakeSpawn(calls), timeoutMs: 1000 });
  await agent.run({ provider: 'codex', messages: [{ role: 'user', text: 'Inspect' }] });
  assert.deepEqual(calls[0].args.slice(0, 5), ['exec', '--sandbox', 'read-only', '--ask-for-approval', 'never']);
  assert.equal(calls[0].args.at(-1), '-');
});

test('local CLI errors are useful and attachment paths are validated', async () => {
  const missing = createLocalAgent({ env: { PATH: '' }, findExecutableImpl: () => null, spawnImpl: fakeSpawn([]) });
  assert.throws(() => missing.run({ provider: 'gemini', messages: [{ role: 'user', text: 'Hi' }] }), /not found/);
  const configured = createLocalAgent({ env: { PATH: '/fake' }, findExecutableImpl: (bin) => `/fake/${bin}`, spawnImpl: fakeSpawn([]) });
  assert.throws(() => configured.run({ provider: 'claude', messages: [{ role: 'user', text: 'Hi', context: [{ name: '../secret', content: 'x' }] }] }), /invalid/);
});
