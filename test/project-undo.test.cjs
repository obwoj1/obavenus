const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectUndoStore } = require('../electron/project-undo.cjs');
const { createAgentToolExecutor } = require('../electron/agent-tools.cjs');
const { restoreProjectSnapshot } = require('../electron/project.cjs');

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`ENC:${Buffer.from(value).toString('base64')}`),
    decryptString: (value) => Buffer.from(value.toString().replace(/^ENC:/, ''), 'base64').toString(),
  };
}

test('project undo snapshots are encrypted, bounded, and consumed after undo', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-undo-store-'));
  const filePath = path.join(directory, 'undo.enc');
  try {
    const store = createProjectUndoStore({ filePath, safeStorage: safeStorage(), now: () => 1_800_000_000_000 });
    const id = await store.record({ projectPath: '/workspace/project', relativePath: 'notes.md', beforeBytes: Buffer.from('before'), beforeHash: 'a'.repeat(64), created: false, expectedAfterHash: 'b'.repeat(64) });
    const raw = await readFile(filePath);
    assert.match(raw.toString(), /^ENC:/);
    assert.equal(raw.toString().includes('before'), false);
    assert.equal((await store.get(id)).beforeBytes.toString(), 'before');
    assert.equal(await store.remove(id), true);
    assert.equal(await store.get(id), null);
    await assert.rejects(store.record({ projectPath: '/workspace/project', relativePath: 'large.xlsx', beforeBytes: Buffer.alloc(8 * 1024 * 1024 + 1), beforeHash: 'a'.repeat(64), created: false, expectedAfterHash: 'b'.repeat(64) }), /invalid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('agent file writes return an undo action that restores the saved project file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-agent-undo-'));
  const projectPath = path.join(directory, 'project');
  await require('node:fs/promises').mkdir(projectPath);
  const filePath = path.join(projectPath, 'notes.md');
  await writeFile(filePath, 'original');
  try {
    const projectUndo = createProjectUndoStore({ filePath: path.join(directory, 'undo.enc'), safeStorage: safeStorage() });
    const executor = createAgentToolExecutor({ projectPath, writeAccess: true, projectUndo });
    const result = await executor('write_project_file', { path: 'notes.md', content: 'agent update' });
    assert.equal(typeof result.undoToken, 'string');
    assert.equal(await readFile(filePath, 'utf8'), 'agent update');
    const entry = await projectUndo.get(result.undoToken);
    await restoreProjectSnapshot(projectPath, entry.relativePath, { created: entry.created, beforeBytes: entry.beforeBytes, expectedAfterHash: entry.expectedAfterHash });
    assert.equal(await readFile(filePath, 'utf8'), 'original');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
