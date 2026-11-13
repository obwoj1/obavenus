const { execFile: nodeExecFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveProjectFilePath } = require('./project.cjs');

const execFile = promisify(nodeExecFile);
const OFFICE_PREVIEW_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx']);
const MAX_PREVIEW_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_IMAGE_BYTES = 5 * 1024 * 1024;

function createQuickLookPreview({ execFileImpl = execFile, makeTempDir = mkdtemp, readFileImpl = readFile, removeTempDir = rm, platform = process.platform } = {}) {
  return async function quickLookPreview(projectPath, relativePath) {
    if (platform !== 'darwin') throw new Error('Office layout previews require macOS Quick Look.');
    const extension = path.extname(String(relativePath || '')).toLowerCase();
    if (!OFFICE_PREVIEW_EXTENSIONS.has(extension)) throw new TypeError('Quick Look preview supports Word, Excel, and PowerPoint files.');
    const { target, details } = await resolveProjectFilePath(projectPath, relativePath);
    if (details.size > MAX_PREVIEW_SOURCE_BYTES) throw new RangeError('Office preview files must be 10 MB or smaller.');
    const outputDirectory = await makeTempDir(path.join(os.tmpdir(), 'obavenus-office-preview-'));
    try {
      try {
        await execFileImpl('/usr/bin/qlmanage', ['-t', '-s', '1600', '-o', outputDirectory, target], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      } catch (error) {
        if (error.code === 'ENOENT') throw new Error('macOS Quick Look could not render this Office file. Open it in its default app to inspect the layout.');
        throw new Error('Could not render this Office preview. Open the file in its default app to inspect the layout.');
      }
      const imagePath = path.join(outputDirectory, `${path.basename(target)}.png`);
      let bytes;
      try { bytes = await readFileImpl(imagePath); }
      catch { throw new Error('macOS Quick Look did not produce a preview. Open the file in its default app to inspect the layout.'); }
      if (bytes.length < 8 || bytes.length > MAX_PREVIEW_IMAGE_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Quick Look returned an invalid or oversized preview image.');
      const description = extension === '.docx' ? 'First page' : extension === '.pptx' ? 'First slide' : 'Workbook preview';
      return { mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, description, bytes: bytes.length };
    } finally {
      await removeTempDir(outputDirectory, { recursive: true, force: true }).catch(() => {});
    }
  };
}

module.exports = { createQuickLookPreview, OFFICE_PREVIEW_EXTENSIONS, MAX_PREVIEW_SOURCE_BYTES, MAX_PREVIEW_IMAGE_BYTES };
