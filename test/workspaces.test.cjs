const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceStore } = require('../electron/workspaces.cjs');

test('project spaces migrate the current workspace, switch folders, and retain saved folders when closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-spaces-'));
  const filePath = path.join(root, 'workspace.json');
  try {
    await writeFile(filePath, JSON.stringify({ projectPath: '/projects/one' }));
    const store = createWorkspaceStore({ filePath, describeProject: async (folder) => ({ path: folder, summary: { name: path.basename(folder), entries: [], truncated: false } }) });
    const first = (await store.last());
    const second = await store.add('/projects/two');
    assert.equal(first.name, 'one');
    assert.equal(second.name, 'two');
    assert.equal((await store.list()).length, 2);
    assert.equal((await store.activate(first.id)).name, 'one');
    await store.close();
    assert.equal(await store.last(), null);
    assert.equal((await store.list()).length, 2);
    const saved = JSON.parse(await readFile(filePath, 'utf8'));
    assert.deepEqual(saved.projects, ['/projects/two', '/projects/one']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
