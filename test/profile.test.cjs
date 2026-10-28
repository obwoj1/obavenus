const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProfileStore } = require('../electron/profile.cjs');

test('profile is encrypted on disk and only shared when the user opts in', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-profile-'));
  const filePath = path.join(root, 'profile.bin');
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value).map((byte) => byte ^ 27), decryptString: (bytes) => Buffer.from(bytes).map((byte) => byte ^ 27).toString() };
  const store = createProfileStore({ filePath, safeStorage });
  try {
    const saved = await store.save({ name: 'Ada', resumeText: 'TypeScript engineer', linkedinUrl: 'https://www.linkedin.com/in/ada/', githubUrl: 'https://github.com/ada', shareWithAI: false });
    assert.equal(saved.completed, true);
    assert.equal((await store.get()).shareWithAI, false);
    assert.doesNotMatch((await readFile(filePath, 'utf8')), /TypeScript engineer/);
    await assert.rejects(store.save({ linkedinUrl: 'https://github.com/attacker', githubUrl: 'https://github.com/ada' }), /www.linkedin.com/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
