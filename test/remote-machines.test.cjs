const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRemoteMachineStore } = require('../electron/remote-machines.cjs');

test('remote machines are encrypted, editable, unique by SSH alias, and removable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-machines-'));
  const filePath = path.join(directory, 'machines.enc');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`OS-ENCRYPTED:${Buffer.from(text).toString('base64')}`),
    decryptString: (bytes) => Buffer.from(bytes.toString().replace(/^OS-ENCRYPTED:/, ''), 'base64').toString(),
  };
  try {
    const store = createRemoteMachineStore({ filePath, safeStorage });
    const machine = await store.save({ label: 'Build server', host: 'buildbox' });
    const bytes = await readFile(filePath);
    assert.match(bytes.toString(), /^OS-ENCRYPTED:/);
    assert.equal(bytes.toString().includes('buildbox'), false);
    assert.deepEqual(await store.list(), [{ id: machine.id, label: 'Build server', host: 'buildbox' }]);
    await assert.rejects(store.save({ label: 'Duplicate', host: 'BUILDBOX' }), /already saved/);
    await store.save({ id: machine.id, label: 'Build machine', host: 'buildbox' });
    assert.equal((await store.list())[0].label, 'Build machine');
    assert.equal(await store.remove(machine.id), true);
    assert.deepEqual(await store.list(), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('remote machine store refuses to persist without OS credential encryption', async () => {
  const store = createRemoteMachineStore({ filePath: '/tmp/nope/machines.enc', safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(store.save({ label: 'Host', host: 'box' }), /encryption is unavailable/);
});
