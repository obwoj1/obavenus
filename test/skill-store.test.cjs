const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSkillStore } = require('../electron/skill-store.cjs');

function memorySafeStorage() {
  return { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value).map((b) => b ^ 7), decryptString: (value) => Buffer.from(value).map((b) => b ^ 7).toString() };
}

test('custom workflows are encrypted, editable, bounded, and deletable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-skills-'));
  const filePath = path.join(directory, 'skills.enc');
  try {
    const safeStorage = memorySafeStorage();
    const store = createSkillStore({ filePath, safeStorage });
    const skill = await store.save({ name: 'Release reviewer', instructions: 'Check changelog and package version.' });
    assert.equal((await createSkillStore({ filePath, safeStorage }).list())[0].id, skill.id);
    assert.doesNotMatch(await readFile(filePath, 'utf8'), /Release reviewer/);
    await store.save({ id: skill.id, name: 'Release reviewer', instructions: 'Check release risks and tests.' });
    assert.match((await store.list())[0].instructions, /release risks/);
    await assert.rejects(store.save({ name: 'x', instructions: ' '.repeat(2501) }), /1–2,500/);
    assert.equal(await store.remove(skill.id), true);
    assert.equal(await store.remove(skill.id), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
