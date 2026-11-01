const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStudyStore } = require('../electron/study-store.cjs');

function encryptedMock() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString(),
  };
}

test('study space is encrypted, persists courses, plans, notes, and cards', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-study-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'study.enc');
  const store = createStudyStore({ filePath, safeStorage: encryptedMock(), now: () => 100 });
  const course = await store.createCourse({ name: 'Statistics', term: 'Fall' });
  const courseId = course.courses[0].id;
  const withSource = await store.addSource({ courseId, name: 'Week 1.pdf', content: 'Page 1\nMean and variance.' });
  const stepId = '10000000-0000-4000-8000-000000000002';
  const assignmentId = '10000000-0000-4000-8000-000000000003';
  const noteId = '10000000-0000-4000-8000-000000000004';
  const deckId = '10000000-0000-4000-8000-000000000005';
  const cardId = '10000000-0000-4000-8000-000000000006';
  const moduleId = '10000000-0000-4000-8000-000000000007';
  const saved = await store.save({
    ...withSource,
    assignments: [{ id: assignmentId, courseId, title: 'Problem set', dueAt: 200, steps: [{ id: stepId, text: 'Read the prompt', done: false }] }],
    notes: [{ id: noteId, courseId, title: 'Variance', body: 'E[X²] − E[X]²' }],
    decks: [{ id: deckId, courseId, title: 'Definitions', cards: [{ id: cardId, front: 'Variance?', back: 'Expected squared deviation.' }] }],
    modules: [{ id: moduleId, courseId, canvasId: '51', title: 'Week one', position: 1, items: [{ canvasId: '52', title: 'Lecture slides', type: 'File', position: 1, locked: false }] }],
  });
  const onDisk = await readFile(filePath, 'utf8');
  assert.equal(onDisk.includes('Statistics'), false);
  assert.deepEqual(await store.load(), saved);
  assert.equal(saved.assignments[0].steps[0].done, false);
  assert.equal(saved.decks[0].cards[0].ease, 2.5);
  assert.equal(saved.sources[0].name, 'Week 1.pdf');
  assert.equal(saved.modules[0].items[0].title, 'Lecture slides');
  const reviewed = await store.reviewCard(deckId, cardId, 2, 2000);
  assert.equal(reviewed.decks[0].cards[0].repetitions, 1);
  assert.equal(reviewed.decks[0].cards[0].dueAt, 2000 + 24 * 60 * 60 * 1000);
});

test('course creation serializes concurrent saves and validates references', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-study-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createStudyStore({ filePath: path.join(root, 'study.enc'), safeStorage: encryptedMock() });
  const [a, b] = await Promise.all([
    store.createCourse({ name: 'Algebra' }),
    store.createCourse({ name: 'Biology' }),
  ]);
  assert.equal(a.courses.length + b.courses.length, 3);
  assert.equal((await store.load()).courses.length, 2);
  const courseId = a.courses[0].id;
  await assert.rejects(store.save({ version: 1, courses: a.courses, assignments: [{ id: '20000000-0000-4000-8000-000000000001', courseId: '20000000-0000-4000-8000-000000000099', title: 'Invalid' }] }), /belong to a saved course/);
});

test('study storage refuses plaintext fallback and rejects oversized data', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obavenus-study-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const unavailable = createStudyStore({ filePath: path.join(root, 'unavailable.enc'), safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(unavailable.save({ version: 1 }), /Secure study storage/);
  const store = createStudyStore({ filePath: path.join(root, 'large.enc'), safeStorage: encryptedMock() });
  const notes = Array.from({ length: 110 }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    title: `Note ${index + 1}`,
    body: 'x'.repeat(50_000),
  }));
  await assert.rejects(store.save({ version: 1, courses: [], notes }), /5 MB/);
});
