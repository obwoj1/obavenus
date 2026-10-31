const crypto = require('node:crypto');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');

function createRemoteMachineStore({ filePath, safeStorage }) {
  async function read() {
    try {
      if (!safeStorage?.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
      const encrypted = await readFile(filePath);
      const parsed = JSON.parse(safeStorage.decryptString(encrypted));
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.host === 'string').slice(0, 20) : [];
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function write(machines) {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, safeStorage.encryptString(JSON.stringify(machines)), { mode: 0o600 });
  }
  return {
    list: async () => (await read()).map(({ id, label, host }) => ({ id, label, host })),
    save: async ({ id, label, host }) => {
      if (typeof label !== 'string' || !label.trim() || label.trim().length > 60) throw new TypeError('Machine name must contain 1–60 characters.');
      if (typeof host !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(host)) throw new TypeError('Enter a valid SSH host alias.');
      const machines = await read();
      const duplicate = machines.find((item) => item.host.toLowerCase() === host.toLowerCase() && item.id !== id);
      if (duplicate) throw new Error('That SSH host is already saved.');
      const current = id && machines.find((item) => item.id === id);
      const machine = { id: current?.id || crypto.randomUUID(), label: label.trim(), host };
      const next = current ? machines.map((item) => item.id === current.id ? machine : item) : [...machines, machine];
      if (next.length > 20) throw new RangeError('Save up to 20 remote machines.');
      await write(next);
      return { ...machine };
    },
    remove: async (id) => {
      const machines = await read();
      const next = machines.filter((item) => item.id !== id);
      if (next.length === machines.length) return false;
      await write(next); return true;
    },
    get: async (id) => (await read()).find((item) => item.id === id) || null,
  };
}

module.exports = { createRemoteMachineStore };
