const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTaskStore } = require('../electron/tasks.cjs');

test('scheduled tasks persist locally, validate local provider/time, and cancel queued work', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'obavenus-tasks-'));
  let now = Date.now();
  try {
    const filePath = path.join(dir, 'tasks.json');
    const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value).map((byte) => byte ^ 1), decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 1).toString() };
    const store = createTaskStore({ filePath, now: () => now, safeStorage });
    await assert.rejects(store.schedule({ prompt: 'x', provider: 'xai', executeAt: now + 100_000 }), /local CLI/);
    await assert.rejects(store.schedule({ prompt: 'x', provider: 'claude', executeAt: now + 1_000 }), /at least one minute/);
    const task = await store.schedule({ prompt: 'Review this folder', provider: 'codex', executeAt: now + 120_000, projectPath: dir });
    assert.equal(task.attempts, 0);
    assert.equal((await createTaskStore({ filePath, safeStorage }).list())[0].id, task.id);
    assert.doesNotMatch(await require('node:fs/promises').readFile(filePath, 'utf8'), /Review this folder/);
    assert.equal(await store.cancel(task.id), true);
    assert.equal((await store.list())[0].status, 'cancelled');
    assert.equal(await store.cancel(task.id), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
