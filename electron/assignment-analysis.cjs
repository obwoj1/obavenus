const MAX_TEXT = 20_000;
const DELIVERABLES = ['essay', 'report', 'presentation', 'slides', 'code', 'notebook', 'lab report', 'problem set', 'reflection', 'poster', 'discussion post', 'video', 'proposal', 'bibliography', 'annotated bibliography', 'source code'];
const CITATION_STYLES = ['APA', 'MLA', 'Chicago', 'IEEE', 'Harvard', 'Vancouver'];

function analyzeAssignment({ title = '', instructions = '', dueAt = null } = {}) {
  if (typeof title !== 'string' || typeof instructions !== 'string' || title.length > 200 || instructions.length > MAX_TEXT) throw new TypeError('Assignment text exceeds its local analysis limit.');
  const text = `${title}\n${instructions}`;
  const lower = text.toLowerCase();
  const deliverables = DELIVERABLES.filter((item) => lower.includes(item));
  const citations = CITATION_STYLES.filter((style) => new RegExp(`\\b${style}\\b`, 'i').test(text));
  const quantityRequirements = [...text.matchAll(/\b(?:(?:at least|minimum(?: of)?|no fewer than|up to|at most|maximum(?: of)?)\s+)?\d[\d,]*\s*[-– ]\s*(?:words?|pages?|slides?|minutes?|sources?|references?)\b/gi)]
    .map((match) => match[0].replace(/\s+/g, ' ').trim());
  const formatRequirements = [...new Set([...text.matchAll(/\b(?:PDF|DOCX?|PPTX?|CSV|XLSX?|Jupyter notebook|video|PowerPoint|Google Slides)\b/gi)].map((match) => match[0]))];
  const evidence = instructions.split(/\r?\n+|(?<=[.!?])\s+/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((line) => line.length >= 12 && line.length <= 300 && /\b(?:must|required|include|submit|upload|attach|minimum|maximum|at least|no more than|cite|citation|format|rubric|criteria)\b/i.test(line)).slice(0, 12);
  const dueDate = Number.isFinite(dueAt) ? new Date(dueAt).toISOString() : '';
  return { deliverables, citations, quantityRequirements: [...new Set(quantityRequirements)], formatRequirements, evidence, dueDate, analyzedLocally: true };
}

module.exports = { analyzeAssignment };
