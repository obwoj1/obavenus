const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectMemoryStore } = require('../electron/project-memory.cjs');

function encryptedStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0xa7)),
    decryptString: (bytes) => Buffer.from([...bytes].map((byte) => byte ^ 0xa7)).toString(),
  };
}

test('project memory is encrypted, persists per project and rejects oversized notes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-memory-'));
  try {
    const projectA = path.join(root, 'project-a');
    const projectB = path.join(root, 'project-b');
    await mkdir(projectA);
    await mkdir(projectB);
    const memory = createProjectMemoryStore({ directory: path.join(root, 'memory'), safeStorage: encryptedStorage() });
    assert.equal(await memory.read(projectA), '');
    await memory.save(projectA, 'Uses Electron and local-first storage.');
    assert.equal(await memory.read(projectA), 'Uses Electron and local-first storage.');
    assert.equal(await memory.read(projectB), '');
    const files = await require('node:fs/promises').readdir(path.join(root, 'memory'));
    const disk = await readFile(path.join(root, 'memory', files[0]), 'utf8');
    assert.doesNotMatch(disk, /local-first storage/);
    await assert.rejects(memory.save(projectA, 'x'.repeat(12_001)), /12,000 characters/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('project memory refuses storage when operating-system encryption is unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-memory-'));
  try {
    const memory = createProjectMemoryStore({ directory: root, safeStorage: { isEncryptionAvailable: () => false } });
    await assert.rejects(memory.save(root, 'private note'), /Secure project memory is unavailable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
