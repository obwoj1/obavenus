const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTaskStore, nextRecurringRunAt } = require('../electron/tasks.cjs');

test('scheduled tasks persist locally, validate providers, and cancel queued or running work', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'obavenus-tasks-'));
  let now = Date.now();
  try {
    const filePath = path.join(dir, 'tasks.json');
    const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value).map((byte) => byte ^ 1), decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 1).toString() };
    const store = createTaskStore({ filePath, now: () => now, safeStorage });
    await assert.rejects(store.schedule({ prompt: 'x', provider: 'xai', executeAt: now + 100_000 }), /Choose a local CLI/);
    await assert.rejects(store.schedule({ prompt: 'x', provider: 'claude', executeAt: now + 1_000 }), /at least one minute/);
    const task = await store.schedule({ prompt: 'Review this folder', provider: 'codex', executeAt: now + 120_000, projectPath: dir });
    const aiTask = await store.schedule({ prompt: 'Summarize current priorities', provider: 'configured-ai', executeAt: now + 120_000 });
    assert.equal(task.attempts, 0);
    assert.equal((await createTaskStore({ filePath, safeStorage }).list())[0].id, task.id);
    assert.ok((await store.list()).some((item) => item.id === aiTask.id && item.provider === 'configured-ai'));
    assert.doesNotMatch(await require('node:fs/promises').readFile(filePath, 'utf8'), /Review this folder/);
    assert.equal(await store.cancel(task.id), true);
    assert.equal((await store.list())[0].status, 'cancelled');
    assert.equal(await store.cancel(task.id), false);
    await store.update(aiTask.id, { status: 'running' });
    assert.equal(await store.cancel(aiTask.id), true);
    assert.equal((await store.list()).find((item) => item.id === aiTask.id).status, 'cancelled');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('recurring tasks persist their local schedule and weekday recurrence skips weekends', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'obavenus-recurring-tasks-'));
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`sealed:${value}`), decryptString: (value) => value.toString().slice(7) };
  const afterFriday = new Date(2026, 0, 2, 18, 30).getTime();
  try {
    const store = createTaskStore({ filePath: path.join(dir, 'tasks.enc'), safeStorage, now: () => afterFriday - 60_000 });
    const task = await store.schedule({ prompt: 'Check the project inbox', provider: 'configured-ai', executeAt: new Date(2026, 0, 2, 19, 0).getTime(), recurrence: 'weekdays' });
    assert.equal(task.recurrence, 'weekdays');
    assert.equal(task.recurrenceHour, 19);
    assert.equal(task.recurrenceMinute, 0);
    const reopened = await createTaskStore({ filePath: path.join(dir, 'tasks.enc'), safeStorage }).list();
    assert.equal(reopened[0].recurrence, 'weekdays');
    const monday = new Date(nextRecurringRunAt('weekdays', 7, 15, afterFriday));
    assert.equal(monday.getDay(), 1);
    assert.equal(monday.getHours(), 7);
    assert.equal(monday.getMinutes(), 15);
    const daily = new Date(nextRecurringRunAt('daily', 8, 0, afterFriday));
    assert.equal(daily.getDay(), 6);
    assert.throws(() => nextRecurringRunAt('once', 8, 0, afterFriday), /invalid/);
    await assert.rejects(store.schedule({ prompt: 'Bad repeat', provider: 'codex', executeAt: afterFriday + 120_000, recurrence: 'monthly' }), /repeat schedule/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
