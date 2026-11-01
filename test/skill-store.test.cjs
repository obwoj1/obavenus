const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSkillStore, MAX_ALWAYS_ON_SKILLS } = require('../electron/skill-store.cjs');

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

test('always-on workflows persist encrypted, survive edits, and are capped', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-default-skills-'));
  const filePath = path.join(directory, 'skills.enc');
  try {
    const safeStorage = memorySafeStorage();
    const store = createSkillStore({ filePath, safeStorage });
    const workflow = await store.save({ name: 'Cite evidence', instructions: 'Support claims with source links.', alwaysOn: true });
    assert.equal(workflow.alwaysOn, true);
    assert.equal((await createSkillStore({ filePath, safeStorage }).list())[0].alwaysOn, true);
    const updated = await store.save({ id: workflow.id, name: workflow.name, instructions: 'Cite every factual claim.' });
    assert.equal(updated.alwaysOn, true);
    for (let index = 1; index < MAX_ALWAYS_ON_SKILLS; index++) {
      await store.save({ name: `Default ${index}`, instructions: 'Keep the response concise.', alwaysOn: true });
    }
    await assert.rejects(store.save({ name: 'Too many defaults', instructions: 'Another default.', alwaysOn: true }), /up to 5 always-on workflows/);
    assert.doesNotMatch(await readFile(filePath, 'utf8'), /Cite evidence/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
