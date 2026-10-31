const { readFile, readdir, realpath, stat, lstat, mkdir, open } = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
let pdfjsPromise;
function getPdfjs() { pdfjsPromise ||= import('pdfjs-dist/legacy/build/pdf.mjs'); return pdfjsPromise; }

const MAX_PROJECT_FILE_BYTES = 64 * 1024;
const MAX_CONTEXT_FILES = 3;
const MAX_CONTEXT_BYTES = 24 * 1024;
const MAX_INDEXED_FILES = 1200;
const MAX_SCANNED_BYTES = 5 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'release', '.next', '.turbo']);
const MAX_AGENT_WRITE_BYTES = 256 * 1024;
const TEXT_EXTENSIONS = new Set(['.cjs', '.css', '.csv', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.py', '.rs', '.sh', '.toml', '.ts', '.tsx', '.txt', '.tsv', '.yaml', '.yml']);
const OFFICE_READ_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx']);
const PDF_EXTENSION = '.pdf';
const IMAGE_EXTENSIONS = new Set(['.bmp', '.jpg', '.jpeg', '.png', '.tif', '.tiff']);
const MAX_OCR_PAGES = 20;
const MAX_OFFICE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_OFFICE_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARACTERS = 60_000;

function xmlText(value) {
  return value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code))).replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

async function loadOfficeArchive(bytes) {
  if (bytes.length > MAX_OFFICE_FILE_BYTES) throw new RangeError('Office files must be 10 MB or smaller.');
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  const files = Object.entries(archive.files).filter(([, entry]) => !entry.dir);
  if (files.length > 5000) throw new RangeError('Office archive contains too many entries.');
  let expanded = 0;
  for (const [name, entry] of files) {
    if (name.split('/').some((part) => part === '..')) throw new TypeError('Office archive contains an unsafe path.');
    expanded += entry._data?.uncompressedSize || 0;
    if (expanded > MAX_OFFICE_UNCOMPRESSED_BYTES) throw new RangeError('Office archive expands beyond the 40 MB reading limit.');
  }
  return archive;
}

async function readOfficeText(bytes, extension) {
  const archive = await loadOfficeArchive(bytes);
  let blocks = [];
  if (extension === '.xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    if (workbook.worksheets.length > 30) throw new RangeError('A workbook can contain at most 30 worksheets for preview.');
    for (const sheet of workbook.worksheets) {
      const lines = [`Sheet: ${sheet.name}`];
      const lastRow = Math.min(sheet.rowCount, 2000);
      for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        if (!row.hasValues) continue;
        const values = Array.from({ length: Math.min(row.cellCount, 200) }, (_, index) => row.getCell(index + 1).value).map((value) => {
          if (value && typeof value === 'object') {
            if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
            if ('result' in value) return value.result ?? '';
            if ('text' in value) return value.text;
          }
          return value instanceof Date ? value.toISOString() : value ?? '';
        });
        lines.push(values.map((value) => String(value).replace(/[\r\n]+/g, ' ')).join('\t'));
      }
      blocks.push(lines.join('\n'));
    }
  } else if (extension === '.docx') {
    const document = archive.file('word/document.xml');
    if (!document || (document._data?.uncompressedSize || 0) > MAX_OFFICE_UNCOMPRESSED_BYTES) throw new TypeError('This Word document has no readable body.');
    const xml = await document.async('string');
    blocks = [xml.split(/<w:p(?:\s[^>]*)?>/).slice(1).map((paragraph) => xmlText(paragraph.split('</w:p>')[0]).trim()).filter(Boolean).join('\n')];
  } else if (extension === '.pptx') {
    const slides = Object.keys(archive.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
    if (!slides.length) throw new TypeError('This presentation has no readable slides.');
    if (slides.length > 100) throw new RangeError('A presentation can contain at most 100 slides for preview.');
    for (const [index, name] of slides.entries()) {
      const xml = await archive.file(name).async('string');
      const text = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => xmlText(match[1]).trim()).filter(Boolean);
      if (text.length) blocks.push(`Slide ${index + 1}\n${text.join('\n')}`);
    }
  }
  const content = blocks.join('\n\n').trim();
  if (!content) throw new TypeError('No readable text was found in this Office file.');
  return { content: content.slice(0, MAX_EXTRACTED_TEXT_CHARACTERS), truncated: content.length > MAX_EXTRACTED_TEXT_CHARACTERS };
}

