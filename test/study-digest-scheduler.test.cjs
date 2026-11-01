const assert = require('node:assert/strict');
const test = require('node:test');
const { createStudyDigestScheduler, localDateKey } = require('../electron/study-digest-scheduler.cjs');

test('scheduled digest creates one Gmail draft after its time and outside quiet hours', async () => {
  let timestamp = new Date(2026, 10, 1, 9, 15).getTime();
  const data = {
    courses: [], assignments: [], decks: [],
    digestScheduleEnabled: true, digestScheduleTime: '08:00', digestRecipient: 'student@example.com', digestLastCreatedDate: '',
    quietHoursEnabled: true, quietStart: '22:00', quietEnd: '10:00',
  };
  const drafts = [];
  const scheduler = createStudyDigestScheduler({
    loadStudy: async () => data,
    createDraft: async (draft) => { drafts.push(draft); return { id: 'draft-1' }; },
    markCreated: async (date) => { data.digestLastCreatedDate = date; },
    now: () => timestamp,
  });

  assert.deepEqual(await scheduler.check(), { created: false });
  assert.equal(drafts.length, 0);
  timestamp = new Date(2026, 10, 1, 10, 15).getTime();
  const result = await scheduler.check();
  assert.equal(result.created, true);
  assert.equal(result.date, localDateKey(new Date(timestamp)));
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].to, 'student@example.com');
  assert.match(drafts[0].subject, /study digest/i);
  assert.deepEqual(await scheduler.check(), { created: false });
  assert.equal(drafts.length, 1);
});

test('scheduled digest waits until its configured local time', async () => {
  const timestamp = new Date(2026, 10, 1, 7, 59).getTime();
  let created = false;
  const scheduler = createStudyDigestScheduler({
    loadStudy: async () => ({ courses: [], assignments: [], decks: [], digestScheduleEnabled: true, digestScheduleTime: '08:00', digestRecipient: 'student@example.com' }),
    createDraft: async () => { created = true; },
    markCreated: async () => {},
    now: () => timestamp,
  });
  assert.deepEqual(await scheduler.check(), { created: false });
  assert.equal(created, false);
});
