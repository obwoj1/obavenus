const { createHash } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const MAX_MEMORY_CHARS = 12_000;

function createProjectMemoryStore({ directory, safeStorage, realpath = require('node:fs/promises').realpath }) {
  async function fileFor(projectPath) {
    const canonical = await realpath(projectPath);
    const key = createHash('sha256').update(canonical).digest('hex');
    return path.join(directory, `${key}.enc`);
  }
  return {
    async read(projectPath) {
      const filePath = await fileFor(projectPath);
      try {
        const record = JSON.parse(await readFile(filePath, 'utf8'));
        if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure project memory is unavailable.');
        const memory = safeStorage.decryptString(Buffer.from(record.encrypted, 'base64'));
        return memory.slice(0, MAX_MEMORY_CHARS);
      } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
    },
    async save(projectPath, memory) {
      if (typeof memory !== 'string' || memory.trim().length > MAX_MEMORY_CHARS) throw new TypeError('Project memory must be 12,000 characters or fewer.');
      if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure project memory is unavailable.');
      const filePath = await fileFor(projectPath);
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      const encrypted = safeStorage.encryptString(memory.trim()).toString('base64');
      await writeFile(filePath, JSON.stringify({ encrypted }), { mode: 0o600 });
      return { saved: true, characters: memory.trim().length };
    },
  };
}

module.exports = { createProjectMemoryStore, MAX_MEMORY_CHARS };
