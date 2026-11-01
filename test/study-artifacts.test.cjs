const assert = require('node:assert/strict');
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createStudyArtifactStore, MAX_ARTIFACT_BYTES } = require('../electron/study-artifacts.cjs');

function encryptedStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`cipher:${Buffer.from(value).toString('base64')}`),
    decryptString: (bytes) => Buffer.from(bytes.toString().slice('cipher:'.length), 'base64').toString('utf8'),
  };
}

test('assignment attachment bytes and extracted text are encrypted and can be removed', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-study-artifact-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createStudyArtifactStore({ directory, safeStorage: encryptedStorage() });
  const bytes = Buffer.from('private workbook bytes');
  const metadata = await store.save({ name: 'reference.txt', bytes, content: 'private extracted notes' });
  const files = await readdir(directory);
  assert.deepEqual(files, [`${metadata.id}.enc`]);
  const onDisk = await readFile(path.join(directory, files[0]), 'utf8');
  assert.equal(onDisk.includes('private extracted notes'), false);
  assert.equal(onDisk.includes(bytes.toString()), false);
  const restored = await store.read(metadata.id);
  assert.equal(restored.name, 'reference.txt');
  assert.deepEqual(restored.bytes, bytes);
  assert.equal(restored.content, 'private extracted notes');
  await store.remove(metadata.id);
  await assert.rejects(store.read(metadata.id), { code: 'ENOENT' });
});

test('assignment attachment storage validates identifiers, content and the file size cap', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-study-artifact-limits-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createStudyArtifactStore({ directory, safeStorage: encryptedStorage() });
  await assert.rejects(store.save({ name: 'empty.txt', bytes: Buffer.alloc(0), content: '' }), /between 1 byte and 10 MB/);
  await assert.rejects(store.save({ name: 'huge.txt', bytes: Buffer.alloc(MAX_ARTIFACT_BYTES + 1), content: '' }), /between 1 byte and 10 MB/);
  await assert.rejects(store.save({ name: 'no-text.txt', bytes: Buffer.from('a'), content: 'x'.repeat(120_001) }), /text is invalid/);
  await assert.rejects(store.read('../outside'), /ID is invalid/);
});
