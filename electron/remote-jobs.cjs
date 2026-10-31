const { readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');

const PROVIDERS = new Set(['claude', 'codex', 'gemini']);

function createRemoteJobStore({ filePath, safeStorage, now = () => Date.now() }) {
  async function read() {
    try {
      if (!safeStorage?.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
      const data = await readFile(filePath);
      const jobs = JSON.parse(safeStorage.decryptString(data));
      return Array.isArray(jobs) ? jobs.filter((job) => job && typeof job.id === 'string' && typeof job.machineId === 'string').slice(-50) : [];
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function write(jobs) {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, safeStorage.encryptString(JSON.stringify(jobs.slice(-50))), { mode: 0o600 });
  }
  return {
    list: async () => (await read()).sort((a, b) => b.startedAt - a.startedAt).map((job) => ({ ...job })),
    async create({ id, machineId, machineHost, machineLabel, provider, title, writeAccess = false }) {
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new TypeError('Invalid remote job ID.');
      if (typeof machineId !== 'string' || !machineId || machineId.length > 80) throw new TypeError('Choose a saved remote machine.');
      if (!PROVIDERS.has(provider)) throw new TypeError('Choose a supported remote CLI.');
      if (typeof machineHost !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(machineHost)) throw new TypeError('Invalid SSH host alias.');
      if (typeof machineLabel !== 'string' || machineLabel.length > 60) throw new TypeError('Invalid remote machine name.');
      if (typeof title !== 'string' || title.length > 120) throw new TypeError('Remote job title must be at most 120 characters.');
      const jobs = await read();
      if (jobs.some((job) => job.id === id)) throw new Error('That remote job is already being tracked.');
      const job = { id, machineId, machineHost, machineLabel, provider, title: title.trim() || 'Remote agent task', writeAccess: writeAccess === true, status: 'running', startedAt: now(), updatedAt: now(), exitCode: null, output: '', error: '' };
      jobs.push(job);
      await write(jobs);
      return { ...job };
    },
    async get(id) { return (await read()).find((job) => job.id === id) || null; },
    async update(id, changes) {
      const jobs = await read();
      const index = jobs.findIndex((job) => job.id === id);
      if (index < 0) throw new Error('Remote job is no longer in the local task history.');
      if (changes.status && !['running', 'completed', 'error', 'cancelled'].includes(changes.status)) throw new TypeError('Invalid remote job status.');
      if (changes.output !== undefined && (typeof changes.output !== 'string' || changes.output.length > 2_000_000)) throw new RangeError('Remote job output exceeds the local storage limit.');
      if (changes.error !== undefined && (typeof changes.error !== 'string' || changes.error.length > 200_000)) throw new RangeError('Remote job error exceeds the local storage limit.');
      jobs[index] = { ...jobs[index], ...changes, updatedAt: now() };
      await write(jobs);
      return { ...jobs[index] };
    },
    async remove(id) {
      const jobs = await read();
      const remaining = jobs.filter((job) => job.id !== id);
      if (remaining.length === jobs.length) return false;
      await write(remaining);
      return true;
    },
  };
}

module.exports = { createRemoteJobStore };
