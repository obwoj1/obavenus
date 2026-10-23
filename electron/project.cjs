const { readdir, realpath, stat } = require('node:fs/promises');
const path = require('node:path');

async function describeProject(selectedPath) {
  const projectPath = await realpath(selectedPath);
  const details = await stat(projectPath);
  if (!details.isDirectory()) throw new TypeError('Selected project is not a directory');

  const dirents = await readdir(projectPath, { withFileTypes: true });
  const entries = dirents
    .map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? 'folder' : entry.isFile() ? 'file' : 'link or special item',
    }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1))
    .slice(0, 80);

  return {
    path: projectPath,
    summary: { name: path.basename(projectPath), entries, truncated: dirents.length > entries.length },
  };
}

module.exports = { describeProject };
