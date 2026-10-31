const test = require('node:test');
const assert = require('node:assert/strict');
const { formatConversationMarkdown } = require('../electron/conversation-export.cjs');

test('conversation export includes user and agent work, attached reference and project artifact changes', () => {
  const markdown = formatConversationMarkdown({
    title: 'Federal roles',
    messages: [
      { role: 'user', text: 'Compare these roles.', context: [{ name: 'offers.txt', content: 'SBA $172K' }] },
      { role: 'assistant', text: 'Here is the comparison.', agents: [{ role: 'Hiring analyst', text: 'SBA pays the most.' }], changes: [{ path: 'reports/roles.xlsx', created: true }] },
    ],
  });
  assert.match(markdown, /# Federal roles/);
  assert.match(markdown, /## You[\s\S]*Compare these roles/);
  assert.match(markdown, /Attached context: offers.txt/);
  assert.match(markdown, /### Hiring analyst/);
  assert.match(markdown, /Project file created: `reports\/roles.xlsx`/);
});

test('conversation export rejects malformed and oversized conversations', () => {
  assert.throws(() => formatConversationMarkdown(null), /saved conversation/);
  assert.throws(() => formatConversationMarkdown({ title: 'x', messages: Array(201).fill({ role: 'user', text: 'x' }) }), /too large/);
});
