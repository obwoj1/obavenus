const { readFile, readdir, realpath, stat, lstat } = require('node:fs/promises');
const path = require('node:path');

const MAX_PROJECT_FILE_BYTES = 64 * 1024;
const MAX_CONTEXT_FILES = 3;
const MAX_CONTEXT_BYTES = 60 * 1024;
const MAX_INDEXED_FILES = 1200;
const MAX_SCANNED_BYTES = 5 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'release', '.next', '.turbo']);
const TEXT_EXTENSIONS = new Set(['.cjs', '.css', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.py', '.rs', '.sh', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml']);

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

function queryTerms(query) {
  return [...new Set((query.toLowerCase().match(/[a-z0-9_./-]{2,}/g) || []).filter((term) => !['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into'].includes(term)))];
}

async function collectProjectContext(projectPath, query) {
  if (typeof query !== 'string' || !query.trim()) return [];
  const root = await realpath(projectPath);
  const terms = queryTerms(query);
  if (!terms.length) return [];

  const candidates = [];
  let indexed = 0;
  let scanned = 0;
  const walk = async (relative = '') => {
    if (indexed >= MAX_INDEXED_FILES || scanned >= MAX_SCANNED_BYTES) return;
    const directory = path.join(root, relative);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (indexed >= MAX_INDEXED_FILES || scanned >= MAX_SCANNED_BYTES) break;
      if (entry.isSymbolicLink()) continue;
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !IGNORED_DIRECTORIES.has(entry.name)) await walk(name);
        continue;
      }
      if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      indexed += 1;
      const fullPath = path.join(root, name);
      const details = await lstat(fullPath).catch(() => null);
      if (!details?.isFile() || details.size > MAX_PROJECT_FILE_BYTES || scanned + details.size > MAX_SCANNED_BYTES) continue;
      scanned += details.size;
      const bytes = await readFile(fullPath).catch(() => null);
      if (!bytes || bytes.includes(0)) continue;
      const content = bytes.toString('utf8');
      const lowerPath = name.toLowerCase();
      const lowerContent = content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (lowerPath.includes(term)) score += 8;
        const occurrences = lowerContent.split(term).length - 1;
        score += Math.min(occurrences, 8);
      }
      if (path.basename(name) === 'AGENTS.md') score += 3;
      if (score > 0) candidates.push({ name, content, score, size: bytes.length });
    }
  };

  await walk();
  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const selected = [];
  let total = 0;
  for (const candidate of candidates) {
    if (selected.length >= MAX_CONTEXT_FILES || total + candidate.size > MAX_CONTEXT_BYTES) continue;
    selected.push({ name: candidate.name, content: candidate.content, size: candidate.size });
    total += candidate.size;
  }
  return selected;
}

module.exports = { describeProject, readProjectFile, collectProjectContext, MAX_PROJECT_FILE_BYTES, MAX_CONTEXT_FILES, MAX_CONTEXT_BYTES };
