const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const PROVIDERS = new Set(['claude', 'codex', 'gemini', 'configured-ai']);
const RECURRENCES = new Set(['once', 'daily', 'weekdays']);

function nextRecurringRunAt(recurrence, hour, minute, after = Date.now()) {
  if (!['daily', 'weekdays'].includes(recurrence) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59 || !Number.isFinite(after)) throw new TypeError('Recurring task schedule is invalid.');
  const cursor = new Date(after);
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date(cursor);
    candidate.setDate(cursor.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= after) continue;
    if (recurrence === 'weekdays' && [0, 6].includes(candidate.getDay())) continue;
    return candidate.getTime();
  }
  throw new Error('Could not calculate the next recurring task time.');
}

function createTaskStore({ filePath, now = () => Date.now(), safeStorage }) {
  async function read() {
    try {
      const value = JSON.parse(await readFile(filePath, 'utf8'));
      if (value.encrypted) {
        if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure task storage is unavailable on this Mac.');
        return JSON.parse(safeStorage.decryptString(Buffer.from(value.encrypted, 'base64')));
      }
      return Array.isArray(value.tasks) ? value.tasks : Array.isArray(value) ? value : [];
    }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function write(tasks) {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure task storage is unavailable on this Mac.');
    await mkdir(path.dirname(filePath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(tasks)).toString('base64');
    await writeFile(filePath, JSON.stringify({ encrypted }), { mode: 0o600 });
  }
  return {
    async list() { return (await read()).sort((a, b) => a.executeAt - b.executeAt); },
    async schedule({ prompt, provider, executeAt, projectPath = '', recurrence = 'once' }) {
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20_000) throw new TypeError('Task prompt must contain 1–20,000 characters.');
      if (!PROVIDERS.has(provider)) throw new TypeError('Choose a local CLI or the configured AI provider.');
      const at = new Date(executeAt).getTime();
      if (!Number.isFinite(at) || at < now() + 60_000 || at > now() + 365 * 24 * 60 * 60 * 1000) throw new RangeError('Choose a time at least one minute from now and within the next year.');
      if (!RECURRENCES.has(recurrence)) throw new TypeError('Choose a supported task repeat schedule.');
      if (typeof projectPath !== 'string' || projectPath.length > 2000) throw new TypeError('Invalid project folder.');
      const tasks = await read();
      const scheduledDate = new Date(at);
      const task = { id: require('node:crypto').randomUUID(), prompt: prompt.trim(), provider, executeAt: at, recurrence, recurrenceHour: scheduledDate.getHours(), recurrenceMinute: scheduledDate.getMinutes(), projectPath, status: 'queued', attempts: 0, createdAt: now(), result: '', error: '' };
      tasks.push(task);
      await write(tasks);
      return { ...task };
    },
    async update(id, changes) {
      const tasks = await read();
      const index = tasks.findIndex((task) => task.id === id);
      if (index < 0) throw new Error('Scheduled task no longer exists.');
      tasks[index] = { ...tasks[index], ...changes };
      await write(tasks);
      return { ...tasks[index] };
    },
    async cancel(id) {
      const tasks = await read();
      const task = tasks.find((item) => item.id === id);
      if (!task || task.status !== 'queued') return false;
      task.status = 'cancelled';
      await write(tasks);
      return true;
    },
  };
}

module.exports = { RECURRENCES, createTaskStore, nextRecurringRunAt };
