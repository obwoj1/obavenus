const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { describeProject, readProjectFile, collectProjectContext, readProjectRelativeFile, listProjectFiles, writeProjectFile, writeProjectBinaryArtifact } = require('../electron/project.cjs');

test('project summary sorts folders first and caps visible entries at 80', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-project-'));
  const projectPath = path.join(root, 'sample-project');
  await mkdir(projectPath);

  try {
    await mkdir(path.join(projectPath, 'z-folder'));
    await Promise.all(Array.from({ length: 81 }, (_, index) =>
      writeFile(path.join(projectPath, `file-${String(index).padStart(3, '0')}.txt`), 'x')));

    const project = await describeProject(projectPath);

    assert.equal(project.summary.name, 'sample-project');
    assert.equal(project.summary.entries.length, 80);
    assert.equal(project.summary.entries[0].name, 'z-folder');
    assert.equal(project.summary.entries[0].kind, 'folder');
    assert.equal(project.summary.truncated, true);
    assert.equal('path' in project.summary, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('opening a project file returns small text and rejects paths and oversized files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-read-'));

  try {
    await writeFile(path.join(root, 'notes.txt'), 'hello from the project');
    await writeFile(path.join(root, 'large.txt'), Buffer.alloc(64 * 1024 + 1, 65));

    const opened = await readProjectFile(root, 'notes.txt');
    assert.equal(opened.content, 'hello from the project');
    assert.equal(opened.size, Buffer.byteLength(opened.content));
    await assert.rejects(readProjectFile(root, '../outside.txt'), /top-level file name/);
    await assert.rejects(readProjectFile(root, 'large.txt'), /larger than 64 KB/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('team context deterministically selects relevant nested text files and skips dependencies and symlinks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-context-'));
  const projectPath = path.join(root, 'project');
  await mkdir(path.join(projectPath, 'src'), { recursive: true });
  await mkdir(path.join(projectPath, 'node_modules', 'package'), { recursive: true });
  try {
    await writeFile(path.join(projectPath, 'src', 'checkout.ts'), 'function checkoutCart() { return true; }');
    await writeFile(path.join(projectPath, 'src', 'unrelated.ts'), 'export const greeting = "hello";');
    await writeFile(path.join(projectPath, 'node_modules', 'package', 'checkout.ts'), 'checkout checkout checkout');
    await writeFile(path.join(root, 'outside.ts'), 'checkout secret');
    const { symlink } = require('node:fs/promises');
    await symlink(path.join(root, 'outside.ts'), path.join(projectPath, 'src', 'linked.ts'));

    const first = await collectProjectContext(projectPath, 'fix checkout cart');
    const second = await collectProjectContext(projectPath, 'fix checkout cart');
    assert.deepEqual(first, second);
    assert.equal(first.length, 1);
    assert.equal(first[0].name, path.join('src', 'checkout.ts'));
    assert.match(first[0].content, /checkoutCart/);
    assert.doesNotMatch(JSON.stringify(first), /checkout secret|node_modules/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project agent tools read nested text only and reject traversal and symlinks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-agent-tools-'));
  await mkdir(path.join(root, 'src'));
  try {
    await writeFile(path.join(root, 'src', 'app.js'), 'local-only preview');
    await writeFile(path.join(root, 'outside.js'), 'outside');
    const { symlink } = require('node:fs/promises');
    await symlink(path.join(root, 'outside.js'), path.join(root, 'src', 'linked.js'));
    assert.deepEqual((await listProjectFiles(root)).files, ['outside.js', path.join('src', 'app.js')]);
    assert.equal((await readProjectRelativeFile(root, 'src/app.js')).content, 'local-only preview');
    await assert.rejects(readProjectRelativeFile(root, '../outside.js'), /relative project file path/);
    await assert.rejects(readProjectRelativeFile(root, 'src/linked.js'), /Symbolic links/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project writes stay inside the selected folder and only create bounded plain-text files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-write-'));
  const project = path.join(root, 'project');
  await mkdir(project);
  await mkdir(path.join(project, 'reports'));
  try {
    const created = await writeProjectFile(project, 'reports/plan.md', '# Plan\n');
    assert.deepEqual(created, { path: path.join('reports', 'plan.md'), bytes: 7, created: true });
    assert.equal((await readFile(path.join(project, 'reports', 'plan.md'), 'utf8')), '# Plan\n');
    const updated = await writeProjectFile(project, 'reports/plan.md', '# Updated\n');
    assert.equal(updated.created, false);
    const sheet = await writeProjectFile(project, 'reports/roles.csv', 'title,agency\nSoftware Engineer,Treasury\n');
    assert.equal(sheet.created, true);
    assert.equal(await readFile(path.join(project, 'reports/roles.csv'), 'utf8'), 'title,agency\nSoftware Engineer,Treasury\n');
    assert.equal((await readFile(path.join(project, 'reports', 'plan.md'), 'utf8')), '# Updated\n');
    await assert.rejects(writeProjectFile(project, '../outside.md', 'no'), /relative path/);
    await assert.rejects(writeProjectFile(project, '.git/config', 'no'), /relative path/);
    await assert.rejects(writeProjectFile(project, 'node_modules/file.js', 'no'), /relative path/);
    await assert.rejects(writeProjectFile(project, 'reports/data.bin', 'no'), /supported/);
    await assert.rejects(writeProjectFile(project, 'reports/large.txt', 'x'.repeat(256 * 1024 + 1)), /256 KB/);
    await assert.rejects(writeProjectFile(project, 'reports/binary.txt', 'bad\0data'), /plain text/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('project writes reject symlink targets and parent folders', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-write-link-'));
  const project = path.join(root, 'project');
  await mkdir(project);
  await writeFile(path.join(root, 'outside.txt'), 'keep safe');
  const { symlink } = require('node:fs/promises');
  try {
    await symlink(path.join(root, 'outside.txt'), path.join(project, 'linked.txt'));
    await symlink(root, path.join(project, 'linked-dir'));
    await assert.rejects(writeProjectFile(project, 'linked.txt', 'overwrite'), /regular files/);
    await assert.rejects(writeProjectFile(project, 'linked-dir/escape.txt', 'escape'), /symlinks/);
    assert.equal(await readFile(path.join(root, 'outside.txt'), 'utf8'), 'keep safe');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('binary office artifacts stay within the selected project and approved office extensions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-binary-'));
  try {
    const result = await writeProjectBinaryArtifact(root, 'reports/book.xlsx', Buffer.from('PK test'), ['.xlsx']);
    assert.equal(result.created, true);
    assert.equal((await readFile(path.join(root, 'reports/book.xlsx'))).toString(), 'PK test');
    await assert.rejects(writeProjectBinaryArtifact(root, '../outside.xlsx', Buffer.from('x'), ['.xlsx']), /relative path/);
    await assert.rejects(writeProjectBinaryArtifact(root, 'reports/file.exe', Buffer.from('x'), ['.xlsx']), /not supported/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
