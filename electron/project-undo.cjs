const { readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_ENTRIES = 20;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

function createProjectUndoStore({ filePath, safeStorage, now = () => Date.now() }) {
  async function read() {
    try {
      if (!safeStorage?.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable; project undo history is disabled.');
      return JSON.parse(safeStorage.decryptString(await readFile(filePath)));
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function write(entries) {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable; project undo history is disabled.');
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, safeStorage.encryptString(JSON.stringify(entries)), { mode: 0o600 });
  }
  return {
    async record({ projectPath, relativePath, beforeBytes, beforeHash, created, expectedAfterHash }) {
      if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath) || typeof relativePath !== 'string' || !relativePath
        || !Buffer.isBuffer(beforeBytes) || beforeBytes.length > MAX_SNAPSHOT_BYTES
        || typeof expectedAfterHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedAfterHash)
        || (created ? beforeHash !== null || beforeBytes.length !== 0 : typeof beforeHash !== 'string' || !/^[a-f0-9]{64}$/.test(beforeHash))) {
        throw new TypeError('Project undo snapshot is invalid.');
      }
      let entries = await read();
      const entry = { id: randomUUID(), projectPath, relativePath, before: beforeBytes.toString('base64'), beforeHash, created: created === true, expectedAfterHash, createdAt: now() };
      entries.push(entry);
      const totalBytes = () => entries.reduce((total, item) => total + (item.before?.length || 0), 0);
      while (entries.length > MAX_ENTRIES || totalBytes() > MAX_TOTAL_BYTES) entries.shift();
      await write(entries);
      return entry.id;
    },
    async get(id) {
      if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) throw new TypeError('Invalid project undo ID.');
      const entry = (await read()).find((item) => item.id === id);
      return entry ? { ...entry, beforeBytes: Buffer.from(entry.before, 'base64') } : null;
    },
    async remove(id) {
      const entries = await read();
      const remaining = entries.filter((entry) => entry.id !== id);
      if (remaining.length === entries.length) return false;
      await write(remaining);
      return true;
    },
  };
}

module.exports = { createProjectUndoStore, MAX_ENTRIES, MAX_SNAPSHOT_BYTES, MAX_TOTAL_BYTES };
