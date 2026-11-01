const { isWithinQuietHours } = require('./study-reminders.cjs');
const { buildStudyDigest } = require('./study-digest.cjs');

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function createStudyDigestScheduler({ loadStudy, createDraft, markCreated, now = () => Date.now() }) {
  let inFlight = null;
  let retryAt = 0;
  return {
    async check() {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const timestamp = now();
        const date = new Date(timestamp);
        const today = localDateKey(date);
        const data = await loadStudy();
        if (!data.digestScheduleEnabled || !data.digestRecipient || data.digestLastCreatedDate === today || timestamp < retryAt) return { created: false };
        const [hour, minute] = data.digestScheduleTime.split(':').map(Number);
        if (date.getHours() * 60 + date.getMinutes() < hour * 60 + minute || isWithinQuietHours(data, date)) return { created: false };
        const digest = buildStudyDigest(data, { now: () => timestamp });
        try {
          const draft = await createDraft({ to: data.digestRecipient, subject: digest.subject, body: digest.body });
          await markCreated(today);
          retryAt = 0;
          return { created: true, date: today, draft };
        } catch (error) {
          retryAt = timestamp + 60 * 60 * 1000;
          return { created: false, error };
        }
      })().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

module.exports = { createStudyDigestScheduler, localDateKey };
