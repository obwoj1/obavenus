const { randomUUID } = require('node:crypto');

const MAX_SENTENCES = 120;

function splitSentences(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 2000)
    .slice(0, MAX_SENTENCES);
}

function generateStudyAids(source, { now = Date.now, id = randomUUID } = {}) {
  if (!source || typeof source.name !== 'string' || typeof source.content !== 'string') throw new TypeError('Choose an imported study file first.');
  if (source.content.length > 200_000) throw new RangeError('This study file is too large to generate local study aids.');
  const sentences = splitSentences(source.content);
  if (!sentences.length) throw new Error('There is not enough readable text to generate study aids from this file.');

  const headings = source.content.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^#{1,3}\s+/.test(line) || (/^[A-Z][^.!?]{3,90}$/.test(line) && line.length < 90)).slice(0, 16).map((line) => line.replace(/^#{1,3}\s+/, ''));
  const keyPoints = [...new Set(sentences)].slice(0, 12);
  const noteBody = [
    `Generated locally from ${source.name}. This is an extractive outline; verify details against the original file.`,
    ...(headings.length ? ['', 'Topics', ...headings.map((item) => `• ${item}`)] : []),
    '', 'Key points', ...keyPoints.map((item) => `• ${item}`),
  ].join('\n');

  const patterns = [
    /^(?:\s*)([^.!?]{2,100}?)\s+(?:is defined as|is|are|means|refers to|consists of|includes)\s+(.{20,1200})$/i,
    /^(.{2,100}?)\s*[:—–-]\s*(.{20,1200})$/,
  ];
  const seen = new Set();
  const cards = [];
  for (const sentence of sentences) {
    for (const pattern of patterns) {
      const match = sentence.match(pattern);
      if (!match) continue;
      const front = `What is ${match[1].trim()}?`;
      const back = match[2].trim().replace(/[.!?]+$/, '');
      const key = `${front.toLowerCase()}|${back.toLowerCase()}`;
      if (front.length > 2000 || back.length > 5000 || seen.has(key)) break;
      seen.add(key);
      cards.push({ id: id(), front, back, dueAt: now(), intervalDays: 0, repetitions: 0, ease: 2.5, lapses: 0, lastReviewedAt: null });
      break;
    }
    if (cards.length >= 30) break;
  }
  if (!cards.length) {
    for (const [index, sentence] of keyPoints.entries()) {
      cards.push({ id: id(), front: `What is a key point from ${source.name} (${index + 1})?`, back: sentence, dueAt: now(), intervalDays: 0, repetitions: 0, ease: 2.5, lapses: 0, lastReviewedAt: null });
      if (cards.length >= 12) break;
    }
  }
  return {
    note: { id: id(), courseId: source.courseId || '', title: `${source.name} · study outline`, body: noteBody.slice(0, 50_000), updatedAt: now() },
    deck: { id: id(), courseId: source.courseId || '', title: `${source.name} · generated cards`.slice(0, 160), cards },
    sourceName: source.name,
  };
}

function buildPracticeQuiz(deck, { limit = 10 } = {}) {
  if (!deck || !Array.isArray(deck.cards)) throw new TypeError('Choose a flashcard deck first.');
  const cards = deck.cards.filter((card) => card.front && card.back).slice(0, Math.max(1, Math.min(20, limit)));
  if (cards.length < 2) throw new Error('Add at least two cards to this deck before starting a quiz.');
  return cards.map((card, index) => {
    const distractors = cards.filter((item) => item.id !== card.id).map((item) => item.back).filter((answer) => answer !== card.back).slice(0, 3);
    if (distractors.length < 1) return null;
    const options = distractors.slice(0, 3);
    const correctIndex = index % (options.length + 1);
    options.splice(correctIndex, 0, card.back);
    return { prompt: card.front, options, correctIndex, explanation: card.back };
  }).filter(Boolean);
}

module.exports = { generateStudyAids, splitSentences, buildPracticeQuiz };
