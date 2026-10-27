const ROLES = {
  planner: {
    label: 'Lead · plan',
    prompt: 'You are the lead agent. Break the user’s request into a short plan, note assumptions, and identify what a second agent should investigate. Do not answer the user yet.',
  },
  analyst: {
    label: 'Specialist · analysis',
    prompt: 'You are an independent specialist agent. Solve the user’s request directly. Use the lead plan as context, check concrete details, and be clear about uncertainty. Return useful findings, not a plan for another agent.',
  },
  reviewer: {
    label: 'Specialist · review',
    prompt: 'You are an independent reviewer. Look for missing requirements, unsupported claims, edge cases, and a better alternative. Give a concise critique that can improve the final response.',
  },
  synthesis: {
    label: 'Lead · final response',
    prompt: 'You are the lead agent finishing a team run. Write one direct answer to the user, using the specialist analysis and review. Resolve disagreements, keep uncertainty explicit, and do not mention internal agent mechanics unless useful.',
  },
};

function lastUserMessage(messages) {
  return [...messages].reverse().find((message) => message.role === 'user');
}

async function runTeamWorkflow({ messages, dispatch, onProgress = () => {} }) {
  if (!Array.isArray(messages) || messages.length === 0) throw new TypeError('Add a message before starting a team run.');
  if (typeof dispatch !== 'function') throw new TypeError('A provider dispatcher is required.');
  const task = lastUserMessage(messages);
  if (!task) throw new TypeError('A team run needs a user request.');
  const taskText = task.text;
  const context = Array.isArray(task.context) ? task.context : [];
  const send = (role, extra = '') => dispatch([
    { role: 'user', text: `${ROLES[role].prompt}\n\nUser request:\n${taskText}${extra ? `\n\n${extra}` : ''}`, context },
  ]);
  const result = {};

  onProgress({ stage: 'planner', label: ROLES.planner.label });
  result.plan = await send('planner');

  onProgress({ stage: 'specialists', label: 'Specialists · working in parallel' });
  [result.analysis, result.review] = await Promise.all([
    send('analyst', `Lead plan:\n${result.plan}`),
    send('reviewer', `Lead plan:\n${result.plan}`),
  ]);

  onProgress({ stage: 'synthesis', label: ROLES.synthesis.label });
  result.answer = await send('synthesis',
    `Lead plan:\n${result.plan}\n\nSpecialist analysis:\n${result.analysis}\n\nIndependent review:\n${result.review}`);

  return {
    text: result.answer,
    agents: [
      { role: 'Lead · plan', text: result.plan },
      { role: 'Specialist · analysis', text: result.analysis },
      { role: 'Specialist · review', text: result.review },
    ],
  };
}

module.exports = { runTeamWorkflow };
