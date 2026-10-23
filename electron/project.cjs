const { readFile, readdir, realpath, stat, lstat } = require('node:fs/promises');
const path = require('node:path');

const MAX_PROJECT_FILE_BYTES = 64 * 1024;

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

async function readProjectFile(projectPath, fileName) {
  if (typeof fileName !== 'string' || fileName.length === 0 || path.basename(fileName) !== fileName || fileName === '.' || fileName === '..') {
    throw new TypeError('Only a top-level file name can be opened');
  }

  const root = await realpath(projectPath);
  const target = path.join(root, fileName);
  const details = await lstat(target);
  if (!details.isFile()) throw new TypeError('Only regular files can be opened');
  if (details.size > MAX_PROJECT_FILE_BYTES) throw new RangeError('File is larger than 64 KB');

  const bytes = await readFile(target);
  if (bytes.includes(0)) throw new TypeError('This file does not look like plain text');
  return { content: bytes.toString('utf8'), size: bytes.length, truncated: false };
}

module.exports = { describeProject, readProjectFile, MAX_PROJECT_FILE_BYTES };
