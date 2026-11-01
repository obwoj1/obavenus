const MAX_INSTRUCTIONS = 20_000;
const ACTION = /^(?:read|review|compare|calculate|analy[sz]e|describe|explain|identify|summari[sz]e|create|develop|write|draft|discuss|evaluate|define|list|research|cite|solve|prove|demonstrate|prepare|include|use|complete|answer|submit|upload|watch|record|reflect|select|choose|find|investigate|present|show|outline|classify|interpret|apply|derive|design|build|construct|collect|measure|conduct|argue|defend|contrast|assess|respond|respond to)\b/i;

function suggestAssignmentSteps(instructions) {
  if (typeof instructions !== 'string' || instructions.length > MAX_INSTRUCTIONS) throw new TypeError('Assignment instructions must be text under 20,000 characters.');
  const candidates = instructions
    .replace(/<[^>]*>/g, ' ')
    .split(/\r?\n+|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 12 && line.length <= 300 && ACTION.test(line));
  const unique = [...new Set(candidates.map((line) => line.replace(/[.!?]+$/, '')))].slice(0, 10);
  if (unique.length) return { source: 'instructions', steps: unique };
  return {
    source: 'general',
    steps: ['Review the prompt and grading rubric', 'Gather the required course materials', 'Complete a first draft or solution', 'Check the work against every requirement', 'Confirm the due date and submission instructions'],
  };
}

module.exports = { suggestAssignmentSteps };
