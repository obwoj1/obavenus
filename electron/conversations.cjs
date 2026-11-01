const { mkdir, readFile, rename, writeFile } = require('node:fs/promises');
const path = require('node:path');

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 300;
const MAX_STORE_BYTES = 20 * 1024 * 1024;

function normalizeConversation(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value.id)) throw new TypeError('Conversation history contains an invalid ID.');
  if (typeof value.title !== 'string' || value.title.length > 120 || !Array.isArray(value.messages) || value.messages.length > MAX_MESSAGES) throw new TypeError('Conversation history exceeds its safe size.');
  const messages = value.messages.filter((message) => message && ['user', 'assistant'].includes(message.role) && typeof message.text === 'string' && message.status !== 'pending');
  for (const message of messages) {
    if (message.text.length > 200_000) throw new RangeError('A conversation message exceeds 200,000 characters.');
    const context = Array.isArray(message.context) ? message.context : [];
    if (context.length > 3 || context.some((file) => !file || typeof file.name !== 'string' || file.name.length > 500 || typeof file.content !== 'string' || file.content.length > 100_000)) throw new RangeError('Conversation attachments exceed the local storage limit.');
  }
  return {
    id: value.id,
    title: value.title,
    projectId: typeof value.projectId === 'string' ? value.projectId.slice(0, 120) : '',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt.slice(0, 40) : new Date(0).toISOString(),
    messages,
  };
}

function createConversationStore({ filePath, safeStorage }) {
  function requireEncryption() {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('OS-encrypted conversation storage is unavailable on this Mac.');
  }

  return {
    async load() {
      try {
        requireEncryption();
        const saved = JSON.parse(await readFile(filePath, 'utf8'));
        if (typeof saved.encrypted !== 'string') throw new TypeError('Encrypted conversation history is malformed.');
        const decrypted = safeStorage.decryptString(Buffer.from(saved.encrypted, 'base64'));
        const conversations = JSON.parse(decrypted);
        if (!Array.isArray(conversations) || conversations.length > MAX_CONVERSATIONS) throw new TypeError('Conversation history is malformed.');
        return conversations.map(normalizeConversation);
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async save(value) {
      requireEncryption();
      if (!Array.isArray(value)) throw new TypeError('Conversation history must be a list.');
      const conversations = value.slice(-MAX_CONVERSATIONS).map(normalizeConversation);
      const plaintext = JSON.stringify(conversations);
      if (Buffer.byteLength(plaintext, 'utf8') > MAX_STORE_BYTES) throw new RangeError('Conversation history exceeds the 20 MB encrypted local storage limit.');
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      const encrypted = safeStorage.encryptString(plaintext).toString('base64');
      await writeFile(temporaryPath, JSON.stringify({ encrypted }), { mode: 0o600 });
      await rename(temporaryPath, filePath);
      return { saved: true, count: conversations.length };
    },
  };
}

module.exports = { MAX_CONVERSATIONS, MAX_MESSAGES, MAX_STORE_BYTES, createConversationStore, normalizeConversation };