async function renderPdfPage(page) {
  const { createCanvas } = require('@napi-rs/canvas');
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.6, 1800 / base.width, 1800 / base.height);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, canvas, viewport }).promise;
  return canvas.toBuffer('image/png');
}

async function readPdfText(bytes, { ocrImage } = {}) {
  if (bytes.length > MAX_OFFICE_FILE_BYTES) throw new RangeError('PDF files must be 10 MB or smaller.');
  const { getDocument } = await getPdfjs();
  const loadingTask = getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, useSystemFonts: false, stopAtErrors: true, verbosity: 0 });
  let document;
  try {
    document = await loadingTask.promise;
    const pageLimit = Math.min(document.numPages, 200);
    let text = '';
    let ocrPages = 0;
    let ocrTruncated = false;
    for (let number = 1; number <= pageLimit && text.length < MAX_EXTRACTED_TEXT_CHARACTERS; number += 1) {
      const page = await document.getPage(number);
      try {
        const content = await page.getTextContent();
        let pageText = content.items.map((item) => item && typeof item.str === 'string' ? item.str : '').filter(Boolean).join(' ').trim();
        if (!pageText && ocrImage && ocrPages < MAX_OCR_PAGES) {
          const image = await renderPdfPage(page);
          pageText = await ocrImage(image);
          ocrPages += 1;
        } else if (!pageText && ocrImage) {
          ocrTruncated = true;
        }
        text += `${text ? '\n\n' : ''}Page ${number}\n${pageText}`;
      } finally { page.cleanup(); }
    }
    const content = text.trim();
    if (!content || !content.replace(/Page \d+\s*/g, '').trim()) throw new TypeError(ocrImage ? 'No readable text was found in this PDF, even after on-device OCR.' : 'No selectable text was found. Scanned pages need on-device OCR, which is unavailable in this build.');
    return { content: content.slice(0, MAX_EXTRACTED_TEXT_CHARACTERS), truncated: document.numPages > pageLimit || content.length > MAX_EXTRACTED_TEXT_CHARACTERS || ocrTruncated };
  } finally { await loadingTask.destroy(); }
}

async function readProjectBytes(projectPath, relativeName, { topLevelOnly = false, ocrImage } = {}) {
  if (typeof relativeName !== 'string' || !relativeName || (topLevelOnly && (path.basename(relativeName) !== relativeName || ['.', '..'].includes(relativeName))) || path.isAbsolute(relativeName)
    || relativeName.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(topLevelOnly ? 'Only a top-level file name can be opened' : 'Use a relative project file path without traversal segments.');
  }
  const root = await realpath(projectPath);
  const parts = relativeName.split(/[\\/]/);
  let target = root;
  for (const [index, part] of parts.entries()) {
    target = path.join(target, part);
    const details = await lstat(target);
    if (details.isSymbolicLink()) throw new TypeError('Symbolic links are not available to project tools.');
    if (index < parts.length - 1 && !details.isDirectory()) throw new TypeError('A project path segment is not a folder.');
    if (index === parts.length - 1 && !details.isFile()) throw new TypeError('Only regular project files can be read.');
  }
  const details = await lstat(target);
  const extension = path.extname(target).toLowerCase();
  const office = OFFICE_READ_EXTENSIONS.has(extension);
  const pdf = extension === PDF_EXTENSION;
  const image = IMAGE_EXTENSIONS.has(extension);
  const limit = office || pdf || image ? MAX_OFFICE_FILE_BYTES : MAX_PROJECT_FILE_BYTES;
  if (details.size > limit) throw new RangeError(office || pdf || image ? `${pdf ? 'PDF' : image ? 'Image' : 'Office'} files must be 10 MB or smaller.` : 'File is larger than 64 KB');
  const bytes = await readFile(target);
  if (office) return { name: parts.join(path.sep), size: bytes.length, ...(await readOfficeText(bytes, extension)) };
  if (pdf) return { name: parts.join(path.sep), size: bytes.length, ...(await readPdfText(bytes, { ocrImage })) };
  if (image) {
    if (typeof ocrImage !== 'function') throw new TypeError('On-device image OCR is unavailable in this build.');
    const content = await ocrImage(bytes);
    if (!content) throw new TypeError('No readable text was found in this image.');
    return { name: parts.join(path.sep), size: bytes.length, content: `Image text (recognized on this Mac)\n${content}`, truncated: false };
  }
  if (bytes.includes(0)) throw new TypeError('This file does not look like plain text');
  return { name: parts.join(path.sep), content: bytes.toString('utf8'), size: bytes.length, truncated: false };
}

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

