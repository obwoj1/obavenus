const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createRemoteAgent, validateTarget, validateRemotePath, shellQuote } = require('../electron/remote-agent.cjs');

function fakeSpawn(calls, { output = 'remote answer', code = 0 } = {}) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
    child.stdin.on('data', (chunk) => { calls.at(-1).stdin = (calls.at(-1).stdin || '') + chunk.toString(); });
    process.nextTick(() => { child.stdout.end(output); child.stderr.end(); child.emit('close', code); });
    return child;
  };
}

test('remote agents use a configured SSH alias, no local shell, and read-only provider controls', async () => {
  const calls = [];
  const agent = createRemoteAgent({ spawnImpl: fakeSpawn(calls), timeoutMs: 1000 });
  assert.equal(await agent.run({ provider: 'claude', target: 'studio', messages: [{ role: 'user', text: 'Review this' }] }), 'remote answer');
  const call = calls[0];
  assert.equal(call.command, '/usr/bin/ssh');
  assert.equal(call.options.shell, false);
  assert.deepEqual(call.args.slice(0, 6), ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', 'studio']);
  assert.match(call.args[6], /'--permission-mode' 'plan'/);
  assert.ok(!call.args[6].includes('--dangerously-skip-permissions'));
  assert.equal(call.stdin, undefined);
});

test('remote project writes require an absolute directory and preserve shell quoting', async () => {
  const calls = [];
  const agent = createRemoteAgent({ spawnImpl: fakeSpawn(calls), timeoutMs: 1000 });
  assert.throws(() => agent.run({ provider: 'codex', target: 'studio', messages: [{ role: 'user', text: 'Edit' }], writeAccess: true }), /absolute remote project path/);
  await agent.run({ provider: 'codex', target: 'studio', remotePath: "/Users/me/project's work; notes", messages: [{ role: 'user', text: 'Edit' }], writeAccess: true });
  assert.match(calls[0].args[6], /cd -- '\/Users\/me\/project'\\''s work; notes' && exec/);
  assert.match(calls[0].args[6], /workspace-write/);
  assert.match(calls[0].args[6], /'codex' 'exec' '--sandbox' 'workspace-write'/);
  assert.match(calls[0].stdin, /user authorized edits/);
});

test('SSH aliases and remote paths reject invalid input', () => {
  for (const value of ['-oProxyCommand=bad', 'user@host', 'host;touch']) assert.throws(() => validateTarget(value));
  for (const value of ['relative/path', '/safe\ncommand']) assert.throws(() => validateRemotePath(value, true));
  assert.equal(validateRemotePath('', false), '');
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
});
