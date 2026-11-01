const { mkdir, readFile, rename, writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const MAX_PAGES = 25;
const MAX_CANVAS_DOWNLOAD = 10 * 1024 * 1024;

async function readLimitedResponse(response, limit) {
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength > limit) throw new RangeError('Canvas file exceeds the local download limit.');
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new RangeError('Canvas file exceeds the local download limit.');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RangeError('Canvas file exceeds the local download limit.'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock?.(); }
  return Buffer.concat(chunks, size);
}

function cleanCanvasBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 500) throw new TypeError('Enter your Canvas school URL.');
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new TypeError('Canvas must use a secure HTTPS school URL without credentials or query parameters.');
  return url.origin;
}

function plainText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1').trim().slice(0, 20_000);
}

function createCanvasConnector({ filePath, safeStorage, fetchImpl = globalThis.fetch, extractFile, now = () => Date.now() }) {
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
      if (!Array.isArray(data.modules)) data.modules = [];
      if (!Array.isArray(data.sources)) data.sources = [];
      let importedCourses = 0;
      let importedAssignments = 0;
      let syncedModules = 0;
      let filesImported = 0;
      let filesSkipped = 0;
      let downloadedBytes = 0;
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
            status: existing?.status || 'todo', steps: existing?.steps || [], draft: existing?.draft || '', createdAt: existing?.createdAt || now(),
          };
          if (existing) Object.assign(existing, record);
          else { data.assignments.push(record); importedAssignments += 1; }
        }
        const modules = await pages(config, `${config.baseUrl}/api/v1/courses/${canvasCourse.id}/modules?include[]=items&per_page=100`);
        for (const canvasModule of modules.filter((item) => Number.isInteger(item.id) && item.name)) {
          let items = Array.isArray(canvasModule.items) ? canvasModule.items : [];
          if (!items.length && canvasModule.items_url) items = await pages(config, canvasModule.items_url);
          const record = {
            id: randomUUID(), courseId: course.id, canvasId: String(canvasModule.id),
            title: String(canvasModule.name).slice(0, 200),
            position: Number.isInteger(canvasModule.position) ? canvasModule.position : 0,
            items: items.filter((entry) => Number.isInteger(entry.id)).slice(0, 300).map((entry) => ({
              canvasId: String(entry.id), title: String(entry.title || entry.type || 'Untitled item').slice(0, 240),
              contentId: entry.content_id === undefined || entry.content_id === null ? '' : String(entry.content_id),
              type: String(entry.type || 'Unknown').slice(0, 40), position: Number.isInteger(entry.position) ? entry.position : 0,
              locked: entry.locked_for_user === true || entry.content_details?.locked_for_user === true,
            })),
            updatedAt: now(),
          };
          const existing = data.modules.find((entry) => entry.courseId === course.id && entry.canvasId === record.canvasId);
          if (existing) Object.assign(existing, record, { id: existing.id });
          else data.modules.push(record);
          syncedModules += 1;
          for (const item of record.items) {
            if (item.type !== 'File' || item.locked || !/^\d+$/.test(item.contentId) || typeof extractFile !== 'function') continue;
            const oldSource = data.sources.find((source) => source.courseId === course.id && source.canvasId === item.contentId);
            try {
              const fileResponse = await request(config, `${config.baseUrl}/api/v1/files/${item.contentId}`);
              const file = await fileResponse.json();
              if (!file || !Number.isFinite(file.size) || file.size < 0 || file.size > MAX_CANVAS_DOWNLOAD || typeof file.url !== 'string' || typeof file.filename !== 'string') throw new Error('Canvas file is missing a safe download URL or is over 10 MB.');
              const revision = String(file.updated_at || file.modified_at || '');
              if (oldSource && revision && oldSource.remoteUpdatedAt === revision) continue;
              if (downloadedBytes + file.size > 20 * 1024 * 1024) { filesSkipped += 1; continue; }
              const downloadUrl = new URL(file.url);
              if (downloadUrl.protocol !== 'https:' || downloadUrl.username || downloadUrl.password) throw new Error('Canvas returned an unsafe file URL.');
              const headers = { Accept: '*/*' };
              if (downloadUrl.origin === config.baseUrl) headers.Authorization = `Bearer ${config.token}`;
              const download = await fetchImpl(downloadUrl, { headers, redirect: 'error' });
              if (!download.ok) throw new Error(`Canvas file download failed (${download.status}).`);
              const bytes = await readLimitedResponse(download, MAX_CANVAS_DOWNLOAD);
              if (!bytes.length || bytes.length > MAX_CANVAS_DOWNLOAD || downloadedBytes + bytes.length > 20 * 1024 * 1024) throw new Error('Canvas file exceeds the local download limit.');
              downloadedBytes += bytes.length;
              const extracted = await extractFile(file.filename, bytes);
              let content = String(extracted?.content || '').trim();
              if (!content) throw new Error('No readable text was found in this Canvas file.');
              const truncated = content.length > 200_000;
              if (truncated) content = `${content.slice(0, 199_960)}\n\n[Local import truncated at 200,000 characters.]`;
              const storedBytes = data.sources.reduce((total, source) => total + Buffer.byteLength(source.content), 0) - (oldSource ? Buffer.byteLength(oldSource.content) : 0);
              if (!oldSource && data.sources.length >= 40 || storedBytes + Buffer.byteLength(content) > 4 * 1024 * 1024) { filesSkipped += 1; continue; }
              const source = {
                id: oldSource?.id || randomUUID(), courseId: course.id,
                name: String(file.filename).slice(0, 240), content, canvasId: item.contentId,
                remoteUpdatedAt: revision.slice(0, 80), updatedAt: now(),
              };
              if (oldSource) Object.assign(oldSource, source);
              else data.sources.push(source);
              filesImported += 1;
            } catch {
              filesSkipped += 1;
            }
          }
        }
      }
      await studyStore.save(data);
      return { courses: importedCourses, assignments: importedAssignments, modules: syncedModules, filesImported, filesSkipped, syncedAt: now() };
    },
  };
}

module.exports = { cleanCanvasBaseUrl, createCanvasConnector, readLimitedResponse };
