const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRemoteJobStore } = require('../electron/remote-jobs.cjs');

function storage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`ENC:${Buffer.from(text).toString('base64')}`),
    decryptString: (data) => Buffer.from(data.toString().replace(/^ENC:/, ''), 'base64').toString(),
  };
}

test('remote job history is encrypted and retains status, bounded output, and cancellation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-remote-jobs-'));
  const filePath = path.join(directory, 'jobs.enc');
  let time = 1000;
  const store = createRemoteJobStore({ filePath, safeStorage: storage(), now: () => time++ });
  try {
    const job = await store.create({ id: '123e4567-e89b-12d3-a456-426614174000', machineId: 'machine-1', machineHost: 'buildbox', machineLabel: 'Build server', provider: 'codex', title: 'Refactor project', writeAccess: true });
    const bytes = await readFile(filePath);
    assert.match(bytes.toString(), /^ENC:/);
    assert.equal(bytes.toString().includes('Refactor project'), false);
    assert.equal((await store.list())[0].status, 'running');
    await store.update(job.id, { status: 'completed', exitCode: 0, output: 'Done', error: '' });
    assert.equal((await store.get(job.id)).output, 'Done');
    await store.update(job.id, { status: 'cancelled' });
    assert.equal((await store.get(job.id)).status, 'cancelled');
    assert.equal(await store.remove(job.id), true);
    assert.deepEqual(await store.list(), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('remote job storage rejects invalid providers, status, and oversized output', async () => {
  const store = createRemoteJobStore({ filePath: '/tmp/unused-remote-jobs.enc', safeStorage: storage() });
  await assert.rejects(store.create({ id: '123e4567-e89b-12d3-a456-426614174000', machineId: 'm', provider: 'openai', title: 'x' }), /supported remote CLI/);
});
