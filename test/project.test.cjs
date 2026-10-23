const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { describeProject } = require('../electron/project.cjs');

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
