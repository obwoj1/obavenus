const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { mkdtemp, mkdir, writeFile, chmod, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRemoteAgent, validateTarget, validateRemotePath, validateExecuteAt, shellQuote, backgroundBootstrap } = require('../electron/remote-agent.cjs');

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

test('remote start times require a safe timestamp 1 minute to 30 days ahead', () => {
  const now = 1_800_000_000_000;
  assert.equal(validateExecuteAt(undefined, now), 0);
  assert.equal(validateExecuteAt(now + 60_999, now), Math.floor((now + 60_999) / 1000));
  for (const value of [now + 59_999, now + 30 * 24 * 60 * 60 * 1000 + 1, 'tomorrow', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateExecuteAt(value, now), /start time/);
  }
});

test('remote connection checks use batch SSH and never allow a shell', async () => {
  const calls = [];
  const agent = createRemoteAgent({ spawnImpl: fakeSpawn(calls), timeoutMs: 1000 });
  assert.deepEqual(await agent.probe('studio'), { connected: true });
  assert.deepEqual(calls[0].args, ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', 'studio', 'true']);
  assert.equal(calls[0].options.shell, false);
});

test('remote background launcher and detached provider runner are valid POSIX shell scripts', () => {
  const bootstrap = backgroundBootstrap({ jobId: '123e4567-e89b-12d3-a456-426614174000', provider: 'codex', projectPath: '/project', prompt: 'Safe test prompt', writeAccess: false });
  const outer = spawnSync('sh', ['-n'], { input: bootstrap, encoding: 'utf8' });
  assert.equal(outer.status, 0, outer.stderr);
  const runner = bootstrap.match(/<<'OBAVENUS_RUNNER'\n([\s\S]*?)\nOBAVENUS_RUNNER/)[1];
  const inner = spawnSync('sh', ['-n'], { input: runner, encoding: 'utf8' });
  assert.equal(inner.status, 0, inner.stderr);
});

test('a detached remote runner finishes and retains its result after the launcher shell exits', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'obavenus-remote-run-'));
  try {
    const bin = path.join(home, 'bin');
    await mkdir(bin);
    const codex = path.join(bin, 'codex');
    await writeFile(codex, '#!/bin/sh\ncat\n');
    await chmod(codex, 0o700);
    const jobId = '123e4567-e89b-12d3-a456-426614174000';
    const script = backgroundBootstrap({ jobId, provider: 'codex', projectPath: '', prompt: 'background test payload', writeAccess: false });
    const launched = spawnSync('sh', ['-s'], { input: script, encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, timeout: 3000 });
    assert.equal(launched.status, 0, launched.stderr);
    assert.match(launched.stdout, new RegExp(`OBAVENUS_JOB_ID:${jobId}`));
    const jobDir = path.join(home, '.cache/obavenus/jobs', jobId);
    let status = '';
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { status = await readFile(path.join(jobDir, 'status'), 'utf8'); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
    }
    assert.equal(status, '0\n');
    assert.match(await readFile(path.join(jobDir, 'output'), 'utf8'), /background test payload/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('detached remote runner waits until its scheduled start time', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'obavenus-remote-scheduled-'));
  try {
    const bin = path.join(home, 'bin');
    await mkdir(bin);
    const codex = path.join(bin, 'codex');
    await writeFile(codex, '#!/bin/sh\nprintf started\n');
    await chmod(codex, 0o700);
    const jobId = '123e4567-e89b-12d3-a456-426614174001';
    const runAt = Math.floor(Date.now() / 1000) + 2;
    const script = backgroundBootstrap({ jobId, provider: 'codex', projectPath: '', prompt: 'scheduled payload', writeAccess: false, runAt });
    const launched = spawnSync('sh', ['-s'], { input: script, encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, timeout: 3000 });
    assert.equal(launched.status, 0, launched.stderr);
    const jobDir = path.join(home, '.cache/obavenus/jobs', jobId);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await assert.rejects(readFile(path.join(jobDir, 'status')));
    let status = '';
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try { status = await readFile(path.join(jobDir, 'status'), 'utf8'); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    assert.equal(status, '0\n');
    assert.equal(await readFile(path.join(jobDir, 'output'), 'utf8'), 'started');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('remote jobs detach over SSH and can be inspected after reconnecting', async () => {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options, input: '' });
    const call = calls.at(-1);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
    child.stdin.on('data', (chunk) => { call.input += chunk.toString(); });
    process.nextTick(() => {
      if (args.at(-1) === 'sh -s') {
        const id = call.input.match(/OBAVENUS_JOB_ID:([0-9a-f-]{36})/)?.[1];
        child.stdout.end(`OBAVENUS_JOB_ID:${id}\n`);
      } else {
        child.stdout.end('OBAVENUS_STATUS:0\nOBAVENUS_OUTPUT_B64\nRG9uZQ==\nOBAVENUS_ERROR_B64\n\n');
      }
      child.stderr.end(); child.emit('close', 0);
    });
    return child;
  };
  const agent = createRemoteAgent({ spawnImpl, timeoutMs: 1000 });
  const started = await agent.start({ provider: 'codex', target: 'studio', remotePath: '/project', messages: [{ role: 'user', text: 'Long remote task' }], writeAccess: true });
  assert.equal(started.jobId.length, 36);
  assert.equal(calls[0].args.at(-1), 'sh -s');
  assert.match(calls[0].input, /nohup sh .*runner\.sh/);
  assert.ok(!calls[0].input.includes('Long remote task'));
  assert.match(calls[0].input, /workspace-write/);
  assert.deepEqual(await agent.inspect('studio', started.jobId), { status: 'completed', exitCode: 0, output: 'Done', error: '' });
});

test('remote job inspection recognizes a scheduled state', async () => {
  const agent = createRemoteAgent({ spawnImpl: (command, args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    process.nextTick(() => { child.stdout.end('OBAVENUS_STATUS:scheduled\nOBAVENUS_OUTPUT_B64\n\nOBAVENUS_ERROR_B64\n\n'); child.stderr.end(); child.emit('close', 0); });
    return child;
  } });
  assert.deepEqual(await agent.inspect('studio', '123e4567-e89b-12d3-a456-426614174000'), { status: 'scheduled', exitCode: null, output: '', error: '' });
});

test('remote background cancellation uses only a validated job ID', async () => {
  const calls = [];
  const agent = createRemoteAgent({ spawnImpl: (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    process.nextTick(() => { child.stdout.end('cancelled\n'); child.stderr.end(); child.emit('close', 0); });
    return child;
  } });
  const result = await agent.cancel('studio', '123e4567-e89b-12d3-a456-426614174000');
  assert.deepEqual(result, { cancelled: true, finished: false });
  assert.ok(calls[0].args.at(-1).includes('$HOME/.cache/obavenus/jobs/123e4567-e89b-12d3-a456-426614174000'));
  assert.throws(() => agent.cancel('studio', '../../bad'), /Invalid remote job ID/);
});
