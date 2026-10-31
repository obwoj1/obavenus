const { createHash } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

function createWorkspaceStore({ filePath, describeProject }) {
  async function read() {
    try {
      const saved = JSON.parse(await readFile(filePath, 'utf8'));
      const projects = Array.isArray(saved.projects) ? saved.projects.filter((item) => typeof item === 'string') : [];
      if (typeof saved.projectPath === 'string' && saved.projectPath && !projects.includes(saved.projectPath)) projects.unshift(saved.projectPath);
      return { projectPath: typeof saved.projectPath === 'string' ? saved.projectPath : '', projects: [...new Set(projects)].slice(0, 30) };
    } catch (error) { if (error.code === 'ENOENT') return { projectPath: '', projects: [] }; throw error; }
  }
  async function write(state) {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, JSON.stringify(state), { mode: 0o600 });
  }
  function idFor(projectPath) { return createHash('sha256').update(projectPath).digest('hex').slice(0, 24); }
  return {
    async add(projectPath) {
      const project = await describeProject(projectPath);
      const state = await read();
      const projects = [project.path, ...state.projects.filter((item) => item !== project.path)].slice(0, 30);
      await write({ projectPath: project.path, projects });
      return { ...project.summary, id: idFor(project.path) };
    },
    async list() {
      const state = await read();
      const projects = await Promise.all(state.projects.map(async (projectPath) => {
        try { const project = await describeProject(projectPath); return { ...project.summary, id: idFor(project.path) }; }
        catch { return null; }
      }));
      return projects.filter(Boolean);
    },
    async activate(id) {
      if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) throw new TypeError('Choose a saved project space.');
      const state = await read();
      const projectPath = state.projects.find((item) => idFor(item) === id);
      if (!projectPath) throw new Error('That project space is no longer available.');
      const project = await describeProject(projectPath);
      await write({ ...state, projectPath: project.path });
      return { ...project.summary, id: idFor(project.path) };
    },
    async last() {
      const state = await read();
      if (!state.projectPath) return null;
      const project = await describeProject(state.projectPath);
      return { ...project.summary, id: idFor(project.path) };
    },
    async close() {
      const state = await read();
      await write({ ...state, projectPath: '' });
      return true;
    },
  };
}

module.exports = { createWorkspaceStore };
