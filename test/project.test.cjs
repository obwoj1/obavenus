const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSpreadsheet, buildDocument, buildPresentation } = require('../electron/artifacts.cjs');

function makeTextPdf(text) {
  const stream = `BT /F1 18 Tf 50 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
const { describeProject, readProjectFile, collectProjectContext, readProjectRelativeFile, listProjectFiles, writeProjectFile, writeProjectBinaryArtifact, snapshotProjectFile, restoreProjectSnapshot, hashBytes } = require('../electron/project.cjs');

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

test('project previews and read tools extract bounded text from local Word, Excel, and PowerPoint files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-office-read-'));
  try {
    await writeFile(path.join(root, 'summary.xlsx'), await buildSpreadsheet({ sheets: [{ name: 'Offers', headers: ['Agency', 'Salary'], rows: [['Treasury', 153000]] }] }));
    await writeFile(path.join(root, 'brief.docx'), await buildDocument({ title: 'Hiring plan', sections: [{ heading: 'Next step', text: 'Apply through USAJOBS.' }] }));
    await writeFile(path.join(root, 'deck.pptx'), await buildPresentation({ title: 'Hiring', slides: [{ title: 'Targets', bullets: ['Treasury', 'Energy'] }] }));
    const spreadsheet = await readProjectFile(root, 'summary.xlsx');
    const document = await readProjectRelativeFile(root, 'brief.docx');
    const presentation = await readProjectRelativeFile(root, 'deck.pptx');
    assert.match(spreadsheet.content, /Sheet: Offers[\s\S]*Treasury\t153000/);
    assert.match(document.content, /Hiring plan[\s\S]*Next step[\s\S]*Apply through USAJOBS/);
    assert.match(presentation.content, /Slide 1[\s\S]*Targets[\s\S]*Treasury[\s\S]*Energy/);
    assert.equal(spreadsheet.truncated, false);
    assert.deepEqual((await listProjectFiles(root)).files, ['brief.docx', 'deck.pptx', 'summary.xlsx']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Office previews cap extracted text and reject malformed document archives', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-office-bounds-'));
  try {
    await writeFile(path.join(root, 'long.docx'), await buildDocument({ title: 'Long report', sections: Array.from({ length: 4 }, () => ({ text: 'x'.repeat(18_000) })) }));
    await writeFile(path.join(root, 'bad.docx'), 'not a zip archive');
    const preview = await readProjectFile(root, 'long.docx');
    assert.equal(preview.content.length, 60_000);
    assert.equal(preview.truncated, true);
    await assert.rejects(readProjectFile(root, 'bad.docx'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('PDF previews extract selectable text locally and reject malformed PDFs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-pdf-read-'));
  try {
    await writeFile(path.join(root, 'brief.pdf'), makeTextPdf('Obavenus PDF preview'));
    await writeFile(path.join(root, 'broken.pdf'), 'not a PDF');
    const preview = await readProjectFile(root, 'brief.pdf');
    assert.match(preview.content, /Page 1[\s\S]*Obavenus PDF preview/);
    assert.equal(preview.truncated, false);
    assert.ok((await listProjectFiles(root)).files.includes('brief.pdf'));
    await assert.rejects(readProjectFile(root, 'broken.pdf'));
  } finally { await rm(root, { recursive: true, force: true }); }
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

test('project undo restores the original file, removes new outputs, and preserves later edits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-project-undo-'));
  try {
    await writeFile(path.join(root, 'existing.md'), 'original\n');
    const snapshot = await snapshotProjectFile(root, 'existing.md');
    const updated = Buffer.from('agent output\n');
    await writeProjectFile(root, 'existing.md', updated.toString(), { expectedBeforeHash: snapshot.beforeHash });
    await restoreProjectSnapshot(root, 'existing.md', { ...snapshot, expectedAfterHash: hashBytes(updated) });
    assert.equal(await readFile(path.join(root, 'existing.md'), 'utf8'), 'original\n');

    const created = await snapshotProjectFile(root, 'reports/new.md');
    await writeProjectFile(root, 'reports/new.md', 'generated\n', { expectedAbsent: true });
    await restoreProjectSnapshot(root, 'reports/new.md', { ...created, expectedAfterHash: hashBytes(Buffer.from('generated\n')) });
    await assert.rejects(readFile(path.join(root, 'reports/new.md')));

    const changed = await snapshotProjectFile(root, 'existing.md');
    const agentOutput = Buffer.from('second agent output\n');
    await writeProjectFile(root, 'existing.md', agentOutput.toString(), { expectedBeforeHash: changed.beforeHash });
    await writeFile(path.join(root, 'existing.md'), 'newer human edit\n');
    await assert.rejects(restoreProjectSnapshot(root, 'existing.md', { ...changed, expectedAfterHash: hashBytes(agentOutput) }), /changed after the agent run/);
    assert.equal(await readFile(path.join(root, 'existing.md'), 'utf8'), 'newer human edit\n');
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
