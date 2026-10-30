const { randomUUID } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

function createAgentStore({ filePath, safeStorage }) {
  async function read() {
    try {
      const value = JSON.parse(await readFile(filePath, 'utf8'));
      if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure agent storage is unavailable.');
      return JSON.parse(safeStorage.decryptString(Buffer.from(value.encrypted, 'base64')));
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function write(agents) {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure agent storage is unavailable.');
    await mkdir(path.dirname(filePath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(agents)).toString('base64');
    await writeFile(filePath, JSON.stringify({ encrypted }), { mode: 0o600 });
  }
  return {
    list: read,
    async save({ id, name, instructions }) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) throw new TypeError('Agent name must be 1–60 characters.');
      if (typeof instructions !== 'string' || !instructions.trim() || instructions.trim().length > 2500) throw new TypeError('Agent instructions must be 1–2,500 characters.');
      const agents = await read();
      const agent = { id: id || randomUUID(), name: name.trim(), instructions: instructions.trim(), custom: true, updatedAt: Date.now() };
      const index = agents.findIndex((item) => item.id === agent.id);
      if (index >= 0) agents[index] = agent;
      else { if (agents.length >= 30) throw new RangeError('You can save up to 30 custom agents.'); agents.push(agent); }
      await write(agents);
      return agent;
    },
    async remove(id) {
      const agents = await read();
      const remaining = agents.filter((agent) => agent.id !== id);
      if (remaining.length === agents.length) return false;
      await write(remaining);
      return true;
    },
  };
}

module.exports = { createAgentStore };