async function readProjectFile(projectPath, fileName, options) {
  return readProjectBytes(projectPath, fileName, { ...options, topLevelOnly: true });
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

async function readProjectRelativeFile(projectPath, relativeName, options) {
  if (typeof relativeName !== 'string' || !relativeName || path.isAbsolute(relativeName)
    || relativeName.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError('Use a relative project file path without traversal segments.');
  }
  return readProjectBytes(projectPath, relativeName, options);
}

function validateWritableRelativePath(relativeName) {
  if (typeof relativeName !== 'string' || !relativeName || path.isAbsolute(relativeName)
    || relativeName.length > 500 || relativeName.split(/[\\/]/).some((part) => !part || part === '.' || part === '..' || part.startsWith('.') || IGNORED_DIRECTORIES.has(part.toLowerCase()))) {
    throw new TypeError('Use a non-hidden relative path inside the project, without traversal or protected directories.');
  }
  return relativeName.split(/[\\/]/);
}

function hashBytes(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function snapshotProjectFile(projectPath, relativeName, maxBytes = 8 * 1024 * 1024) {
  const parts = validateWritableRelativePath(relativeName);
  const root = await realpath(projectPath);
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    try {
      const details = await lstat(directory);
      if (details.isSymbolicLink() || !details.isDirectory()) throw new TypeError('Project folders must be regular directories, not symlinks.');
    } catch (error) {
      if (error.code === 'ENOENT') return { created: true, beforeBytes: Buffer.alloc(0), beforeHash: null };
      throw error;
    }
  }
  const target = path.join(directory, parts.at(-1));
  const details = await lstat(target).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!details) return { created: true, beforeBytes: Buffer.alloc(0), beforeHash: null };
  if (!details.isFile() || details.isSymbolicLink()) throw new TypeError('Only regular files can be captured for undo.');
  if (details.size > maxBytes) throw new RangeError('The existing file is too large to make an undo snapshot.');
  const beforeBytes = await readFile(target);
  return { created: false, beforeBytes, beforeHash: hashBytes(beforeBytes) };
}

async function restoreProjectSnapshot(projectPath, relativeName, { created, beforeBytes, expectedAfterHash }) {
  const parts = validateWritableRelativePath(relativeName);
  if (!Buffer.isBuffer(beforeBytes) || typeof expectedAfterHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedAfterHash)) throw new TypeError('Undo snapshot is invalid.');
  const root = await realpath(projectPath);
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    const details = await lstat(directory);
    if (details.isSymbolicLink() || !details.isDirectory()) throw new TypeError('Project folders must be regular directories, not symlinks.');
  }
  const target = path.join(directory, parts.at(-1));
  const details = await lstat(target).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!details || !details.isFile() || details.isSymbolicLink()) throw new Error('The output file is no longer in its expected state; undo was not applied.');
  if (hashBytes(await readFile(target)) !== expectedAfterHash) throw new Error('This file changed after the agent run. Undo was not applied, so newer edits stay intact.');
  if (created) {
    await require('node:fs/promises').unlink(target);
    return { restored: true, removed: true };
  }
  const { constants } = require('node:fs');
  const handle = await open(target, constants.O_WRONLY | constants.O_TRUNC | (constants.O_NOFOLLOW || 0));
  try { await handle.writeFile(beforeBytes); } finally { await handle.close(); }
  return { restored: true, removed: false };
}

