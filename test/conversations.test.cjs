const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createConversationStore, MAX_CONVERSATIONS } = require('../electron/conversations.cjs');

function secureStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`sealed:${value}`),
    decryptString: (value) => value.toString().replace(/^sealed:/, ''),
  };
}

test('conversation history is OS-encrypted on disk and can be reopened', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-conversations-'));
  const filePath = path.join(root, 'conversations.json');
  const store = createConversationStore({ filePath, safeStorage: secureStorage() });
  const conversations = [{
    id: 'session-1', title: 'Personal notes', projectId: '', createdAt: new Date(0).toISOString(),
    messages: [
      { role: 'user', text: 'Sensitive conversation text', status: 'complete' },
      { role: 'assistant', text: 'Thinking…', status: 'pending' },
    ],
  }];
  try {
    assert.equal(await store.load(), null);
    await store.save(conversations);
    const contents = await readFile(filePath, 'utf8');
    assert.equal(contents.includes('Sensitive conversation text'), false);
    assert.deepEqual(await store.load(), [{ ...conversations[0], messages: [conversations[0].messages[0]] }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('conversation store retains only the latest fifty chats and rejects malformed input', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-conversations-cap-'));
  const store = createConversationStore({ filePath: path.join(root, 'conversations.json'), safeStorage: secureStorage() });
  const conversations = Array.from({ length: MAX_CONVERSATIONS + 2 }, (_unused, index) => ({ id: `chat-${index}`, title: `Chat ${index}`, messages: [] }));
  try {
    await store.save(conversations);
    const saved = await store.load();
    assert.equal(saved.length, MAX_CONVERSATIONS);
    assert.equal(saved[0].id, 'chat-2');
    await assert.rejects(store.save([{ id: '../escape', title: 'Bad', messages: [] }]), /invalid ID/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('conversation storage refuses to persist without OS encryption', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-conversations-no-crypto-'));
  const store = createConversationStore({ filePath: path.join(root, 'conversations.json'), safeStorage: { isEncryptionAvailable: () => false } });
  try {
    await assert.rejects(store.save([]), /OS-encrypted conversation storage is unavailable/);
    await assert.rejects(store.load(), /OS-encrypted conversation storage is unavailable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
