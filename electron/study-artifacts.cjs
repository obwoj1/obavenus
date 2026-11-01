const { randomUUID } = require('node:crypto');
const { mkdir, readFile, rm, writeFile, rename } = require('node:fs/promises');
const path = require('node:path');

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

function createStudyArtifactStore({ directory, safeStorage }) {
  function artifactPath(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw new TypeError('Study attachment ID is invalid.');
    return path.join(directory, `${id}.enc`);
  }

  function assertEncryption() {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure attachment storage is unavailable on this Mac.');
  }

  return {
    async save({ name, bytes, content }) {
      if (typeof name !== 'string' || !name.trim() || name.length > 240 || /[\r\n]/.test(name)) throw new TypeError('Study attachment name is invalid.');
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_ARTIFACT_BYTES) throw new RangeError('Study attachments must be between 1 byte and 10 MB.');
      if (typeof content !== 'string' || content.length > 120_000) throw new TypeError('Study attachment text is invalid or too large.');
      assertEncryption();
      const id = randomUUID();
      await mkdir(directory, { recursive: true });
      const target = artifactPath(id);
      const temporary = `${target}.${randomUUID()}.tmp`;
      const plaintext = JSON.stringify({ name: path.basename(name), bytes: bytes.toString('base64'), content });
      try {
        await writeFile(temporary, safeStorage.encryptString(plaintext), { mode: 0o600, flag: 'wx' });
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      return { id, name: path.basename(name), size: bytes.length };
    },
    async read(id) {
      assertEncryption();
      const encrypted = await readFile(artifactPath(id));
      const payload = JSON.parse(safeStorage.decryptString(encrypted));
      if (typeof payload.name !== 'string' || typeof payload.bytes !== 'string' || typeof payload.content !== 'string' || payload.content.length > 120_000) throw new Error('Study attachment data is invalid.');
      const bytes = Buffer.from(payload.bytes, 'base64');
      if (!bytes.length || bytes.length > MAX_ARTIFACT_BYTES) throw new RangeError('Study attachment exceeds its local size limit.');
      return { name: payload.name, bytes, content: payload.content };
    },
    async remove(id) {
      await rm(artifactPath(id), { force: true });
      return true;
    },
  };
}

module.exports = { MAX_ARTIFACT_BYTES, createStudyArtifactStore };