async function writeProjectArtifact(projectPath, relativeName, content, { extensions = TEXT_EXTENSIONS, maxBytes = MAX_AGENT_WRITE_BYTES, binary = false, expectedBeforeHash, expectedAbsent } = {}) {
  const parts = validateWritableRelativePath(relativeName);
  if (binary ? !Buffer.isBuffer(content) : typeof content !== 'string' || content.includes('\0')) throw new TypeError(binary ? 'Generated artifact data must be a buffer.' : 'File content must be plain text.');
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const limitLabel = maxBytes === MAX_AGENT_WRITE_BYTES ? '256 KB' : `${Math.round(maxBytes / (1024 * 1024))} MB`;
  if (bytes.length > maxBytes) throw new RangeError(`Generated files must be ${limitLabel} or smaller.`);
  const extension = path.extname(parts.at(-1)).toLowerCase();
  if (!extensions.has(extension)) throw new TypeError('That project artifact format is not supported.');
  const root = await realpath(projectPath);
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    try {
      const details = await lstat(directory);
      if (details.isSymbolicLink() || !details.isDirectory()) throw new TypeError('Project folders must be regular directories, not symlinks.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(directory, { mode: 0o700 });
      const created = await lstat(directory);
      if (created.isSymbolicLink() || !created.isDirectory()) throw new TypeError('Could not safely create a project folder.');
    }
    if (!path.resolve(directory).startsWith(`${root}${path.sep}`)) throw new TypeError('Project path escaped the selected folder.');
  }
  const target = path.join(directory, parts.at(-1));
  const before = await lstat(target).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (before && (!before.isFile() || before.isSymbolicLink())) throw new TypeError('Only regular files can be replaced; symlinks and special files are blocked.');
  if (expectedAbsent === true && before) throw new Error('This file appeared after the undo snapshot was made. The write was stopped.');
  if (expectedBeforeHash && (!before || hashBytes(await readFile(target)) !== expectedBeforeHash)) throw new Error('This file changed after the undo snapshot was made. The write was stopped.');
  if (before && before.size > maxBytes) throw new RangeError(`Existing file is larger than the ${limitLabel} write limit.`);
  const { constants } = require('node:fs');
  const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW || 0), 0o600);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
  return { path: parts.join(path.sep), bytes: bytes.length, created: !before };
}

async function writeProjectFile(projectPath, relativeName, content, options) {
  return writeProjectArtifact(projectPath, relativeName, content, options);
}

async function writeProjectBinaryArtifact(projectPath, relativeName, content, extensions, maxBytes = 8 * 1024 * 1024, options = {}) {
  return writeProjectArtifact(projectPath, relativeName, content, { extensions: new Set(extensions), maxBytes, binary: true, ...options });
}

async function listProjectFiles(projectPath, limit = 500) {
  const root = await realpath(projectPath);
  const files = [];
  const walk = async (relative = '') => {
    if (files.length >= limit) return;
    const entries = await readdir(path.join(root, relative), { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.isSymbolicLink()) continue;
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !IGNORED_DIRECTORIES.has(entry.name)) await walk(name);
      } else if (entry.isFile() && (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || OFFICE_READ_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || path.extname(entry.name).toLowerCase() === PDF_EXTENSION || IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))) {
        files.push(name);
      }
    }
  };
  await walk();
  return { files, truncated: files.length === limit };
}

module.exports = { describeProject, readProjectFile, collectProjectContext, readProjectRelativeFile, listProjectFiles, writeProjectFile, writeProjectBinaryArtifact, snapshotProjectFile, restoreProjectSnapshot, hashBytes, MAX_PROJECT_FILE_BYTES, MAX_OFFICE_FILE_BYTES, MAX_OFFICE_UNCOMPRESSED_BYTES, MAX_EXTRACTED_TEXT_CHARACTERS, MAX_CONTEXT_FILES, MAX_CONTEXT_BYTES, MAX_AGENT_WRITE_BYTES, MAX_OCR_PAGES, IMAGE_EXTENSIONS };
