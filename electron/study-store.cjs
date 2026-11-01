const { randomUUID } = require('node:crypto');
const { mkdir, readFile, rename, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { scheduleReview } = require('./study-review.cjs');

const MAX_STORE_BYTES = 5 * 1024 * 1024;
const EMPTY_STUDY_DATA = () => ({ version: 1, courses: [], assignments: [], notes: [], decks: [] });

function cleanText(value, label, max, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw new TypeError(`${label} must contain ${optional ? 'at most' : '1–'}${max} characters.`);
  return value.trim();
}

function validId(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{16,80}$/i.test(value)) throw new TypeError(`${label} has an invalid ID.`);
  return value;
}

function normalizeStudyData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Study data must be an object.');
  const courses = Array.isArray(value.courses) ? value.courses : [];
  const assignments = Array.isArray(value.assignments) ? value.assignments : [];
  const notes = Array.isArray(value.notes) ? value.notes : [];
  const decks = Array.isArray(value.decks) ? value.decks : [];
  if (courses.length > 100 || assignments.length > 1000 || notes.length > 1000 || decks.length > 100) throw new RangeError('Study space has reached its local item limit.');
  const ids = new Set();
  const uniqueId = (id, label) => {
    validId(id, label);
    if (ids.has(id)) throw new TypeError('Study records must have unique IDs.');
    ids.add(id);
    return id;
  };
  const normalizedCourses = courses.map((course) => ({
    id: uniqueId(course.id, 'Course'),
    name: cleanText(course.name, 'Course name', 120),
    term: cleanText(course.term, 'Course term', 80, { optional: true }),
    createdAt: Number.isFinite(course.createdAt) ? course.createdAt : Date.now(),
  }));
  const courseIds = new Set(normalizedCourses.map((course) => course.id));
  const normalizedAssignments = assignments.map((assignment) => {
    const id = uniqueId(assignment.id, 'Assignment');
    const courseId = validId(assignment.courseId, 'Assignment course');
    if (!courseIds.has(courseId)) throw new TypeError('Every assignment must belong to a saved course.');
    const steps = Array.isArray(assignment.steps) ? assignment.steps : [];
    if (steps.length > 100) throw new RangeError('An assignment can have up to 100 plan steps.');
    return {
      id,
      courseId,
      title: cleanText(assignment.title, 'Assignment title', 200),
      instructions: cleanText(assignment.instructions, 'Assignment instructions', 20_000, { optional: true }),
      dueAt: assignment.dueAt === null || assignment.dueAt === undefined || assignment.dueAt === '' ? null : Number(assignment.dueAt),
      status: ['todo', 'in-progress', 'done'].includes(assignment.status) ? assignment.status : 'todo',
      steps: steps.map((step) => ({ id: uniqueId(step.id, 'Plan step'), text: cleanText(step.text, 'Plan step', 300), done: step.done === true })),
      createdAt: Number.isFinite(assignment.createdAt) ? assignment.createdAt : Date.now(),
    };
  });
  if (normalizedAssignments.some((assignment) => assignment.dueAt !== null && !Number.isFinite(assignment.dueAt))) throw new TypeError('Assignment due dates must be valid timestamps.');
  const normalizedNotes = notes.map((note) => {
    const courseId = note.courseId ? validId(note.courseId, 'Note course') : '';
    if (courseId && !courseIds.has(courseId)) throw new TypeError('Notes must belong to a saved course.');
    return {
      id: uniqueId(note.id, 'Note'), courseId,
      title: cleanText(note.title, 'Note title', 160),
      body: cleanText(note.body, 'Note', 50_000),
      updatedAt: Number.isFinite(note.updatedAt) ? note.updatedAt : Date.now(),
    };
  });
  const normalizedDecks = decks.map((deck) => {
    const courseId = deck.courseId ? validId(deck.courseId, 'Deck course') : '';
    if (courseId && !courseIds.has(courseId)) throw new TypeError('Flashcard decks must belong to a saved course.');
    if (!Array.isArray(deck.cards) || deck.cards.length > 200) throw new RangeError('A deck can have up to 200 flashcards.');
    return {
      id: uniqueId(deck.id, 'Deck'), courseId,
      title: cleanText(deck.title, 'Deck title', 160),
      cards: deck.cards.map((card) => ({
        id: uniqueId(card.id, 'Flashcard'),
        front: cleanText(card.front, 'Flashcard prompt', 2000),
        back: cleanText(card.back, 'Flashcard answer', 5000),
        dueAt: Number.isFinite(card.dueAt) ? card.dueAt : 0,
        intervalDays: Number.isFinite(card.intervalDays) ? Math.max(0, card.intervalDays) : 0,
        repetitions: Number.isInteger(card.repetitions) ? Math.max(0, card.repetitions) : 0,
        ease: Number.isFinite(card.ease) ? Math.max(1.3, Math.min(3, card.ease)) : 2.5,
        lapses: Number.isInteger(card.lapses) ? Math.max(0, card.lapses) : 0,
        lastReviewedAt: Number.isFinite(card.lastReviewedAt) ? card.lastReviewedAt : null,
      })),
    };
  });
  return { version: 1, courses: normalizedCourses, assignments: normalizedAssignments, notes: normalizedNotes, decks: normalizedDecks };
}

function createStudyStore({ filePath, safeStorage, now = () => Date.now() }) {
  let pending = Promise.resolve();

  async function read() {
    try {
      const wrapper = JSON.parse(await readFile(filePath, 'utf8'));
      if (typeof wrapper.encrypted !== 'string') throw new Error('Study space data is invalid.');
      if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure study storage is unavailable on this Mac.');
      const data = JSON.parse(safeStorage.decryptString(Buffer.from(wrapper.encrypted, 'base64')));
      return normalizeStudyData(data);
    } catch (error) {
      if (error.code === 'ENOENT') return EMPTY_STUDY_DATA();
      throw error;
    }
  }

  async function write(value) {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('Secure study storage is unavailable on this Mac.');
    const data = normalizeStudyData(value);
    const plaintext = JSON.stringify(data);
    if (Buffer.byteLength(plaintext) > MAX_STORE_BYTES) throw new RangeError('Study space is over its 5 MB local limit.');
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      const encrypted = safeStorage.encryptString(plaintext).toString('base64');
      await writeFile(temporary, JSON.stringify({ encrypted }), { mode: 0o600 });
      await rename(temporary, filePath);
    } catch (error) {
      const { unlink } = require('node:fs/promises');
      await unlink(temporary).catch(() => {});
      throw error;
    }
    return data;
  }

  function serialize(operation) {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  }

  return {
    async load() { await pending; return read(); },
    async save(value) { return serialize(() => write(value)); },
    async createCourse({ name, term = '' }) {
      return serialize(async () => {
        const data = await read();
        data.courses.push({ id: randomUUID(), name, term, createdAt: now() });
        return write(data);
      });
    },
    async reviewCard(deckId, cardId, rating, reviewedAt = now()) {
      return serialize(async () => {
        const data = await read();
        const deck = data.decks.find((item) => item.id === deckId);
        const card = deck?.cards.find((item) => item.id === cardId);
        if (!card) throw new Error('That flashcard is no longer in this study space.');
        Object.assign(card, scheduleReview(card, rating, reviewedAt));
        return write(data);
      });
    },
  };
}

module.exports = { createStudyStore, normalizeStudyData };
