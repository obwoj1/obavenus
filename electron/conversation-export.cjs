function formatConversationMarkdown(conversation) {
  if (!conversation || typeof conversation.title !== 'string' || !Array.isArray(conversation.messages)) throw new TypeError('Choose a saved conversation to export.');
  if (conversation.messages.length > 200 || conversation.title.length > 200) throw new RangeError('This conversation is too large to export.');
  const lines = [`# ${conversation.title.trim() || 'Obavenus conversation'}`, '', `Exported from Obavenus · ${new Date().toISOString()}`, ''];
  for (const message of conversation.messages) {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string') continue;
    if (message.text.length > 100_000) throw new RangeError('A conversation message is too large to export.');
    lines.push(`## ${message.role === 'user' ? 'You' : 'Obavenus'}`, '', message.text, '');
    for (const file of Array.isArray(message.context) ? message.context.slice(0, 3) : []) {
      if (file && typeof file.name === 'string' && typeof file.content === 'string') lines.push(`### Attached context: ${file.name}`, '', '```text', file.content.slice(0, 60_000).replaceAll('```', '` ` `'), '```', '');
    }
    for (const agent of Array.isArray(message.agents) ? message.agents.slice(0, 10) : []) {
      if (agent && typeof agent.role === 'string' && typeof agent.text === 'string') lines.push(`### ${agent.role}`, '', agent.text.slice(0, 30_000), '');
    }
    for (const change of Array.isArray(message.changes) ? message.changes.slice(0, 50) : []) {
      if (change && typeof change.path === 'string') lines.push(`- Project file ${change.created ? 'created' : 'updated'}: \`${change.path.replaceAll('`', '')}\``);
    }
    if (message.changes?.length) lines.push('');
  }
  return lines.join('\n').slice(0, 1_000_000);
}

module.exports = { formatConversationMarkdown };
