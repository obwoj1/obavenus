const { lstat, readFile } = require('node:fs/promises');
const path = require('node:path');
const { readProjectFile } = require('./project.cjs');

const MAX_TEXT_RESUME_BYTES = 100 * 1024;
const MAX_RESUME_CHARACTERS = 50_000;
const SUPPORTED_RESUME_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx']);

async function readResumeFile(filePath, { ocrImage } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new TypeError('Choose a resume file from this Mac.');
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_RESUME_EXTENSIONS.has(extension)) throw new TypeError('Choose a TXT, Markdown, PDF, or DOCX resume.');
  const details = await lstat(filePath);
  if (!details.isFile() || details.isSymbolicLink()) throw new TypeError('Resume must be a regular local file.');
  const name = path.basename(filePath);
  if (extension === '.txt' || extension === '.md') {
    if (details.size > MAX_TEXT_RESUME_BYTES) throw new RangeError('Text resume file must be 100 KB or smaller.');
    const bytes = await readFile(filePath);
    if (bytes.includes(0)) throw new TypeError('Resume must be a plain-text file.');
    const text = bytes.toString('utf8');
    return { name, text: text.slice(0, MAX_RESUME_CHARACTERS), truncated: text.length > MAX_RESUME_CHARACTERS };
  }
  const result = await readProjectFile(path.dirname(filePath), name, { ocrImage });
  return { name, text: result.content.slice(0, MAX_RESUME_CHARACTERS), truncated: result.truncated || result.content.length > MAX_RESUME_CHARACTERS };
}

module.exports = { MAX_TEXT_RESUME_BYTES, MAX_RESUME_CHARACTERS, SUPPORTED_RESUME_EXTENSIONS, readResumeFile };
