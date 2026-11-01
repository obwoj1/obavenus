const { mkdir, readFile, rename, writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const MAX_PAGES = 25;

function cleanCanvasBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 500) throw new TypeError('Enter your Canvas school URL.');
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new TypeError('Canvas must use a secure HTTPS school URL without credentials or query parameters.');
  return url.origin;
}

function plainText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1').trim().slice(0, 20_000);
}

function createCanvasConnector({ filePath, safeStorage, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  async function readConfig() {
    try {
      const envelope = JSON.parse(await readFile(filePath, 'utf8'));
      if (typeof envelope.encrypted !== 'string' || !safeStorage?.isEncryptionAvailable()) throw new Error('Secure Canvas credential storage is unavailable on this Mac.');
      const config = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64')));
      return { baseUrl: cleanCanvasBaseUrl(envelope.baseUrl || config.baseUrl), token: config.token };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function saveConfig(config) {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure Canvas credential storage is unavailable on this Mac.');
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(config)).toString('base64');
      await writeFile(temporary, JSON.stringify({ version: 1, baseUrl: config.baseUrl, encrypted }), { mode: 0o600 });
      await rename(temporary, filePath);
    } catch (error) {
      await require('node:fs/promises').unlink(temporary).catch(() => {});
      throw error;
    }
  }

  async function request(config, url) {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' }, redirect: 'error' });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Canvas rejected this access token. Check the token and its course access.');
      throw new Error(`Canvas request failed (${response.status}).`);
    }
    return response;
  }

  async function pages(config, firstUrl) {
    let next = firstUrl;
    const values = [];
    for (let page = 0; next && page < MAX_PAGES; page += 1) {
      const url = new URL(next);
      if (url.origin !== config.baseUrl) throw new Error('Canvas returned a pagination link outside your school domain.');
      const response = await request(config, url);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Canvas returned an unexpected response.');
      values.push(...rows);
      const link = response.headers.get('link') || '';
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      next = match?.[1] || '';
    }
    if (next) throw new Error('Canvas returned too many pages to sync safely.');
    return values;
  }

  async function connect({ baseUrl, token }) {
    const config = { baseUrl: cleanCanvasBaseUrl(baseUrl), token: String(token || '').trim() };
    if (!config.token || config.token.length > 4096 || /[\r\n]/.test(config.token)) throw new TypeError('Paste a valid Canvas access token.');
    const response = await request(config, `${config.baseUrl}/api/v1/users/self/profile`);
    const profile = await response.json();
    if (!profile || typeof profile.name !== 'string') throw new Error('Canvas did not return a valid account profile.');
    await saveConfig(config);
    return { connected: true, baseUrl: config.baseUrl, accountName: profile.name };
  }

  return {
    async status() {
      try {
        const envelope = JSON.parse(await readFile(filePath, 'utf8'));
        if (typeof envelope.encrypted !== 'string') throw new Error('Saved Canvas connection is invalid.');
        return { connected: true, baseUrl: cleanCanvasBaseUrl(envelope.baseUrl || '') };
      } catch (error) {
        if (error.code === 'ENOENT') return { connected: false, baseUrl: '' };
        throw error;
      }
    },
    connect,
    async disconnect() {
      await require('node:fs/promises').unlink(filePath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      return { connected: false, baseUrl: '' };
    },
    async sync(studyStore) {
      const config = await readConfig();
      if (!config) throw new Error('Connect Canvas in Study settings before syncing.');
      const courses = await pages(config, `${config.baseUrl}/api/v1/courses?enrollment_state=active&per_page=100`);
      const data = await studyStore.load();
      let importedCourses = 0;
      let importedAssignments = 0;
      for (const canvasCourse of courses.filter((course) => Number.isInteger(course.id) && course.name)) {
        let course = data.courses.find((item) => String(item.canvasId || '') === String(canvasCourse.id));
        if (!course) {
          course = { id: randomUUID(), name: String(canvasCourse.name).slice(0, 120), term: String(canvasCourse.term?.name || '').slice(0, 80), canvasId: String(canvasCourse.id), createdAt: now() };
          data.courses.push(course);
          importedCourses += 1;
        } else {
          course.name = String(canvasCourse.name).slice(0, 120);
          course.term = String(canvasCourse.term?.name || '').slice(0, 80);
        }
        const assignments = await pages(config, `${config.baseUrl}/api/v1/courses/${canvasCourse.id}/assignments?per_page=100`);
        for (const item of assignments.filter((assignment) => Number.isInteger(assignment.id) && assignment.name)) {
          const existing = data.assignments.find((assignment) => String(assignment.canvasId || '') === String(item.id));
          const record = {
            id: existing?.id || randomUUID(), courseId: course.id, canvasId: String(item.id),
            title: String(item.name).slice(0, 200), instructions: plainText(item.description),
            dueAt: item.due_at ? Date.parse(item.due_at) : null,
            status: existing?.status || 'todo', steps: existing?.steps || [], createdAt: existing?.createdAt || now(),
          };
          if (existing) Object.assign(existing, record);
          else { data.assignments.push(record); importedAssignments += 1; }
        }
      }
      await studyStore.save(data);
      return { courses: importedCourses, assignments: importedAssignments, syncedAt: now() };
    },
  };
}

module.exports = { cleanCanvasBaseUrl, createCanvasConnector };
