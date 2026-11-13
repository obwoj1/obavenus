const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, mkdir, realpath, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createQuickLookPreview, MAX_PREVIEW_IMAGE_BYTES } = require('../electron/quick-look-preview.cjs');

test('Quick Look preview renders only project-scoped Office files and cleans its temporary output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-office-preview-test-'));
  const output = await mkdtemp(path.join(os.tmpdir(), 'obavenus-office-output-'));
  const previewPng = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('preview')]);
  try {
    await mkdir(path.join(root, 'reports'));
    await writeFile(path.join(root, 'reports', 'brief.docx'), 'sample office file');
    let executed;
    let cleaned = false;
    const render = createQuickLookPreview({
      makeTempDir: async () => output,
      execFileImpl: async (binary, args, options) => { executed = { binary, args, options }; },
      readFileImpl: async (filePath) => { assert.equal(filePath, path.join(output, 'brief.docx.png')); return previewPng; },
      removeTempDir: async (directory, options) => { assert.equal(directory, output); assert.deepEqual(options, { recursive: true, force: true }); cleaned = true; },
      platform: 'darwin',
    });
    const result = await render(root, 'reports/brief.docx');
    assert.deepEqual(executed, {
      binary: '/usr/bin/qlmanage',
      args: ['-t', '-s', '1600', '-o', output, await realpath(path.join(root, 'reports', 'brief.docx'))],
      options: { timeout: 30_000, maxBuffer: 1024 * 1024 },
    });
    assert.equal(result.description, 'First page');
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.dataUrl, `data:image/png;base64,${previewPng.toString('base64')}`);
    assert.equal(cleaned, true);
    await assert.rejects(render(root, '../outside.docx'), /traversal/);
    await assert.rejects(render(root, 'reports/brief.pdf'), /Word, Excel, and PowerPoint/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(output, { recursive: true, force: true }); }
});

test('Quick Look errors are bounded and unsupported systems report the platform requirement', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-office-preview-errors-'));
  try {
    await writeFile(path.join(root, 'book.xlsx'), 'sample');
    const unsupported = createQuickLookPreview({ platform: 'linux' });
    await assert.rejects(unsupported(root, 'book.xlsx'), /require macOS Quick Look/);
    const invalidImage = createQuickLookPreview({
      makeTempDir: async () => '/tmp/fake-preview',
      execFileImpl: async () => {},
      readFileImpl: async () => Buffer.alloc(MAX_PREVIEW_IMAGE_BYTES + 1, 0),
      removeTempDir: async () => {},
      platform: 'darwin',
    });
    await assert.rejects(invalidImage(root, 'book.xlsx'), /invalid or oversized/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
