const MAX_TEXT = 20_000;
const DELIVERABLES = ['essay', 'report', 'presentation', 'slides', 'code', 'notebook', 'lab report', 'problem set', 'reflection', 'poster', 'discussion post', 'video', 'proposal', 'bibliography', 'annotated bibliography', 'source code'];
const CITATION_STYLES = ['APA', 'MLA', 'Chicago', 'IEEE', 'Harvard', 'Vancouver'];
const SKILLS = [
  ['Research', /\bresearch\b/i], ['Critical thinking', /\bcritical thinking\b/i], ['Data analysis', /\bdata analysis\b/i],
  ['Statistical analysis', /\bstatistical(?: analysis)?\b/i], ['Technical writing', /\btechnical writing\b/i], ['Argumentation', /\bargument(?:ation)?\b/i],
  ['Collaboration', /\bcollaborat(?:e|ion|ive)\b/i], ['Programming', /\b(?:programming|coding|code)\b/i], ['Data visualization', /\bvisuali[sz](?:ation|e)\b/i],
  ['Communication', /\bcommunication\b/i], ['Source evaluation', /\bevaluat(?:e|ion).*sources?|source evaluation\b/i], ['Problem solving', /\bproblem[- ]solving\b/i],
];

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
  const gradingCriteria = instructions.split(/\r?\n+|(?<=[.!?])\s+/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((line) => line.length >= 12 && line.length <= 300 && /\b(?:rubric|grading|graded|criterion|criteria|points?|weight(?:ed|ing)?|assess(?:ed|ment|ing)?)\b/i.test(line)).slice(0, 10);
  const skills = SKILLS.filter(([, pattern]) => pattern.test(text)).map(([skill]) => skill);
  const dueDate = Number.isFinite(dueAt) ? new Date(dueAt).toISOString() : '';
  const instructorQuestions = [];
  if (!dueDate) instructorQuestions.push('What is the exact due date and submission time?');
  if (!deliverables.length) instructorQuestions.push('What specific deliverable or output should be submitted?');
  else if (!formatRequirements.length) instructorQuestions.push('Is there a required file format, template, or submission location?');
  if (/\b(?:cite|citation|references?|sources?|research)\b/i.test(instructions) && !citations.length) instructorQuestions.push('Which citation style and source requirements should I follow?');
  if (!gradingCriteria.length) instructorQuestions.push('Is there a rubric or weighting I should use to prioritize the requirements?');
  return { deliverables, citations, quantityRequirements: [...new Set(quantityRequirements)], formatRequirements, evidence, gradingCriteria, skills, instructorQuestions: instructorQuestions.slice(0, 4), dueDate, analyzedLocally: true };
}

module.exports = { analyzeAssignment };
