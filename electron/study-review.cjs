const DAY_MS = 24 * 60 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;

function scheduleReview(card, rating, reviewedAt = Date.now()) {
  if (!card || typeof card !== 'object') throw new TypeError('Choose a flashcard to review.');
  if (!Number.isInteger(rating) || rating < 0 || rating > 3) throw new RangeError('Choose Again, Hard, Good, or Easy.');
  if (!Number.isFinite(reviewedAt) || reviewedAt < 0) throw new TypeError('Review time must be a timestamp.');
  const repetitions = Number.isInteger(card.repetitions) && card.repetitions >= 0 ? card.repetitions : 0;
  const intervalDays = Number.isFinite(card.intervalDays) && card.intervalDays >= 0 ? card.intervalDays : 0;
  const ease = Number.isFinite(card.ease) ? Math.max(1.3, Math.min(3, card.ease)) : 2.5;
  let nextEase = ease;
  let nextRepetitions = repetitions;
  let nextInterval = intervalDays;

  if (rating === 0) {
    nextRepetitions = 0;
    nextInterval = 0;
  } else {
    const quality = rating + 2;
    nextEase = Math.max(1.3, ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (rating === 1) nextInterval = Math.max(1, intervalDays * 1.2);
    else if (nextRepetitions === 0) nextInterval = rating === 3 ? 4 : 1;
    else if (nextRepetitions === 1) nextInterval = rating === 3 ? 7 : 3;
    else nextInterval = intervalDays * nextEase * (rating === 3 ? 1.3 : 1);
    nextRepetitions += 1;
  }

  return {
    repetitions: nextRepetitions,
    intervalDays: Math.round(nextInterval * 100) / 100,
    ease: Math.round(nextEase * 1000) / 1000,
    lapses: (Number.isInteger(card.lapses) && card.lapses >= 0 ? card.lapses : 0) + (rating === 0 ? 1 : 0),
    lastReviewedAt: reviewedAt,
    dueAt: rating === 0 ? reviewedAt + TEN_MINUTES : reviewedAt + nextInterval * DAY_MS,
  };
}

function dueCards(decks, at = Date.now()) {
  if (!Array.isArray(decks) || !Number.isFinite(at)) return [];
  return decks.flatMap((deck) => (Array.isArray(deck.cards) ? deck.cards : [])
    .filter((card) => Number.isFinite(card.dueAt) && card.dueAt <= at)
    .map((card) => ({ ...card, deckId: deck.id, deckTitle: deck.title, courseId: deck.courseId || '' })))
    .sort((a, b) => a.dueAt - b.dueAt);
}

module.exports = { DAY_MS, dueCards, scheduleReview };
