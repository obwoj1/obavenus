const SKILLS = [
  { id: 'feature-plan', name: 'Plan a feature', instructions: 'Create a practical feature plan. Start with the user outcome, then list the smallest implementation steps, affected components, edge cases, and a clear acceptance check. State assumptions.' },
  { id: 'codebase-explore', name: 'Explore a codebase', instructions: 'Explain how the relevant parts of this codebase fit together. Trace the request through files and runtime behavior, cite paths and symbols when available, and separate observed facts from inference.' },
  { id: 'review-changes', name: 'Review changes', instructions: 'Review the requested changes as a careful maintainer. Prioritize actionable bugs, regressions, security issues, and missing validation. Cite file paths and concrete scenarios; say when you find no material issue.' },
  { id: 'debug-issue', name: 'Debug an issue', instructions: 'Investigate the reported behavior systematically. Identify likely causes from available evidence, propose the smallest fix, and give a focused verification step. Do not invent test results.' },
  { id: 'technical-docs', name: 'Write technical docs', instructions: 'Produce concise technical documentation for a reader who has not seen this conversation. Explain the purpose, prerequisites, exact steps, expected result, and limitations. Do not claim unsupported behavior.' },
  { id: 'idea-steps', name: 'Turn an idea into steps', instructions: 'Translate the idea into an ordered, achievable checklist. Make the first action concrete, group dependent steps in order, identify decisions that truly block progress, and define what done looks like.' },
];

function getSkill(id) {
  return SKILLS.find((skill) => skill.id === id) || null;
}

function applySkill(messages, id) {
  const skill = getSkill(id);
  if (!skill || !Array.isArray(messages) || messages.length === 0) return messages;
  const result = messages.map((message) => ({ ...message }));
  const index = result.map((message) => message.role).lastIndexOf('user');
  if (index < 0) return result;
  result[index].text += `\n\nSelected Obavenus workflow: ${skill.name}. ${skill.instructions}`;
  return result;
}

module.exports = { SKILLS, getSkill, applySkill };
