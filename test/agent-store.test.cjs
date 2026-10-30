const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAgentStore } = require('../electron/agent-store.cjs');

const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value).map((b) => b ^ 7), decryptString: (value) => Buffer.from(value).map((b) => b ^ 7).toString() };

test('custom agents are encrypted, editable, bounded, and deletable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-agents-'));
  const filePath = path.join(directory, 'agents.enc');
  try {
    const store = createAgentStore({ filePath, safeStorage });
    const agent = await store.save({ name: 'Hiring analyst', instructions: 'Find current software engineering roles at federal agencies.' });
    assert.equal((await createAgentStore({ filePath, safeStorage }).list())[0].id, agent.id);
    assert.doesNotMatch(await readFile(filePath, 'utf8'), /Hiring analyst/);
    await store.save({ id: agent.id, name: 'Hiring analyst', instructions: 'Compare official postings and deadlines.' });
    assert.match((await store.list())[0].instructions, /deadlines/);
    await assert.rejects(store.save({ name: 'x', instructions: '' }), /1–2,500/);
    assert.equal(await store.remove(agent.id), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
