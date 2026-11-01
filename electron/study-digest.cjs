function buildStudyDigest(data, { now = Date.now } = {}) {
  if (!data || !Array.isArray(data.assignments) || !Array.isArray(data.courses) || !Array.isArray(data.decks)) throw new TypeError('Study data is invalid for a digest.');
  const timestamp = now();
  const week = timestamp + 7 * 24 * 60 * 60 * 1000;
  const open = data.assignments.filter((assignment) => assignment.status !== 'done');
  const overdue = open.filter((assignment) => Number.isFinite(assignment.dueAt) && assignment.dueAt < timestamp).sort((a, b) => a.dueAt - b.dueAt);
  const upcoming = open.filter((assignment) => Number.isFinite(assignment.dueAt) && assignment.dueAt >= timestamp && assignment.dueAt <= week).sort((a, b) => a.dueAt - b.dueAt);
  const cardsDue = data.decks.flatMap((deck) => deck.cards || []).filter((card) => card.dueAt <= timestamp).length;
  const pendingSteps = open.reduce((count, assignment) => count + (assignment.steps || []).filter((step) => !step.done).length, 0);
  const formatAssignment = (assignment) => {
    const course = data.courses.find((item) => item.id === assignment.courseId)?.name || 'Course';
    return `- ${assignment.title} (${course}) · ${new Date(assignment.dueAt).toLocaleString()}`;
  };
  const today = new Date(timestamp).toISOString().slice(0, 10);
  const sections = [
    `Study digest · ${today}`,
    '', `Overdue assignments: ${overdue.length}`,
    ...(overdue.length ? overdue.slice(0, 20).map(formatAssignment) : ['- None']),
    '', `Due in the next 7 days: ${upcoming.length}`,
    ...(upcoming.length ? upcoming.slice(0, 20).map(formatAssignment) : ['- None']),
    '', `Unfinished checklist steps: ${pendingSteps}`, `Flashcards ready to review: ${cardsDue}`,
    '', 'Generated on this Mac from your local Study space. Review dates and details before sharing.',
  ];
  return { subject: `Obavenus study digest · ${today}`, body: sections.join('\n') };
}

module.exports = { buildStudyDigest };
